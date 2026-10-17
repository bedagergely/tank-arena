# 06 — A bullet cannot hit on the tick it reaches `maxBounces`

| | |
| --- | --- |
| Category | Bug (simulation correctness) |
| Priority | Medium |
| Component | `packages/shared/src/engine/simulation.ts` |
| Verified | By code reading (see Evidence) |

## Problem

In `stepBullets()`, when a bullet's bounce count reaches `maxBounces` the bullet is
destroyed **before** the tank collision test runs:

```ts
if (moved.hitX || moved.hitY) {
  bullet.bounces += 1;
  events.push({ type: "bounce", bulletId: bullet.id, x: bullet.x, y: bullet.y });
  if (bullet.bounces >= maxBounces) {
    events.push({ type: "bullet-expired", bulletId: bullet.id });
    continue;                       // <-- no tank test happens on this tick
  }
}

const target = findHitTank(world, bullet, radius, tankRadius, canHitOwner);
```

So a bullet whose final permitted bounce lands it on a tank passes through without
registering a hit. This is also one of the ways the bot's planner disagrees with
the simulation (see `01-bot-shot-planner-desync.md`).

## Proposed change

Run the tank test for the current position first, then apply the bounce/expire
bookkeeping:

- Move `findHitTank(...)` (and the shield/hit handling) ahead of the
  `bullet.bounces >= maxBounces` early-out, or
- Restructure so the expire check happens after the hit resolution, and only
  `continue` when the bullet neither hit nor expired.

Preserve existing behaviour: a bounce event is still emitted, a bullet that expires
without hitting is still removed, and `bullet-expired` is still broadcast-ignored
by the room.

## Acceptance test (write this first)

In `packages/shared/test/simulation.test.ts`:

> Build a scenario where a bullet's Nth (`maxBounces`) bounce coincides with a tank
> at the contact point, and assert a `hit` event is emitted for that tank (the
> bullet is destroyed by the hit, not silently expired).

A convenient way to construct this: place a stationary tank on the corridor map so
a bullet fired at a wall bounces back onto it exactly as the bounce budget runs
out; assert `events` contains a `hit` for the target and no `bullet-expired`
precedes it. Today the hit is missing.

The consistency sweep in `01-bot-shot-planner-desync.md` is a broader guard for the
same root cause — land both if you fix this first.

## Files likely touched

- `packages/shared/src/engine/simulation.ts` (`stepBullets`)
- `packages/shared/test/simulation.test.ts`

## Definition of done

- New test passes; existing bounce/expire tests in `simulation.test.ts` still pass
  (`"bullets bounce off walls and expire after maxBounces"`, `"a bullet hitting a
  tank kills it and reports the shooter"`).
- `bun run typecheck && bun run lint && bun run test` is green.
