import { isBorderClosed, layoutWalls, parseLayout, tileCenter, unreachableCells } from "./layout.ts";

/** Axis-aligned rectangle in world units (pixels). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpawnPoint {
  x: number;
  y: number;
  /** Initial heading, radians. 0 points along +x. */
  angle: number;
}

/**
 * Author-facing map description: a grid of square tiles whose walls sit on the
 * tile borders, drawn as a picture (see `parseLayout`):
 *
 *     +-+-+-+
 *     |1  | |
 *     + + + +
 *     |   |2|
 *     +-+-+-+
 *
 * Spawn digits order the player slots; tanks face the map centre. This is the
 * format the map editor reads and writes.
 */
export interface MapSource {
  id: string;
  name: string;
  /** Tile edge length in world units; must comfortably fit a tank. */
  tileSize: number;
  /** Wall thickness in world units. */
  wallThickness: number;
  layout: string[];
}

/**
 * Compiled map: validated geometry plus derived spawn headings. Plain numeric
 * structs so the layout can be copied into WASM memory as-is.
 */
export interface GameMap {
  id: string;
  name: string;
  width: number;
  height: number;
  tileSize: number;
  wallThickness: number;
  cols: number;
  rows: number;
  walls: readonly Rect[];
  spawns: readonly SpawnPoint[];
}

export const MAP_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
export const DEFAULT_TILE_SIZE = 64;
export const DEFAULT_WALL_THICKNESS = 4;

/**
 * Returns human-readable problems with a map source (empty when valid).
 * `clearance` is the tank radius: every tile must have room for one.
 */
export function validateMapSource(source: MapSource, clearance = 0): string[] {
  const errors: string[] = [];
  if (!MAP_ID_PATTERN.test(source.id)) {
    errors.push(`id must match ${MAP_ID_PATTERN} (got "${source.id}")`);
  }
  if (source.name.trim().length === 0) errors.push("name is empty");
  if (!isPositive(source.tileSize) || !isPositive(source.wallThickness)) {
    errors.push("tileSize and wallThickness must be positive numbers");
  } else if (source.tileSize - source.wallThickness <= 2 * clearance) {
    errors.push(`tiles must be wider than ${2 * clearance + source.wallThickness} to fit a tank`);
  }

  let grid;
  try {
    grid = parseLayout(source.layout);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return errors;
  }
  if (!isBorderClosed(grid)) errors.push("the outer border must be closed");
  if (grid.spawns.length < 2) errors.push("at least 2 spawn points are required");
  const unreachable = unreachableCells(grid);
  if (unreachable > 0) errors.push(`${unreachable} tile(s) cannot be reached from spawn 1`);
  return errors;
}

export function compileMap(source: MapSource): GameMap {
  const errors = validateMapSource(source);
  if (errors.length > 0) {
    throw new Error(`Map "${source.id}": ${errors.join("; ")}`);
  }
  const grid = parseLayout(source.layout);
  const ts = source.tileSize;
  const t = source.wallThickness;
  const width = grid.cols * ts + t;
  const height = grid.rows * ts + t;
  return {
    id: source.id,
    name: source.name,
    width,
    height,
    tileSize: ts,
    wallThickness: t,
    cols: grid.cols,
    rows: grid.rows,
    walls: layoutWalls(grid, ts, t),
    spawns: grid.spawns.map((s) => {
      const { x, y } = tileCenter(ts, t, s.col, s.row);
      return { x, y, angle: Math.atan2(height / 2 - y, width / 2 - x) };
    }),
  };
}

function isPositive(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}
