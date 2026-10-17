# 03 — `GameRoom.test.ts` has a test that asserts nothing

| | |
| --- | --- |
| Category | Tests (vacuous test) |
| Priority | High |
| Component | `apps/server/test/GameRoom.test.ts` |
| Verified | Yes — the body is commented out |

## Problem

The test named `"refuses to start with fewer than minPlayers"` has its entire body
commented out and only re-asserts that the room is in the lobby, which is true
before anyone does anything:

```ts
it("refuses to start with fewer than minPlayers", async () => {
  const room = await colyseus.createRoom<GameState>(GAME_ROOM, {});
  //const host = await colyseus.connectTo(room);
  //host.send("start", {});
  //await room.waitForMessage("start");
  expect(room.state.phase).toBe("lobby");
});
```

It also **cannot** test the guard as written: `app.config.ts` uses `minPlayers: 1`
(see `02-solo-match-never-ends.md`), so a single client is allowed to start.

Related: the same file has `//expect(room.state.maxPlayers).toBe(2);` commented out
in the seating test, and the room is actually configured with `maxPlayers: 4`.

## Proposed change

Rewrite the test against a room that actually requires two players, so it
exercises the refusal path and the `system` feedback:

- Boot a dedicated `defineServer({ rooms: { solo: defineRoom(gameRoom({ rules: { minPlayers: 2 } })) } })`
  in the test (mirroring how `Match.test.ts` builds its own config), or reuse the
  existing room type and connect two clients for the positive case.
- Assert that after a lone client sends `start`, the phase is still `lobby` **and**
  the client received a `system` message containing "Need at least 2 players".

Also fix the seating test to assert the real capacity (`maxPlayers`), un-commenting
the line with the correct value.

## Acceptance test (write this first)

The rewritten `it("refuses to start with fewer than minPlayers")` is itself the
acceptance test. It must:

1. fail against the current code (the guard is never exercised), then
2. pass once the test uses a `minPlayers: 2` room and asserts the `system` message.

## Files likely touched

- `apps/server/test/GameRoom.test.ts`

## Definition of done

- No commented-out assertions remain in the file.
- The test fails for the right reason before the room config is fixed and passes after.
- `bun run test` is green.
