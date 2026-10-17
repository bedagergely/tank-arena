# 13 — No game-level metrics or structured logs

| | |
| --- | --- |
| Category | Observability |
| Priority | Medium |
| Component | `apps/server/src/metrics.ts`, `apps/server/src/rooms/GameRoom.ts`, `apps/server/src/admin.ts` |
| Verified | Yes — the metrics module only samples process CPU/memory |

## Problem

The admin panel exposes process CPU and memory only. There is nothing about the
game itself: how many rooms are live, how many players, how long a tick takes,
how many events fire, or whether rooms are failing. The only logging in the server
is two `console.warn`s in `app.config.ts` (disabled monitor/admin panels). When a
room misbehaves in production there is no signal.

## Proposed change

- Extend `apps/server/src/metrics.ts` with a `game` channel (a recorder like the
  existing `cpu`/`memory` ones, so history/`latest`/`recording` semantics are
  reused): sample or aggregate
  - active rooms, seated players,
  - tick duration (p50/p95 over the window),
  - events per second (fire/bounce/hit/loot).
- Feed it from `GameRoom.simulate()` (tick duration) and room lifecycle hooks
  (`onCreate`/`onDispose` for room count; `onJoin`/`onLeave` for players).
- Expose it through `GET /admin/metrics` and render it in the admin panel
  (`apps/client/src/admin/`).
- Add structured lifecycle logs (join, leave, phase transitions, dispose) with a
  consistent prefix, so `docker logs` is usable.

Keep the schema out of it — these are server-side counters, never synchronised
state.

## Acceptance test (write this first)

1. Unit test the aggregator in `apps/server/test/metrics.test.ts`, mirroring the
   existing recorder tests:
   - recording nothing yields `{ recording: false, latest: null, history: [] }`;
   - after recording a known set of tick durations, the reported p50/p95 match;
   - history is bounded by `historyLimit` and `snapshot()` hands out copies (the
     existing tests already assert the copy semantics — keep them working for the
     new channel).
2. Extend `apps/server/test/admin.test.ts`: with a fake metrics object, assert
   `GET /admin/metrics` includes the new `game` field.

## Files likely touched

- `apps/server/src/metrics.ts`
- `apps/server/src/rooms/GameRoom.ts`
- `apps/server/src/admin.ts` (only if the route needs changes)
- `apps/client/src/admin/AdminPanel.tsx`, `Gauges.tsx` (render it)
- `apps/server/test/metrics.test.ts`, `apps/server/test/admin.test.ts`

## Definition of done

- New tests pass; existing metrics/admin tests still pass.
- `bun run typecheck && bun run lint && bun run test` is green.
- No game counters leak into the Colyseus schema.
