# 14 — Per-frame allocations in the renderer

| | |
| --- | --- |
| Category | Performance |
| Priority | Low |
| Component | `apps/client/src/game/GameRenderer.ts` |
| Verified | By code reading |

## Problem

`GameRenderer.syncTanks()` runs every PixiJS frame (~60 fps) and rebuilds two
collections from scratch each time:

```ts
const names = new Map<number, string>();
let localSlot = -1;
for (const p of state.players.values()) {
  if (p.slot >= 0) names.set(p.slot, p.name);
  if (p.sessionId === this.room.sessionId) localSlot = p.slot;
}
...
const seen = new Set<number>();
for (const t of state.tanks.values()) { seen.add(t.slot); ... }
```

With up to 4 tanks this is small, but it is pure garbage on the hot path and the
pattern scales badly if player counts grow. The same shape appears in
`syncBullets` (`new Set`) and `syncLoot`.

## Proposed change

- Cache the slot→name map and the local slot; invalidate only when the players
  collection changes. `@colyseus/react`/`Callbacks` expose `onAdd`/`onRemove`/
  `onChange("players", …)` — subscribe once and set a dirty flag instead of
  rescanning every frame.
- Reuse the `seen` sets (clear them instead of allocating) in `syncTanks`,
  `syncBullets`, `syncLoot`.

Keep the renderer's contract intact: it still only reads authoritative state and
never simulates.

## Acceptance test (write this first)

Frame-accurate allocation counting is not practical in the current `bun test`
setup (no DOM/Pixi). Do this instead:

1. Extract the state→view bookkeeping into a pure, exported helper (e.g. a function
   that, given the current players/tanks snapshot and a cached map, returns the
   name map, the local slot, and the set of live slots), and unit-test that it
   produces the same output as the current inline logic — including the
   `slot < 0` (spectating) and local-player cases.
2. If you want the allocation claim verified, add a small benchmark script under
   `apps/client/test/` that calls the helper N times and asserts it allocates at
   most a fixed number of objects (or simply document the before/after GC counts
   in the PR).

## Files likely touched

- `apps/client/src/game/GameRenderer.ts`
- `apps/client/test/` (new pure-helper test)

## Definition of done

- The extracted helper is covered by tests and produces identical results to the
  current logic.
- Rendering behaviour is unchanged (tanks/bullets/loot appear, names update, dead
  tanks fade).
- `bun run typecheck && bun run lint && bun run test` is green.
