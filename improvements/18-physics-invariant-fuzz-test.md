# 18 — Physics invariant fuzz test

| | |
| --- | --- |
| Category | Tests (invariant coverage) |
| Priority | Low |
| Component | `packages/shared/test/simulation.test.ts` |
| Verified | By code reading |

## Problem

`moveCircle()` makes a strong guarantee — a body is never left overlapping a wall,
even when a single step is longer than the wall is thick — and `circleHitsWall()`
is the only collision predicate in the engine. The existing tests cover a couple of
hand-picked cases (`"collides with thin walls and never tunnels through them"`) but
nothing asserts the invariant holds generally. Physics regressions here would
undermine tanks, bullets and the bot's dodge logic at once.

## Proposed change

None to the implementation. Add a seeded, randomized invariant test. Keep it
deterministic (fixed seed) so it is reproducible and CI-stable, and keep the
iteration count modest so the suite stays fast.

## Acceptance test

In `packages/shared/test/simulation.test.ts`, add a test that:

1. Builds a maze map (reuse `generateMaze` + `compileMap`, or the `corridor`/
   `detour` fixtures) and a seeded PRNG.
2. For N iterations, picks a random start that is not colliding, and a random large
   step (both components up to several wall thicknesses), calls `moveCircle`, and
   asserts:
   - the result is **not** inside a wall: `circleHitsWall(map, r.x, r.y, radius)` is
     `false`;
   - if `r.hitX` is `true`, the resulting `x` is at or before the blocking wall (the
     axis did not advance past the obstruction);
   - likewise for `hitY`;
   - the body never moves further than requested along an unblocked axis.
3. Also fuzz `circlesOverlap`/`circleHitsWall` with boundary values (exactly
   touching, `r = 0`, point on the map border) to pin the `<` vs `<=` semantics.

If any iteration fails, that is a real bug: fix the physics and keep the seed that
reproduces it.

## Files likely touched

- `packages/shared/test/simulation.test.ts`

## Definition of done

- New test passes deterministically across runs (fixed seed).
- Existing physics/simulation tests still pass.
- `bun run typecheck && bun run lint && bun run test` is green.
