import { describe, expect, it } from "vitest";
import {
  compileMap,
  createJsEngine,
  DEFAULT_RULES,
  getMap,
  listMaps,
  resolveRules,
  sanitizeInput,
  type PlayerInput,
  type TickEvent,
} from "../src/index.ts";

const FIRE: PlayerInput = { throttle: 0, turn: 0, fire: true };
const IDLE: PlayerInput = { throttle: 0, turn: 0, fire: false };

/** 10x5 corridor, tanks at both ends facing each other. */
const corridor = compileMap({
  id: "corridor",
  name: "Corridor",
  tileSize: 40,
  rows: ["##########", "#........#", "#1......2#", "#........#", "##########"],
});

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
    expect(() => compileMap({ id: "bad", name: "bad", tileSize: 10, rows: ["##", "#"] })).toThrow();
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
    expect(tank.x).toBeGreaterThanOrEqual(corridor.tileSize + DEFAULT_RULES.tank.radius - 1e-6);
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
