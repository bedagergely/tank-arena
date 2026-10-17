# 17 — `editorModel.ts` is pure and untested

| | |
| --- | --- |
| Category | Tests (coverage gap) |
| Priority | Medium |
| Component | `apps/client/src/dev/editorModel.ts` |
| Verified | Yes — no test file references it |

## Problem

`apps/client/src/dev/editorModel.ts` is the map editor's geometry core: `edgeAt`,
`cellAt`, `edgeRect`, `toggleSpawn`, `cornerSpawns`, `slugify`, `setEdge`,
`sameEdge`, `withGrid`. It is pure functions over plain data, exactly what the
client's `bun test` suite is for — yet it has no tests. The only client tests are
`test/summarize.test.ts` and `test/latency.test.ts`.

The editor writes maps into source, so a regression here silently corrupts map
files.

## Proposed change

None to the implementation unless a test uncovers a bug. Add the test file.

## Acceptance test

New `apps/client/test/editorModel.test.ts` (Bun's `bun:test`, matching the existing
client tests) covering:

- `slugify`: lowercases, replaces runs of non-alphanumerics with `-`, strips leading
  digits/symbols, trims dashes, clamps to 32 chars.
- `edgeAt`: with a known grid/tileSize/thickness, a point just inside the tolerance
  of a vertical grid line returns `{ kind: "v", … }`; the nearer of two candidates
  wins; a point outside the tolerance returns `undefined`; indices are clamped to
  the grid.
- `cellAt`: returns the containing cell; returns `undefined` outside the grid.
- `toggleSpawn`: adds a spawn in an empty cell, removes it when toggled again, and
  refuses to exceed `MAX_SPAWNS`.
- `cornerSpawns`: returns the four corners with opposite corners (slot 1/2) first,
  matching the bundled maps' ordering.
- `edgeRect`: the rectangle matches `layoutWalls`' geometry for the same edge.

Prefer asserting against `formatLayout`/`layoutWalls` from `@tank-arena/shared`
where possible, so the editor and the compiler are pinned together.

## Files likely touched

- `apps/client/test/editorModel.test.ts` (new)

## Definition of done

- New test file passes; if it revealed a bug, the fix is included with a regression
  case.
- `bun run test` (client `bun test`) is green, as is the full `bun run test`.
