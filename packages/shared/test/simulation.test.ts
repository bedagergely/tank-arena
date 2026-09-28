import { describe, expect, it } from "vitest";
import {
  asciiMap,
  circleHitsWall,
  compileMap,
  createJsEngine,
  DEFAULT_RULES,
  getMap,
  listMaps,
  resolveRules,
  sanitizeInput,
  validateMapSource,
  type PlayerInput,
  type TickEvent,
} from "../src/index.ts";

const FIRE: PlayerInput = { throttle: 0, turn: 0, fire: true };
const IDLE: PlayerInput = { throttle: 0, turn: 0, fire: false };

const TILE = 40;

/** 10x5 corridor, tanks at both ends facing each other. */
const corridor = compileMap(
  asciiMap({
    id: "corridor",
    name: "Corridor",
    tileSize: TILE,
    rows: ["##########", "#........#", "#1......2#", "#........#", "##########"],
  }),
);

function run(engine: ReturnType<typeof createJsEngine>, seconds: number, inputs: Record<number, PlayerInput> = {}) {
  const dt = 1 / engine.rules.tickRate;
  const events: TickEvent[] = [];
  for (const [slot, input] of Object.entries(inputs)) engine.setInput(Number(slot), input);
  for (let t = 0; t < seconds; t += dt) events.push(...engine.step(dt));
  return events;
}

describe("maps", () => {
  it("compiles the registry with corner spawns", () => {
    expect(listMaps().length).toBeGreaterThan(0);
    const arena = getMap("arena")!;
    expect(arena.width).toBe(800);
    expect(arena.height).toBe(600);
    expect(arena.spawns.length).toBe(4);
    const [a, b] = arena.spawns;
    expect(a!.x).toBeLessThan(arena.width / 2);
    expect(a!.y).toBeLessThan(arena.height / 2);
    expect(b!.x).toBeGreaterThan(arena.width / 2);
    expect(b!.y).toBeGreaterThan(arena.height / 2);
  });

  it("rejects ragged rows", () => {
    expect(() => asciiMap({ id: "bad", name: "bad", tileSize: 10, rows: ["##", "#"] })).toThrow();
  });

  it("merges ascii wall tiles into rectangles covering the same area", () => {
    const src = asciiMap({ id: "t", name: "t", tileSize: 10, rows: ["###", "#.1", "##2"] });
    expect(src.width).toBe(30);
    expect(src.height).toBe(30);
    expect(src.walls).toEqual([
      { x: 0, y: 0, width: 30, height: 10 },
      { x: 0, y: 10, width: 10, height: 20 },
      { x: 10, y: 20, width: 10, height: 10 },
    ]);
    expect(src.spawns).toEqual([
      { x: 25, y: 15 },
      { x: 25, y: 25 },
    ]);
  });

  it("collides with arbitrary-size wall rectangles", () => {
    const map = compileMap({
      id: "free",
      name: "Free",
      width: 300,
      height: 200,
      walls: [{ x: 100.5, y: 50, width: 7, height: 33 }],
      spawns: [{ x: 20, y: 20 }, { x: 280, y: 180, angle: Math.PI }],
    });
    expect(circleHitsWall(map, 95, 60, 4)).toBe(false);
    expect(circleHitsWall(map, 98, 60, 4)).toBe(true);
    expect(circleHitsWall(map, 104, 90, 4)).toBe(false);
    expect(circleHitsWall(map, 104, 86, 4)).toBe(true);
    expect(circleHitsWall(map, 3, 100, 4)).toBe(true);
    expect(map.spawns[1]!.angle).toBe(Math.PI);
    expect(map.spawns[0]!.angle).toBeCloseTo(Math.atan2(100 - 20, 150 - 20));
  });

  it("validates map sources", () => {
    const base = { id: "ok", name: "Ok", width: 100, height: 100, walls: [], spawns: [{ x: 20, y: 20 }, { x: 80, y: 80 }] };
    expect(validateMapSource(base)).toEqual([]);
    expect(validateMapSource({ ...base, id: "Bad Id" })).toHaveLength(1);
    expect(validateMapSource({ ...base, spawns: [{ x: 20, y: 20 }] })).toHaveLength(1);
    expect(validateMapSource({ ...base, walls: [{ x: 50, y: 50, width: 60, height: 10 }] })).toHaveLength(1);
    expect(validateMapSource({ ...base, walls: [{ x: 0, y: 0, width: 30, height: 30 }] })).toHaveLength(1);
    // Touching is fine without clearance, but a tank of radius 14 would overlap.
    const near = { ...base, walls: [{ x: 0, y: 0, width: 15, height: 15 }] };
    expect(validateMapSource(near)).toEqual([]);
    expect(validateMapSource(near, 14)).toHaveLength(1);
    expect(validateMapSource({ ...base, walls: [{ x: 0, y: 0, width: 0, height: 5 }] })).toHaveLength(1);
  });
});

describe("input sanitising", () => {
  it("clamps to the discrete set", () => {
    expect(sanitizeInput({ throttle: 100, turn: -0.2, fire: 1 })).toEqual({ throttle: 1, turn: -1, fire: false });
    expect(sanitizeInput(null)).toEqual(IDLE);
    expect(sanitizeInput({ throttle: "1", fire: true })).toEqual({ throttle: 0, turn: 0, fire: true });
  });
});

describe("simulation", () => {
  it("tanks cannot drive through walls", () => {
    const engine = createJsEngine(corridor, DEFAULT_RULES);
    engine.reset([0, 1]);
    const start = engine.world.tanks[0]!;
    // face left (towards the wall) and drive.
    const angle = Math.PI;
    engine.world.tanks[0]!.angle = angle;
    run(engine, 3, { 0: { throttle: 1, turn: 0, fire: false } });
    const tank = engine.world.tanks[0]!;
    expect(tank.x).toBeGreaterThanOrEqual(TILE + DEFAULT_RULES.tank.radius - 1e-6);
    expect(tank.x).toBeLessThanOrEqual(start.x);
  });

  it("only one bullet per tank and cooldown enforced", () => {
    const engine = createJsEngine(corridor, DEFAULT_RULES);
    engine.reset([0, 1]);
    engine.world.tanks[0]!.angle = 0; // down the corridor, no wall or tank within 0.5s of flight
    const events = run(engine, 0.5, { 0: FIRE });
    expect(events.filter((e) => e.type === "fire").length).toBe(1);
    expect(engine.world.bullets.length).toBe(1);
  });

  it("a bounced bullet can hit its own tank", () => {
    const engine = createJsEngine(corridor, DEFAULT_RULES);
    engine.reset([0, 1]);
    engine.world.tanks[0]!.angle = Math.PI / 2; // into the near wall, straight back
    const events = run(engine, 1, { 0: FIRE });
    const hit = events.find((e) => e.type === "hit");
    expect(hit).toMatchObject({ type: "hit", shooterSlot: 0, targetSlot: 0 });
    expect(engine.world.tanks[0]!.alive).toBe(false);
  });

  it("bullets bounce off walls and expire after maxBounces", () => {
    const rules = resolveRules({ bullet: { maxBounces: 5, canHitOwner: false } });
    const engine = createJsEngine(corridor, rules);
    engine.reset([0]);
    engine.world.tanks[0]!.angle = -Math.PI / 2; // straight up, bounces vertically forever
    engine.setInput(0, FIRE);
    const events: TickEvent[] = [];
    const dt = 1 / rules.tickRate;
    for (let i = 0; i < rules.tickRate * 10 && !events.some((e) => e.type === "bullet-expired"); i++) {
      events.push(...engine.step(dt));
      engine.setInput(0, IDLE);
    }
    expect(events.filter((e) => e.type === "bounce").length).toBe(5);
    expect(events.some((e) => e.type === "bullet-expired")).toBe(true);
    expect(engine.world.bullets.length).toBe(0);
  });

  it("a bullet hitting a tank kills it and reports the shooter", () => {
    const engine = createJsEngine(corridor, DEFAULT_RULES);
    engine.reset([0, 1]);
    // slot 0 spawn faces the centre, i.e. straight at slot 1 along the corridor.
    const events = run(engine, 3, { 0: FIRE, 1: IDLE });
    const hit = events.find((e) => e.type === "hit");
    expect(hit).toEqual({ type: "hit", bulletId: 1, shooterSlot: 0, targetSlot: 1 });
    expect(engine.world.tanks[1]!.alive).toBe(false);
    expect(engine.world.bullets.length).toBe(0);
  });

  it("is deterministic for identical inputs", () => {
    const a = createJsEngine(corridor, DEFAULT_RULES);
    const b = createJsEngine(corridor, DEFAULT_RULES);
    a.reset([0, 1]);
    b.reset([0, 1]);
    const inputs = { 0: { throttle: 1, turn: 1, fire: true } as PlayerInput, 1: { throttle: -1, turn: -1, fire: true } as PlayerInput };
    run(a, 2, inputs);
    run(b, 2, inputs);
    expect(a.world).toEqual(b.world);
  });
});
