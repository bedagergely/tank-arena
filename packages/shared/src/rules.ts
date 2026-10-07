/**
 * Tunable game rules. Everything the simulation and the room need to know about
 * "how the game is played" lives here, so a match can be configured (player
 * count, bullet behaviour, win condition) without touching engine code.
 *
 * Plain numbers/strings only: this struct must be trivially passable to a
 * Rust/WebAssembly engine implementation.
 */
export interface GameRules {
  /** Players required before the host can start a match. */
  minPlayers: number;
  /** Maximum players in a match (also the room capacity). */
  maxPlayers: number;
  /** Fixed simulation rate, in Hz. */
  tickRate: number;
  /** Seconds between "start" and tanks becoming controllable. */
  countdownSeconds: number;
  /** Seconds the result screen is shown before returning to the lobby. */
  resultSeconds: number;

  tank: {
    /** Collision radius, in world units (pixels). */
    radius: number;
    /** Forward/backward speed, units per second. */
    speed: number;
    /** Turn rate, radians per second. */
    turnSpeed: number;
  };

  bullet: {
    radius: number;
    speed: number;
    /** Bullets alive at once per tank. */
    maxPerTank: number;
    /** Wall bounces before the bullet is destroyed. */
    maxBounces: number;
    /** Minimum seconds between two shots from the same tank. */
    cooldownSeconds: number;
    /** Whether a bullet may hit the tank that fired it (after bouncing). */
    canHitOwner: boolean;
  };

  match: {
    /** Default number of rounds in a match; the host can change it in the lobby. */
    rounds: number;
    minRounds: number;
    maxRounds: number;
    /** How long the final result is shown before returning to the lobby. */
    resultSeconds: number;
  };

  loot: {
    enabled: boolean;
    /** Pickup radius, in world units. */
    radius: number;
    /** Seconds after the round starts before the first box appears. */
    firstSpawnSeconds: number;
    /** Average seconds between spawns (actual gap varies +-50%). */
    spawnIntervalSeconds: number;
    maxOnMap: number;
    /** How long a picked-up perk lasts, seconds. */
    durationSeconds: number;
    /** Perk pool a new box draws from (repeat an entry to weight it). */
    perks: PerkId[];
    /** Additional bullets alive at once while the "bullets" perk is active. */
    extraBullets: number;
    bulletSpeedMultiplier: number;
    tankSpeedMultiplier: number;
  };

  /**
   * - "first-hit": the round ends as soon as any tank is hit.
   * - "last-standing": the round ends when at most one tank is alive.
   */
  winCondition: "first-hit" | "last-standing";
}

/** Perks are numeric ids so the world stays plain-number data for a WASM engine. */
export const PERK_BULLETS = 0;
export const PERK_BULLET_SPEED = 1;
export const PERK_TANK_SPEED = 2;
export const PERK_SHIELD = 3;
export type PerkId = typeof PERK_BULLETS | typeof PERK_BULLET_SPEED | typeof PERK_TANK_SPEED | typeof PERK_SHIELD;
export const PERK_IDS: readonly PerkId[] = [PERK_BULLETS, PERK_BULLET_SPEED, PERK_TANK_SPEED, PERK_SHIELD];
export const PERK_NAMES: Readonly<Record<PerkId, string>> = {
  [PERK_BULLETS]: "Extra bullets",
  [PERK_BULLET_SPEED]: "Fast bullets",
  [PERK_TANK_SPEED]: "Speed",
  [PERK_SHIELD]: "Shield",
};

export function isPerkId(value: unknown): value is PerkId {
  return PERK_IDS.some((id) => id === value);
}

export const DEFAULT_RULES: GameRules = {
  minPlayers: 2,
  maxPlayers: 4,
  tickRate: 30,
  countdownSeconds: 3,
  resultSeconds: 4,
  tank: {
    radius: 14,
    speed: 140,
    turnSpeed: 3.2,
  },
  bullet: {
    radius: 4,
    speed: 320,
    maxPerTank: 1,
    maxBounces: 5,
    cooldownSeconds: 0.25,
    canHitOwner: true,
  },
  match: {
    rounds: 5,
    minRounds: 1,
    maxRounds: 15,
    resultSeconds: 6,
  },
  loot: {
    enabled: true,
    radius: 12,
    firstSpawnSeconds: 4,
    spawnIntervalSeconds: 8,
    maxOnMap: 3,
    durationSeconds: 30,
    perks: [PERK_BULLETS, PERK_BULLET_SPEED, PERK_TANK_SPEED, PERK_SHIELD],
    extraBullets: 2,
    bulletSpeedMultiplier: 1.6,
    tankSpeedMultiplier: 1.5,
  },
  winCondition: "last-standing",
};

/** Round wins needed to take a best-of-`rounds` match. */
export function winsNeeded(rounds: number): number {
  return Math.floor(rounds / 2) + 1;
}

/** Clamp a requested round count to the configured range; `undefined` when it is not a usable number. */
export function clampRounds(value: unknown, rules: GameRules): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  return Math.min(rules.match.maxRounds, Math.max(rules.match.minRounds, rounded));
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type RulesOverrides = DeepPartial<GameRules>;

export function resolveRules(overrides: RulesOverrides = {}): GameRules {
  return {
    ...DEFAULT_RULES,
    ...overrides,
    tank: { ...DEFAULT_RULES.tank, ...overrides.tank },
    bullet: { ...DEFAULT_RULES.bullet, ...overrides.bullet },
    match: { ...DEFAULT_RULES.match, ...overrides.match },
    loot: { ...DEFAULT_RULES.loot, ...overrides.loot },
  };
}
