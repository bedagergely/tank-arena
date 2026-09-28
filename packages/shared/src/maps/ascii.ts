import type { MapSource, Rect } from "./types.ts";

/**
 * Compact text form of a grid map. Rows use:
 *   `#` wall, `.` empty, `1`..`9` spawn point (ordered by digit)
 */
export interface AsciiMapSource {
  id: string;
  name: string;
  tileSize: number;
  rows: string[];
}

/**
 * Converts an ASCII grid into a rectangle map. Runs of wall tiles are merged
 * into maximal rectangles (greedy, row-major) so the result is compact but
 * covers exactly the same area.
 */
export function asciiMap(source: AsciiMapSource): MapSource {
  const rows = source.rows.length;
  const cols = source.rows[0]?.length ?? 0;
  if (rows === 0 || cols === 0) {
    throw new Error(`Map "${source.id}" is empty`);
  }

  const ts = source.tileSize;
  const wall = new Uint8Array(rows * cols);
  const spawnByDigit = new Map<number, { x: number; y: number }>();

  for (let r = 0; r < rows; r++) {
    const row = source.rows[r]!;
    if (row.length !== cols) {
      throw new Error(`Map "${source.id}": row ${r} has length ${row.length}, expected ${cols}`);
    }
    for (let c = 0; c < cols; c++) {
      const ch = row[c]!;
      if (ch === "#") {
        wall[r * cols + c] = 1;
      } else if (ch >= "1" && ch <= "9") {
        spawnByDigit.set(Number(ch), { x: c * ts + ts / 2, y: r * ts + ts / 2 });
      } else if (ch !== ".") {
        throw new Error(`Map "${source.id}": unknown tile "${ch}" at ${r},${c}`);
      }
    }
  }

  const walls: Rect[] = [];
  const used = new Uint8Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!wall[r * cols + c] || used[r * cols + c]) continue;
      let w = 1;
      while (c + w < cols && wall[r * cols + c + w] && !used[r * cols + c + w]) w++;
      let h = 1;
      outer: while (r + h < rows) {
        for (let k = 0; k < w; k++) {
          const i = (r + h) * cols + c + k;
          if (!wall[i] || used[i]) break outer;
        }
        h++;
      }
      for (let dr = 0; dr < h; dr++) {
        for (let dc = 0; dc < w; dc++) used[(r + dr) * cols + c + dc] = 1;
      }
      walls.push({ x: c * ts, y: r * ts, width: w * ts, height: h * ts });
    }
  }

  const spawns = [...spawnByDigit.entries()].sort(([a], [b]) => a - b).map(([, s]) => s);

  return {
    id: source.id,
    name: source.name,
    width: cols * ts,
    height: rows * ts,
    walls,
    spawns,
  };
}
