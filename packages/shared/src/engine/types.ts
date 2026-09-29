/**
 * Plain-data world model. Tanks are addressed by numeric slot (0..maxPlayers-1),
 * never by session id, so the whole struct is representable in WASM linear
 * memory without string handling.
 */

import type { PerkId } from "../rules.ts";

export interface PlayerInput {
  /** -1 reverse, 0 idle, 1 forward. */
  throttle: -1 | 0 | 1;
  /** -1 turn left (counter-clockwise), 0 none, 1 turn right. */
  turn: -1 | 0 | 1;
  fire: boolean;
}

export const IDLE_INPUT: Readonly<PlayerInput> = Object.freeze({ throttle: 0, turn: 0, fire: false });

/** Seconds left on each perk, indexed by `PerkId`; 0 means inactive. */
export type PerkTimers = [bullets: number, bulletSpeed: number, tankSpeed: number, shield: number];

export interface Tank {
  slot: number;
  x: number;
  y: number;
  /** Heading in radians, 0 along +x, increasing clockwise (screen space). */
  angle: number;
  alive: boolean;
  /** Seconds until the tank may fire again. */
  cooldown: number;
  perks: PerkTimers;
}

export interface LootBox {
  id: number;
  x: number;
  y: number;
  perk: PerkId;
}

export interface Bullet {
  id: number;
  ownerSlot: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  bounces: number;
}

export interface World {
  /** Simulated time, seconds. */
  time: number;
  tick: number;
  tanks: Tank[];
  bullets: Bullet[];
  nextBulletId: number;
  loot: LootBox[];
  nextLootId: number;
  /** Seconds until the next loot box may spawn. */
  lootTimer: number;
  /** xorshift32 state; the only source of randomness, seeded by the server. */
  rng: number;
}

export type TickEvent =
  | { type: "fire"; slot: number; bulletId: number }
  | { type: "bounce"; bulletId: number; x: number; y: number }
  | { type: "bullet-expired"; bulletId: number }
  | { type: "hit"; bulletId: number; shooterSlot: number; targetSlot: number }
  | { type: "shield-block"; bulletId: number; shooterSlot: number; targetSlot: number }
  | { type: "loot-spawn"; lootId: number; perk: PerkId; x: number; y: number }
  | { type: "loot-pickup"; lootId: number; slot: number; perk: PerkId };
