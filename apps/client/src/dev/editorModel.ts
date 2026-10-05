import {
  cloneGrid,
  createGrid,
  DEFAULT_TILE_SIZE,
  DEFAULT_WALL_THICKNESS,
  formatLayout,
  hIndex,
  MAX_SPAWNS,
  vIndex,
  type GridCell,
  type LayoutGrid,
  type MapSource,
  type Rect,
} from "@tank-arena/shared";

export interface Point {
  x: number;
  y: number;
}

/** A tile border: `h` edges run along the top of cell (col, row), `v` edges along its left. */
export interface Edge {
  kind: "h" | "v";
  col: number;
  row: number;
}

export const EMPTY_MAP: MapSource = {
  id: "new-map",
  name: "New map",
  tileSize: DEFAULT_TILE_SIZE,
  wallThickness: DEFAULT_WALL_THICKNESS,
  layout: formatLayout(createGrid(12, 9)),
};

export function withGrid(map: MapSource, grid: LayoutGrid): MapSource {
  return { ...map, layout: formatLayout(grid) };
}

export function edgeValue(grid: LayoutGrid, e: Edge): boolean {
  return e.kind === "h" ? grid.hWalls[hIndex(grid, e.col, e.row)] === 1 : grid.vWalls[vIndex(grid, e.col, e.row)] === 1;
}

export function setEdge(grid: LayoutGrid, e: Edge, wall: boolean): LayoutGrid {
  const next = cloneGrid(grid);
  if (e.kind === "h") next.hWalls[hIndex(next, e.col, e.row)] = wall ? 1 : 0;
  else next.vWalls[vIndex(next, e.col, e.row)] = wall ? 1 : 0;
  return next;
}

export function sameEdge(a: Edge | undefined, b: Edge | undefined): boolean {
  return !!a && !!b && a.kind === b.kind && a.col === b.col && a.row === b.row;
}

/** World rectangle a wall on this edge occupies (matches `layoutWalls`). */
export function edgeRect(e: Edge, tileSize: number, thickness: number): Rect {
  return e.kind === "h"
    ? { x: e.col * tileSize, y: e.row * tileSize, width: tileSize + thickness, height: thickness }
    : { x: e.col * tileSize, y: e.row * tileSize, width: thickness, height: tileSize + thickness };
}

/** Tile border nearest to `p`, if it is within `tolerance` of a grid line. */
export function edgeAt(grid: LayoutGrid, tileSize: number, thickness: number, p: Point, tolerance: number): Edge | undefined {
  const u = p.x - thickness / 2;
  const v = p.y - thickness / 2;
  const kx = Math.round(u / tileSize);
  const ky = Math.round(v / tileSize);
  const dx = Math.abs(u - kx * tileSize);
  const dy = Math.abs(v - ky * tileSize);
  const col = clampIndex(Math.floor(u / tileSize), grid.cols);
  const row = clampIndex(Math.floor(v / tileSize), grid.rows);
  if (dx <= dy && dx < tolerance && kx >= 0 && kx <= grid.cols) return { kind: "v", col: kx, row };
  if (dy < tolerance && ky >= 0 && ky <= grid.rows) return { kind: "h", col, row: ky };
  return undefined;
}

export function cellAt(grid: LayoutGrid, tileSize: number, thickness: number, p: Point): GridCell | undefined {
  const col = Math.floor((p.x - thickness / 2) / tileSize);
  const row = Math.floor((p.y - thickness / 2) / tileSize);
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return undefined;
  return { col, row };
}

/** Removes the spawn in `cell` if there is one, otherwise appends a new spawn there. */
export function toggleSpawn(grid: LayoutGrid, cell: GridCell): LayoutGrid {
  const next = cloneGrid(grid);
  const index = next.spawns.findIndex((s) => s.col === cell.col && s.row === cell.row);
  if (index >= 0) next.spawns.splice(index, 1);
  else if (next.spawns.length < MAX_SPAWNS) next.spawns.push({ ...cell });
  return next;
}

/** Slots 1-4 in the four corners (opposite corners first, like the bundled maps). */
export function cornerSpawns(grid: LayoutGrid): GridCell[] {
  const c = grid.cols - 1;
  const r = grid.rows - 1;
  return [
    { col: 0, row: 0 },
    { col: c, row: r },
    { col: c, row: 0 },
    { col: 0, row: r },
  ];
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 32);
}

function clampIndex(i: number, count: number): number {
  return i < 0 ? 0 : i >= count ? count - 1 : i;
}
