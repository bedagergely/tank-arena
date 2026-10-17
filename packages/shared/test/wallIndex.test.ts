import { describe, expect, it } from "vitest";
import {
  castShotRay,
  circleHitsWall,
  compileMap,
  listMaps,
  type GameMap,
  type ShotImpact,
} from "../src/index.ts";

/**
 * Differential equivalence for the wall spatial index. `circleHitsWall` decides
 * bullet collisions and `castShotRay` decides where a bullet goes next, so a
 * difference from the linear scan is a gameplay change, not an optimisation.
 *
 * The reference for a ray is the map with its index margin forced to zero: that
 * routes `castShotRay` down the linear scan it used before the index, so the
 * comparison is indexed walk vs. the original loop. The reference for a circle
 * is the same loop written out here.
 */

const SHOT_EPSILON = 1e-9;
const TILE = 40;

/** Linear scan over every wall, exactly what `circleHitsWall` did before the index. */
function circleHitsWallLinear(map: GameMap, x: number, y: number, r: number): boolean {
  if (x - r < 0 || y - r < 0 || x + r > map.width || y + r > map.height) return true;
  const rr = r * r;
  for (const w of map.walls) {
    const cx = Math.min(Math.max(x, w.x), w.x + w.width);
    const cy = Math.min(Math.max(y, w.y), w.y + w.height);
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy < rr) return true;
  }
  return false;
}

/** The same map with the index disabled, so `castShotRay` takes its linear fallback. */
function withoutIndex(map: GameMap): GameMap {
  return { ...map, wallIndex: { ...map.wallIndex, margin: 0 } };
}

/** xorshift32, so the corpus is fixed and a failure is reproducible. */
function makeRandom(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

const maps: GameMap[] = [
  ...listMaps(),
  compileMap({
    id: "corridor",
    name: "Corridor",
    tileSize: TILE,
    wallThickness: 4,
    layout: [
      "+-+-+-+-+-+-+-+-+",
      "|               |",
      "+ + + + + + + + +",
      "|1             2|",
      "+ + + + + + + + +",
      "|               |",
      "+-+-+-+-+-+-+-+-+",
    ],
  }),
  /** Smaller than one index cell, so the whole map is a single bucket. */
  compileMap({
    id: "tiny",
    name: "Tiny",
    tileSize: TILE,
    wallThickness: 4,
    layout: ["+-+", "|1|", "+ +", "|2|", "+-+"],
  }),
  /** Tile size double the index cell, so buckets do not line up with tiles. */
  compileMap({
    id: "wide",
    name: "Wide",
    tileSize: 128,
    wallThickness: 8,
    layout: ["+-+-+-+", "|1    |", "+ + + +", "|     |", "+ + + +", "|    2|", "+-+-+-+"],
  }),
];

interface Point {
  x: number;
  y: number;
}

interface Ray extends Point {
  angle: number;
  maxTime: number;
}

function samplePoints(map: GameMap, random: () => number, count: number): Point[] {
  const { cell, cols, rows } = map.wallIndex;
  const points: Point[] = [];
  for (let i = 0; i < count; i++) {
    points.push({ x: random() * map.width, y: random() * map.height });
    // Just off a random wall face, where hits and misses alternate.
    const wall = map.walls[Math.floor(random() * map.walls.length)]!;
    const nudge = (random() * 2 - 1) * 12;
    points.push({ x: wall.x + random() * wall.width + nudge, y: wall.y + random() * wall.height + nudge });
    // On a cell boundary, where the lookup has to pick the right bucket.
    points.push({ x: Math.floor(random() * (cols + 1)) * cell, y: Math.floor(random() * (rows + 1)) * cell });
  }
  return points;
}

function sampleRays(map: GameMap, random: () => number, count: number): Ray[] {
  const { cell, cols, rows } = map.wallIndex;
  const inside = (x: number, y: number): Point => ({ x: Math.min(x, map.width - 1e-6), y: Math.min(y, map.height - 1e-6) });
  const rays: Ray[] = [];
  for (let i = 0; i < count; i++) {
    rays.push({ ...inside(random() * map.width, random() * map.height), angle: random() * Math.PI * 2, maxTime: random() * 3 });
    // Axis-aligned and exactly diagonal headings, which stress the cell walk.
    rays.push({ ...inside(random() * map.width, random() * map.height), angle: (Math.floor(random() * 8) * Math.PI) / 4, maxTime: random() * 3 });
    // From a wall face, where a contact is immediate.
    const wall = map.walls[Math.floor(random() * map.walls.length)]!;
    rays.push({ ...inside(wall.x + random() * wall.width, wall.y + random() * wall.height), angle: random() * Math.PI * 2, maxTime: random() * 3 });
    // From a cell corner, where the walk has to choose a cell to enter.
    rays.push({
      ...inside(Math.floor(random() * (cols + 1)) * cell, Math.floor(random() * (rows + 1)) * cell),
      angle: (Math.floor(random() * 8) * Math.PI) / 4,
      maxTime: random() * 3,
    });
  }
  return rays;
}

/** Why two impacts differ, or undefined when they agree. */
function impactDiff(radius: number, ray: Ray, indexed: ShotImpact | undefined, linear: ShotImpact | undefined): string | undefined {
  const at = `r=${radius} at (${ray.x}, ${ray.y}) angle ${ray.angle} t<=${ray.maxTime}`;
  if (!indexed || !linear) {
    return indexed === linear ? undefined : `${at}: indexed ${JSON.stringify(indexed)}, linear ${JSON.stringify(linear)}`;
  }
  if (indexed.reflectX !== linear.reflectX || indexed.reflectY !== linear.reflectY) {
    return `${at}: indexed ${JSON.stringify(indexed)}, linear ${JSON.stringify(linear)}`;
  }
  if (Math.abs(indexed.time - linear.time) > SHOT_EPSILON) {
    return `${at}: times differ by ${Math.abs(indexed.time - linear.time)} (${indexed.time} vs ${linear.time})`;
  }
  return undefined;
}

const RADII = [0, 1, 4, 13.9, 14, 16, 17, 26, 33, 100];

describe("wall index", () => {
  it("matches the linear scan for every circle query", () => {
    const failures: string[] = [];
    let cases = 0;
    let hits = 0;
    for (const map of maps) {
      const random = makeRandom(0xc0ffee + map.walls.length);
      for (const point of samplePoints(map, random, 300)) {
        for (const r of RADII) {
          cases++;
          const indexed = circleHitsWall(map, point.x, point.y, r);
          const linear = circleHitsWallLinear(map, point.x, point.y, r);
          if (indexed) hits++;
          if (indexed !== linear) failures.push(`${map.id} (${point.x}, ${point.y}) r=${r}: indexed ${indexed}, linear ${linear}`);
        }
      }
    }
    expect(failures).toEqual([]);
    // Guard against a vacuous corpus: every case must agree, and some must hit.
    expect(cases).toBeGreaterThan(10000);
    expect(hits).toBeGreaterThan(100);
  });

  it("matches the linear scan for every shot ray", () => {
    const failures: string[] = [];
    let cases = 0;
    let hits = 0;
    for (const map of maps) {
      const linearMap = withoutIndex(map);
      const random = makeRandom(0x5eed + map.walls.length);
      for (const ray of sampleRays(map, random, 300)) {
        const vx = Math.cos(ray.angle) * 320;
        const vy = Math.sin(ray.angle) * 320;
        for (const radius of [1, 4, 16, 20, 100]) {
          cases++;
          const indexed = castShotRay(map, radius, ray.x, ray.y, vx, vy, ray.maxTime);
          const linear = castShotRay(linearMap, radius, ray.x, ray.y, vx, vy, ray.maxTime);
          if (indexed) hits++;
          const diff = impactDiff(radius, ray, indexed, linear);
          if (diff) failures.push(`${map.id} ${diff}`);
        }
      }
    }
    expect(failures).toEqual([]);
    expect(cases).toBeGreaterThan(5000);
    expect(hits).toBeGreaterThan(100);
  });

  it("reports impacts the point query agrees are real contacts", () => {
    // An independent cross-check: the point path (already validated against the
    // linear scan above) must call the impact point a contact, and must not have
    // reached a contact earlier along the leg.
    const failures: string[] = [];
    let checked = 0;
    for (const map of maps) {
      const random = makeRandom(0xfeed + map.walls.length);
      for (const ray of sampleRays(map, random, 60)) {
        const vx = Math.cos(ray.angle) * 320;
        const vy = Math.sin(ray.angle) * 320;
        const radius = 4;
        // A leg that starts touching a wall is ignored by the cast by design,
        // exactly as the step simulation ignores a bullet pinned in a wall.
        if (circleHitsWall(map, ray.x, ray.y, radius)) continue;
        const impact = castShotRay(map, radius, ray.x, ray.y, vx, vy, ray.maxTime);
        if (!impact) continue;
        checked++;
        const hitX = ray.x + vx * impact.time;
        const hitY = ray.y + vy * impact.time;
        // `circleHitsWall` counts touching as clear, so allow a hair of slack.
        if (!circleHitsWall(map, hitX, hitY, radius + 1e-4)) {
          failures.push(`${map.id}: impact at t=${impact.time} is not a contact (${hitX}, ${hitY})`);
          continue;
        }
        // Sampling the leg cannot find a contact before the analytic entry.
        const step = 0.25 / Math.hypot(vx, vy);
        for (let t = 0; t < impact.time - step; t += step) {
          if (circleHitsWall(map, ray.x + vx * t, ray.y + vy * t, radius)) {
            failures.push(`${map.id}: contact at t=${t} is earlier than the reported ${impact.time}`);
            break;
          }
        }
      }
    }
    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThan(100);
  });
});
