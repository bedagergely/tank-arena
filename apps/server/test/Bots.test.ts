import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { defineRoom, defineServer } from "colyseus";
import type { PlayerInput } from "@tank-arena/shared";

import { gameRoom } from "../src/rooms/GameRoom.ts";
import type { GameState } from "../src/rooms/schema/GameState.ts";

const ROOM = "bots";
const appConfig = defineServer({
  rooms: {
    [ROOM]: defineRoom(
      gameRoom({
        rules: {
          minPlayers: 2,
          maxPlayers: 3,
          countdownSeconds: 0.1,
          resultSeconds: 0.1,
          match: { resultSeconds: 0.2 },
          loot: { enabled: false },
        },
      }),
    ),
  },
});

describe("bots", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  beforeAll(async () => {
    colyseus = await boot(appConfig);
  });
  afterAll(async () => colyseus.shutdown());
  beforeEach(async () => colyseus.cleanup());

  async function waitFor(check: () => boolean, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
      if (Date.now() > deadline) throw new Error("timed out waiting for condition");
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  function bots(room: { state: GameState }) {
    return [...room.state.players.values()].filter((p) => p.isBot);
  }

  it("lets only the host add and remove bots, and only in the lobby", async () => {
    const room = await colyseus.createRoom<GameState>(ROOM, {});
    const host = await colyseus.connectTo(room, { name: "Alice" });
    const guest = await colyseus.connectTo(room, { name: "Bob" });
    await room.waitForNextPatch();

    guest.send("addBot", { difficulty: "hard" });
    await room.waitForMessage("addBot");
    expect(bots(room)).toHaveLength(0);

    host.send("addBot", { difficulty: "hard" });
    await room.waitForMessage("addBot");
    const [bot] = bots(room);
    expect(bot).toMatchObject({ slot: 2, ready: true, isBot: true, difficulty: "hard" });
    expect(bot!.name).toContain("(bot)");

    guest.send("removeBot", { sessionId: bot!.sessionId });
    await room.waitForMessage("removeBot");
    expect(bots(room)).toHaveLength(1);

    host.send("start", {});
    await room.waitForMessage("start");
    expect(room.state.phase).toBe("countdown");
    host.send("removeBot", { sessionId: bot!.sessionId });
    await room.waitForMessage("removeBot");
    expect(bots(room)).toHaveLength(1);
    expect(room.state.tanks.size).toBe(3);
  });

  it("falls back to the default difficulty for garbage payloads", async () => {
    const room = await colyseus.createRoom<GameState>(ROOM, {});
    const host = await colyseus.connectTo(room, { name: "Alice" });
    await room.waitForNextPatch();

    host.send("addBot", { difficulty: "god-mode" });
    await room.waitForMessage("addBot");
    expect(bots(room)[0]?.difficulty).toBe("normal");

    host.send("removeBot", { sessionId: bots(room)[0]!.sessionId });
    await room.waitForMessage("removeBot");
    expect(bots(room)).toHaveLength(0);
  });

  it("bots take seats: the room refuses more bots and more humans than maxPlayers", async () => {
    const room = await colyseus.createRoom<GameState>(ROOM, {});
    const host = await colyseus.connectTo(room, { name: "Alice" });
    await room.waitForNextPatch();

    host.send("addBot", {});
    await room.waitForMessage("addBot");
    host.send("addBot", {});
    await room.waitForMessage("addBot");
    host.send("addBot", {});
    await room.waitForMessage("addBot");
    expect(bots(room)).toHaveLength(2);
    expect(room.maxClients).toBe(1);

    await expect(colyseus.connectTo(room, { name: "Bob" })).rejects.toThrow();

    host.send("removeBot", { sessionId: bots(room)[0]!.sessionId });
    await room.waitForMessage("removeBot");
    expect(room.maxClients).toBe(2);
    const guest = await colyseus.connectTo(room, { name: "Bob" });
    await room.waitForNextPatch();
    expect(room.state.players.get(guest.sessionId)?.slot).toBeGreaterThanOrEqual(0);
  });

  it("counts toward minPlayers and plays: the bot acts on its own, humans cannot drive it", async () => {
    const room = await colyseus.createRoom<GameState>(ROOM, {});
    const host = await colyseus.connectTo(room, { name: "Alice" });
    await room.waitForNextPatch();

    host.send("start", {});
    await room.waitForMessage("start");
    expect(room.state.phase).toBe("lobby");

    host.send("addBot", { difficulty: "hard" });
    await room.waitForMessage("addBot");
    host.send("start", {});
    await room.waitForMessage("start");
    expect(room.state.phase).toBe("countdown");
    await waitFor(() => room.state.phase === "playing");

    const botSlot = bots(room)[0]!.slot;
    const tank = room.state.tanks.get(String(botSlot))!;
    const before = { x: tank.x, y: tank.y, angle: tank.angle };
    await waitFor(
      () =>
        tank.x !== before.x ||
        tank.y !== before.y ||
        tank.angle !== before.angle ||
        [...room.state.bullets.values()].some((b) => b.ownerSlot === botSlot),
      3000,
    );

    // A human's input only ever reaches their own tank.
    const mine = room.state.tanks.get("0")!;
    const x0 = mine.x;
    host.send("input", { throttle: 1, turn: 0, fire: false } satisfies PlayerInput);
    await room.waitForMessage("input");
    await room.waitForNextTimestep();
    await room.waitForNextTimestep();
    expect(mine.x).toBeGreaterThan(x0);
  });

  it("a lone human toggling Ready auto-starts against a (always ready) bot", async () => {
    const room = await colyseus.createRoom<GameState>(ROOM, {});
    const host = await colyseus.connectTo(room, { name: "Alice" });
    await room.waitForNextPatch();

    host.send("addBot", {});
    await room.waitForMessage("addBot");
    expect(room.state.phase).toBe("lobby");
    host.send("ready", { ready: true });
    await room.waitForMessage("ready");
    expect(room.state.phase).toBe("countdown");
  });

  it("never hands the host role to a bot; the room survives a match and keeps the bot in the lobby", async () => {
    const room = await colyseus.createRoom<GameState>(ROOM, {});
    const host = await colyseus.connectTo(room, { name: "Alice" });
    const guest = await colyseus.connectTo(room, { name: "Bob" });
    await room.waitForNextPatch();

    host.send("addBot", {});
    await room.waitForMessage("addBot");
    const botId = bots(room)[0]!.sessionId;

    await host.leave();
    await waitFor(() => room.state.hostSessionId === guest.sessionId);
    expect(room.state.players.has(botId)).toBe(true);

    // Bots stay seated across the whole match and come back to the lobby with everyone else.
    guest.send("setRounds", { rounds: 1 });
    await room.waitForMessage("setRounds");
    guest.send("start", {});
    await room.waitForMessage("start");
    await waitFor(() => room.state.phase === "playing");
    await waitFor(() => room.state.phase === "lobby", 20000);
    expect(room.state.players.get(botId)?.slot).toBeGreaterThanOrEqual(0);
    expect(room.state.players.get(botId)?.ready).toBe(true);
    expect(bots(room)).toHaveLength(1);
  }, 30000);
});
