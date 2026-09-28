import type { MapSource, Rect } from "@tank-arena/shared";

export interface Point {
  x: number;
  y: number;
}

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export type Selection = { kind: "wall"; index: number } | { kind: "spawn"; index: number } | null;

export const EMPTY_MAP: MapSource = {
  id: "new-map",
  name: "New map",
  width: 800,
  height: 600,
  walls: [],
  spawns: [],
};

export function snap(v: number, step: number): number {
  return step > 0 ? Math.round(v / step) * step : Math.round(v * 10) / 10;
}

export function snapPoint(p: Point, step: number): Point {
  return { x: snap(p.x, step), y: snap(p.y, step) };
}

/** Rect spanning two corners, normalised so width/height are positive. */
export function rectFromCorners(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export function clampRectToMap(r: Rect, width: number, height: number): Rect {
  const w = Math.min(r.width, width);
  const h = Math.min(r.height, height);
  return {
    x: Math.min(Math.max(r.x, 0), width - w),
    y: Math.min(Math.max(r.y, 0), height - h),
    width: w,
    height: h,
  };
}

export function clampPointToMap(p: Point, width: number, height: number): Point {
  return { x: Math.min(Math.max(p.x, 0), width), y: Math.min(Math.max(p.y, 0), height) };
}

/** Moves one or two edges of `orig` to the (already snapped) pointer position. */
export function resizeRect(orig: Rect, handle: Handle, p: Point, minSize: number): Rect {
  let left = orig.x;
  let right = orig.x + orig.width;
  let top = orig.y;
  let bottom = orig.y + orig.height;
  if (handle.includes("w")) left = Math.min(p.x, right - minSize);
  if (handle.includes("e")) right = Math.max(p.x, left + minSize);
  if (handle.includes("n")) top = Math.min(p.y, bottom - minSize);
  if (handle.includes("s")) bottom = Math.max(p.y, top + minSize);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function handlePosition(r: Rect, h: Handle): Point {
  const x = h.includes("w") ? r.x : h.includes("e") ? r.x + r.width : r.x + r.width / 2;
  const y = h.includes("n") ? r.y : h.includes("s") ? r.y + r.height : r.y + r.height / 2;
  return { x, y };
}

export function handleCursor(h: Handle): string {
  switch (h) {
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    default:
      return "nwse-resize";
  }
}

/** Index of the top-most wall under the point, or -1. */
export function wallAt(walls: readonly Rect[], p: Point): number {
  for (let i = walls.length - 1; i >= 0; i--) {
    const w = walls[i]!;
    if (p.x >= w.x && p.x <= w.x + w.width && p.y >= w.y && p.y <= w.y + w.height) return i;
  }
  return -1;
}

export function spawnAt(spawns: readonly Point[], p: Point, radius: number): number {
  for (let i = spawns.length - 1; i >= 0; i--) {
    const s = spawns[i]!;
    const dx = s.x - p.x;
    const dy = s.y - p.y;
    if (dx * dx + dy * dy <= radius * radius) return i;
  }
  return -1;
}

/** Four walls hugging the map edge. */
export function borderWalls(width: number, height: number, thickness: number): Rect[] {
  const t = Math.min(thickness, width / 2, height / 2);
  return [
    { x: 0, y: 0, width, height: t },
    { x: 0, y: height - t, width, height: t },
    { x: 0, y: t, width: t, height: height - 2 * t },
    { x: width - t, y: t, width: t, height: height - 2 * t },
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

export function cloneMap(m: MapSource): MapSource {
  return {
    ...m,
    walls: m.walls.map((w) => ({ ...w })),
    spawns: m.spawns.map((s) => ({ ...s })),
  };
}
