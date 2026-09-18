import { isWall, type GameMap } from "../maps/types.ts";

/** True when a circle at (x, y) with radius r overlaps any wall tile or leaves the map. */
export function circleHitsWall(map: GameMap, x: number, y: number, r: number): boolean {
  if (x - r < 0 || y - r < 0 || x + r > map.width || y + r > map.height) return true;

  const ts = map.tileSize;
  const c0 = Math.floor((x - r) / ts);
  const c1 = Math.floor((x + r) / ts);
  const r0 = Math.floor((y - r) / ts);
  const r1 = Math.floor((y + r) / ts);
  const rr = r * r;

  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      if (!isWall(map, col, row)) continue;
      const left = col * ts;
      const top = row * ts;
      const cx = clamp(x, left, left + ts);
      const cy = clamp(y, top, top + ts);
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy < rr) return true;
    }
  }
  return false;
}

export interface MoveResult {
  x: number;
  y: number;
  hitX: boolean;
  hitY: boolean;
}

/**
 * Move a circle by (dx, dy), resolving each axis independently so the body
 * slides along walls instead of sticking. Reports which axes were blocked so the
 * caller can reflect velocity (bullets) or simply stop (tanks).
 */
export function moveCircle(map: GameMap, x: number, y: number, r: number, dx: number, dy: number): MoveResult {
  let nx = x + dx;
  let hitX = false;
  if (dx !== 0 && circleHitsWall(map, nx, y, r)) {
    nx = x;
    hitX = true;
  }

  let ny = y + dy;
  let hitY = false;
  if (dy !== 0 && circleHitsWall(map, nx, ny, r)) {
    ny = y;
    hitY = true;
  }

  return { x: nx, y: ny, hitX, hitY };
}

export function circlesOverlap(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const rr = ar + br;
  return dx * dx + dy * dy < rr * rr;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
