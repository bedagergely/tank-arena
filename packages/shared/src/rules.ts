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

  /**
   * - "first-hit": the match ends as soon as any tank is hit.
   * - "last-standing": the match ends when at most one tank is alive.
   */
  winCondition: "first-hit" | "last-standing";
}

export const DEFAULT_RULES: GameRules = {
  minPlayers: 2,
  maxPlayers: 2,
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
  winCondition: "first-hit",
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export type RulesOverrides = DeepPartial<GameRules>;

export function resolveRules(overrides: RulesOverrides = {}): GameRules {
  return {
    ...DEFAULT_RULES,
    ...overrides,
    tank: { ...DEFAULT_RULES.tank, ...overrides.tank },
    bullet: { ...DEFAULT_RULES.bullet, ...overrides.bullet },
  };
}
