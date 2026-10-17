# 02 — A lone player can start a match that never ends

| | |
| --- | --- |
| Category | Bug (game flow / soft-lock) |
| Priority | High |
| Component | `apps/server` — `src/app.config.ts`, `src/rooms/GameRoom.ts` |
| Verified | By code reading (see Evidence); no test currently covers it |

## Problem

The production room type is created with `minPlayers: 1`:

```ts
// apps/server/src/app.config.ts
[GAME_ROOM]: defineRoom(gameRoom({ rules: { maxPlayers: 4, minPlayers: 1 } })).enableRealtimeListing(),
```

`DEFAULT_RULES.winCondition` is `"last-standing"`. `checkWinCondition()` is only
called from `handleEvents()` when a `hit` event occurred, and from `onLeave()` —
**never when a round starts**. `matchDecided()`'s forfeit branch also requires
`matchSeats > 1`.

So with a single seated human:

- `RoomScreen`'s `canStart` is true (`seated.length >= state.minPlayers`), and the
  `start` handler passes its `minPlayers` guard.
- `beginCountdown()` runs, the round enters `playing`, and the win condition is
  never evaluated. The round can only end if the player suicides with a bounced
  shot (`bullet.canHitOwner` is `true`). Otherwise the room is stuck in `playing`
  forever.

## Evidence

- `apps/server/src/app.config.ts` line with `minPlayers: 1`.
- `apps/server/src/rooms/GameRoom.ts`:
  - `start` handler: `if (this.seatedPlayers().length < this.rules.minPlayers) …`
  - `checkWinCondition()` — only reachable via `handleEvents`' `if (hit) this.checkWinCondition()` and `onLeave`.
  - `matchDecided()` — `seated.length < this.rules.minPlayers || (this.matchSeats > 1 && seated.length <= 1)`; with one seat neither is true.

## Proposed change (pick one, prefer the first)

1. Require `minPlayers: 2` for the shipped room (the lobby already offers
   **Add bot** so solo players can still play), and/or
2. Make `checkWinCondition()` run once when `beginPlaying()` is reached, and
   auto-resolve a match with fewer than 2 live tanks (abort back to the lobby
   rather than "winning" a 1-player round), and/or
3. Refuse `start` when only one seat is filled and no bot is seated, replying with
   a `system` message.

Option 2 alone is not enough (ending a solo round as an immediate draw is silly);
combine 1 or 3 with a start-time check if you want solo play to stay possible.

## Acceptance test (write this first)

In `apps/server/test/GameRoom.test.ts` (or a new `Solo.test.ts`), boot a room with
`rules: { minPlayers: 1, countdownSeconds: 0.1, loot: { enabled: false } }`, join a
single client, send `start`, then:

> assert that within ~2 seconds the phase is **not** `playing` — either `start` was
> refused (phase stays `lobby`, with a `system` message) or the match resolves back
> to the lobby.

Today the phase stays `playing`/`countdown` and the assertion times out.

## Files likely touched

- `apps/server/src/app.config.ts`
- `apps/server/src/rooms/GameRoom.ts` (`beginPlaying`, `checkWinCondition`, `start`)
- `apps/server/test/GameRoom.test.ts` (or a new test file)

## Definition of done

- New test passes; `Match.test.ts`, `Bots.test.ts` and `GameRoom.test.ts` still pass.
- `bun run typecheck && bun run lint && bun run test` is green.
