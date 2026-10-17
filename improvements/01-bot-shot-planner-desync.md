# 01 — Bot shot planner disagrees with the authoritative simulation

| | |
| --- | --- |
| Category | Bug (gameplay AI correctness) |
| Priority | High |
| Component | `packages/shared` — `src/engine/bot.ts`, `src/engine/physics.ts` |
| Verified | Yes, reproduced with an angle sweep (numbers below) |

## Problem

The bot decides where to shoot with `simulateShot()` in
`packages/shared/src/engine/bot.ts`. It predicts the bullet path **analytically**:
straight ray/segment casts against the walls (`castShotRay`, `rayShotBox`), a
rounded-corner Minkowski model for wall corners, and a `SHOT_NUDGE` off each
surface.

The real bullet is moved by `moveCircle()` in
`packages/shared/src/engine/physics.ts`, whose semantics are quite specific:

- the move is split into `steps = ceil(max(|dx|, |dy|) / (2 * radius))` sub-steps,
- each sub-step resolves **X first, then Y**, testing each axis independently
  against `circleHitsWall`,
- once an axis is blocked it is **latched**: `hitX`/`hitY` stay true and that axis
  stops advancing for the rest of the *call* (the loop also breaks early when both
  are blocked),
- `circleHitsWall` is a circle-vs-AABB test via `clamp` (i.e. the wall grown by the
  radius with rounded corners), plus a map-bounds check.

The analytic model does not reproduce the sub-step quantization or the per-axis
latching, so the two disagree near corners, tangents and simultaneous contacts.

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

**Keep the planner analytic and fast, but make the analytic model agree with the
step-based simulation.** Do not simply replace `simulateShot` with a stepper loop,
and do not change the simulation — the simulation is the source of truth and the
bot must match it as it is.

Concretely, the replacement model must reproduce, at minimum:

1. The sub-step quantization: a leg's displacement is divided into
   `ceil(max(|dx|, |dy|) / (2 * radius))` equal sub-steps, so the achievable path
   depends on the total leg length, not just its direction.
2. Per-axis latching: within a single `moveCircle` call, a blocked axis freezes for
   the remainder of that call while the other axis keeps advancing (using the
   current value of the frozen axis). Reflection happens once per call, per axis,
   at the moment the axis latches.
3. The same collision primitive as `circleHitsWall` (wall grown by the radius with
   rounded corners + map bounds), not a sharp grown box.
4. The simulation's event ordering: `stepBullets` destroys a bullet on the tick it
   reaches `maxBounces` **before** the tank collision test, so a hit on that tick
   does not happen. The planner must reproduce that ordering rather than "improve"
   on it.

`findShot()`'s candidate generation (direct line, mirror images, coarse sweep) and
the performance characteristics of the search should stay as they are; only the
prediction function needs to agree with the sim.

An exact closed form may not be attainable; that is acceptable. The gate is the
differential test below — **any** analytic implementation that passes it is
acceptable, whether that means deriving the latched geometry exactly or adding a
cheap reconciliation step that keeps the search analytic.

## Acceptance test (write this first)

Two layers, both in `packages/shared/test/`:

1. **Differential equivalence (the real gate).** Add a seeded randomized test that,
   for a large corpus of `(map, start, displacement)` cases, runs the new analytic
   model and `moveCircle`/`stepBullets` and asserts they agree on the outcome:
   final position (within a tight epsilon), `hitX`/`hitY`, bounce count, and — for
   shot simulation — which tank (if any) is hit and with how many bounces.
   Include the corner/tangent cases that currently diverge.
2. **Planner vs live engine.** Sweep ~720 angles on `corridor` and `detour`; for
   every angle where the planner reports a hit on the target, fire it in a live
   engine and assert the sim reports a `hit` on the target slot and **never** on the
   shooter. This fails today (10 + 4 mismatches).

## Files likely touched

- `packages/shared/src/engine/bot.ts` (`simulateShot`, `castShotRay`, `rayShotBox`)
- `packages/shared/src/engine/physics.ts` (only if a shared primitive is extracted)
- `packages/shared/test/bot.test.ts`, `packages/shared/test/simulation.test.ts`

## Definition of done

- The differential test passes with a tight tolerance; the planner-vs-engine sweep
  reports zero mismatches on both maps.
- Existing `bot.test.ts` and `simulation.test.ts` still pass; the planner stays
  analytic (no per-tick stepper replay in the hot path).
- `bun run typecheck && bun run lint && bun run test` is green.
- No behavioural change to `stepWorld`/`moveCircle`.
