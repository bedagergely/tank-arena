# 01 — Bot shot planner disagrees with the authoritative simulation

| | |
| --- | --- |
| Category | Bug (gameplay AI correctness) |
| Priority | High |
| Component | `packages/shared` — `src/engine/bot.ts`, `src/engine/simulation.ts` |
| Verified | Yes, reproduced with an angle sweep (numbers below) |

## Problem

The bot decides where to shoot with `simulateShot()` in
`packages/shared/src/engine/bot.ts`. It predicts the bullet path **analytically**:
straight ray/segment casts against the walls (`castShotRay`, `rayShotBox`), a
rounded-corner Minkowski model for wall corners, and a `SHOT_NUDGE` off each
surface.

The real bullet is moved by `moveCircle()` in
`packages/shared/src/engine/physics.ts`, which advances in sub-steps and resolves
**each axis independently** (`if (!hitX && sx !== 0) …; if (!hitY && sy !== 0) …`),
reflecting on tick boundaries. These are different collision models and they
diverge near corners, tangents and simultaneous wall contacts.

Consequence: the bot picks angles it believes will hit the enemy, and the bullet
misses — or worse, hits the shooter itself.

## Evidence

An angle sweep (720 angles, `rules.bullet.maxBounces = 5`, comparing
`simulateShot()`'s prediction to a live `createJsEngine` run) gives:

```
corridor: predicted=167 mismatches=10   (e.g. angle 0.567 → planner says hit, live = miss)
detour:   predicted=29  mismatches=4    (e.g. angle 0.724 → planner says hit, live hits the SHOOTER)
```

`corridor` and `detour` are the test maps already defined in
`packages/shared/test/bot.test.ts`. Reproduction script (adapt the map imports as
needed):

```ts
const rules = { ...DEFAULT_RULES, loot: { ...DEFAULT_RULES.loot, enabled: false } };

function liveHit(map: GameMap, angle: number): number | undefined {
  const engine = createJsEngine(map, rules);
  engine.reset([0, 1], 1);
  engine.world.tanks[0]!.angle = angle;
  engine.setInput(0, { throttle: 0, turn: 0, fire: true });
  const dt = 1 / rules.tickRate;
  for (let i = 0; i < rules.tickRate * 6; i++) {
    const events = engine.step(dt);
    engine.setInput(0, { throttle: 0, turn: 0, fire: false });
    const hit = events.find((e) => e.type === "hit");
    if (hit?.type === "hit") return hit.targetSlot;
  }
  return undefined;
}

// for each of 720 angles: if simulateShot(...).slot === target.slot but
// liveHit(map, angle) !== target.slot, that is a mismatch.
```

## Proposed change

Make the planner use the **same** collision model as the simulation:

- Reimplement `simulateShot()` by stepping the bullet with `moveCircle()` at
  `dt = 1 / rules.tickRate`, exactly as `predictImpact()` already does for dodging,
  instead of the analytic ray casts. Stop when the bullet exceeds its bounce
  budget, leaves the time budget, or hits a tank.
- Alternatively (less invasive but slower): keep the analytic candidate search in
  `findShot()`, but verify the chosen angle by replaying it through the stepper
  before returning it.
- Keep `findShot()`'s candidate generation (direct line, mirror images, coarse
  sweep) unchanged; only the prediction function needs to agree with the sim.

Do not change `stepBullets()`/`moveCircle()` semantics to match the planner — the
simulation is the source of truth.

## Acceptance test (write this first)

In `packages/shared/test/bot.test.ts`, add:

> **"the shot planner agrees with the live simulation"** — sweep ~720 angles on
> `corridor` and `detour`; for every angle where
> `simulateShot(world, map, rules, shooter, angle, rules.bullet.maxBounces)` returns
> a hit on the target, fire that angle in a live engine and assert the sim reports
> a `hit` on the target slot and **never** on the shooter.

This fails today (10 mismatches on `corridor`, 4 on `detour`).

## Files likely touched

- `packages/shared/src/engine/bot.ts` (`simulateShot`, possibly `castShotRay`/`rayShotBox` removed)
- `packages/shared/test/bot.test.ts`

## Definition of done

- New test passes; existing `bot.test.ts` and `simulation.test.ts` still pass.
- `bun run typecheck && bun run lint && bun run test` is green.
- No behavioural change to `stepWorld`/`moveCircle`.
