# 12 — `setName` works mid-match and is unrated

| | |
| --- | --- |
| Category | Robustness |
| Priority | Low |
| Component | `apps/server/src/rooms/GameRoom.ts` |
| Verified | By code reading |

## Problem

The `setName` handler sanitises the name but otherwise has no guards, unlike every
other lobby-only message (`ready`, `start`, `setRounds`, `addBot`, `removeBot` all
check `this.state.phase !== "lobby"`):

```ts
setName: (client: GameClient, payload: ClientMessages["setName"]) => {
  const player = this.state.players.get(client.sessionId);
  const name = readText(payload, "name", MAX_NAME_LENGTH);
  if (!player || !name) return;
  player.name = name;
},
```

So a player can rename mid-round, and there is no rate limit on the message (unlike
`chat`, which has a `RateLimiter`). Names appear on the scoreboard and in chat, so
renaming mid-match is confusing and the unrated message is a small abuse vector.

## Proposed change

- Restrict renaming to the `lobby` phase (match the other lobby-only handlers), or
- If renaming mid-match is intended, add a per-client `RateLimiter` (reuse
  `apps/server/src/util/RateLimiter.ts`) and re-broadcast nothing extra (the name
  already syncs via schema).

The client (`RoomScreen`) only offers renaming indirectly via the home screen, so
restricting to the lobby should not break the UI.

## Acceptance test (write this first)

In `apps/server/test/GameRoom.test.ts` (or `Match.test.ts`):

> 1. In the lobby, `host.send("setName", { name: "New" })` changes the name.
> 2. After the match starts (`phase === "playing"`), send `setName` again and assert
>    the name is **unchanged**.

Part 2 fails today. If you keep mid-match renaming, instead assert that the
`limit + 1`th rename in the window is rejected.

## Files likely touched

- `apps/server/src/rooms/GameRoom.ts`
- `apps/server/test/GameRoom.test.ts`

## Definition of done

- New test passes; existing seating/chat tests still pass.
- `bun run typecheck && bun run lint && bun run test` is green.
