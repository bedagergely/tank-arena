import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { defineRoom, defineServer } from "colyseus";
import { JsGameEngine, type EngineFactory, type TickEvent } from "@tank-arena/shared";

import { gameRoom } from "../src/rooms/GameRoom.ts";
import type { GameState } from "../src/rooms/schema/GameState.ts";

/**
 * A real engine whose hits can be scripted from the test, so round outcomes
 * are deterministic without steering tanks through the arena.
 */
class ScriptedEngine extends JsGameEngine {
  private pendingKill: number | undefined;

  kill(slot: number) {
    this.pendingKill = slot;
  }

  override step(dt: number): TickEvent[] {
    const events = super.step(dt);
    if (this.pendingKill !== undefined) {
      const slot = this.pendingKill;
      this.pendingKill = undefined;
      this.eliminate(slot);
      events.push({ type: "hit", bulletId: 0, shooterSlot: slot === 0 ? 1 : 0, targetSlot: slot });
    }
    return events;
  }
}

const engines: ScriptedEngine[] = [];
const engineFactory: EngineFactory = (map, rules) => {
  const engine = new ScriptedEngine(map, rules);
  engines.push(engine);
  return engine;
};

const ROOM = "match";
const appConfig = defineServer({
  rooms: {
    [ROOM]: defineRoom(
      gameRoom({
        engineFactory,
        rules: {
          countdownSeconds: 0.1,
          resultSeconds: 0.1,
          match: { resultSeconds: 0.2 },
          loot: { enabled: false },
        },
      }),
    ),
  },
});

describe("best-of-N match", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  beforeAll(async () => {
    colyseus = await boot(appConfig);
  });
  afterAll(async () => colyseus.shutdown());
  beforeEach(async () => {
    engines.length = 0;
    await colyseus.cleanup();
  });

  async function createDuel() {
    const room = await colyseus.createRoom<GameState>(ROOM, {});
    const host = await colyseus.connectTo(room, { name: "Alice" });
    const guest = await colyseus.connectTo(room, { name: "Bob" });
    await room.waitForNextPatch();
    return { room, host, guest, engine: engines[engines.length - 1]! };
  }

  async function waitFor(check: () => boolean, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
      if (Date.now() > deadline) throw new Error("timed out waiting for condition");
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  /** Wait for the current round to be live, then have `loser` lose it. */
  async function playRound(room: { state: GameState }, engine: ScriptedEngine, loser: number, expectRound: number) {
    await waitFor(() => room.state.phase === "playing" && room.state.round === expectRound);
    engine.kill(loser);
    await waitFor(() => room.state.phase !== "playing");
  }

  it("only the host can change the round count, only in the lobby, within bounds", async () => {
    const { room, host, guest } = await createDuel();
    expect(room.state.rounds).toBe(5);

    guest.send("setRounds", { rounds: 3 });
    await room.waitForMessage("setRounds");
    expect(room.state.rounds).toBe(5);

    host.send("setRounds", { rounds: 3 });
    await room.waitForMessage("setRounds");
    expect(room.state.rounds).toBe(3);

    host.send("setRounds", { rounds: 1000 });
    await room.waitForMessage("setRounds");
    expect(room.state.rounds).toBe(15);

    host.send("setRounds", { rounds: "7" });
    await room.waitForMessage("setRounds");
    expect(room.state.rounds).toBe(15);

    host.send("start", {});
    await room.waitForMessage("start");
    host.send("setRounds", { rounds: 1 });
    await room.waitForMessage("setRounds");
    expect(room.state.rounds).toBe(15);
  });

  it("ends as soon as someone holds the majority and skips the remaining rounds", async () => {
    const { room, host, guest, engine } = await createDuel();
    host.send("start", {});
    await room.waitForMessage("start");
    expect(room.state.round).toBe(1);

    await playRound(room, engine, 1, 1); // Alice 1–0
    expect(room.state.phase).toBe("finished");
    expect(room.state.winnerSlot).toBe(0);
    expect(room.state.players.get(host.sessionId)?.wins).toBe(1);

    await playRound(room, engine, 0, 2); // 1–1
    expect(room.state.phase).toBe("finished");
    expect(room.state.winnerSlot).toBe(1);

    await playRound(room, engine, 1, 3); // 2–1
    await playRound(room, engine, 1, 4); // 3–1: majority of 5 reached

    // No round-result interlude, straight to the match result; round 5 never starts.
    expect(room.state.phase).toBe("match-over");
    expect(room.state.round).toBe(4);
    expect(room.state.matchWinnerSlot).toBe(0);
    expect(room.state.players.get(host.sessionId)?.wins).toBe(3);
    expect(room.state.players.get(guest.sessionId)?.wins).toBe(1);

    await waitFor(() => room.state.phase === "lobby");
    expect(room.state.round).toBe(4);
    expect(room.state.tanks.size).toBe(0);
    // Scores stay visible in the lobby until the next match starts.
    expect(room.state.players.get(host.sessionId)?.wins).toBe(3);
  });

  it("a fresh match resets the scores and honours the new round count", async () => {
    const { room, host, engine } = await createDuel();
    host.send("setRounds", { rounds: 1 });
    await room.waitForMessage("setRounds");

    host.send("start", {});
    await room.waitForMessage("start");
    await playRound(room, engine, 1, 1);
    expect(room.state.phase).toBe("match-over");
    expect(room.state.matchWinnerSlot).toBe(0);
    await waitFor(() => room.state.phase === "lobby");

    host.send("setRounds", { rounds: 3 });
    await room.waitForMessage("setRounds");
    host.send("start", {});
    await room.waitForMessage("start");
    await room.waitForNextPatch();
    expect(room.state.round).toBe(1);
    expect(room.state.matchWinnerSlot).toBe(-1);
    expect(room.state.players.get(host.sessionId)?.wins).toBe(0);

    await playRound(room, engine, 0, 1);
    await playRound(room, engine, 0, 2);
    expect(room.state.phase).toBe("match-over");
    expect(room.state.matchWinnerSlot).toBe(1);
  });

  it("a player leaving mid-match forfeits the whole match", async () => {
    const { room, host, guest, engine } = await createDuel();
    host.send("start", {});
    await room.waitForMessage("start");
    await playRound(room, engine, 1, 1); // Alice 1–0

    await waitFor(() => room.state.phase === "playing" && room.state.round === 2);
    await guest.leave();
    await waitFor(() => room.state.phase === "match-over");
    expect(room.state.matchWinnerSlot).toBe(0);
    expect(room.state.players.get(host.sessionId)?.wins).toBe(2);
    await waitFor(() => room.state.phase === "lobby");
  });
});
