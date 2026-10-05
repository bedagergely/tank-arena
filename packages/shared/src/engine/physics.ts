import type { GameMap } from "../maps/types.ts";

/** True when a circle at (x, y) with radius r overlaps any wall or leaves the map. */
export function circleHitsWall(map: GameMap, x: number, y: number, r: number): boolean {
  if (x - r < 0 || y - r < 0 || x + r > map.width || y + r > map.height) return true;

  const rr = r * r;
  const walls = map.walls;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i]!;
    const cx = clamp(x, w.x, w.x + w.width);
    const cy = clamp(y, w.y, w.y + w.height);
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy < rr) return true;
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
 *
 * The move is split into sub-steps no longer than the circle's diameter, so a
 * fast body cannot pass through a wall thinner than one step.
 */
export function moveCircle(map: GameMap, x: number, y: number, r: number, dx: number, dy: number): MoveResult {
  const maxStep = r > 0 ? 2 * r : 1;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / maxStep));
  const sx = dx / steps;
  const sy = dy / steps;
  let hitX = false;
  let hitY = false;

  for (let i = 0; i < steps; i++) {
    if (!hitX && sx !== 0) {
      const nx = x + sx;
      if (circleHitsWall(map, nx, y, r)) hitX = true;
      else x = nx;
    }
    if (!hitY && sy !== 0) {
      const ny = y + sy;
      if (circleHitsWall(map, x, ny, r)) hitY = true;
      else y = ny;
    }
    if (hitX && hitY) break;
  }

  return { x, y, hitX, hitY };
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
