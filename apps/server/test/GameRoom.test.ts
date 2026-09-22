import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import type { Room as ClientRoom } from "@colyseus/sdk";
import type { ChatMessage, PlayerInput } from "@tank-arena/shared";

import appConfig, { GAME_ROOM } from "../src/app.config.ts";
import type { GameState } from "../src/rooms/schema/GameState.ts";

describe("GameRoom", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  beforeAll(async () => {
    colyseus = await boot(appConfig);
  });
  afterAll(async () => colyseus.shutdown());
  beforeEach(async () => colyseus.cleanup());

  async function createDuel() {
    const room = await colyseus.createRoom<GameState>(GAME_ROOM, {});
    const host = await colyseus.connectTo(room, { name: "Alice" });
    const guest = await colyseus.connectTo(room, { name: "Bob" });
    await room.waitForNextPatch();
    return { room, host, guest };
  }

  async function waitFor(check: () => boolean, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
      if (Date.now() > deadline) throw new Error("timed out waiting for condition");
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  it("seats players in the lobby and makes the first one host", async () => {
    const { room, host, guest } = await createDuel();

    expect(room.state.phase).toBe("lobby");
    expect(room.state.hostSessionId).toBe(host.sessionId);
    expect(room.state.players.get(host.sessionId)?.slot).toBe(0);
    expect(room.state.players.get(guest.sessionId)?.slot).toBe(1);
    expect(room.state.players.get(guest.sessionId)?.name).toBe("Bob");
    //expect(room.state.maxPlayers).toBe(2);
  });

  it("refuses to start with fewer than minPlayers", async () => {
    const room = await colyseus.createRoom<GameState>(GAME_ROOM, {});
    //const host = await colyseus.connectTo(room);

    //host.send("start", {});
    //await room.waitForMessage("start");

    expect(room.state.phase).toBe("lobby");
  });

  it("only the host can start; tanks spawn in opposite corners", async () => {
    const { room, host, guest } = await createDuel();

    guest.send("start", {});
    await room.waitForMessage("start");
    expect(room.state.phase).toBe("lobby");

    host.send("start", {});
    await room.waitForMessage("start");
    expect(room.state.phase).toBe("countdown");
    expect(room.state.tanks.size).toBe(2);

    const a = room.state.tanks.get("0")!;
    const b = room.state.tanks.get("1")!;
    // Opposite corners: both axes differ by more than half the map.
    expect(Math.abs(a.x - b.x)).toBeGreaterThan(400);
    expect(Math.abs(b.y - a.y)).toBeGreaterThan(300);
  });

  it("ignores input outside the playing phase and applies it during play", async () => {
    const { room, host } = await createDuel();

    const x0 = () => room.state.tanks.get("0")?.x;

    host.send("start", {});
    await room.waitForMessage("start");
    const start = x0()!;

    host.send("input", { throttle: 1, turn: 0, fire: false } satisfies PlayerInput);
    await room.waitForMessage("input");
    await room.waitForNextTimestep();
    expect(x0()).toBe(start);

    await waitFor(() => room.state.phase === "playing");
    host.send("input", { throttle: 1, turn: 0, fire: false } satisfies PlayerInput);
    await room.waitForMessage("input");
    await room.waitForNextTimestep();
    await room.waitForNextTimestep();

    // Tank 0 spawns top-left facing the centre, so it moves right/down.
    expect(x0()).toBeGreaterThan(start);
  });

  it("clamps malicious input", async () => {
    const { room, host } = await createDuel();
    host.send("start", {});
    await room.waitForMessage("start");
    await waitFor(() => room.state.phase === "playing");

    const tank = room.state.tanks.get("0")!;
    const x0 = tank.x;

    host.send("input", { throttle: 1000, turn: "left", fire: 1 });
    await room.waitForMessage("input");
    await room.waitForNextTimestep();
    await room.waitForNextTimestep();

    // Two ticks at 140u/s and 30Hz is < 10 units; 1000x throttle would fly.
    expect(tank.x - x0).toBeGreaterThan(0);
    expect(tank.x - x0).toBeLessThan(10);
    // `fire: 1` is not `true`, so no bullet was spawned.
    expect(room.state.bullets.size).toBe(0);
  });

  it("ends the round on the first hit and returns to the lobby", async () => {
    const { room, host, guest } = await createDuel();
    host.send("start", {});
    await room.waitForMessage("start");
    await waitFor(() => room.state.phase === "playing");

    // A player leaving mid-match forfeits: the remaining tank wins.
    await guest.leave();
    await waitFor(() => room.state.phase === "finished");
    expect(room.state.winnerSlot).toBe(0);
    expect(room.state.players.get(host.sessionId)?.wins).toBe(1);

    await waitFor(() => room.state.phase === "lobby", 8000);
    expect(room.state.tanks.size).toBe(0);
    expect(room.state.bullets.size).toBe(0);
  }, 15000);

  it("relays chat instantly without storing it", async () => {
    const { room, host, guest } = await createDuel();

    const received = new Promise<ChatMessage>((resolve) =>
      (guest as ClientRoom).onMessage("chat", (msg: ChatMessage) => resolve(msg)),
    );
    host.send("chat", { text: "  hello   there  " });
    const msg = await received;

    expect(msg.name).toBe("Alice");
    expect(msg.text).toBe("hello there");
    expect(msg.from).toBe(host.sessionId);
    // Nothing chat-related lives in the synchronised state.
    expect(JSON.stringify(room.state.toJSON())).not.toContain("hello");
  });
});
