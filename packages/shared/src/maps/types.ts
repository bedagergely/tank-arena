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
 * Author-facing map description: a world size, solid wall rectangles of any
 * size, and ordered spawn points. Spawns without an explicit angle face the
 * centre of the map. This is the format the map editor reads and writes.
 */
export interface MapSource {
  id: string;
  name: string;
  width: number;
  height: number;
  walls: Rect[];
  spawns: { x: number; y: number; angle?: number }[];
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
  walls: readonly Rect[];
  spawns: readonly SpawnPoint[];
}

export const MAP_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * Returns human-readable problems with a map source (empty when valid).
 * `clearance` is the radius that must stay free around each spawn point.
 */
export function validateMapSource(source: MapSource, clearance = 0): string[] {
  const errors: string[] = [];
  if (!MAP_ID_PATTERN.test(source.id)) {
    errors.push(`id must match ${MAP_ID_PATTERN} (got "${source.id}")`);
  }
  if (source.name.trim().length === 0) errors.push("name is empty");
  if (!isPositive(source.width) || !isPositive(source.height)) {
    errors.push("width and height must be positive numbers");
  }
  source.walls.forEach((w, i) => {
    if (!Number.isFinite(w.x) || !Number.isFinite(w.y) || !isPositive(w.width) || !isPositive(w.height)) {
      errors.push(`wall ${i} has invalid geometry`);
    } else if (w.x < 0 || w.y < 0 || w.x + w.width > source.width || w.y + w.height > source.height) {
      errors.push(`wall ${i} is outside the map`);
    }
  });
  if (source.spawns.length < 2) errors.push("at least 2 spawn points are required");
  source.spawns.forEach((s, i) => {
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) {
      errors.push(`spawn ${i + 1} has invalid coordinates`);
    } else if (
      s.x - clearance < 0 ||
      s.y - clearance < 0 ||
      s.x + clearance > source.width ||
      s.y + clearance > source.height
    ) {
      errors.push(`spawn ${i + 1} is outside the map`);
    } else if (source.walls.some((w) => circleOverlapsRect(s.x, s.y, clearance, w))) {
      errors.push(`spawn ${i + 1} is inside a wall`);
    }
  });
  return errors;
}

export function compileMap(source: MapSource): GameMap {
  const errors = validateMapSource(source);
  if (errors.length > 0) {
    throw new Error(`Map "${source.id}": ${errors.join("; ")}`);
  }
  const cx = source.width / 2;
  const cy = source.height / 2;
  return {
    id: source.id,
    name: source.name,
    width: source.width,
    height: source.height,
    walls: source.walls.map((w) => ({ x: w.x, y: w.y, width: w.width, height: w.height })),
    spawns: source.spawns.map((s) => ({
      x: s.x,
      y: s.y,
      angle: s.angle ?? Math.atan2(cy - s.y, cx - s.x),
    })),
  };
}

export function pointInRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
}

/** True when a circle at (x, y) with radius r overlaps the rectangle (touching edges do not count). */
export function circleOverlapsRect(x: number, y: number, r: number, rect: Rect): boolean {
  const cx = Math.min(Math.max(x, rect.x), rect.x + rect.width);
  const cy = Math.min(Math.max(y, rect.y), rect.y + rect.height);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy < r * r || (r === 0 && pointInRect(x, y, rect));
}

function isPositive(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}
