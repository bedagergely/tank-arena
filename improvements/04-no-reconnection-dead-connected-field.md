# 04 — Disconnects are permanent; `connected` is dead state

| | |
| --- | --- |
| Category | Bug (robustness) |
| Priority | High |
| Component | `apps/server/src/rooms/GameRoom.ts`, `apps/server/src/rooms/schema/GameState.ts`, `apps/client/src/ui/RoomScreen.tsx` |
| Verified | Yes — grep shows `connected` is never written |

## Problem

`GameRoom` implements `onLeave()` but no `onDrop()` / `onReconnect()`, and never
calls `allowReconnection()`. In Colyseus 0.18 a room without `onDrop` receives
every disconnect in `onLeave`, so any transient network blip permanently removes
the player and forfeits the match (`onLeave` calls `engine.eliminate()` and
`checkWinCondition()` during `playing`/`countdown`).

`PlayerState.connected` exists in the schema with a default of `true` but is never
assigned anywhere in the codebase — dead synchronised state that costs bandwidth
on every patch.

## Evidence

- `apps/server/src/rooms/GameRoom.ts` — only `onLeave(client)` is defined.
- `apps/server/src/rooms/schema/GameState.ts` — `connected: t.boolean().default(true)`.
- `grep -rn "connected" --include='*.ts' --include='*.tsx'` matches the schema
  declaration and comments only; no assignment.

## Proposed change

Adopt the 0.18 reconnection lifecycle (see the bundled Colyseus skill at
`.devin/skills/colyseus/`):

```ts
onDrop(client: GameClient, code: CloseCode) {
  const player = this.state.players.get(client.sessionId);
  if (player) player.connected = false;
  this.allowReconnection(client, 30); // no await; the outcome routes to the hooks
}

onReconnect(client: GameClient) {
  const player = this.state.players.get(client.sessionId);
  if (player) player.connected = true;
}

onLeave(client: GameClient, code: CloseCode) {
  // unchanged: remove the player, reassign host, eliminate the tank
}
```

Notes:

- Do **not** eliminate or delete the player in `onDrop`; removal stays in `onLeave`.
- Do not let a bot hold the host role (existing logic already skips bots).
- The forfeit path in `onLeave` must remain for a real leave/timeout.
- Client: `RoomScreen` should register `room.onDrop` / `room.onReconnect` and show a
  "reconnecting…" state instead of bouncing home; keep the existing `onLeave`
  handler for `FAILED_TO_RECONNECT`.

## Acceptance test (write this first)

In `apps/server/test/` add a reconnection test:

1. Two clients start a match; assert both players have `connected === true`.
2. Force a drop on one client and assert its `connected` becomes `false` **and**
   the player is still present in `state.players` (not eliminated).
3. Reconnect using the SDK reconnection token and assert `connected === true`
   again, the same `slot` and `wins` are preserved.
4. Separately, assert a consented `leave()` still removes the player and forfeits.

Use `@colyseus/testing`'s room helpers; if the harness cannot drop a socket,
exercise `onDrop`/`onReconnect` through the room instance directly. Steps 1/2/4
must fail today (the field never changes and a drop removes the player).

## Files likely touched

- `apps/server/src/rooms/GameRoom.ts`
- `apps/client/src/ui/RoomScreen.tsx`
- `apps/server/test/` (new or extended test file)

## Definition of done

- `connected` is written on drop/reconnect (no longer dead state).
- New test passes; `Match.test.ts` forfeit tests still pass.
- `bun run typecheck && bun run lint && bun run test` is green.
