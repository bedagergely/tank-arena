import { Room, type Client, type StepContext } from "colyseus";
import {
  createJsEngine,
  DEFAULT_MAP_ID,
  getMap,
  MAX_CHAT_LENGTH,
  MAX_NAME_LENGTH,
  resolveRules,
  sanitizeInput,
  type EngineFactory,
  type GameEngine,
  type GameRules,
  type JoinOptions,
  type Phase,
  type RulesOverrides,
  type ClientMessages,
  type ServerMessages,
  type TickEvent,
} from "@tank-arena/shared";
import { BulletState, GameState, PlayerState, TankState } from "./schema/GameState.ts";
import { RateLimiter } from "../util/RateLimiter.ts";

/**
 * Server-side configuration of a room type. Deliberately *not* part of the
 * client-supplied create options so clients can never influence the rules.
 */
export interface GameRoomConfig {
  rules?: RulesOverrides;
  /** Swap the simulation implementation (e.g. a WASM build). */
  engineFactory?: EngineFactory;
}

/** Build a room variant with fixed rules: `defineRoom(gameRoom({ rules: { maxPlayers: 4 } }))`. */
export function gameRoom(config: GameRoomConfig): typeof GameRoom {
  return class extends GameRoom {
    protected override readonly config = config;
  };
}

interface ClientData {
  chatLimiter: RateLimiter;
}

type GameClient = Client<{ messages: ServerMessages; userData: ClientData }>;

/**
 * One match lobby + arena. The room owns all game truth: clients only send
 * intents (input, chat, ready, start), the server simulates and broadcasts.
 * Message payload types describe the wire contract; every handler still
 * treats its payload as untrusted and validates it before use.
 */
export class GameRoom extends Room<{ state: GameState; client: GameClient }> {
  override state = new GameState();
  protected readonly config: GameRoomConfig = {};
  /** Clients exceeding this are disconnected by Colyseus (flood protection). */
  override maxMessagesPerSecond = 60;

  private rules!: GameRules;
  private engine!: GameEngine;
  private phaseTimer = 0;
  private lastCountdownShown = -1;

  override messages = {
    input: (client: GameClient, payload: ClientMessages["input"]) => {
      if (this.state.phase !== "playing") return;
      const player = this.state.players.get(client.sessionId);
      if (!player || player.slot < 0) return;
      this.engine.setInput(player.slot, sanitizeInput(payload));
    },

    chat: (client: GameClient, payload: ClientMessages["chat"]) => {
      const player = this.state.players.get(client.sessionId);
      const text = readText(payload, "text", MAX_CHAT_LENGTH);
      if (!player || !text) return;
      if (!client.userData?.chatLimiter.allow()) {
        client.send("system", { text: "You are sending messages too fast.", at: Date.now() });
        return;
      }
      // Chat is relayed only; nothing is stored on the server.
      this.broadcast("chat", { from: client.sessionId, name: player.name, text, at: Date.now() });
    },

    ready: (client: GameClient, payload: ClientMessages["ready"]) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || this.state.phase !== "lobby" || player.slot < 0) return;
      player.ready = isRecord(payload) && payload.ready === true;
      this.tryAutoStart();
    },

    start: (client: GameClient, _payload: ClientMessages["start"]) => {
      if (client.sessionId !== this.state.hostSessionId) return;
      if (this.state.phase !== "lobby") return;
      if (this.seatedPlayers().length < this.rules.minPlayers) {
        client.send("system", { text: `Need at least ${this.rules.minPlayers} players to start.`, at: Date.now() });
        return;
      }
      this.beginCountdown();
    },

    setName: (client: GameClient, payload: ClientMessages["setName"]) => {
      const player = this.state.players.get(client.sessionId);
      const name = readText(payload, "name", MAX_NAME_LENGTH);
      if (!player || !name) return;
      player.name = name;
    },
  };

  override onCreate(options: JoinOptions) {
    const mapId = typeof options.mapId === "string" && getMap(options.mapId) ? options.mapId : DEFAULT_MAP_ID;
    const map = getMap(mapId)!;

    this.rules = resolveRules(this.config.rules);
    this.engine = (this.config.engineFactory ?? createJsEngine)(map, this.rules);
    this.maxClients = this.rules.maxPlayers;

    this.state.mapId = mapId;
    this.state.minPlayers = this.rules.minPlayers;
    this.state.maxPlayers = this.rules.maxPlayers;
    this.state.tankRadius = this.rules.tank.radius;
    this.state.bulletRadius = this.rules.bullet.radius;

    void this.setMetadata({ mapId, phase: "lobby" });
    this.setFixedTimestep((ctx) => this.step(ctx), this.rules.tickRate);
  }

  override onJoin(client: GameClient, options: JoinOptions) {
    client.userData = { chatLimiter: new RateLimiter(5, 3000) };

    const name = readText(options, "name", MAX_NAME_LENGTH) ?? `Player ${this.state.players.size + 1}`;
    const player = new PlayerState({ sessionId: client.sessionId, name });
    this.state.players.set(client.sessionId, player);

    if (this.state.phase === "lobby") {
      player.slot = this.nextFreeSlot();
    }
    if (!this.state.hostSessionId) {
      this.state.hostSessionId = client.sessionId;
    }

    this.system(`${name} joined.`);
  }

  override onLeave(client: GameClient) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    this.state.players.delete(client.sessionId);
    this.system(`${player.name} left.`);

    if (this.state.hostSessionId === client.sessionId) {
      const next = this.state.players.keys().next();
      this.state.hostSessionId = next.done ? "" : next.value;
    }

    if ((this.state.phase === "playing" || this.state.phase === "countdown") && player.slot >= 0) {
      this.engine.eliminate(player.slot);
      this.syncWorld();
      this.checkWinCondition();
    }
  }

  // ---------------------------------------------------------------------------
  // Match flow
  // ---------------------------------------------------------------------------

  private step(ctx: StepContext) {
    switch (this.state.phase as Phase) {
      case "lobby":
        return;
      case "countdown":
        this.tickPhaseTimer(ctx.dt, () => this.beginPlaying());
        return;
      case "playing":
        this.simulate(ctx.dt);
        return;
      case "finished":
        this.tickPhaseTimer(ctx.dt, () => this.returnToLobby());
        return;
    }
  }

  private tickPhaseTimer(dt: number, onDone: () => void) {
    this.phaseTimer -= dt;
    const shown = Math.max(0, Math.ceil(this.phaseTimer));
    if (shown !== this.lastCountdownShown) {
      this.lastCountdownShown = shown;
      this.state.countdown = shown;
    }
    if (this.phaseTimer <= 0) onDone();
  }

  private setPhase(phase: Phase, seconds = 0) {
    this.state.phase = phase;
    this.phaseTimer = seconds;
    this.lastCountdownShown = -1;
    this.state.countdown = Math.ceil(seconds);
    void this.setMetadata({ ...this.metadata, phase });
  }

  private tryAutoStart() {
    const seated = this.seatedPlayers();
    if (seated.length >= this.rules.minPlayers && seated.every((p) => p.ready)) {
      this.beginCountdown();
    }
  }

  private beginCountdown() {
    const seated = this.seatedPlayers();
    this.engine.reset(seated.map((p) => p.slot));
    this.syncWorld();
    this.state.round += 1;
    this.state.winnerSlot = -1;
    this.setPhase("countdown", this.rules.countdownSeconds);
    void this.lock();
    this.system(`Round ${this.state.round} starting...`);
  }

  private beginPlaying() {
    this.setPhase("playing");
    this.system("Fight!");
  }

  private simulate(dt: number) {
    const events = this.engine.step(dt);
    this.syncWorld();
    this.handleEvents(events);
  }

  private handleEvents(events: TickEvent[]) {
    let hit = false;
    for (const e of events) {
      switch (e.type) {
        case "fire":
          this.broadcast("event", { type: "fire", slot: e.slot });
          break;
        case "bounce":
          this.broadcast("event", { type: "bounce", x: e.x, y: e.y });
          break;
        case "hit":
          hit = true;
          this.broadcast("event", { type: "hit", shooterSlot: e.shooterSlot, targetSlot: e.targetSlot });
          break;
        case "bullet-expired":
          break;
      }
    }
    if (hit) this.checkWinCondition();
  }

  private checkWinCondition() {
    if (this.state.phase !== "playing" && this.state.phase !== "countdown") return;
    const alive = this.engine.world.tanks.filter((t) => t.alive);
    const total = this.engine.world.tanks.length;

    const over =
      this.rules.winCondition === "first-hit" ? alive.length < total : alive.length <= 1;
    if (!over) return;

    const winnerSlot = alive.length === 1 ? alive[0]!.slot : -1;
    this.finishMatch(winnerSlot);
  }

  private finishMatch(winnerSlot: number) {
    this.state.winnerSlot = winnerSlot;
    const winner = this.seatedPlayers().find((p) => p.slot === winnerSlot);
    if (winner) {
      winner.wins += 1;
      this.system(`${winner.name} wins round ${this.state.round}!`);
    } else {
      this.system(`Round ${this.state.round} is a draw.`);
    }
    this.setPhase("finished", this.rules.resultSeconds);
  }

  private returnToLobby() {
    this.state.tanks.clear();
    this.state.bullets.clear();
    for (const player of this.state.players.values()) {
      player.ready = false;
      if (player.slot < 0) player.slot = this.nextFreeSlot();
    }
    this.setPhase("lobby");
    void this.unlock();
  }

  // ---------------------------------------------------------------------------
  // World -> schema
  // ---------------------------------------------------------------------------

  private syncWorld() {
    const world = this.engine.world;

    for (const tank of world.tanks) {
      const key = String(tank.slot);
      let s = this.state.tanks.get(key);
      if (!s) {
        s = new TankState({ slot: tank.slot, x: tank.x, y: tank.y, angle: tank.angle, alive: tank.alive });
        this.state.tanks.set(key, s);
        continue;
      }
      s.x = tank.x;
      s.y = tank.y;
      s.angle = tank.angle;
      s.alive = tank.alive;
    }
    for (const key of [...this.state.tanks.keys()]) {
      if (!world.tanks.some((t) => String(t.slot) === key)) this.state.tanks.delete(key);
    }

    const seen = new Set<string>();
    for (const bullet of world.bullets) {
      const key = String(bullet.id);
      seen.add(key);
      let s = this.state.bullets.get(key);
      if (!s) {
        s = new BulletState({ id: bullet.id, ownerSlot: bullet.ownerSlot, x: bullet.x, y: bullet.y, bounces: bullet.bounces });
        this.state.bullets.set(key, s);
        continue;
      }
      s.x = bullet.x;
      s.y = bullet.y;
      s.bounces = bullet.bounces;
    }
    for (const key of [...this.state.bullets.keys()]) {
      if (!seen.has(key)) this.state.bullets.delete(key);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private seatedPlayers(): PlayerState[] {
    return [...this.state.players.values()].filter((p) => p.slot >= 0).sort((a, b) => a.slot - b.slot);
  }

  private nextFreeSlot(): number {
    const taken = new Set([...this.state.players.values()].map((p) => p.slot));
    for (let slot = 0; slot < this.rules.maxPlayers; slot++) {
      if (!taken.has(slot)) return slot;
    }
    return -1;
  }

  private system(text: string) {
    this.broadcast("system", { text, at: Date.now() }, { afterNextPatch: true });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readText(payload: unknown, key: string, maxLength: number): string | undefined {
  if (!isRecord(payload)) return undefined;
  const raw = payload[key];
  if (typeof raw !== "string") return undefined;
  const text = raw.replace(/\s+/g, " ").trim().slice(0, maxLength);
  return text.length > 0 ? text : undefined;
}
