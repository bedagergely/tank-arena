import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { gameStats, type GameSample, type GameStats } from "./gameStats.ts";

/** Percent of a single core, so a multi-threaded burst can exceed 100. */
export interface CpuSample {
  at: number;
  usage: number;
}

export interface MemorySample {
  at: number;
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
}

export interface Channel<T> {
  recording: boolean;
  latest: T | null;
  history: T[];
}

export interface MetricsSnapshot {
  /** Core count, so the per-core CPU figure can be read against the machine. */
  cores: number;
  cpu: Channel<CpuSample>;
  memory: Channel<MemorySample>;
  game: Channel<GameSample>;
}

export interface Recorder<T> {
  readonly recording: boolean;
  readonly latest: T | null;
  readonly history: T[];
  start(): void;
  stop(): void;
}

export interface Metrics {
  readonly cpu: Recorder<CpuSample>;
  readonly memory: Recorder<MemorySample>;
  readonly game: Recorder<GameSample>;
  snapshot(): MetricsSnapshot;
}

export interface MetricsOptions {
  /** Sampling period. Exposed so tests do not have to wait a second per tick. */
  intervalMs?: number;
  /** How many samples the gauge can look back over. */
  historyLimit?: number;
  /** Game counters to aggregate. Defaults to the process-wide instance the rooms feed. */
  stats?: GameStats;
}

const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_HISTORY_LIMIT = 60;

/**
 * A start/stop sampler. Each `start()` builds a fresh sampler so that per-run
 * baselines (the CPU counter, in particular) are never carried across runs.
 */
function createRecorder<T>(
  createSampler: () => (at: number) => T | null,
  intervalMs: number,
  historyLimit: number,
): Recorder<T> {
  let timer: NodeJS.Timeout | null = null;
  let samples: T[] = [];
  let sample: (at: number) => T | null = () => null;

  const tick = () => {
    const value = sample(Date.now());
    if (value === null) return;
    samples.push(value);
    if (samples.length > historyLimit) samples.splice(0, samples.length - historyLimit);
  };

  return {
    get recording() {
      return timer !== null;
    },
    get latest() {
      return samples[samples.length - 1] ?? null;
    },
    get history() {
      return samples;
    },
    start() {
      if (timer !== null) return;
      samples = [];
      sample = createSampler();
      tick();
      timer = setInterval(tick, intervalMs);
      // Never hold the process open on a forgotten recorder.
      timer.unref();
    },
    stop() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },
  };
}

/**
 * `process.cpuUsage()` is a cumulative counter, so usage is the CPU time burnt
 * since the previous tick over the wall time that passed. The first call only
 * establishes the baseline and yields no sample.
 */
function createCpuSampler(): (at: number) => CpuSample | null {
  let previous = process.cpuUsage();
  let previousAt = performance.now();
  let primed = false;

  return (at) => {
    const current = process.cpuUsage();
    const now = performance.now();
    if (!primed) {
      primed = true;
      previous = current;
      previousAt = now;
      return null;
    }
    const elapsed = (now - previousAt) * 1000;
    const used = current.user - previous.user + (current.system - previous.system);
    previous = current;
    previousAt = now;
    return elapsed > 0 ? { at, usage: (used / elapsed) * 100 } : null;
  };
}

function createMemorySampler(): (at: number) => MemorySample {
  return (at) => {
    const { rss, heapUsed, heapTotal, external } = process.memoryUsage();
    return { at, rss, heapUsed, heapTotal, external };
  };
}

export function createMetrics(options: MetricsOptions = {}): Metrics {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  const stats = options.stats ?? gameStats;

  const cpu = createRecorder(createCpuSampler, intervalMs, historyLimit);
  const memory = createRecorder(createMemorySampler, intervalMs, historyLimit);
  // Unlike CPU/memory, this one does not sample the process: the rooms have
  // already recorded their ticks and events, so sampling just aggregates.
  const game = createRecorder(() => (at: number) => stats.sample(at), intervalMs, historyLimit);

  const channel = <T>(recorder: Recorder<T>): Channel<T> => ({
    recording: recorder.recording,
    latest: recorder.latest,
    history: [...recorder.history],
  });

  return {
    cpu,
    memory,
    game,
    snapshot: () => ({
      cores: cpus().length,
      cpu: channel(cpu),
      memory: channel(memory),
      game: channel(game),
    }),
  };
}
