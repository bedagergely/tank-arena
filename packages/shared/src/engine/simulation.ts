import type { GameMap } from "../maps/types.ts";
import { PERK_BULLET_SPEED, PERK_BULLETS, PERK_SHIELD, PERK_TANK_SPEED, type GameRules } from "../rules.ts";
import { circleHitsWall, circlesOverlap, moveCircle } from "./physics.ts";
import {
  IDLE_INPUT,
  type Bullet,
  type LootBox,
  type PerkTimers,
  type PlayerInput,
  type Tank,
  type TickEvent,
  type World,
} from "./types.ts";

/**
 * Build a fresh world with one tank per slot, placed on the map's spawn points.
 * Slot i uses spawn i; the default map lists spawns so that slots 0 and 1 are in
 * opposite corners. `seed` drives loot spawning; the same seed and inputs
 * always replay to the same world.
 */
export function createWorld(map: GameMap, slots: readonly number[], rules?: GameRules, seed = 1): World {
  if (slots.length > map.spawns.length) {
    throw new Error(`Map "${map.id}" has ${map.spawns.length} spawns, need ${slots.length}`);
  }
  const tanks: Tank[] = slots.map((slot, i) => {
    const spawn = map.spawns[i]!;
    return { slot, x: spawn.x, y: spawn.y, angle: spawn.angle, alive: true, cooldown: 0, perks: [0, 0, 0, 0] };
  });
  return {
    time: 0,
    tick: 0,
    tanks,
    bullets: [],
    nextBulletId: 1,
    loot: [],
    nextLootId: 1,
    lootTimer: rules?.loot.firstSpawnSeconds ?? 0,
    rng: (seed | 0) || 0x9e3779b9,
  };
}

/**
 * Advance the world by one fixed step. Pure function of its arguments: no
 * clocks, no I/O; the only randomness is the world's own seeded generator.
 * `inputs` is indexed by tank slot.
 *
 * This is the hot path intended to be swappable for a Rust/WASM build.
 */
export function stepWorld(
  world: World,
  inputs: ReadonlyArray<PlayerInput | undefined>,
  map: GameMap,
  rules: GameRules,
  dt: number,
): TickEvent[] {
  const events: TickEvent[] = [];

  stepTanks(world, inputs, map, rules, dt, events);
  stepBullets(world, map, rules, dt, events);
  stepLoot(world, map, rules, dt, events);

  world.time += dt;
  world.tick += 1;
  return events;
}

function stepTanks(
  world: World,
  inputs: ReadonlyArray<PlayerInput | undefined>,
  map: GameMap,
  rules: GameRules,
  dt: number,
  events: TickEvent[],
): void {
  const { radius, speed, turnSpeed } = rules.tank;

  for (const tank of world.tanks) {
    if (!tank.alive) continue;
    const input = inputs[tank.slot] ?? IDLE_INPUT;

    if (tank.cooldown > 0) tank.cooldown = Math.max(0, tank.cooldown - dt);
    tickPerks(tank.perks, dt);

    tank.angle = normalizeAngle(tank.angle + input.turn * turnSpeed * dt);

    if (input.throttle !== 0) {
      const boost = tank.perks[PERK_TANK_SPEED] > 0 ? rules.loot.tankSpeedMultiplier : 1;
      const dist = input.throttle * speed * boost * dt;
      const moved = moveCircle(map, tank.x, tank.y, radius, Math.cos(tank.angle) * dist, Math.sin(tank.angle) * dist);
      tank.x = moved.x;
      tank.y = moved.y;
    }

    if (input.fire && tank.cooldown === 0 && countBullets(world, tank.slot) < maxBullets(tank, rules)) {
      const bullet = spawnBullet(world, tank, rules);
      tank.cooldown = rules.bullet.cooldownSeconds;
      events.push({ type: "fire", slot: tank.slot, bulletId: bullet.id });
    }
  }
}

function spawnBullet(world: World, tank: Tank, rules: GameRules): Bullet {
  const dirX = Math.cos(tank.angle);
  const dirY = Math.sin(tank.angle);
  const muzzle = rules.tank.radius + rules.bullet.radius + 1;
  const speed = rules.bullet.speed * (tank.perks[PERK_BULLET_SPEED] > 0 ? rules.loot.bulletSpeedMultiplier : 1);
  const bullet: Bullet = {
    id: world.nextBulletId++,
    ownerSlot: tank.slot,
    x: tank.x + dirX * muzzle,
    y: tank.y + dirY * muzzle,
    vx: dirX * speed,
    vy: dirY * speed,
    bounces: 0,
  };
  world.bullets.push(bullet);
  return bullet;
}

function stepBullets(world: World, map: GameMap, rules: GameRules, dt: number, events: TickEvent[]): void {
  const { radius, maxBounces, canHitOwner } = rules.bullet;
  const tankRadius = rules.tank.radius;
  const survivors: Bullet[] = [];

  for (const bullet of world.bullets) {
    const moved = moveCircle(map, bullet.x, bullet.y, radius, bullet.vx * dt, bullet.vy * dt);
    bullet.x = moved.x;
    bullet.y = moved.y;

    if (moved.hitX) bullet.vx = -bullet.vx;
    if (moved.hitY) bullet.vy = -bullet.vy;
    if (moved.hitX || moved.hitY) {
      bullet.bounces += 1;
      events.push({ type: "bounce", bulletId: bullet.id, x: bullet.x, y: bullet.y });
      if (bullet.bounces >= maxBounces) {
        events.push({ type: "bullet-expired", bulletId: bullet.id });
        continue;
      }
    }

    const target = findHitTank(world, bullet, radius, tankRadius, canHitOwner);
    if (target) {
      if (target.perks[PERK_SHIELD] > 0) {
        target.perks[PERK_SHIELD] = 0;
        events.push({ type: "shield-block", bulletId: bullet.id, shooterSlot: bullet.ownerSlot, targetSlot: target.slot });
      } else {
        target.alive = false;
        events.push({ type: "hit", bulletId: bullet.id, shooterSlot: bullet.ownerSlot, targetSlot: target.slot });
      }
      continue;
    }

    survivors.push(bullet);
  }

  world.bullets = survivors;
}

function findHitTank(world: World, bullet: Bullet, bulletRadius: number, tankRadius: number, canHitOwner: boolean): Tank | undefined {
  for (const tank of world.tanks) {
    if (!tank.alive) continue;
    if (!canHitOwner && tank.slot === bullet.ownerSlot) continue;
    // A freshly fired bullet starts just outside its owner; only count owner hits after a bounce.
    if (tank.slot === bullet.ownerSlot && bullet.bounces === 0) continue;
    if (circlesOverlap(bullet.x, bullet.y, bulletRadius, tank.x, tank.y, tankRadius)) return tank;
  }
  return undefined;
}

export function maxBullets(tank: Tank, rules: GameRules): number {
  return rules.bullet.maxPerTank + (tank.perks[PERK_BULLETS] > 0 ? rules.loot.extraBullets : 0);
}

function tickPerks(perks: PerkTimers, dt: number): void {
  for (let i = 0; i < perks.length; i++) {
    if (perks[i]! > 0) perks[i] = Math.max(0, perks[i]! - dt);
  }
}

function stepLoot(world: World, map: GameMap, rules: GameRules, dt: number, events: TickEvent[]): void {
  const loot = rules.loot;
  if (!loot.enabled || loot.perks.length === 0) return;

  // Pickups: a live tank driving over a box takes it; the perk timer is refreshed, not stacked.
  if (world.loot.length > 0) {
    const remaining: LootBox[] = [];
    for (const box of world.loot) {
      const taker = world.tanks.find(
        (t) => t.alive && circlesOverlap(t.x, t.y, rules.tank.radius, box.x, box.y, loot.radius),
      );
      if (taker) {
        taker.perks[box.perk] = loot.durationSeconds;
        events.push({ type: "loot-pickup", lootId: box.id, slot: taker.slot, perk: box.perk });
      } else {
        remaining.push(box);
      }
    }
    world.loot = remaining;
  }

  world.lootTimer -= dt;
  if (world.lootTimer > 0 || world.loot.length >= loot.maxOnMap) return;

  const spot = findLootSpot(world, map, rules);
  // Random gap of 0.5x..1.5x the configured interval.
  world.lootTimer = loot.spawnIntervalSeconds * (0.5 + nextRandom(world));
  if (!spot) return;

  const perk = loot.perks[Math.floor(nextRandom(world) * loot.perks.length)]!;
  const box: LootBox = { id: world.nextLootId++, x: spot.x, y: spot.y, perk };
  world.loot.push(box);
  events.push({ type: "loot-spawn", lootId: box.id, perk, x: box.x, y: box.y });
}

/** A random free spot: clear of walls (with room for a tank to reach it) and away from tanks and other boxes. */
function findLootSpot(world: World, map: GameMap, rules: GameRules): { x: number; y: number } | undefined {
  const clearance = rules.tank.radius + rules.loot.radius;
  const keepAway = rules.tank.radius * 4;
  for (let attempt = 0; attempt < 24; attempt++) {
    const x = clearance + nextRandom(world) * (map.width - clearance * 2);
    const y = clearance + nextRandom(world) * (map.height - clearance * 2);
    if (circleHitsWall(map, x, y, clearance)) continue;
    if (world.tanks.some((t) => t.alive && circlesOverlap(t.x, t.y, keepAway, x, y, 0))) continue;
    if (world.loot.some((b) => circlesOverlap(b.x, b.y, keepAway, x, y, 0))) continue;
    return { x, y };
  }
  return undefined;
}

/** xorshift32: tiny, deterministic, trivially portable to Rust. Returns [0, 1). */
function nextRandom(world: World): number {
  let s = world.rng | 0;
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  world.rng = s;
  return (s >>> 0) / 4294967296;
}

export function countBullets(world: Readonly<World>, slot: number): number {
  let n = 0;
  for (const b of world.bullets) if (b.ownerSlot === slot) n++;
  return n;
}

function normalizeAngle(a: number): number {
  const TWO_PI = Math.PI * 2;
  a %= TWO_PI;
  if (a < 0) a += TWO_PI;
  return a;
}

export function aliveTanks(world: World): Tank[] {
  return world.tanks.filter((t) => t.alive);
}
