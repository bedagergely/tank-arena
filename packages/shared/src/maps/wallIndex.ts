import type { Rect } from "./types.ts";

/**
 * Uniform grid over a map's wall rectangles, built once when the map is
 * compiled so the hot lookups (`circleHitsWall`, `castShotRay`) stop scanning
 * the whole wall list on every call.
 *
 * A wall is bucketed into every cell its rectangle covers *grown by `margin`*.
 * That growth is what makes a cell-by-cell ray walk exact: a wall the radius can
 * reach is always bucketed in one of the cells the ray itself crosses, so the
 * walk never has to look at neighbouring cells. A caller whose radius exceeds
 * `margin` falls back to the linear scan, so the index never changes a result.
 *
 * Plain numeric data (CSR buckets in typed arrays) so `GameMap` stays copyable
 * into WASM memory. `stamps`/`stamp` are per-query scratch: a ray marks every
 * wall it tests so a wall spanning several cells is only tested once. Each query
 * takes a fresh stamp id, which also keeps nested queries independent.
 */
export interface WallIndex {
  /** Cell edge length, world units. */
  cell: number;
  cols: number;
  rows: number;
  /** Largest query radius the buckets cover; larger radii use the linear scan. */
  margin: number;
  /** Bucket start per cell: `cols * rows + 1` entries. */
  starts: Uint32Array;
  /** Wall indices, grouped by cell. */
  items: Uint32Array;
  /** Id of the last query that tested each wall, for dedupe. */
  stamps: Uint32Array;
  /** Id of the current query. */
  stamp: number;
}

export const WALL_INDEX_CELL = 64;
export const WALL_INDEX_MARGIN = 16;

export function buildWallIndex(walls: readonly Rect[], width: number, height: number): WallIndex {
  const cell = WALL_INDEX_CELL;
  const margin = WALL_INDEX_MARGIN;
  const cols = Math.max(1, Math.ceil(width / cell));
  const rows = Math.max(1, Math.ceil(height / cell));

  const spans = walls.map((wall) => ({
    minCol: Math.max(0, Math.floor((wall.x - margin) / cell)),
    maxCol: Math.min(cols - 1, Math.floor((wall.x + wall.width + margin) / cell)),
    minRow: Math.max(0, Math.floor((wall.y - margin) / cell)),
    maxRow: Math.min(rows - 1, Math.floor((wall.y + wall.height + margin) / cell)),
  }));

  const starts = new Uint32Array(cols * rows + 1);
  for (const span of spans) {
    for (let row = span.minRow; row <= span.maxRow; row++) {
      for (let col = span.minCol; col <= span.maxCol; col++) {
        const bucket = row * cols + col + 1;
        starts[bucket] = starts[bucket]! + 1;
      }
    }
  }
  for (let i = 1; i < starts.length; i++) starts[i] = starts[i]! + starts[i - 1]!;

  const items = new Uint32Array(starts[cols * rows]!);
  const cursor = starts.slice(0, cols * rows);
  spans.forEach((span, wall) => {
    for (let row = span.minRow; row <= span.maxRow; row++) {
      for (let col = span.minCol; col <= span.maxCol; col++) {
        const bucket = row * cols + col;
        items[cursor[bucket]!] = wall;
        cursor[bucket] = cursor[bucket]! + 1;
      }
    }
  });

  return { cell, cols, rows, margin, starts, items, stamps: new Uint32Array(walls.length), stamp: 0 };
}

/** Cell coordinate of `v` along one axis, clamped into the grid. */
export function wallCell(v: number, count: number, cell: number): number {
  const i = Math.floor(v / cell);
  return i < 0 ? 0 : i >= count ? count - 1 : i;
}

/** Fresh visit stamp for one query: walls stamped with it have already been tested. */
export function nextWallStamp(index: WallIndex): number {
  if (index.stamp >= 0xffffffff) {
    index.stamps.fill(0);
    index.stamp = 0;
  }
  return ++index.stamp;
}
