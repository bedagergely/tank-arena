import { describe, expect, it } from "vitest";
import {
  circleHitsWall,
  clampRounds,
  compileMap,
  createJsEngine,
  DEFAULT_RULES,
  formatLayout,
  generateMaze,
  getMap,
  isBorderClosed,
  layoutWalls,
  listMaps,
  moveCircle,
  parseLayout,
  PERK_BULLET_SPEED,
  PERK_BULLETS,
  PERK_SHIELD,
  PERK_TANK_SPEED,
  resolveRules,
  sanitizeInput,
  unreachableCells,
  validateMapSource,
  winsNeeded,
  type MapSource,
  type PerkId,
  type PlayerInput,
  type TickEvent,
} from "../src/index.ts";

const FIRE: PlayerInput = { throttle: 0, turn: 0, fire: true };
const IDLE: PlayerInput = { throttle: 0, turn: 0, fire: false };

const TILE = 40;
const WALL = 4;

/** 8x3 open corridor, tanks at both ends of the middle row facing each other. */
const corridor = compileMap({
  id: "corridor",
  name: "Corridor",
  tileSize: TILE,
  wallThickness: WALL,
  layout: [
    "+-+-+-+-+-+-+-+-+",
    "|               |",
    "+ + + + + + + + +",
    "|1             2|",
    "+ + + + + + + + +",
    "|               |",
    "+-+-+-+-+-+-+-+-+",
  ],
});

function run(engine: ReturnType<typeof createJsEngine>, seconds: number, inputs: Record<number, PlayerInput> = {}) {
  const dt = 1 / engine.rules.tickRate;
  const events: TickEvent[] = [];
  for (const [slot, input] of Object.entries(inputs)) engine.setInput(Number(slot), input);
  for (let t = 0; t < seconds; t += dt) events.push(...engine.step(dt));
  return events;
}

describe("maps", () => {
  /** 2x2 tiles with one inner wall between the top two cells. */
  const divided: MapSource = {
    id: "divided",
    name: "Divided",
    tileSize: TILE,
    wallThickness: WALL,
    layout: ["+-+-+", "|1|2|", "+ + +", "|   |", "+-+-+"],
  };

  it("compiles the registry with corner spawns", () => {
    expect(listMaps().length).toBeGreaterThan(0);
    const maze = getMap("labyrinth")!;
    expect(maze.cols).toBe(12);
    expect(maze.rows).toBe(9);
    expect(maze.width).toBe(12 * 64 + 4);
    expect(maze.height).toBe(9 * 64 + 4);
    expect(maze.spawns.length).toBe(4);
    const [a, b] = maze.spawns;
    expect(a!.x).toBeLessThan(maze.width / 2);
    expect(a!.y).toBeLessThan(maze.height / 2);
    expect(b!.x).toBeGreaterThan(maze.width / 2);
    expect(b!.y).toBeGreaterThan(maze.height / 2);
  });

  it("parses and formats layouts losslessly", () => {
    const grid = parseLayout(divided.layout);
    expect(grid.cols).toBe(2);
    expect(grid.rows).toBe(2);
    expect(grid.spawns).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    expect(formatLayout(grid)).toEqual(divided.layout);
    expect(() => parseLayout(["+-+", "| "])).toThrow(/2\*rows\+1/);
    expect(() => parseLayout(["+-+", "|1|", "+-+", "|1|", "+-+"])).toThrow(/twice/);
    expect(() => parseLayout(["+-+", "|2|", "+-+"])).toThrow(/numbered/);
    expect(() => parseLayout(["+-+", "|x|", "+-+"])).toThrow(/unexpected "x"/);
  });

  it("turns tile borders into thin wall rectangles, merging runs", () => {
    const map = compileMap(divided);
    expect(map.width).toBe(2 * TILE + WALL);
    expect(map.height).toBe(2 * TILE + WALL);
    expect(map.walls).toEqual([
      { x: 0, y: 0, width: 2 * TILE + WALL, height: WALL },
      { x: 0, y: 2 * TILE, width: 2 * TILE + WALL, height: WALL },
      { x: 0, y: 0, width: WALL, height: 2 * TILE + WALL },
      { x: TILE, y: 0, width: WALL, height: TILE + WALL },
      { x: 2 * TILE, y: 0, width: WALL, height: 2 * TILE + WALL },
    ]);
    expect(map.spawns[0]).toMatchObject({ x: TILE / 2 + WALL / 2, y: TILE / 2 + WALL / 2 });
    expect(map.spawns[1]!.angle).toBeCloseTo(Math.atan2(map.height / 2 - map.spawns[1]!.y, map.width / 2 - map.spawns[1]!.x));
    expect(layoutWalls(parseLayout(["+-+-+", "|   |", "+-+-+"]), TILE, WALL)).toHaveLength(4);
  });

  it("collides with thin walls and never tunnels through them", () => {
    const map = compileMap(divided);
    const y = TILE / 2 + WALL / 2;
    expect(circleHitsWall(map, TILE - 5, y, 4)).toBe(false);
    expect(circleHitsWall(map, TILE - 3, y, 4)).toBe(true);
    expect(circleHitsWall(map, TILE + 2, y + TILE, 4)).toBe(false);
    // A step much longer than the wall is thick still stops at the wall.
    const moved = moveCircle(map, 10, y, 4, 60, 0);
    expect(moved.hitX).toBe(true);
    expect(moved.x).toBeLessThan(TILE - 4 + 1e-9);
    expect(moved.x).toBeGreaterThan(TILE - 4 - 8);
  });

  it("validates map sources", () => {
    expect(validateMapSource(divided)).toEqual([]);
    expect(validateMapSource(divided, 14)).toEqual([]);
    expect(validateMapSource({ ...divided, id: "Bad Id" })).toHaveLength(1);
    expect(validateMapSource({ ...divided, tileSize: 30 }, 14)).toEqual([expect.stringMatching(/fit a tank/)]);
    expect(validateMapSource({ ...divided, layout: ["+-+-+", "|1  |", "+ + +", "|   |", "+-+-+"] })).toEqual([
      expect.stringMatching(/at least 2 spawn/),
    ]);
    expect(validateMapSource({ ...divided, layout: ["+-+-+", "|1|2|", "+ + +", "|    ", "+-+-+"] })).toEqual([
      expect.stringMatching(/border must be closed/),
    ]);
    expect(validateMapSource({ ...divided, layout: ["+-+-+", "|1|2|", "+ +-+", "|   |", "+-+-+"] })).toEqual([
      expect.stringMatching(/1 tile\(s\) cannot be reached/),
    ]);
    expect(validateMapSource({ ...divided, layout: ["+-+", "|1"] })).toHaveLength(1);
  });

  it("generates connected, closed, deterministic mazes", () => {
    const a = generateMaze(12, 9, 42, 0.1);
    const b = generateMaze(12, 9, 42, 0.1);
    expect(formatLayout(a)).toEqual(formatLayout(b));
    expect(formatLayout(generateMaze(12, 9, 43, 0.1))).not.toEqual(formatLayout(a));
    expect(isBorderClosed(a)).toBe(true);
    expect(unreachableCells(a, { col: 0, row: 0 })).toBe(0);
    const perfect = generateMaze(6, 6, 1, 0);
    // A perfect maze on n cells has exactly n-1 open inner edges.
    const inner = 2 * 6 * 5;
    let open = 0;
    for (let r = 1; r < 6; r++) for (let c = 0; c < 6; c++) if (!perfect.hWalls[r * 6 + c]) open++;
    for (let r = 0; r < 6; r++) for (let c = 1; c < 6; c++) if (!perfect.vWalls[r * 7 + c]) open++;
    expect(open).toBe(6 * 6 - 1);
    expect(open).toBeLessThan(inner);
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
    expect(tank.x).toBeGreaterThanOrEqual(WALL + DEFAULT_RULES.tank.radius - 1e-6);
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

  it("is deterministic for identical inputs and seed", () => {
    const a = createJsEngine(corridor, DEFAULT_RULES);
    const b = createJsEngine(corridor, DEFAULT_RULES);
    a.reset([0, 1], 12345);
    b.reset([0, 1], 12345);
    const inputs = { 0: { throttle: 1, turn: 1, fire: true } as PlayerInput, 1: { throttle: -1, turn: -1, fire: true } as PlayerInput };
    run(a, 20, inputs);
    run(b, 20, inputs);
    expect(a.world).toEqual(b.world);
    expect(a.world.nextLootId).toBeGreaterThan(1);
  });
});

describe("match rules", () => {
  it("needs a majority of rounds", () => {
    expect(winsNeeded(5)).toBe(3);
    expect(winsNeeded(1)).toBe(1);
    expect(winsNeeded(4)).toBe(3);
    expect(winsNeeded(7)).toBe(4);
  });

  it("clamps host-provided round counts", () => {
    expect(clampRounds(5, DEFAULT_RULES)).toBe(5);
    expect(clampRounds(0, DEFAULT_RULES)).toBe(DEFAULT_RULES.match.minRounds);
    expect(clampRounds(999, DEFAULT_RULES)).toBe(DEFAULT_RULES.match.maxRounds);
    expect(clampRounds(3.6, DEFAULT_RULES)).toBe(4);
    expect(clampRounds("5", DEFAULT_RULES)).toBeUndefined();
    expect(clampRounds(NaN, DEFAULT_RULES)).toBeUndefined();
  });
});

describe("loot boxes", () => {
  /** Open 10x5 room of 64 px tiles: plenty of free space for boxes. */
  const room = compileMap({
    id: "room",
    name: "Room",
    tileSize: 64,
    wallThickness: WALL,
    layout: [
      "+-+-+-+-+-+-+-+-+-+-+",
      "|1                  |",
      "+ + + + + + + + + + +",
      "|                   |",
      "+ + + + + + + + + + +",
      "|                   |",
      "+ + + + + + + + + + +",
      "|                   |",
      "+ + + + + + + + + + +",
      "|                  2|",
      "+-+-+-+-+-+-+-+-+-+-+",
    ],
  });

  it("spawn on free floor, away from tanks, up to maxOnMap", () => {
    const rules = resolveRules({ loot: { firstSpawnSeconds: 1, spawnIntervalSeconds: 1, maxOnMap: 2 } });
    const engine = createJsEngine(room, rules);
    engine.reset([0, 1], 7);
    const events = run(engine, 20);
    const spawns = events.filter((e) => e.type === "loot-spawn");
    expect(spawns.length).toBe(2);
    expect(engine.world.loot.length).toBe(2);
    for (const box of engine.world.loot) {
      expect(circleHitsWall(room, box.x, box.y, rules.loot.radius + rules.tank.radius)).toBe(false);
      for (const t of engine.world.tanks) expect(Math.hypot(t.x - box.x, t.y - box.y)).toBeGreaterThan(rules.tank.radius * 4);
    }
  });

  it("does not spawn when disabled", () => {
    const engine = createJsEngine(room, resolveRules({ loot: { enabled: false } }));
    engine.reset([0, 1], 7);
    run(engine, 30);
    expect(engine.world.loot.length).toBe(0);
  });

  function pickUp(perk: PerkId) {
    const rules = DEFAULT_RULES;
    const engine = createJsEngine(room, rules);
    engine.reset([0, 1], 7);
    // Drop a box right in front of tank 0 and drive over it.
    const tank = engine.world.tanks[0]!;
    tank.angle = 0;
    engine.world.loot.push({ id: 99, x: tank.x + 40, y: tank.y, perk });
    const events = run(engine, 1, { 0: { throttle: 1, turn: 0, fire: false } });
    expect(events).toContainEqual({ type: "loot-pickup", lootId: 99, slot: 0, perk });
    expect(engine.world.loot.some((b) => b.id === 99)).toBe(false);
    return { engine, rules, tank: engine.world.tanks[0]! };
  }

  it("a perk lasts for the configured duration and then expires", () => {
    const { engine, rules, tank } = pickUp(PERK_TANK_SPEED);
    expect(tank.perks[PERK_TANK_SPEED]).toBeGreaterThan(rules.loot.durationSeconds - 1);
    expect(tank.perks[PERK_TANK_SPEED]).toBeLessThanOrEqual(rules.loot.durationSeconds);
    run(engine, rules.loot.durationSeconds + 0.1);
    expect(tank.perks[PERK_TANK_SPEED]).toBe(0);
  });

  it("tank speed perk moves the tank faster", () => {
    const boosted = pickUp(PERK_TANK_SPEED);
    const plain = createJsEngine(room, boosted.rules);
    plain.reset([0, 1], 7);
    plain.world.tanks[0]!.angle = 0;
    // Both drive for the same time from the same x after the pickup second.
    const startBoosted = boosted.tank.x;
    const startPlain = plain.world.tanks[0]!.x;
    run(boosted.engine, 0.5, { 0: { throttle: 1, turn: 0, fire: false } });
    run(plain, 0.5, { 0: { throttle: 1, turn: 0, fire: false } });
    const dBoosted = boosted.tank.x - startBoosted;
    const dPlain = plain.world.tanks[0]!.x - startPlain;
    expect(dBoosted / dPlain).toBeCloseTo(boosted.rules.loot.tankSpeedMultiplier, 1);
  });

  it("extra bullets perk raises the in-flight limit", () => {
    const { engine, rules } = pickUp(PERK_BULLETS);
    engine.world.tanks[0]!.angle = 0; // long free flight along the row
    const events = run(engine, 1, { 0: FIRE });
    expect(events.filter((e) => e.type === "fire").length).toBe(rules.bullet.maxPerTank + rules.loot.extraBullets);
  });

  it("bullet speed perk fires faster bullets", () => {
    const { engine, rules } = pickUp(PERK_BULLET_SPEED);
    engine.world.tanks[0]!.angle = 0;
    run(engine, 1 / rules.tickRate, { 0: FIRE });
    const bullet = engine.world.bullets[0]!;
    expect(Math.hypot(bullet.vx, bullet.vy)).toBeCloseTo(rules.bullet.speed * rules.loot.bulletSpeedMultiplier);
  });

  it("shield absorbs exactly one hit", () => {
    const { engine, tank } = pickUp(PERK_SHIELD);
    tank.angle = Math.PI / 2; // fire into the far wall so the bullet bounces straight back
    const first = run(engine, 2, { 0: FIRE });
    expect(first.find((e) => e.type === "shield-block")).toMatchObject({ shooterSlot: 0, targetSlot: 0 });
    expect(first.some((e) => e.type === "hit")).toBe(false);
    expect(tank.alive).toBe(true);
    expect(tank.perks[PERK_SHIELD]).toBe(0);

    const second = run(engine, 2, { 0: FIRE });
    expect(second.some((e) => e.type === "hit")).toBe(true);
    expect(tank.alive).toBe(false);
  });
});
