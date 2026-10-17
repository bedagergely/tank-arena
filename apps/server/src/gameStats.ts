/**
 * Process-wide game counters, fed by the rooms as they run. Unlike the process
 * CPU/memory channels (which are polled), these are pushed from the room
 * lifecycle and the simulation tick, then aggregated into a window when the
 * admin panel samples them.
 */

export type GameEventKind = "fire" | "bounce" | "hit" | "loot";

export const GAME_EVENT_KINDS: readonly GameEventKind[] = ["fire", "bounce", "hit", "loot"];

/** One aggregated window of game activity. */
export interface GameSample {
  at: number;
  /** Live rooms at sample time. */
  rooms: number;
  /** Occupied seats (humans and bots) at sample time. */
  players: number;
  /** Tick duration over the window, milliseconds. */
  tickP50: number;
  tickP95: number;
  /** Events seen during the window, per second, by kind. */
  eventsPerSecond: Record<GameEventKind, number>;
}

export interface GameStats {
  readonly rooms: number;
  readonly players: number;
  roomOpened(): void;
  roomClosed(): void;
  seatTaken(): void;
  seatFreed(): void;
  /** Record one simulation tick's wall-clock duration, in milliseconds. */
  recordTick(ms: number): void;
  recordEvent(kind: GameEventKind): void;
  /** Aggregate the window that just ended and open a new one. */
  sample(at: number): GameSample;
}

/**
 * Upper bound on the tick durations held for one window. A recorder that is
 * never started never calls `sample`, so without a cap the buffer would grow for
 * as long as the process runs. At 30 Hz even a four-room process records ~120
 * ticks per second, well under this.
 */
export const MAX_TICKS_PER_WINDOW = 1024;

function emptyEvents(): Record<GameEventKind, number> {
  return { fire: 0, bounce: 0, hit: 0, loot: 0 };
}

/** Nearest-rank percentile of an ascending array; 0 for an empty one. */
function percentile(ascending: readonly number[], fraction: number): number {
  if (ascending.length === 0) return 0;
  const rank = Math.min(ascending.length, Math.max(1, Math.ceil(fraction * ascending.length)));
  return ascending[rank - 1]!;
}

export function createGameStats(): GameStats {
  let rooms = 0;
  let players = 0;
  let windowStart: number | null = null;
  let ticks: number[] = [];
  let events = emptyEvents();

  return {
    get rooms() {
      return rooms;
    },
    get players() {
      return players;
    },
    roomOpened() {
      rooms += 1;
    },
    roomClosed() {
      rooms = Math.max(0, rooms - 1);
    },
    seatTaken() {
      players += 1;
    },
    seatFreed() {
      players = Math.max(0, players - 1);
    },
    recordTick(ms) {
      ticks.push(ms);
      if (ticks.length > MAX_TICKS_PER_WINDOW) ticks.splice(0, ticks.length - MAX_TICKS_PER_WINDOW);
    },
    recordEvent(kind) {
      events[kind] += 1;
    },
    sample(at) {
      const elapsed = windowStart === null ? 0 : at - windowStart;
      const perSecond = elapsed > 0 ? 1000 / elapsed : 0;
      const sorted = ticks.sort((a, b) => a - b);
      const eventsPerSecond = emptyEvents();
      for (const kind of GAME_EVENT_KINDS) eventsPerSecond[kind] = events[kind] * perSecond;

      const sample: GameSample = {
        at,
        rooms,
        players,
        tickP50: percentile(sorted, 0.5),
        tickP95: percentile(sorted, 0.95),
        eventsPerSecond,
      };

      windowStart = at;
      ticks = [];
      events = emptyEvents();
      return sample;
    },
  };
}

/** The instance the rooms feed; the admin panel's game channel samples it. */
export const gameStats = createGameStats();
