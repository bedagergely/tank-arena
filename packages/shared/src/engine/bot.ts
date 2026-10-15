import type { GameMap, Rect } from "../maps/types.ts";
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
const SHOT_MAX_SECONDS = 3;
const SHOT_SAMPLES = 36;
/** Contacts closer than this are treated as "at the current position" and ignored. */
const SHOT_EPSILON = 1e-9;
/** Seconds of travel used to step a bullet off a wall it just bounced on. */
const SHOT_NUDGE = 1e-6;
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
  const myTank = world.tanks.find((tank) => tank.slot === bot.slot);
  if (!myTank || !myTank.alive) {
    bot.input = IDLE;
    return IDLE;
  }

  trackStuck(bot, myTank, rules, dt);
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
    const steering = decide(bot, myTank, world, map, rules);
    bot.input = steering.input;
    bot.heading = steering.heading;
  } else if (bot.input.fire) {
    // Firing is a one-tick decision, never held.
    bot.input = { ...bot.input, fire: false };
  }

  if (bot.heading !== undefined && bot.input.turn !== 0) {
    const angleDelta = angleDiff(bot.heading, myTank.angle);
    const maxTurnPerTick = rules.tank.turnSpeed * dt;
    const turn: -1 | 0 | 1 = Math.abs(angleDelta) <= maxTurnPerTick ? 0 : angleDelta > 0 ? 1 : -1;
    if (turn !== bot.input.turn) bot.input = { ...bot.input, turn };
  }
  return bot.input;
}

function decide(bot: BotState, myTank: Tank, world: Readonly<World>, map: GameMap, rules: GameRules): Steering {
  const enemies = world.tanks.filter((tank) => tank.alive && tank.slot !== myTank.slot);
  if (enemies.length === 0) return { input: IDLE };
  const target = nearest(myTank, enemies)!;

  const canFire = myTank.cooldown <= 0 && countBullets(world, myTank.slot) < maxBullets(myTank, rules);
  const shot = canFire ? findShot(world, map, rules, myTank, target, bot.profile.maxShotBounces) : undefined;

  if (bot.profile.dodgeHorizon > 0) {
    const threat = findThreat(world, map, rules, myTank, bot.profile.dodgeHorizon);
    // Keep escaping for the committed time even once we are barely clear, or we would turn straight back in.
    if (threat || (bot.dodgeDir && bot.dodgeTimer > 0)) {
      const escape = dodge(bot, myTank, threat, map, rules);
      // Shoot back on the way out if we already happen to be lined up.
      const fire = shot !== undefined && Math.abs(angleDiff(shot, myTank.angle)) < AIM_TOLERANCE;
      return { input: { ...escape.input, fire }, heading: escape.heading };
    }
  }
  bot.dodgeDir = undefined;

  if (shot !== undefined) {
    const aim = shot + (random(bot) * 2 - 1) * bot.profile.aimError;
    const angleDelta = angleDiff(aim, myTank.angle);
    if (Math.abs(angleDelta) < AIM_TOLERANCE) return { input: { throttle: 0, turn: 0, fire: true } };
    return { input: { throttle: 0, turn: angleDelta > 0 ? 1 : -1, fire: false }, heading: aim };
  }

  const goal = chooseGoal(bot, myTank, target, world);
  const waypoint = navigate(bot, myTank, goal, map, rules);
  if (!waypoint) {
    // Nowhere to go (boxed in or close enough): face the enemy so a shot opens up.
    return face(myTank, target);
  }
  return steer(myTank, waypoint, false);
}

// ---------------------------------------------------------------------------
// Shooting

/** Where a bullet leg meets a surface, and which velocity components reflect off it. */
interface ShotImpact {
  time: number;
  reflectX: boolean;
  reflectY: boolean;
}

/**
 * Trace a bullet fired from `shooter` at `angle` through the walls, with the
 * real bounce rules. Returns the first tank it would hit (or undefined if it
 * expires, exceeds `maxBounces`, or runs out of time).
 *
 * Bullets travel in straight lines at constant speed and reflect off the
 * axis-aligned wall rectangles, so the path is solved analytically instead of
 * stepped frame by frame: each leg is a ray swept against the walls (a circle
 * vs. AABB test) and the tanks, and the earliest impact wins.
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
  const bulletRadius = rules.bullet.radius;
  const tankRadius = rules.tank.radius;
  const canHitOwner = rules.bullet.canHitOwner;

  let x = shooter.x + dirX * muzzle;
  let y = shooter.y + dirY * muzzle;
  let vx = dirX * speed;
  let vy = dirY * speed;
  let bounces = 0;
  let time = 0;

  // Firing point-blank into a wall starts the bullet inside it; the step
  // simulator pins it there until it expires, so the shot reaches nothing.
  if (circleHitsWall(map, x, y, bulletRadius)) return undefined;

  // The map border behaves like a wall for the bullet centre.
  const borderMinX = bulletRadius;
  const borderMinY = bulletRadius;
  const borderMaxX = map.width - bulletRadius;
  const borderMaxY = map.height - bulletRadius;

  let remaining = SHOT_MAX_SECONDS;
  while (remaining > 0) {
    const wall = castShotRay(map.walls, bulletRadius, x, y, vx, vy, remaining, borderMinX, borderMinY, borderMaxX, borderMaxY);
    const legTime = wall ? wall.time : remaining;
    const hit = firstShotHit(world.tanks, x, y, vx, vy, legTime, bulletRadius, tankRadius, shooter.slot, canHitOwner, bounces);
    if (hit) return { slot: hit.slot, bounces, time: time + hit.time };
    if (!wall) return undefined;

    x += vx * wall.time;
    y += vy * wall.time;
    time += wall.time;
    remaining -= wall.time;
    if (wall.reflectX) vx = -vx;
    if (wall.reflectY) vy = -vy;
    bounces++;
    if (bounces > maxBounces || bounces >= rules.bullet.maxBounces) return undefined;

    // Step a hair off the surface so the next leg cannot re-detect it.
    x += vx * SHOT_NUDGE;
    y += vy * SHOT_NUDGE;
    time += SHOT_NUDGE;
    remaining -= SHOT_NUDGE;
  }
  return undefined;
}

/**
 * Earliest wall the leg from (x, y) along (vx, vy) meets within `maxTime`
 * seconds, testing only the walls whose grown bounding box overlaps the leg's
 * bounding box. Ties merge into a single impact that reflects every component
 * involved.
 */
function castShotRay(
  walls: readonly Rect[],
  bulletRadius: number,
  x: number,
  y: number,
  vx: number,
  vy: number,
  maxTime: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): ShotImpact | undefined {
  let best: ShotImpact | undefined;
  const consider = (time: number, reflectX: boolean, reflectY: boolean): void => {
    if (time <= SHOT_EPSILON || time > maxTime) return;
    if (!best || time < best.time - SHOT_EPSILON) {
      best = { time, reflectX, reflectY };
    } else if (time <= best.time + SHOT_EPSILON) {
      best.reflectX ||= reflectX;
      best.reflectY ||= reflectY;
    }
  };

  // The border planes, hit only while heading out of the map.
  if (vx < 0) consider((minX - x) / vx, true, false);
  else if (vx > 0) consider((maxX - x) / vx, true, false);
  if (vy < 0) consider((minY - y) / vy, false, true);
  else if (vy > 0) consider((maxY - y) / vy, false, true);

  const legMinX = Math.min(x, x + vx * maxTime);
  const legMaxX = Math.max(x, x + vx * maxTime);
  const legMinY = Math.min(y, y + vy * maxTime);
  const legMaxY = Math.max(y, y + vy * maxTime);
  for (const wall of walls) {
    if (wall.x + wall.width + bulletRadius < legMinX || wall.x - bulletRadius > legMaxX || wall.y + wall.height + bulletRadius < legMinY || wall.y - bulletRadius > legMaxY) continue;
    const hit = rayShotBox(wall, bulletRadius, x, y, vx, vy);
    if (hit) consider(hit.time, hit.reflectX, hit.reflectY);
  }
  return best;
}

/**
 * Entry point of a ray into the Minkowski sum of a wall and the bullet circle:
 * the wall grown by `bulletRadius` with rounded corners. A ray only grazes past
 * a corner if it stays more than `bulletRadius` from the rect, so a sharp grown
 * box would wrongly block it; flat faces and quarter-circle corner arcs are
 * tested separately.
 */
function rayShotBox(wall: Rect, bulletRadius: number, x: number, y: number, vx: number, vy: number): ShotImpact | undefined {
  let best: ShotImpact | undefined;
  const consider = (time: number, reflectX: boolean, reflectY: boolean): void => {
    if (time <= SHOT_EPSILON) return;
    if (!best || time < best.time - SHOT_EPSILON) best = { time, reflectX, reflectY };
    else if (time <= best.time + SHOT_EPSILON) {
      best.reflectX ||= reflectX;
      best.reflectY ||= reflectY;
    }
  };

  // Flat faces, over the wall's own extent (past that it is a rounded corner).
  if (vx > 0) {
    const hitTime = (wall.x - bulletRadius - x) / vx;
    const faceY = y + vy * hitTime;
    if (faceY >= wall.y && faceY <= wall.y + wall.height) consider(hitTime, true, false);
  } else if (vx < 0) {
    const hitTime = (wall.x + wall.width + bulletRadius - x) / vx;
    const faceY = y + vy * hitTime;
    if (faceY >= wall.y && faceY <= wall.y + wall.height) consider(hitTime, true, false);
  }
  if (vy > 0) {
    const hitTime = (wall.y - bulletRadius - y) / vy;
    const faceX = x + vx * hitTime;
    if (faceX >= wall.x && faceX <= wall.x + wall.width) consider(hitTime, false, true);
  } else if (vy < 0) {
    const hitTime = (wall.y + wall.height + bulletRadius - y) / vy;
    const faceX = x + vx * hitTime;
    if (faceX >= wall.x && faceX <= wall.x + wall.width) consider(hitTime, false, true);
  }

  // Rounded corners: the centre sweeps a quarter arc of radius `bulletRadius`
  // around the rect corner. Reflect the axis the contact normal leans towards.
  const speedSq = vx * vx + vy * vy;
  const corner = (cornerX: number, cornerY: number): void => {
    const offsetX = x - cornerX;
    const offsetY = y - cornerY;
    const constant = offsetX * offsetX + offsetY * offsetY - bulletRadius * bulletRadius;
    if (constant < 0) return;
    const dot = offsetX * vx + offsetY * vy;
    const discriminant = dot * dot - speedSq * constant;
    if (discriminant < 0) return;
    const hitTime = (-dot - Math.sqrt(discriminant)) / speedSq;
    if (hitTime <= SHOT_EPSILON) return;
    const hitX = x + vx * hitTime - cornerX;
    const hitY = y + vy * hitTime - cornerY;
    // Only the arc facing outward from this corner counts; elsewhere a face is nearer.
    if ((cornerX === wall.x ? hitX <= 0 : hitX >= 0) && (cornerY === wall.y ? hitY <= 0 : hitY >= 0)) {
      consider(hitTime, Math.abs(hitX) >= Math.abs(hitY), Math.abs(hitY) >= Math.abs(hitX));
    }
  };
  corner(wall.x, wall.y);
  corner(wall.x + wall.width, wall.y);
  corner(wall.x, wall.y + wall.height);
  corner(wall.x + wall.width, wall.y + wall.height);
  return best;
}

/**
 * Earliest tank the leg from (x, y) along (vx, vy) overlaps within `maxTime`
 * seconds. The bullet and tank are circles, so contact is the first root of a
 * quadratic distance test.
 */
function firstShotHit(
  tanks: readonly Tank[],
  x: number,
  y: number,
  vx: number,
  vy: number,
  maxTime: number,
  bulletRadius: number,
  tankRadius: number,
  shooterSlot: number,
  canHitOwner: boolean,
  bounces: number,
): { slot: number; time: number } | undefined {
  const reachSq = (bulletRadius + tankRadius) ** 2;
  const speedSq = vx * vx + vy * vy;
  let best: { slot: number; time: number } | undefined;

  for (const tank of tanks) {
    if (!tank.alive) continue;
    if (tank.slot === shooterSlot && (!canHitOwner || bounces === 0)) continue;

    const offsetX = x - tank.x;
    const offsetY = y - tank.y;
    const constant = offsetX * offsetX + offsetY * offsetY - reachSq;
    let hitTime: number;
    if (constant < 0) {
      hitTime = 0;
    } else {
      const dot = offsetX * vx + offsetY * vy;
      if (dot >= 0) continue;
      const discriminant = dot * dot - speedSq * constant;
      if (discriminant < 0) continue;
      hitTime = (-dot - Math.sqrt(discriminant)) / speedSq;
    }
    if (hitTime > maxTime) continue;
    if (!best || hitTime < best.time) best = { slot: tank.slot, time: hitTime };
  }
  return best;
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
    for (let sample = 0; sample < SHOT_SAMPLES; sample++) {
      consider(shooter.angle + (sample / SHOT_SAMPLES) * Math.PI * 2);
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

/** Earliest bullet predicted to touch `myTank` within `horizon` seconds. */
export function findThreat(world: Readonly<World>, map: GameMap, rules: GameRules, myTank: Tank, horizon: number): Threat | undefined {
  const bulletRadius = rules.bullet.radius;
  const dangerRadius = rules.tank.radius + rules.bullet.radius + 6;
  const dt = 1 / rules.tickRate;
  const steps = Math.ceil(horizon / dt);
  let best: Threat | undefined;

  for (const bullet of world.bullets) {
    if (bullet.ownerSlot === myTank.slot && !rules.bullet.canHitOwner) continue;
    const time = predictImpact(map, rules, bullet, myTank, bulletRadius, dangerRadius, dt, steps);
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
  myTank: Tank,
  bulletRadius: number,
  dangerRadius: number,
  dt: number,
  steps: number,
): number | undefined {
  let { x, y, vx, vy, bounces } = bullet;
  const ownBullet = bullet.ownerSlot === myTank.slot;
  for (let step = 1; step <= steps; step++) {
    const moved = moveCircle(map, x, y, bulletRadius, vx * dt, vy * dt);
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
    if (circlesOverlap(x, y, 0, myTank.x, myTank.y, dangerRadius)) return step * dt;
  }
  return undefined;
}

/**
 * Pick (and then stick to) a direction perpendicular to the bullet, choosing
 * the side with more room and whichever of forward/reverse needs less turning.
 * Re-deciding every think would flip the choice as the heading crosses 90°.
 */
function dodge(bot: BotState, myTank: Tank, threat: Threat | undefined, map: GameMap, rules: GameRules): Steering {
  const reach = rules.tank.speed * 0.6;
  const blocked =
    bot.dodgeDir !== undefined &&
    freeDistance(map, myTank.x, myTank.y, bot.dodgeDir.x, bot.dodgeDir.y, rules.tank.radius, reach) < rules.tank.radius;
  if (threat && (!bot.dodgeDir || bot.dodgeTimer <= 0 || blocked)) {
    const length = Math.hypot(threat.vx, threat.vy) || 1;
    const perpX = -threat.vy / length;
    const perpY = threat.vx / length;
    const roomAlongPerp = freeDistance(map, myTank.x, myTank.y, perpX, perpY, rules.tank.radius, reach);
    const roomOppositePerp = freeDistance(map, myTank.x, myTank.y, -perpX, -perpY, rules.tank.radius, reach);
    bot.dodgeDir = roomAlongPerp >= roomOppositePerp ? { x: perpX, y: perpY } : { x: -perpX, y: -perpY };
    const desiredHeading = Math.atan2(bot.dodgeDir.y, bot.dodgeDir.x);
    bot.dodgeThrottle = Math.abs(angleDiff(desiredHeading, myTank.angle)) > Math.PI / 2 ? -1 : 1;
    bot.dodgeTimer = Math.max(0.3, threat.time);
  }
  const escapeDir = bot.dodgeDir!;
  const desiredHeading = Math.atan2(escapeDir.y, escapeDir.x) + (bot.dodgeThrottle < 0 ? Math.PI : 0);
  const angleDelta = angleDiff(desiredHeading, myTank.angle);
  const turn: -1 | 0 | 1 = Math.abs(angleDelta) < 0.08 ? 0 : angleDelta > 0 ? 1 : -1;
  return { input: { throttle: bot.dodgeThrottle, turn, fire: false }, heading: desiredHeading };
}

/** How far the tank can slide along (dx,dy) before touching a wall, up to `maxDistance`. */
function freeDistance(map: GameMap, x: number, y: number, dx: number, dy: number, radius: number, maxDistance: number): number {
  const step = 6;
  for (let distance = step; distance <= maxDistance; distance += step) {
    if (circleHitsWall(map, x + dx * distance, y + dy * distance, radius)) return distance - step;
  }
  return maxDistance;
}

// ---------------------------------------------------------------------------
// Navigation

interface Goal extends Point {
  kind: "enemy" | "loot";
}

function chooseGoal(bot: BotState, myTank: Tank, target: Tank, world: Readonly<World>): Goal {
  const { lootAppetite, lootRange } = bot.profile;
  if (lootAppetite > 0 && world.loot.length > 0) {
    const lootBox = nearest(myTank, world.loot)!;
    const distance = Math.hypot(lootBox.x - myTank.x, lootBox.y - myTank.y);
    // Keep heading for a box once committed, otherwise roll for it.
    const committed = bot.goal !== undefined && bot.goal.x === lootBox.x && bot.goal.y === lootBox.y;
    if (distance <= lootRange && (committed || random(bot) < lootAppetite)) return { x: lootBox.x, y: lootBox.y, kind: "loot" };
  }
  return { x: target.x, y: target.y, kind: "enemy" };
}

function navigate(bot: BotState, myTank: Tank, goal: Goal, map: GameMap, rules: GameRules): Point | undefined {
  const distanceToGoal = Math.hypot(goal.x - myTank.x, goal.y - myTank.y);
  // Close enough: stop driving into the enemy (or we are on the loot box already).
  if (distanceToGoal < (goal.kind === "enemy" ? STANDOFF : ARRIVE)) return undefined;

  const grid = navGrid(bot, map, rules);
  const goalMoved = bot.goal === undefined || Math.hypot(goal.x - bot.goal.x, goal.y - bot.goal.y) > grid.cell * 2;
  if (!bot.field || goalMoved || bot.fieldTimer <= 0) {
    bot.goal = goal;
    bot.field = distanceField(grid, goal);
    bot.fieldTimer = 0.5;
  }

  const path = descend(grid, bot.field, myTank);
  if (path.length === 0) {
    return lineClear(map, myTank, goal, rules.tank.radius) ? goal : undefined;
  }
  // Follow the farthest waypoint we can drive straight to (string-pulling).
  for (let index = path.length - 1; index >= 0; index -= 2) {
    if (lineClear(map, myTank, path[index]!, rules.tank.radius)) return path[index];
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
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (circleHitsWall(map, (col + 0.5) * cell, (row + 0.5) * cell, clearance)) blocked[row * cols + col] = 1;
    }
  }
  bot.grid = { mapId: map.id, cell, cols, rows, blocked };
  return bot.grid;
}

function cellOf(grid: NavGrid, point: Point): number {
  const col = Math.min(grid.cols - 1, Math.max(0, Math.floor(point.x / grid.cell)));
  const row = Math.min(grid.rows - 1, Math.max(0, Math.floor(point.y / grid.cell)));
  return row * grid.cols + col;
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
  const originCol = index % grid.cols;
  const originRow = Math.floor(index / grid.cols);
  for (let ring = 1; ring < Math.max(grid.cols, grid.rows); ring++) {
    for (let row = originRow - ring; row <= originRow + ring; row++) {
      for (let col = originCol - ring; col <= originCol + ring; col++) {
        if (Math.abs(row - originRow) !== ring && Math.abs(col - originCol) !== ring) continue;
        if (row < 0 || col < 0 || row >= grid.rows || col >= grid.cols) continue;
        const candidate = row * grid.cols + col;
        if (!grid.blocked[candidate]) return candidate;
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
    const index = queue[head++]!;
    const nextDistance = field[index]! + 1;
    const col = index % grid.cols;
    const row = Math.floor(index / grid.cols);
    const visit = (neighbor: number) => {
      if (grid.blocked[neighbor] || field[neighbor] !== -1) return;
      field[neighbor] = nextDistance;
      queue[tail++] = neighbor;
    };
    if (col > 0) visit(index - 1);
    if (col < grid.cols - 1) visit(index + 1);
    if (row > 0) visit(index - grid.cols);
    if (row < grid.rows - 1) visit(index + grid.cols);
  }
  return field;
}

/** Walk downhill on the distance field from the tank's cell to the goal cell. */
function descend(grid: NavGrid, field: Int32Array, myTank: Tank): Point[] {
  let index = walkableNear(grid, cellOf(grid, myTank));
  if (field[index]! < 0) return [];
  const path: Point[] = [];
  let guard = grid.cols * grid.rows;
  while (field[index]! > 0 && guard-- > 0) {
    const col = index % grid.cols;
    const row = Math.floor(index / grid.cols);
    let next = index;
    const tryCell = (neighbor: number) => {
      if (field[neighbor]! >= 0 && field[neighbor]! < field[next]!) next = neighbor;
    };
    if (col > 0) tryCell(index - 1);
    if (col < grid.cols - 1) tryCell(index + 1);
    if (row > 0) tryCell(index - grid.cols);
    if (row < grid.rows - 1) tryCell(index + grid.cols);
    if (next === index) break;
    index = next;
    path.push(centerOf(grid, index));
  }
  return path;
}

/** True when a tank of `radius` can slide in a straight line from `from` to `to`. */
function lineClear(map: GameMap, from: Point, to: Point, radius: number): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(distance / 6));
  for (let step = 1; step <= steps; step++) {
    const fraction = step / steps;
    if (circleHitsWall(map, from.x + dx * fraction, from.y + dy * fraction, radius)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Steering

/** Turn toward `destination` and drive; reverses when that is quicker and allowed. */
function steer(myTank: Tank, destination: Point, allowReverse: boolean): Steering {
  const desiredHeading = Math.atan2(destination.y - myTank.y, destination.x - myTank.x);
  let heading = desiredHeading;
  let angleDelta = angleDiff(desiredHeading, myTank.angle);
  let throttle: -1 | 0 | 1 = 1;
  if (allowReverse && Math.abs(angleDelta) > Math.PI / 2) {
    heading = desiredHeading + Math.PI;
    angleDelta = angleDiff(heading, myTank.angle);
    throttle = -1;
  } else if (Math.abs(angleDelta) > 1) {
    throttle = 0;
  }
  const turn: -1 | 0 | 1 = Math.abs(angleDelta) < 0.08 ? 0 : angleDelta > 0 ? 1 : -1;
  return { input: { throttle, turn, fire: false }, heading };
}

/** Turn in place to point at `target`. */
function face(myTank: Tank, target: Point): Steering {
  const heading = Math.atan2(target.y - myTank.y, target.x - myTank.x);
  const angleDelta = angleDiff(heading, myTank.angle);
  const turn: -1 | 0 | 1 = Math.abs(angleDelta) < AIM_TOLERANCE ? 0 : angleDelta > 0 ? 1 : -1;
  return { input: { throttle: 0, turn, fire: false }, heading };
}

function trackStuck(bot: BotState, myTank: Tank, rules: GameRules, dt: number): void {
  const wantsToMove = bot.input.throttle !== 0 && bot.reverseTimer <= 0;
  if (wantsToMove && Number.isFinite(bot.lastX)) {
    const movedDistance = Math.hypot(myTank.x - bot.lastX, myTank.y - bot.lastY);
    const speed = rules.tank.speed * (myTank.perks[PERK_TANK_SPEED] > 0 ? rules.loot.tankSpeedMultiplier : 1);
    if (movedDistance < speed * dt * 0.2) {
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
  bot.lastX = myTank.x;
  bot.lastY = myTank.y;
}

// ---------------------------------------------------------------------------
// Helpers

function nearest<T extends Point>(from: Point, items: readonly T[]): T | undefined {
  let best: T | undefined;
  let bestDist = Infinity;
  for (const item of items) {
    const distance = Math.hypot(item.x - from.x, item.y - from.y);
    if (distance < bestDist) {
      bestDist = distance;
      best = item;
    }
  }
  return best;
}

/** Signed shortest rotation from `fromAngle` to `targetAngle`, in (-π, π]. */
export function angleDiff(targetAngle: number, fromAngle: number): number {
  let delta = (targetAngle - fromAngle) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta <= -Math.PI) delta += Math.PI * 2;
  return delta;
}

/** xorshift32 on the bot's own seed: deterministic per (seed, decision sequence). */
function random(bot: BotState): number {
  let state = bot.rng | 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  bot.rng = state;
  return (state >>> 0) / 0x100000000;
}
