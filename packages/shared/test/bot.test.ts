import { describe, expect, it } from "vitest";
import {
  compileMap,
  createBot,
  createJsEngine,
  DEFAULT_RULES,
  findShot,
  findThreat,
  listMaps,
  resetBot,
  sanitizeInput,
  shotCandidates,
  simulateShot,
  thinkBot,
  type BotDifficulty,
  type GameMap,
  type PlayerInput,
  type TickEvent,
} from "../src/index.ts";

const TILE = 40;
const IDLE: PlayerInput = { throttle: 0, turn: 0, fire: false };
const FIRE: PlayerInput = { throttle: 0, turn: 0, fire: true };

const rules = { ...DEFAULT_RULES, loot: { ...DEFAULT_RULES.loot, enabled: false } };

/** 8x3 open corridor, tanks at both ends of the middle row facing each other. */
const corridor = compileMap({
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
});

/** A wall down the middle with a gap at the bottom separates the tanks: no direct shot. */
const detour = compileMap({
  id: "detour",
  name: "Detour",
  tileSize: TILE,
  wallThickness: 4,
  layout: [
    "+-+-+-+-+-+-+-+-+-+-+",
    "|         |         |",
    "+ + + + + + + + + + +",
    "|1        |        2|",
    "+ + + + + + + + + + +",
    "|         |         |",
    "+ + + + + + + + + + +",
    "|         |         |",
    "+ + + + + + + + + + +",
    "|                   |",
    "+-+-+-+-+-+-+-+-+-+-+",
  ],
});

/**
 * Run `seconds` of play with a bot in slot 0 and a scripted opponent in slot 1.
 * `opponent(t)` returns the human's input at time t.
 */
function play(
  map: GameMap,
  difficulty: BotDifficulty,
  seconds: number,
  opponent: (t: number) => PlayerInput = () => IDLE,
) {
  const engine = createJsEngine(map, rules);
  engine.reset([0, 1], 7);
  const bot = createBot(0, difficulty, 42);
  const dt = 1 / rules.tickRate;
  const events: TickEvent[] = [];
  let t = 0;
  while (t < seconds) {
    engine.setInput(0, thinkBot(bot, engine.world, engine.map, rules, dt));
    engine.setInput(1, opponent(t));
    events.push(...engine.step(dt));
    t += dt;
    if (events.some((e) => e.type === "hit")) break;
  }
  return { engine, bot, events, elapsed: t };
}

describe("bot", () => {
  it("produces inputs the sanitizer accepts and idles when dead", () => {
    const engine = createJsEngine(corridor, rules);
    engine.reset([0, 1], 1);
    const bot = createBot(0, "hard", 1);
    const dt = 1 / rules.tickRate;
    for (let i = 0; i < 60; i++) {
      const input = thinkBot(bot, engine.world, engine.map, rules, dt);
      expect(sanitizeInput(input)).toEqual(input);
      engine.setInput(0, input);
      engine.step(dt);
    }
    engine.eliminate(0);
    expect(thinkBot(bot, engine.world, engine.map, rules, dt)).toEqual(IDLE);
  });

  it("finds a direct shot down a corridor and takes it", () => {
    const { events, elapsed } = play(corridor, "easy", 5);
    const hit = events.find((e) => e.type === "hit");
    expect(events.some((e) => e.type === "fire" && e.slot === 0)).toBe(true);
    expect(hit).toMatchObject({ shooterSlot: 0, targetSlot: 1 });
    expect(elapsed).toBeLessThan(5);
  });

  it("does not see a direct shot through a wall, but finds a bank shot", () => {
    const engine = createJsEngine(detour, rules);
    engine.reset([0, 1], 1);
    const [me, target] = engine.world.tanks;
    expect(findShot(engine.world, detour, rules, me!, target!, 0)).toBeUndefined();
    const bank = findShot(engine.world, detour, rules, me!, target!, 3);
    expect(bank).toBeDefined();
  });

  it("navigates around a wall toward the enemy when no shot exists", () => {
    const engine = createJsEngine(detour, rules);
    engine.reset([0, 1], 1);
    // Easy bots do not take bank shots, so this one has to drive.
    const bot = createBot(0, "easy", 3);
    const dt = 1 / rules.tickRate;
    const [me, enemy] = engine.world.tanks;
    const startDist = Math.hypot(enemy!.x - me!.x, enemy!.y - me!.y);
    let fired = false;
    for (let t = 0; t < 6; t += dt) {
      engine.setInput(0, thinkBot(bot, engine.world, engine.map, rules, dt));
      const events = engine.step(dt);
      if (events.some((e) => e.type === "fire" && e.slot === 0)) fired = true;
      if (events.some((e) => e.type === "hit")) break;
    }
    const endDist = Math.hypot(enemy!.x - me!.x, enemy!.y - me!.y);
    // Either it got around the wall (much closer) or it found and took a shot on the way.
    expect(endDist < startDist - 100 || fired).toBe(true);
  });

  it("predicts an incoming bullet and dodges it", () => {
    const engine = createJsEngine(corridor, rules);
    engine.reset([0, 1], 1);
    const dt = 1 / rules.tickRate;
    // The human fires straight at the (stationary) bot.
    engine.setInput(1, FIRE);
    engine.step(dt);
    engine.setInput(1, IDLE);
    const me = engine.world.tanks[0]!;
    expect(findThreat(engine.world, corridor, rules, me, 1.5)).toBeDefined();

    const bot = createBot(0, "hard", 5);
    // A hard bot would shoot back and win; drain its ammo first so this measures dodging only.
    engine.world.tanks[0]!.cooldown = 10;
    const y0 = me.y;
    let hit = false;
    for (let t = 0; t < 1.5; t += dt) {
      engine.setInput(0, thinkBot(bot, engine.world, engine.map, rules, dt));
      if (engine.step(dt).some((e) => e.type === "hit" && e.targetSlot === 0)) hit = true;
    }
    expect(hit).toBe(false);
    expect(Math.abs(me.y - y0)).toBeGreaterThan(rules.tank.radius);
  });

  it("an easy bot never dodges and gets hit", () => {
    const { events } = play(corridor, "easy", 3, (t) => (t < 0.05 ? FIRE : IDLE));
    const hit = events.find((e) => e.type === "hit");
    expect(hit).toBeDefined();
  });

  it("is deterministic for a given seed and forgets round memory on reset", () => {
    const a = play(detour, "normal", 2);
    const b = play(detour, "normal", 2);
    expect(a.engine.world.tanks[0]).toEqual(b.engine.world.tanks[0]);

    const bot = a.bot;
    resetBot(bot);
    expect(bot.field).toBeUndefined();
    expect(bot.input).toEqual(IDLE);
  });
});

describe("simulateShot", () => {
  const noOwner = { ...rules, bullet: { ...rules.bullet, canHitOwner: false } };

  function setup(map: GameMap) {
    const engine = createJsEngine(map, rules);
    engine.reset([0, 1], 1);
    return engine;
  }

  it("hits a target on a clear line", () => {
    const engine = setup(corridor);
    const [me, target] = engine.world.tanks;
    const angle = Math.atan2(target!.y - me!.y, target!.x - me!.x);
    const hit = simulateShot(engine.world, corridor, rules, me!, angle, 0);
    expect(hit).toMatchObject({ slot: target!.slot, bounces: 0 });
    expect(hit!.time).toBeGreaterThan(0);
  });

  it("returns undefined when a wall blocks the line", () => {
    const engine = setup(detour);
    const [me, target] = engine.world.tanks;
    const angle = Math.atan2(target!.y - me!.y, target!.x - me!.x);
    expect(simulateShot(engine.world, detour, rules, me!, angle, 0)).toBeUndefined();
  });

  it("reaches a bank shot the direct line cannot, within its bounce budget", () => {
    const engine = setup(detour);
    const [me, target] = engine.world.tanks;
    const bank = findShot(engine.world, detour, rules, me!, target!, 3);
    expect(bank).toBeDefined();
    const hit = simulateShot(engine.world, detour, rules, me!, bank!, 3);
    expect(hit).toMatchObject({ slot: target!.slot });
    expect(hit!.bounces).toBeGreaterThan(0);
    // The same shot exceeds a zero-bounce budget.
    expect(simulateShot(engine.world, detour, rules, me!, bank!, 0)).toBeUndefined();
  });

  it("reflects off walls and can hit the shooter once it has bounced", () => {
    const engine = setup(corridor);
    const me = engine.world.tanks[0]!;
    const up = -Math.PI / 2;
    expect(simulateShot(engine.world, corridor, rules, me, up, 2)).toMatchObject({ slot: me.slot, bounces: 1 });
    // With owner hits disabled it bounces until the budget runs out instead.
    expect(simulateShot(engine.world, corridor, noOwner, me, up, 5)).toBeUndefined();
  });

  it("stops at a wall when no bounces are allowed", () => {
    const engine = setup(corridor);
    const me = engine.world.tanks[0]!;
    expect(simulateShot(engine.world, corridor, rules, me, -Math.PI / 2, 0)).toBeUndefined();
  });

  it("agrees with a bullet fired in the live simulation", () => {
    const engine = setup(corridor);
    const me = engine.world.tanks[0]!;
    expect(simulateShot(engine.world, corridor, rules, me, me.angle, 0)).toMatchObject({ slot: 1, bounces: 0 });

    engine.setInput(0, FIRE);
    const dt = 1 / rules.tickRate;
    let hit: TickEvent | undefined;
    for (let i = 0; i < 120 && !hit; i++) {
      hit = engine.step(dt).find((e) => e.type === "hit");
    }
    expect(hit).toMatchObject({ type: "hit", targetSlot: 1 });
  });
});

describe("shot candidates", () => {
  it("drops wall faces the unfolded line cannot cross", () => {
    for (const map of listMaps()) {
      const engine = createJsEngine(map, rules);
      engine.reset([0, 1], 1);
      const [me, target] = engine.world.tanks;
      const candidates = shotCandidates(me!, target!, map, rules);

      // Always the direct line and the current heading.
      expect(candidates.length).toBeGreaterThanOrEqual(2);
      // One face per axis per wall at most, against four per wall in the naive
      // search this replaced. A regression would blow well past this bound.
      expect(candidates.length).toBeLessThanOrEqual(2 + 2 * map.walls.length);
    }
  });

  it("keeps the face a bank shot actually bounces off", () => {
    for (const map of [corridor, detour]) {
      const engine = createJsEngine(map, rules);
      engine.reset([0, 1], 1);
      const [me, target] = engine.world.tanks;
      const angle = findShot(engine.world, map, rules, me!, target!, 3);

      expect(angle).toBeDefined();
      expect(simulateShot(engine.world, map, rules, me!, angle!, 3)).toMatchObject({ slot: target!.slot });
    }
  });
});
