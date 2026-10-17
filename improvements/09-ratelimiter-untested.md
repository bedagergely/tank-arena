# 09 — `RateLimiter` has zero tests

| | |
| --- | --- |
| Category | Tests (coverage gap) |
| Priority | Medium |
| Component | `apps/server/src/util/RateLimiter.ts` |
| Verified | Yes — no test file exists for it |

## Problem

`RateLimiter` is the only thing preventing chat flooding
(`new RateLimiter(5, 3000)` per client in `GameRoom.onJoin`), yet it has no test
file. The sliding-window boundary is exactly where off-by-one bugs hide:

```ts
allow(now = Date.now()): boolean {
  const cutoff = now - this.windowMs;
  while (this.stamps.length > 0 && this.stamps[0]! <= cutoff) this.stamps.shift();
  if (this.stamps.length >= this.limit) return false;
  this.stamps.push(now);
  return true;
}
```

The `now` parameter is already injectable, which makes this trivial to test without
real time.

## Proposed change

None to the implementation unless a test uncovers a bug. Add the test file. If you
want, also add a test that `GameRoom` replies with the
`"You are sending messages too fast."` system message once the limiter trips.

## Acceptance test

New file `apps/server/test/RateLimiter.test.ts` (vitest) covering:

- Allows exactly `limit` calls inside the window, rejects the `limit + 1`th.
- Allows again once the window has slid past the earliest stamp.
- Boundary: a call exactly `windowMs` after the first is expired
  (`stamps[0] <= cutoff`), so it is allowed.
- Interleaved timestamps: a burst, a gap longer than the window, then a fresh burst
  is allowed.
- A rejected call does not push a stamp (so it does not extend the lockout).

These are pure assertions on the injected `now`, so they run instantly.

## Files likely touched

- `apps/server/test/RateLimiter.test.ts` (new)

## Definition of done

- New test file passes; if it revealed a bug, the fix is included with a regression
  case.
- `bun run typecheck && bun run lint && bun run test` is green.
