import { Room, type Client, type StepContext } from "colyseus";
import {
  clampRounds,
  createJsEngine,
  DEFAULT_MAP_ID,
  getMap,
  MAX_CHAT_LENGTH,
  MAX_NAME_LENGTH,
  PERK_BULLET_SPEED,
  PERK_BULLETS,
  PERK_NAMES,
  PERK_SHIELD,
  PERK_TANK_SPEED,
  resolveRules,
  sanitizeInput,
  winsNeeded,
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
import { BulletState, GameState, LootState, PlayerState, TankState } from "./schema/GameState.ts";
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
  /** Seats taken when the match began; a match with fewer players left ends by forfeit. */
  private matchSeats = 0;

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
      this.beginMatch();
    },

    setRounds: (client: GameClient, payload: ClientMessages["setRounds"]) => {
      if (client.sessionId !== this.state.hostSessionId) return;
      if (this.state.phase !== "lobby") return;
      const rounds = clampRounds(isRecord(payload) ? payload.rounds : undefined, this.rules);
      if (rounds === undefined || rounds === this.state.rounds) return;
      this.state.rounds = rounds;
      this.system(`Match set to best of ${rounds} (first to ${winsNeeded(rounds)}).`);
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
    this.state.rounds = clampRounds(this.rules.match.rounds, this.rules) ?? this.rules.match.rounds;

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
        this.tickPhaseTimer(ctx.dt, () => this.nextRound());
        return;
      case "match-over":
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
      this.beginMatch();
    }
  }

  private beginMatch() {
    const seated = this.seatedPlayers();
    for (const p of this.state.players.values()) p.wins = 0;
    this.state.round = 0;
    this.state.matchWinnerSlot = -1;
    this.matchSeats = seated.length;
    void this.lock();
    this.system(`Best of ${this.state.rounds}: first to ${winsNeeded(this.state.rounds)} round wins.`);
    this.beginCountdown();
  }

  private beginCountdown() {
    const seated = this.seatedPlayers();
    this.engine.reset(
      seated.map((p) => p.slot),
      newSeed(),
    );
    this.syncWorld();
    this.state.round += 1;
    this.state.winnerSlot = -1;
    this.setPhase("countdown", this.rules.countdownSeconds);
    this.system(`Round ${this.state.round} of ${this.state.rounds} starting...`);
  }

  /** After a round result: either the next round, or the match is over. */
  private nextRound() {
    const seated = this.seatedPlayers();
    if (this.matchDecided(seated)) this.finishMatch(seated);
    else this.beginCountdown();
  }

  /**
   * True once someone holds the majority, all rounds have been played, or too
   * few of the original players are left to continue (forfeit).
   */
  private matchDecided(seated: PlayerState[]): boolean {
    const needed = winsNeeded(this.state.rounds);
    if (seated.some((p) => p.wins >= needed) || this.state.round >= this.state.rounds) return true;
    return seated.length < this.rules.minPlayers || (this.matchSeats > 1 && seated.length <= 1);
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
        case "shield-block":
          this.broadcast("event", { type: "shield-block", shooterSlot: e.shooterSlot, targetSlot: e.targetSlot });
          break;
        case "loot-spawn":
          this.broadcast("event", { type: "loot-spawn", x: e.x, y: e.y });
          break;
        case "loot-pickup": {
          this.broadcast("event", { type: "loot-pickup", slot: e.slot, perk: e.perk });
          const player = this.seatedPlayers().find((p) => p.slot === e.slot);
          if (player) this.system(`${player.name} picked up ${PERK_NAMES[e.perk]}.`);
          break;
        }
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
    this.finishRound(winnerSlot);
  }

  private finishRound(winnerSlot: number) {
    this.state.winnerSlot = winnerSlot;
    const seated = this.seatedPlayers();
    const winner = seated.find((p) => p.slot === winnerSlot);
    if (winner) {
      winner.wins += 1;
      this.system(`${winner.name} wins round ${this.state.round}! (${scoreline(seated)})`);
    } else {
      this.system(`Round ${this.state.round} is a draw.`);
    }
    if (this.matchDecided(seated)) this.finishMatch(seated);
    else this.setPhase("finished", this.rules.resultSeconds);
  }

  /** Match winner: the (single) player with the most round wins; a tie is a drawn match. */
  private finishMatch(seated: PlayerState[]) {
    const best = Math.max(0, ...seated.map((p) => p.wins));
    const leaders = seated.filter((p) => p.wins === best);
    const winner = leaders.length === 1 ? leaders[0] : undefined;
    this.state.matchWinnerSlot = winner?.slot ?? -1;
    this.system(winner ? `${winner.name} wins the match ${scoreline(seated)}!` : `The match is a draw (${scoreline(seated)}).`);
    this.setPhase("match-over", this.rules.match.resultSeconds);
  }

  private returnToLobby() {
    this.state.tanks.clear();
    this.state.bullets.clear();
    this.state.loot.clear();
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
      }
      s.x = tank.x;
      s.y = tank.y;
      s.angle = tank.angle;
      s.alive = tank.alive;
      s.perkBullets = tank.perks[PERK_BULLETS];
      s.perkBulletSpeed = tank.perks[PERK_BULLET_SPEED];
      s.perkTankSpeed = tank.perks[PERK_TANK_SPEED];
      s.perkShield = tank.perks[PERK_SHIELD];
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

    // Loot boxes never move: only additions and removals need syncing.
    const liveLoot = new Set<string>();
    for (const box of world.loot) {
      const key = String(box.id);
      liveLoot.add(key);
      if (!this.state.loot.has(key)) {
        this.state.loot.set(key, new LootState({ id: box.id, x: box.x, y: box.y, perk: box.perk }));
      }
    }
    for (const key of [...this.state.loot.keys()]) {
      if (!liveLoot.has(key)) this.state.loot.delete(key);
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

function scoreline(seated: PlayerState[]): string {
  return seated.map((p) => p.wins).join("–");
}

/** Non-zero 32-bit seed for the round's loot RNG; the engine is deterministic given the seed. */
function newSeed(): number {
  return (Math.floor(Math.random() * 0xffffffff) | 0) || 1;
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
