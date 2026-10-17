# 07 — Map clearance is never checked on the real compile path

| | |
| --- | --- |
| Category | Bug (validation gap) |
| Priority | Medium |
| Component | `packages/shared/src/maps/types.ts`, `apps/client/dev/mapStore.ts` |
| Verified | By code reading |

## Problem

`validateMapSource(source, clearance)` has a rule that a tile must be wide enough
for a tank:

```ts
} else if (source.tileSize - source.wallThickness <= 2 * clearance) {
  errors.push(`tiles must be wider than ${2 * clearance + source.wallThickness} to fit a tank`);
}
```

But `compileMap()` calls it with the **default `clearance = 0`**, so that rule is a
no-op on the path that actually builds the game maps:

```ts
export function compileMap(source: MapSource): GameMap {
  const errors = validateMapSource(source);   // clearance defaults to 0
  ...
}
```

`apps/client/dev/mapStore.ts` (the dev-server `PUT /__editor/maps/:id` handler)
also calls `validateMapSource(body)` with no clearance. Only the editor's client
preview passes `DEFAULT_RULES.tank.radius`, so a too-tight map can be written to
source or added by hand and compiled without complaint — tanks then cannot fit in a
tile.

## Proposed change

- Pass the tank radius on every real compile path. `maps/types.ts` can import
  `DEFAULT_RULES` from `../rules.ts` (no cycle: `rules.ts` imports nothing), or take
  an explicit `clearance` parameter through the registry in `maps/index.ts`.
- Do the same in `apps/client/dev/mapStore.ts` before writing a map to source.
- Keep the default parameter so existing callers/tests are unaffected.

## Acceptance test (write this first)

In `packages/shared/test/simulation.test.ts` (which already imports `compileMap`,
`validateMapSource`, `listMaps`):

> 1. `expect(() => compileMap({ ...divided, tileSize: 30 })).toThrow(/fit a tank/)`
>    — fails today (it compiles fine).
> 2. Assert every bundled map is valid with the tank clearance, e.g.
>    `for (const m of listMaps()) expect(m).toBeDefined()` plus a direct
>    `validateMapSource(getMapSource(m.id)!, DEFAULT_RULES.tank.radius)` check
>    returning `[]`.

## Files likely touched

- `packages/shared/src/maps/types.ts` (`compileMap`)
- `packages/shared/src/maps/index.ts` (if the clearance is threaded through)
- `apps/client/dev/mapStore.ts`
- `packages/shared/test/simulation.test.ts`

## Definition of done

- New assertions pass; the existing `validateMapSource` tests still pass.
- `bun run typecheck && bun run lint && bun run test` is green.
- The three bundled maps (`crossroads`, `labyrinth`, `warren`) still compile.
