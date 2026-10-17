# 19 — Spatial index for wall lookups

| | |
| --- | --- |
| Category | Performance |
| Priority | Medium |
| Component | `packages/shared` — `src/maps/types.ts`, `src/engine/physics.ts`, `src/engine/bot.ts` |
| Verified | Hot spots measured; the index itself is not built yet |

## Problem

Every wall lookup scans the whole wall list. `circleHitsWall()` loops `map.walls`
for each call, and `castShotRay()` loops them once per bullet leg. Its bounding-box
pre-filter only drops walls outside the *leg's* bounding box, which for a diagonal
leg is most of the map, so a long shot still touches a large fraction of the list.

Maps carry 28–70 walls after merging, so this is not catastrophic on its own — but
the lookups sit on the hottest paths in the server:

- the bot's shot planner (`castShotRay` → `rayShotBox`, plus `lineClear`'s segment
  sampling),
- the authoritative simulation (`moveCircle` for tanks and bullets),
- bot navigation (nav-grid construction, line-of-sight),
- loot placement.

Measured after the candidate-pruning change in `devin/bot-planner-perf`, profiling
the deployed container with 4 rooms × 4 tanks for 30 s (3401 ms of on-CPU time):

| self | function | location |
| --- | --- | --- |
| 24.9% | `rayShotBox` | `bot.ts` |
| 14.9% | `castShotRay` | `bot.ts` |
| 12.8% | `corner` (closure in `rayShotBox`) | `bot.ts` |
| 9.4% | `lineClear` | `bot.ts` |
| 4.6% | `moveCircle` | `physics.ts` |
| 3.6% | `circleHitsWall` | `physics.ts` |

Ray tracing is still ~52% of what remains, and `lineClear` samples the segment
every 6 units calling `circleHitsWall` each time.

## Proposed change

Build a per-map uniform grid (or a small BVH) over the wall rectangles **once**, at
`compileMap()` time, and route `castShotRay()` and `circleHitsWall()` through it.

Two details that decide whether this is correct and actually fast:

1. **The radius varies** — tank radius, bullet radius, and the nav clearance all
   call `circleHitsWall`. Index the *raw* wall rectangles and grow the query box by
   the radius at lookup time, so one index serves every caller.
2. **Merged runs span several cells.** `layoutWalls()` merges adjacent edges into
   long rectangles, so a naive cell bucket returns the same wall many times. Either
   dedupe with a per-query stamp array, or accept the duplicate tests — the cheap
   bbox check is not what costs, `rayShotBox` is.

Keep the structure plain data (typed arrays) so `GameMap` stays copyable into WASM
memory, as `maps/types.ts` documents.

## Acceptance test (write this first)

1. **Differential equivalence — the real gate.** For a seeded corpus of
   `(map, point, radius)` and `(map, origin, direction, radius)` cases, assert the
   indexed lookup returns *exactly* what the linear scan returns: the same boolean
   from `circleHitsWall`, and the same earliest impact from `castShotRay`
   (including the tie-merging within `SHOT_EPSILON`). `circleHitsWall` decides
   bullet collisions, so any difference here is a gameplay change, not an
   optimisation.
2. **Existing tests must pass unchanged** — especially the determinism test in
   `simulation.test.ts` and `"collides with thin walls and never tunnels through
   them"`.
3. **Measure it:** `bun run --filter @tank-arena/shared bench` before/after, and a
   re-profile of the container. The bench currently reports ms per simulated second
   per map.

## Files likely touched

- `packages/shared/src/maps/types.ts` (`compileMap` builds the index)
- `packages/shared/src/engine/physics.ts` (`circleHitsWall`)
- `packages/shared/src/engine/bot.ts` (`castShotRay`, `lineClear`)
- `packages/shared/bench/bot.ts`, `packages/shared/test/`

## Definition of done

- The indexed lookups match the linear scan on the differential corpus.
- `bun run --filter @tank-arena/shared bench` and a container profile show a
  measured improvement.
- Bot and simulation behaviour is unchanged: every existing test passes untouched.
- `bun run typecheck && bun run lint && bun run test` is green.

## Notes

- Do this as its own change. `circleHitsWall` is authoritative for bullets, so it
  needs the differential test above before anything else is trusted.
- If the index proves fiddly, `lineClear` is a cheaper independent win: it samples
  a straight segment at a fixed 6-unit step regardless of the radius it is testing
  for.
