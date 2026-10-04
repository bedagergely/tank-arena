import type { GameMap } from "../maps/types.ts";
import { PERK_BULLET_SPEED, PERK_TANK_SPEED, type GameRules } from "../rules.ts";
import { circleHitsWall, circlesOverlap, moveCircle } from "./physics.ts";
import { countBullets, maxBullets } from "./simulation.ts";
import type { Bullet, PlayerInput, Tank, World } from "./types.ts";

/**
 * Server-side AI opponent. Pure numeric code over the read-only `World`: the
 * bot sees exactly what the simulation sees and only ever produces a
 * `PlayerInput`, so it goes through the same authority path as a human.
 */

export type BotDifficulty = "easy" | "normal" | "hard";
export const BOT_DIFFICULTIES: readonly BotDifficulty[] = ["easy", "normal", "hard"];
export const DEFAULT_BOT_DIFFICULTY: BotDifficulty = "normal";

export function isBotDifficulty(value: unknown): value is BotDifficulty {
  return typeof value === "string" && (BOT_DIFFICULTIES as readonly string[]).includes(value);
}

export interface BotProfile {
  /** Seconds between decisions (reaction time). */
  thinkInterval: number;
  /** Most wall bounces the bot will plan a shot with (0 = direct shots only). */
  maxShotBounces: number;
  /** Aim error in radians, uniform in ±aimError. */
  aimError: number;
  /** How far ahead (seconds) incoming bullets are predicted; 0 disables dodging. */
  dodgeHorizon: number;
  /** Chance per decision to go for a reachable loot box instead of the enemy. */
  lootAppetite: number;
  /** Loot farther than this is ignored. */
  lootRange: number;
}

export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = {
  easy: { thinkInterval: 0.3, maxShotBounces: 0, aimError: 0.12, dodgeHorizon: 0, lootAppetite: 0.2, lootRange: 150 },
  normal: { thinkInterval: 0.15, maxShotBounces: 1, aimError: 0.05, dodgeHorizon: 0.6, lootAppetite: 0.6, lootRange: 250 },
  hard: { thinkInterval: 0.05, maxShotBounces: 3, aimError: 0.015, dodgeHorizon: 1, lootAppetite: 0.9, lootRange: 400 },
};

interface Point {
  x: number;
  y: number;
}

interface NavGrid {
  mapId: string;
  cell: number;
  cols: number;
  rows: number;
  blocked: Uint8Array;
}

/** A steering decision: the input to apply now plus the heading the turn is aiming for. */
interface Steering {
  input: PlayerInput;
  heading?: number;
}

export interface BotState {
  slot: number;
  profile: BotProfile;
  rng: number;
  thinkTimer: number;
  input: PlayerInput;
  /** Heading the current turn command is steering toward; the turn stops once reached. */
  heading?: number;
  grid?: NavGrid;
  /** BFS distance (in cells) to the current goal, -1 = unreachable. */
  field?: Int32Array;
  goal?: Point;
  fieldTimer: number;
  /** Committed escape direction while a bullet is incoming. */
  dodgeDir?: Point;
  dodgeThrottle: -1 | 1;
  dodgeTimer: number;
  lastX: number;
  lastY: number;
  stuckTime: number;
  reverseTimer: number;
  reverseInput: PlayerInput;
}

const IDLE: PlayerInput = { throttle: 0, turn: 0, fire: false };
const NAV_CELL = 10;
const SHOT_DT = 1 / 60;
const SHOT_MAX_SECONDS = 3;
const SHOT_SAMPLES = 36;
const AIM_TOLERANCE = 0.05;
const STANDOFF = 110;
const ARRIVE = 10;

export function createBot(slot: number, difficulty: BotDifficulty, seed: number): BotState {
  const bot: BotState = {
    slot,
    profile: BOT_PROFILES[difficulty],
    rng: (seed | 0) || 0x2545f491,
    thinkTimer: 0,
    input: IDLE,
    fieldTimer: 0,
    dodgeThrottle: 1,
    dodgeTimer: 0,
    lastX: NaN,
    lastY: NaN,
    stuckTime: 0,
    reverseTimer: 0,
    reverseInput: IDLE,
  };
  // Stagger decisions so several bots do not move in lockstep.
  bot.thinkTimer = random(bot) * bot.profile.thinkInterval;
  return bot;
}

/** Forget round-specific memory (paths, stuck detection) while keeping identity and RNG. */
export function resetBot(bot: BotState): void {
  bot.thinkTimer = 0;
  bot.input = IDLE;
  bot.heading = undefined;
  bot.field = undefined;
  bot.goal = undefined;
  bot.fieldTimer = 0;
  bot.dodgeDir = undefined;
  bot.dodgeTimer = 0;
  bot.lastX = NaN;
  bot.lastY = NaN;
  bot.stuckTime = 0;
  bot.reverseTimer = 0;
}

/**
 * Called once per simulation tick before `engine.step`. Returns the input the
 * bot wants applied this tick. Decisions are only re-evaluated every
 * `profile.thinkInterval` seconds; in between the last input is held, except
 * that a turn stops as soon as the heading it was aiming for is reached.
 */
export function thinkBot(bot: BotState, world: Readonly<World>, map: GameMap, rules: GameRules, dt: number): PlayerInput {
  const me = world.tanks.find((t) => t.slot === bot.slot);
  if (!me || !me.alive) {
    bot.input = IDLE;
    return IDLE;
  }

  trackStuck(bot, me, rules, dt);
  if (bot.reverseTimer > 0) {
    bot.reverseTimer -= dt;
    bot.input = bot.reverseInput;
    return bot.input;
  }

  bot.thinkTimer -= dt;
  bot.fieldTimer -= dt;
  bot.dodgeTimer -= dt;
  if (bot.thinkTimer <= 0) {
    bot.thinkTimer = bot.profile.thinkInterval;
    const steering = decide(bot, me, world, map, rules);
    bot.input = steering.input;
    bot.heading = steering.heading;
  } else if (bot.input.fire) {
    // Firing is a one-tick decision, never held.
    bot.input = { ...bot.input, fire: false };
  }

  if (bot.heading !== undefined && bot.input.turn !== 0) {
    const diff = angleDiff(bot.heading, me.angle);
    const perTick = rules.tank.turnSpeed * dt;
    const turn: -1 | 0 | 1 = Math.abs(diff) <= perTick ? 0 : diff > 0 ? 1 : -1;
    if (turn !== bot.input.turn) bot.input = { ...bot.input, turn };
  }
  return bot.input;
}

function decide(bot: BotState, me: Tank, world: Readonly<World>, map: GameMap, rules: GameRules): Steering {
  const enemies = world.tanks.filter((t) => t.alive && t.slot !== me.slot);
  if (enemies.length === 0) return { input: IDLE };
  const target = nearest(me, enemies)!;

  const canFire = me.cooldown <= 0 && countBullets(world, me.slot) < maxBullets(me, rules);
  const shot = canFire ? findShot(world, map, rules, me, target, bot.profile.maxShotBounces) : undefined;

  if (bot.profile.dodgeHorizon > 0) {
    const threat = findThreat(world, map, rules, me, bot.profile.dodgeHorizon);
    // Keep escaping for the committed time even once we are barely clear, or we would turn straight back in.
    if (threat || (bot.dodgeDir && bot.dodgeTimer > 0)) {
      const escape = dodge(bot, me, threat, map, rules);
      // Shoot back on the way out if we already happen to be lined up.
      const fire = shot !== undefined && Math.abs(angleDiff(shot, me.angle)) < AIM_TOLERANCE;
      return { input: { ...escape.input, fire }, heading: escape.heading };
    }
  }
  bot.dodgeDir = undefined;

  if (shot !== undefined) {
    const aim = shot + (random(bot) * 2 - 1) * bot.profile.aimError;
    const diff = angleDiff(aim, me.angle);
    if (Math.abs(diff) < AIM_TOLERANCE) return { input: { throttle: 0, turn: 0, fire: true } };
    return { input: { throttle: 0, turn: diff > 0 ? 1 : -1, fire: false }, heading: aim };
  }

  const goal = chooseGoal(bot, me, target, world);
  const waypoint = navigate(bot, me, goal, map, rules);
  if (!waypoint) {
    // Nowhere to go (boxed in or close enough): face the enemy so a shot opens up.
    return face(me, target);
  }
  return steer(me, waypoint, false);
}

// ---------------------------------------------------------------------------
// Shooting

/**
 * Trace a bullet fired from `shooter` at `angle` through the walls, with the
 * real bounce rules. Returns the first tank it would hit (or undefined if it
 * expires, exceeds `maxBounces`, or runs out of time).
 */
export function simulateShot(
  world: Readonly<World>,
  map: GameMap,
  rules: GameRules,
  shooter: Tank,
  angle: number,
  maxBounces: number,
): { slot: number; bounces: number; time: number } | undefined {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const muzzle = rules.tank.radius + rules.bullet.radius + 1;
  const speed = rules.bullet.speed * (shooter.perks[PERK_BULLET_SPEED] > 0 ? rules.loot.bulletSpeedMultiplier : 1);
  const r = rules.bullet.radius;
  const tankRadius = rules.tank.radius;
  const canHitOwner = rules.bullet.canHitOwner;

  let x = shooter.x + dirX * muzzle;
  let y = shooter.y + dirY * muzzle;
  let vx = dirX * speed;
  let vy = dirY * speed;
  let bounces = 0;
  const steps = Math.ceil(SHOT_MAX_SECONDS / SHOT_DT);

  for (let i = 1; i <= steps; i++) {
    const moved = moveCircle(map, x, y, r, vx * SHOT_DT, vy * SHOT_DT);
    x = moved.x;
    y = moved.y;
    if (moved.hitX) vx = -vx;
    if (moved.hitY) vy = -vy;
    if (moved.hitX || moved.hitY) {
      bounces++;
      if (bounces > maxBounces || bounces >= rules.bullet.maxBounces) return undefined;
    }
    for (const tank of world.tanks) {
      if (!tank.alive) continue;
      if (tank.slot === shooter.slot && (!canHitOwner || bounces === 0)) continue;
      if (circlesOverlap(x, y, r, tank.x, tank.y, tankRadius)) {
        return { slot: tank.slot, bounces, time: i * SHOT_DT };
      }
    }
  }
  return undefined;
}

/**
 * Angle to fire at so the bullet reaches `target` (and not the shooter) with
 * at most `maxBounces` bounces, preferring fewer bounces, then less turning.
 * Candidates: the direct line, the current heading, one-bounce mirror images
 * of the target in every wall face, and a coarse sweep for longer ricochets.
 */
export function findShot(
  world: Readonly<World>,
  map: GameMap,
  rules: GameRules,
  shooter: Tank,
  target: Tank,
  maxBounces: number,
): number | undefined {
  const direct = Math.atan2(target.y - shooter.y, target.x - shooter.x);
  const hit = simulateShot(world, map, rules, shooter, direct, 0);
  if (hit?.slot === target.slot) return direct;
  if (maxBounces <= 0) return undefined;

  let best: { angle: number; bounces: number; turn: number } | undefined;
  const consider = (angle: number) => {
    const result = simulateShot(world, map, rules, shooter, angle, maxBounces);
    if (!result || result.slot !== target.slot) return;
    const turn = Math.abs(angleDiff(angle, shooter.angle));
    if (!best || result.bounces < best.bounces || (result.bounces === best.bounces && turn < best.turn)) {
      best = { angle, bounces: result.bounces, turn };
    }
  };
  consider(shooter.angle);
  for (const wall of map.walls) {
    // Only faces turned toward the shooter can reflect a bullet back at the target.
    if (shooter.x < wall.x) consider(Math.atan2(target.y - shooter.y, 2 * wall.x - target.x - shooter.x));
    const right = wall.x + wall.width;
    if (shooter.x > right) consider(Math.atan2(target.y - shooter.y, 2 * right - target.x - shooter.x));
    if (shooter.y < wall.y) consider(Math.atan2(2 * wall.y - target.y - shooter.y, target.x - shooter.x));
    const bottom = wall.y + wall.height;
    if (shooter.y > bottom) consider(Math.atan2(2 * bottom - target.y - shooter.y, target.x - shooter.x));
  }
  if (best === undefined && maxBounces > 1) {
    for (let i = 0; i < SHOT_SAMPLES; i++) {
      consider(shooter.angle + (i / SHOT_SAMPLES) * Math.PI * 2);
    }
  }
  return best?.angle;
}

// ---------------------------------------------------------------------------
// Dodging

interface Threat {
  vx: number;
  vy: number;
  time: number;
}

/** Earliest bullet predicted to touch `me` within `horizon` seconds. */
export function findThreat(world: Readonly<World>, map: GameMap, rules: GameRules, me: Tank, horizon: number): Threat | undefined {
  const r = rules.bullet.radius;
  const danger = rules.tank.radius + rules.bullet.radius + 6;
  const dt = 1 / rules.tickRate;
  const steps = Math.ceil(horizon / dt);
  let best: Threat | undefined;

  for (const bullet of world.bullets) {
    if (bullet.ownerSlot === me.slot && !rules.bullet.canHitOwner) continue;
    const time = predictImpact(map, rules, bullet, me, r, danger, dt, steps);
    if (time !== undefined && (!best || time < best.time)) {
      best = { vx: bullet.vx, vy: bullet.vy, time };
    }
  }
  return best;
}

function predictImpact(
  map: GameMap,
  rules: GameRules,
  bullet: Bullet,
  me: Tank,
  r: number,
  danger: number,
  dt: number,
  steps: number,
): number | undefined {
  let { x, y, vx, vy, bounces } = bullet;
  const ownBullet = bullet.ownerSlot === me.slot;
  for (let i = 1; i <= steps; i++) {
    const moved = moveCircle(map, x, y, r, vx * dt, vy * dt);
    x = moved.x;
    y = moved.y;
    if (moved.hitX) vx = -vx;
    if (moved.hitY) vy = -vy;
    if (moved.hitX || moved.hitY) {
      bounces++;
      if (bounces >= rules.bullet.maxBounces) return undefined;
    }
    // Our own fresh bullet is flying away; the sim ignores it until it bounces.
    if (ownBullet && bounces === 0) continue;
    if (circlesOverlap(x, y, 0, me.x, me.y, danger)) return i * dt;
  }
  return undefined;
}

/**
 * Pick (and then stick to) a direction perpendicular to the bullet, choosing
 * the side with more room and whichever of forward/reverse needs less turning.
 * Re-deciding every think would flip the choice as the heading crosses 90°.
 */
function dodge(bot: BotState, me: Tank, threat: Threat | undefined, map: GameMap, rules: GameRules): Steering {
  const reach = rules.tank.speed * 0.6;
  const blocked =
    bot.dodgeDir !== undefined &&
    freeDistance(map, me.x, me.y, bot.dodgeDir.x, bot.dodgeDir.y, rules.tank.radius, reach) < rules.tank.radius;
  if (threat && (!bot.dodgeDir || bot.dodgeTimer <= 0 || blocked)) {
    const len = Math.hypot(threat.vx, threat.vy) || 1;
    const px = -threat.vy / len;
    const py = threat.vx / len;
    const a = freeDistance(map, me.x, me.y, px, py, rules.tank.radius, reach);
    const b = freeDistance(map, me.x, me.y, -px, -py, rules.tank.radius, reach);
    bot.dodgeDir = a >= b ? { x: px, y: py } : { x: -px, y: -py };
    const desired = Math.atan2(bot.dodgeDir.y, bot.dodgeDir.x);
    bot.dodgeThrottle = Math.abs(angleDiff(desired, me.angle)) > Math.PI / 2 ? -1 : 1;
    bot.dodgeTimer = Math.max(0.3, threat.time);
  }
  const dir = bot.dodgeDir!;
  const desired = Math.atan2(dir.y, dir.x) + (bot.dodgeThrottle < 0 ? Math.PI : 0);
  const diff = angleDiff(desired, me.angle);
  const turn: -1 | 0 | 1 = Math.abs(diff) < 0.08 ? 0 : diff > 0 ? 1 : -1;
  return { input: { throttle: bot.dodgeThrottle, turn, fire: false }, heading: desired };
}

/** How far the tank can slide along (dx,dy) before touching a wall, up to `max`. */
function freeDistance(map: GameMap, x: number, y: number, dx: number, dy: number, radius: number, max: number): number {
  const step = 6;
  for (let d = step; d <= max; d += step) {
    if (circleHitsWall(map, x + dx * d, y + dy * d, radius)) return d - step;
  }
  return max;
}

// ---------------------------------------------------------------------------
// Navigation

interface Goal extends Point {
  kind: "enemy" | "loot";
}

function chooseGoal(bot: BotState, me: Tank, target: Tank, world: Readonly<World>): Goal {
  const { lootAppetite, lootRange } = bot.profile;
  if (lootAppetite > 0 && world.loot.length > 0) {
    const box = nearest(me, world.loot)!;
    const dist = Math.hypot(box.x - me.x, box.y - me.y);
    // Keep heading for a box once committed, otherwise roll for it.
    const committed = bot.goal !== undefined && bot.goal.x === box.x && bot.goal.y === box.y;
    if (dist <= lootRange && (committed || random(bot) < lootAppetite)) return { x: box.x, y: box.y, kind: "loot" };
  }
  return { x: target.x, y: target.y, kind: "enemy" };
}

function navigate(bot: BotState, me: Tank, goal: Goal, map: GameMap, rules: GameRules): Point | undefined {
  const toGoal = Math.hypot(goal.x - me.x, goal.y - me.y);
  // Close enough: stop driving into the enemy (or we are on the loot box already).
  if (toGoal < (goal.kind === "enemy" ? STANDOFF : ARRIVE)) return undefined;

  const grid = navGrid(bot, map, rules);
  const moved = bot.goal === undefined || Math.hypot(goal.x - bot.goal.x, goal.y - bot.goal.y) > grid.cell * 2;
  if (!bot.field || moved || bot.fieldTimer <= 0) {
    bot.goal = goal;
    bot.field = distanceField(grid, goal);
    bot.fieldTimer = 0.5;
  }

  const path = descend(grid, bot.field, me);
  if (path.length === 0) {
    return lineClear(map, me, goal, rules.tank.radius) ? goal : undefined;
  }
  // Follow the farthest waypoint we can drive straight to (string-pulling).
  for (let i = path.length - 1; i >= 0; i -= 2) {
    if (lineClear(map, me, path[i]!, rules.tank.radius)) return path[i];
  }
  return path[0];
}

function navGrid(bot: BotState, map: GameMap, rules: GameRules): NavGrid {
  if (bot.grid && bot.grid.mapId === map.id) return bot.grid;
  const cell = NAV_CELL;
  const cols = Math.ceil(map.width / cell);
  const rows = Math.ceil(map.height / cell);
  const blocked = new Uint8Array(cols * rows);
  const clearance = rules.tank.radius + 0.5;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (circleHitsWall(map, (c + 0.5) * cell, (r + 0.5) * cell, clearance)) blocked[r * cols + c] = 1;
    }
  }
  bot.grid = { mapId: map.id, cell, cols, rows, blocked };
  return bot.grid;
}

function cellOf(grid: NavGrid, p: Point): number {
  const c = Math.min(grid.cols - 1, Math.max(0, Math.floor(p.x / grid.cell)));
  const r = Math.min(grid.rows - 1, Math.max(0, Math.floor(p.y / grid.cell)));
  return r * grid.cols + c;
}

function centerOf(grid: NavGrid, index: number): Point {
  return {
    x: ((index % grid.cols) + 0.5) * grid.cell,
    y: (Math.floor(index / grid.cols) + 0.5) * grid.cell,
  };
}

/** Nearest walkable cell to `index` (itself if walkable), searching outward in rings. */
function walkableNear(grid: NavGrid, index: number): number {
  if (!grid.blocked[index]) return index;
  const c0 = index % grid.cols;
  const r0 = Math.floor(index / grid.cols);
  for (let ring = 1; ring < Math.max(grid.cols, grid.rows); ring++) {
    for (let r = r0 - ring; r <= r0 + ring; r++) {
      for (let c = c0 - ring; c <= c0 + ring; c++) {
        if (Math.abs(r - r0) !== ring && Math.abs(c - c0) !== ring) continue;
        if (r < 0 || c < 0 || r >= grid.rows || c >= grid.cols) continue;
        const i = r * grid.cols + c;
        if (!grid.blocked[i]) return i;
      }
    }
  }
  return index;
}

/** Breadth-first distance from every cell to the goal (4-connected). */
function distanceField(grid: NavGrid, goal: Point): Int32Array {
  const field = new Int32Array(grid.cols * grid.rows).fill(-1);
  const start = walkableNear(grid, cellOf(grid, goal));
  const queue = new Int32Array(grid.cols * grid.rows);
  let head = 0;
  let tail = 0;
  field[start] = 0;
  queue[tail++] = start;
  while (head < tail) {
    const i = queue[head++]!;
    const d = field[i]! + 1;
    const c = i % grid.cols;
    const r = Math.floor(i / grid.cols);
    const visit = (j: number) => {
      if (grid.blocked[j] || field[j] !== -1) return;
      field[j] = d;
      queue[tail++] = j;
    };
    if (c > 0) visit(i - 1);
    if (c < grid.cols - 1) visit(i + 1);
    if (r > 0) visit(i - grid.cols);
    if (r < grid.rows - 1) visit(i + grid.cols);
  }
  return field;
}

/** Walk downhill on the distance field from the tank's cell to the goal cell. */
function descend(grid: NavGrid, field: Int32Array, me: Tank): Point[] {
  let i = walkableNear(grid, cellOf(grid, me));
  if (field[i]! < 0) return [];
  const path: Point[] = [];
  let guard = grid.cols * grid.rows;
  while (field[i]! > 0 && guard-- > 0) {
    const c = i % grid.cols;
    const r = Math.floor(i / grid.cols);
    let next = i;
    const tryCell = (j: number) => {
      if (field[j]! >= 0 && field[j]! < field[next]!) next = j;
    };
    if (c > 0) tryCell(i - 1);
    if (c < grid.cols - 1) tryCell(i + 1);
    if (r > 0) tryCell(i - grid.cols);
    if (r < grid.rows - 1) tryCell(i + grid.cols);
    if (next === i) break;
    i = next;
    path.push(centerOf(grid, i));
  }
  return path;
}

/** True when a tank of `radius` can slide in a straight line from `from` to `to`. */
function lineClear(map: GameMap, from: Point, to: Point, radius: number): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / 6));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (circleHitsWall(map, from.x + dx * t, from.y + dy * t, radius)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Steering

/** Turn toward `to` and drive; reverses when that is quicker and allowed. */
function steer(me: Tank, to: Point, allowReverse: boolean): Steering {
  const desired = Math.atan2(to.y - me.y, to.x - me.x);
  let heading = desired;
  let diff = angleDiff(desired, me.angle);
  let throttle: -1 | 0 | 1 = 1;
  if (allowReverse && Math.abs(diff) > Math.PI / 2) {
    heading = desired + Math.PI;
    diff = angleDiff(heading, me.angle);
    throttle = -1;
  } else if (Math.abs(diff) > 1) {
    throttle = 0;
  }
  const turn: -1 | 0 | 1 = Math.abs(diff) < 0.08 ? 0 : diff > 0 ? 1 : -1;
  return { input: { throttle, turn, fire: false }, heading };
}

/** Turn in place to point at `target`. */
function face(me: Tank, target: Point): Steering {
  const heading = Math.atan2(target.y - me.y, target.x - me.x);
  const diff = angleDiff(heading, me.angle);
  const turn: -1 | 0 | 1 = Math.abs(diff) < AIM_TOLERANCE ? 0 : diff > 0 ? 1 : -1;
  return { input: { throttle: 0, turn, fire: false }, heading };
}

function trackStuck(bot: BotState, me: Tank, rules: GameRules, dt: number): void {
  const wanted = bot.input.throttle !== 0 && bot.reverseTimer <= 0;
  if (wanted && Number.isFinite(bot.lastX)) {
    const moved = Math.hypot(me.x - bot.lastX, me.y - bot.lastY);
    const speed = rules.tank.speed * (me.perks[PERK_TANK_SPEED] > 0 ? rules.loot.tankSpeedMultiplier : 1);
    if (moved < speed * dt * 0.2) {
      bot.stuckTime += dt;
      if (bot.stuckTime > 0.5) {
        bot.stuckTime = 0;
        bot.reverseTimer = 0.4;
        bot.reverseInput = { throttle: bot.input.throttle > 0 ? -1 : 1, turn: random(bot) < 0.5 ? -1 : 1, fire: false };
        bot.field = undefined;
        bot.dodgeDir = undefined;
      }
    } else {
      bot.stuckTime = 0;
    }
  } else {
    bot.stuckTime = 0;
  }
  bot.lastX = me.x;
  bot.lastY = me.y;
}

// ---------------------------------------------------------------------------
// Helpers

function nearest<T extends Point>(from: Point, items: readonly T[]): T | undefined {
  let best: T | undefined;
  let bestDist = Infinity;
  for (const item of items) {
    const d = Math.hypot(item.x - from.x, item.y - from.y);
    if (d < bestDist) {
      bestDist = d;
      best = item;
    }
  }
  return best;
}

/** Signed shortest rotation from `from` to `to`, in (-π, π]. */
export function angleDiff(to: number, from: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** xorshift32 on the bot's own seed: deterministic per (seed, decision sequence). */
function random(bot: BotState): number {
  let x = bot.rng | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  bot.rng = x;
  return (x >>> 0) / 0x100000000;
}
