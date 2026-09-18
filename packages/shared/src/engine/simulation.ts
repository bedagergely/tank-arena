import type { GameMap } from "../maps/types.ts";
import type { GameRules } from "../rules.ts";
import { circlesOverlap, moveCircle } from "./physics.ts";
import { IDLE_INPUT, type Bullet, type PlayerInput, type Tank, type TickEvent, type World } from "./types.ts";

/**
 * Build a fresh world with one tank per slot, placed on the map's spawn points.
 * Slot i uses spawn i; the default map lists spawns so that slots 0 and 1 are in
 * opposite corners.
 */
export function createWorld(map: GameMap, slots: readonly number[]): World {
  if (slots.length > map.spawns.length) {
    throw new Error(`Map "${map.id}" has ${map.spawns.length} spawns, need ${slots.length}`);
  }
  const tanks: Tank[] = slots.map((slot, i) => {
    const spawn = map.spawns[i]!;
    return { slot, x: spawn.x, y: spawn.y, angle: spawn.angle, alive: true, cooldown: 0 };
  });
  return { time: 0, tick: 0, tanks, bullets: [], nextBulletId: 1 };
}

/**
 * Advance the world by one fixed step. Pure function of its arguments: no
 * clocks, no randomness, no I/O. `inputs` is indexed by tank slot.
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

    tank.angle = normalizeAngle(tank.angle + input.turn * turnSpeed * dt);

    if (input.throttle !== 0) {
      const dist = input.throttle * speed * dt;
      const moved = moveCircle(map, tank.x, tank.y, radius, Math.cos(tank.angle) * dist, Math.sin(tank.angle) * dist);
      tank.x = moved.x;
      tank.y = moved.y;
    }

    if (input.fire && tank.cooldown === 0 && countBullets(world, tank.slot) < rules.bullet.maxPerTank) {
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
  const bullet: Bullet = {
    id: world.nextBulletId++,
    ownerSlot: tank.slot,
    x: tank.x + dirX * muzzle,
    y: tank.y + dirY * muzzle,
    vx: dirX * rules.bullet.speed,
    vy: dirY * rules.bullet.speed,
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
      target.alive = false;
      events.push({ type: "hit", bulletId: bullet.id, shooterSlot: bullet.ownerSlot, targetSlot: target.slot });
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

function countBullets(world: World, slot: number): number {
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
