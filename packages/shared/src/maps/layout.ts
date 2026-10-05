import type { Rect } from "./types.ts";

export interface GridCell {
  col: number;
  row: number;
}

/**
 * Tile grid whose walls sit on tile borders (Tank Trouble style).
 * `hWalls[r * cols + c]` is the edge above cell (c, r) for r in 0..rows (row
 * `rows` is the bottom border); `vWalls[r * (cols + 1) + c]` is the edge left
 * of cell (c, r) for c in 0..cols (column `cols` is the right border).
 * 1 = wall, 0 = open.
 */
export interface LayoutGrid {
  cols: number;
  rows: number;
  hWalls: Uint8Array;
  vWalls: Uint8Array;
  /** Spawn cells in player-slot order. */
  spawns: GridCell[];
}

export const MAX_SPAWNS = 9;

export function hIndex(g: LayoutGrid, col: number, row: number): number {
  return row * g.cols + col;
}

export function vIndex(g: LayoutGrid, col: number, row: number): number {
  return row * (g.cols + 1) + col;
}

/** Grid with every edge open (including the border). */
export function emptyGrid(cols: number, rows: number): LayoutGrid {
  return {
    cols,
    rows,
    hWalls: new Uint8Array((rows + 1) * cols),
    vWalls: new Uint8Array(rows * (cols + 1)),
    spawns: [],
  };
}

/** Open grid whose outer border is walled. */
export function createGrid(cols: number, rows: number): LayoutGrid {
  const g = emptyGrid(cols, rows);
  closeBorder(g);
  return g;
}

export function cloneGrid(g: LayoutGrid): LayoutGrid {
  return {
    cols: g.cols,
    rows: g.rows,
    hWalls: g.hWalls.slice(),
    vWalls: g.vWalls.slice(),
    spawns: g.spawns.map((s) => ({ ...s })),
  };
}

export function closeBorder(g: LayoutGrid): void {
  for (let c = 0; c < g.cols; c++) {
    g.hWalls[hIndex(g, c, 0)] = 1;
    g.hWalls[hIndex(g, c, g.rows)] = 1;
  }
  for (let r = 0; r < g.rows; r++) {
    g.vWalls[vIndex(g, 0, r)] = 1;
    g.vWalls[vIndex(g, g.cols, r)] = 1;
  }
}

export function isBorderClosed(g: LayoutGrid): boolean {
  for (let c = 0; c < g.cols; c++) {
    if (!g.hWalls[hIndex(g, c, 0)] || !g.hWalls[hIndex(g, c, g.rows)]) return false;
  }
  for (let r = 0; r < g.rows; r++) {
    if (!g.vWalls[vIndex(g, 0, r)] || !g.vWalls[vIndex(g, g.cols, r)]) return false;
  }
  return true;
}

export function isBorderEdge(g: LayoutGrid, kind: "h" | "v", col: number, row: number): boolean {
  return kind === "h" ? row === 0 || row === g.rows : col === 0 || col === g.cols;
}

/**
 * Parses the picture form stored in map sources: (2*rows+1) lines of
 * (2*cols+1) characters where even/even positions are corners (`+`), even
 * rows hold horizontal edges (`-` wall, space open), odd rows alternate
 * vertical edges (`|` wall, space open) and cells (space, or `1`..`9` for a
 * spawn). `.` is accepted as an alias for space.
 */
export function parseLayout(layout: readonly string[]): LayoutGrid {
  const lines = layout.length;
  const width = layout[0]?.length ?? 0;
  if (lines < 3 || lines % 2 === 0 || width < 3 || width % 2 === 0) {
    throw new Error(`layout must be (2*rows+1) lines of (2*cols+1) characters (got ${lines} lines of ${width})`);
  }
  const g = emptyGrid((width - 1) / 2, (lines - 1) / 2);
  const byDigit = new Map<number, GridCell>();

  for (let i = 0; i < lines; i++) {
    const line = layout[i]!;
    if (line.length !== width) {
      throw new Error(`layout line ${i + 1} has length ${line.length}, expected ${width}`);
    }
    for (let j = 0; j < width; j++) {
      const ch = line[j]!;
      const open = ch === " " || ch === ".";
      if (i % 2 === 0) {
        if (j % 2 === 0) continue;
        if (ch === "-") g.hWalls[hIndex(g, (j - 1) / 2, i / 2)] = 1;
        else if (!open) throw unexpected(ch, i, j, '"-" or space');
      } else if (j % 2 === 0) {
        if (ch === "|") g.vWalls[vIndex(g, j / 2, (i - 1) / 2)] = 1;
        else if (!open) throw unexpected(ch, i, j, '"|" or space');
      } else if (ch >= "1" && ch <= "9") {
        const n = Number(ch);
        if (byDigit.has(n)) throw new Error(`layout: spawn ${n} appears twice`);
        byDigit.set(n, { col: (j - 1) / 2, row: (i - 1) / 2 });
      } else if (!open) {
        throw unexpected(ch, i, j, "a spawn digit or space");
      }
    }
  }

  const digits = [...byDigit.keys()].sort((a, b) => a - b);
  digits.forEach((d, k) => {
    if (d !== k + 1) throw new Error(`layout: spawns must be numbered 1..${digits.length} without gaps`);
  });
  g.spawns = digits.map((d) => byDigit.get(d)!);
  return g;
}

function unexpected(ch: string, i: number, j: number, expected: string): Error {
  return new Error(`layout: unexpected "${ch}" at line ${i + 1}, column ${j + 1} (expected ${expected})`);
}

/** Inverse of `parseLayout`. */
export function formatLayout(g: LayoutGrid): string[] {
  const spawnAt = new Map<number, string>();
  g.spawns.forEach((s, i) => spawnAt.set(s.row * g.cols + s.col, String(i + 1)));
  const out: string[] = [];
  for (let r = 0; r <= g.rows; r++) {
    let line = "";
    for (let c = 0; c < g.cols; c++) line += `+${g.hWalls[hIndex(g, c, r)] ? "-" : " "}`;
    out.push(`${line}+`);
    if (r === g.rows) break;
    line = "";
    for (let c = 0; c < g.cols; c++) {
      line += (g.vWalls[vIndex(g, c, r)] ? "|" : " ") + (spawnAt.get(r * g.cols + c) ?? " ");
    }
    out.push(line + (g.vWalls[vIndex(g, g.cols, r)] ? "|" : " "));
  }
  return out;
}

/** Copies walls and spawns that still fit into a grid of the new size; the border stays closed. */
export function resizeGrid(g: LayoutGrid, cols: number, rows: number): LayoutGrid {
  const next = emptyGrid(cols, rows);
  for (let r = 0; r <= Math.min(rows, g.rows); r++) {
    for (let c = 0; c < Math.min(cols, g.cols); c++) next.hWalls[hIndex(next, c, r)] = g.hWalls[hIndex(g, c, r)]!;
  }
  for (let r = 0; r < Math.min(rows, g.rows); r++) {
    for (let c = 0; c <= Math.min(cols, g.cols); c++) next.vWalls[vIndex(next, c, r)] = g.vWalls[vIndex(g, c, r)]!;
  }
  closeBorder(next);
  next.spawns = g.spawns.filter((s) => s.col < cols && s.row < rows).map((s) => ({ ...s }));
  return next;
}

/** World size of a grid: tiles plus one wall thickness so border walls are full width. */
export function gridSize(g: LayoutGrid, tileSize: number, thickness: number): { width: number; height: number } {
  return { width: g.cols * tileSize + thickness, height: g.rows * tileSize + thickness };
}

/** Centre of a tile in world units. */
export function tileCenter(tileSize: number, thickness: number, col: number, row: number): { x: number; y: number } {
  return { x: (col + 0.5) * tileSize + thickness / 2, y: (row + 0.5) * tileSize + thickness / 2 };
}

/**
 * Wall rectangles for a grid: runs of adjacent edges on the same line are
 * merged into one rect. Grid line k lies at k * tileSize, each wall spans
 * [k * tileSize, k * tileSize + thickness] across the line and overhangs
 * by one thickness along it so junctions are closed.
 */
export function layoutWalls(g: LayoutGrid, tileSize: number, thickness: number): Rect[] {
  const walls: Rect[] = [];
  for (let r = 0; r <= g.rows; r++) {
    for (let c = 0; c < g.cols; ) {
      if (!g.hWalls[hIndex(g, c, r)]) {
        c++;
        continue;
      }
      let n = 1;
      while (c + n < g.cols && g.hWalls[hIndex(g, c + n, r)]) n++;
      walls.push({ x: c * tileSize, y: r * tileSize, width: n * tileSize + thickness, height: thickness });
      c += n;
    }
  }
  for (let c = 0; c <= g.cols; c++) {
    for (let r = 0; r < g.rows; ) {
      if (!g.vWalls[vIndex(g, c, r)]) {
        r++;
        continue;
      }
      let n = 1;
      while (r + n < g.rows && g.vWalls[vIndex(g, c, r + n)]) n++;
      walls.push({ x: c * tileSize, y: r * tileSize, width: thickness, height: n * tileSize + thickness });
      r += n;
    }
  }
  return walls;
}

/** Number of cells that cannot be reached from `from` (defaults to the first spawn, else cell 0,0). */
export function unreachableCells(g: LayoutGrid, from: GridCell | undefined = g.spawns[0]): number {
  const start = from ?? { col: 0, row: 0 };
  const seen = new Uint8Array(g.cols * g.rows);
  const stack = [start.row * g.cols + start.col];
  seen[stack[0]!] = 1;
  let reached = 0;
  while (stack.length > 0) {
    const cur = stack.pop()!;
    reached++;
    const c = cur % g.cols;
    const r = (cur - c) / g.cols;
    const visit = (next: number) => {
      if (!seen[next]) {
        seen[next] = 1;
        stack.push(next);
      }
    };
    if (r > 0 && !g.hWalls[hIndex(g, c, r)]) visit(cur - g.cols);
    if (r < g.rows - 1 && !g.hWalls[hIndex(g, c, r + 1)]) visit(cur + g.cols);
    if (c > 0 && !g.vWalls[vIndex(g, c, r)]) visit(cur - 1);
    if (c < g.cols - 1 && !g.vWalls[vIndex(g, c + 1, r)]) visit(cur + 1);
  }
  return g.cols * g.rows - reached;
}

/**
 * Random labyrinth: a perfect maze (recursive backtracker) with a fraction
 * `loops` of the remaining interior walls knocked out so it has cycles.
 * Deterministic for a given seed. Spawns are left for the author to place.
 */
export function generateMaze(cols: number, rows: number, seed: number, loops = 0.12): LayoutGrid {
  const g = emptyGrid(cols, rows);
  g.hWalls.fill(1);
  g.vWalls.fill(1);

  let s = seed >>> 0 || 0x9e3779b9;
  const rand = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };

  const visited = new Uint8Array(cols * rows);
  const stack = [Math.floor(rand() * cols * rows)];
  visited[stack[0]!] = 1;
  while (stack.length > 0) {
    const cur = stack[stack.length - 1]!;
    const c = cur % cols;
    const r = (cur - c) / cols;
    const options: { next: number; carve: () => void }[] = [];
    if (r > 0 && !visited[cur - cols]) options.push({ next: cur - cols, carve: () => void (g.hWalls[hIndex(g, c, r)] = 0) });
    if (c < cols - 1 && !visited[cur + 1]) options.push({ next: cur + 1, carve: () => void (g.vWalls[vIndex(g, c + 1, r)] = 0) });
    if (r < rows - 1 && !visited[cur + cols]) options.push({ next: cur + cols, carve: () => void (g.hWalls[hIndex(g, c, r + 1)] = 0) });
    if (c > 0 && !visited[cur - 1]) options.push({ next: cur - 1, carve: () => void (g.vWalls[vIndex(g, c, r)] = 0) });
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const pick = options[Math.floor(rand() * options.length)]!;
    pick.carve();
    visited[pick.next] = 1;
    stack.push(pick.next);
  }

  for (let r = 1; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (g.hWalls[hIndex(g, c, r)] && rand() < loops) g.hWalls[hIndex(g, c, r)] = 0;
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 1; c < cols; c++) {
      if (g.vWalls[vIndex(g, c, r)] && rand() < loops) g.vWalls[vIndex(g, c, r)] = 0;
    }
  }
  return g;
}
