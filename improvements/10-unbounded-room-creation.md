# 10 — Nothing caps room creation or joins

| | |
| --- | --- |
| Category | Security (resource exhaustion) |
| Priority | Medium |
| Component | `apps/server/src/app.config.ts` |
| Verified | By code reading |

## Problem

The `game` room is defined with `.enableRealtimeListing()` and no creation guard:

```ts
[GAME_ROOM]: defineRoom(gameRoom({ rules: { maxPlayers: 4, minPlayers: 1 } })).enableRealtimeListing(),
```

Any client can create an unbounded number of rooms. Each room boots a 30 Hz fixed
timestep, a schema, and a bot pool, so a single attacker can exhaust CPU and memory
with cheap `create()` calls. There is also no per-IP cap on joins.

## Proposed change

Pick one or combine:

1. **Global cap:** a module-level counter of live rooms, incremented in `onCreate`
   and decremented in `onDispose`, and reject/refuse creation past a configurable
   maximum. Rejecting a `create` needs care with Colyseus — the cleanest place is a
   matchmaker `onCreate` hook or a small express-level gate for a custom create
   endpoint.
2. **Per-IP creation rate limit:** a sliding-window limiter (reuse
   `apps/server/src/util/RateLimiter.ts`) keyed on the client IP in a matchmaker
   filter or a wrapping HTTP handler.
3. **Join rate limit:** reject joins beyond N per IP per minute.

Make the limits env-configurable (e.g. `MAX_ROOMS`), and forward the new variable in
`docker-compose.yml`'s `game` service `environment:` block if it is read from
`process.env` — `AGENTS.md` notes `.env` is only read by the server process and must
be forwarded explicitly.

## Acceptance test (write this first)

In `apps/server/test/` add a test that:

> boots the server with the cap set to `N` (e.g. 2) and creates `N` rooms
> successfully, then asserts the `N + 1`th creation is rejected (and that disposing
> a room frees a slot).

If the limiter is implemented as a standalone function, unit-test it directly with
injected `now`/IP, mirroring `09-ratelimiter-untested.md`. The end-to-end assertion
above is the real acceptance test.

## Files likely touched

- `apps/server/src/app.config.ts`
- `apps/server/src/rooms/GameRoom.ts` (lifecycle counting)
- `apps/server/src/util/RateLimiter.ts` (reuse)
- `docker-compose.yml`, `.env.example` (if env-driven)
- `apps/server/test/` (new)

## Definition of done

- New test passes; normal multi-room usage (two players, two rooms) still works.
- `bun run typecheck && bun run lint && bun run test` is green.
