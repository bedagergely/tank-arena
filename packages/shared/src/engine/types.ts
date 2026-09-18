/**
 * Plain-data world model. Tanks are addressed by numeric slot (0..maxPlayers-1),
 * never by session id, so the whole struct is representable in WASM linear
 * memory without string handling.
 */

export interface PlayerInput {
  /** -1 reverse, 0 idle, 1 forward. */
  throttle: -1 | 0 | 1;
  /** -1 turn left (counter-clockwise), 0 none, 1 turn right. */
  turn: -1 | 0 | 1;
  fire: boolean;
}

export const IDLE_INPUT: Readonly<PlayerInput> = Object.freeze({ throttle: 0, turn: 0, fire: false });

export interface Tank {
  slot: number;
  x: number;
  y: number;
  /** Heading in radians, 0 along +x, increasing clockwise (screen space). */
  angle: number;
  alive: boolean;
  /** Seconds until the tank may fire again. */
  cooldown: number;
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
}

export type TickEvent =
  | { type: "fire"; slot: number; bulletId: number }
  | { type: "bounce"; bulletId: number; x: number; y: number }
  | { type: "bullet-expired"; bulletId: number }
  | { type: "hit"; bulletId: number; shooterSlot: number; targetSlot: number };
