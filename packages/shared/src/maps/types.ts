export const TILE_WALL = 1;
export const TILE_EMPTY = 0;

export interface SpawnPoint {
  x: number;
  y: number;
  /** Initial heading, radians. 0 points along +x. */
  angle: number;
}

/**
 * Author-facing map description. Rows use:
 *   `#` wall, `.` empty, `1`..`9` spawn point (ordered by digit)
 */
export interface MapSource {
  id: string;
  name: string;
  tileSize: number;
  rows: string[];
}

/**
 * Compiled map: a flat row-major grid of tile ids plus derived metrics.
 * Flat typed arrays keep the layout directly transferable to WASM memory.
 */
export interface GameMap {
  id: string;
  name: string;
  tileSize: number;
  cols: number;
  rows: number;
  width: number;
  height: number;
  tiles: Uint8Array;
  spawns: SpawnPoint[];
}

export function compileMap(source: MapSource): GameMap {
  const rows = source.rows.length;
  const cols = source.rows[0]?.length ?? 0;
  if (rows === 0 || cols === 0) {
    throw new Error(`Map "${source.id}" is empty`);
  }

  const tiles = new Uint8Array(rows * cols);
  const spawnByDigit = new Map<number, SpawnPoint>();
  const half = source.tileSize / 2;

  for (let r = 0; r < rows; r++) {
    const row = source.rows[r]!;
    if (row.length !== cols) {
      throw new Error(`Map "${source.id}": row ${r} has length ${row.length}, expected ${cols}`);
    }
    for (let c = 0; c < cols; c++) {
      const ch = row[c]!;
      if (ch === "#") {
        tiles[r * cols + c] = TILE_WALL;
      } else if (ch >= "1" && ch <= "9") {
        const x = c * source.tileSize + half;
        const y = r * source.tileSize + half;
        // Face the centre of the map so opposite corners start facing each other.
        const angle = Math.atan2((rows * source.tileSize) / 2 - y, (cols * source.tileSize) / 2 - x);
        spawnByDigit.set(Number(ch), { x, y, angle });
      } else if (ch !== ".") {
        throw new Error(`Map "${source.id}": unknown tile "${ch}" at ${r},${c}`);
      }
    }
  }

  const spawns = [...spawnByDigit.entries()].sort(([a], [b]) => a - b).map(([, s]) => s);

  return {
    id: source.id,
    name: source.name,
    tileSize: source.tileSize,
    cols,
    rows,
    width: cols * source.tileSize,
    height: rows * source.tileSize,
    tiles,
    spawns,
  };
}

export function isWall(map: GameMap, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= map.cols || row >= map.rows) return true;
  return map.tiles[row * map.cols + col] === TILE_WALL;
}
