import type { PlayerInput } from "./types.ts";

function toAxis(value: unknown): -1 | 0 | 1 {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

/**
 * Coerce anything received from the network into a well-formed input. Values are
 * clamped to the discrete set the simulation understands, so a modified client
 * cannot gain speed or precision by sending out-of-range numbers.
 */
export function sanitizeInput(raw: unknown): PlayerInput {
  if (typeof raw !== "object" || raw === null) {
    return { throttle: 0, turn: 0, fire: false };
  }
  const r = raw as Record<string, unknown>;
  return {
    throttle: toAxis(r.throttle),
    turn: toAxis(r.turn),
    fire: r.fire === true,
  };
}

export function inputsEqual(a: PlayerInput, b: PlayerInput): boolean {
  return a.throttle === b.throttle && a.turn === b.turn && a.fire === b.fire;
}
