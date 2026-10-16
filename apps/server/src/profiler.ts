import { Session } from "node:inspector";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { remapProfile, type CpuProfile } from "./sourcemap.ts";

/**
 * Bun's heap-snapshot API. Declared locally rather than through `@types/bun` so
 * the browser client, which imports this module's types, stays free of Bun globals.
 */
declare const Bun: { generateHeapSnapshot(format?: "v8" | "jsc"): string };

export type SnapshotKind = "cpu" | "heap";

export interface SnapshotInfo {
  name: string;
  kind: SnapshotKind;
  size: number;
  /** File mtime in milliseconds since the epoch. */
  createdAt: number;
}

/** Thrown when a start/stop call does not match the profiler's current state. */
export class ProfilerStateError extends Error {}

export interface Profiler {
  readonly cpuRunning: boolean;
  startCpuProfile(): Promise<void>;
  stopCpuProfile(): Promise<SnapshotInfo>;
  takeHeapSnapshot(): Promise<SnapshotInfo>;
  listSnapshots(): Promise<SnapshotInfo[]>;
  /** Absolute path of a stored snapshot, or `null` when the name is not a snapshot we recorded. */
  resolveSnapshot(name: string): string | null;
}

const EXTENSIONS: Record<SnapshotKind, string> = {
  cpu: ".cpuprofile",
  heap: ".heapsnapshot",
};

/** Promisified `session.post`, which only exposes callbacks. */
function post<T>(session: Session, method: string, params?: object): Promise<T> {
  return new Promise((resolve, reject) => {
    session.post(method, params ?? {}, (err: Error | null, result?: unknown) => {
      if (err) reject(err);
      else resolve(result as T);
    });
  });
}

function kindFromName(name: string): SnapshotKind | null {
  for (const [kind, extension] of Object.entries(EXTENSIONS) as [SnapshotKind, string][]) {
    if (name.endsWith(extension)) return kind;
  }
  return null;
}

function fileStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * CPU profiles come from Node's built-in inspector (which Bun implements);
 * heap snapshots come from `Bun.generateHeapSnapshot`, since Bun's inspector
 * does not implement the `HeapProfiler` domain. Snapshots are written into
 * `dir` and served back by the admin panel; nothing is kept in memory beyond
 * the profile currently being recorded.
 */
export function createProfiler(dir: string): Profiler {
  let cpuSession: Session | null = null;

  async function describe(name: string): Promise<SnapshotInfo | null> {
    const kind = kindFromName(name);
    if (kind === null) return null;
    try {
      const info = await stat(join(dir, name));
      if (!info.isFile()) return null;
      return { name, kind, size: info.size, createdAt: info.mtimeMs };
    } catch {
      return null;
    }
  }

  async function record(kind: SnapshotKind, data: string): Promise<SnapshotInfo> {
    await mkdir(dir, { recursive: true });
    const name = `${kind}-${fileStamp()}${EXTENSIONS[kind]}`;
    await writeFile(join(dir, name), data);
    const info = await describe(name);
    if (info === null) throw new Error(`failed to record ${name}`);
    return info;
  }

  return {
    get cpuRunning() {
      return cpuSession !== null;
    },

    async startCpuProfile() {
      if (cpuSession) throw new ProfilerStateError("CPU profiling is already running");
      const session = new Session();
      session.connect();
      cpuSession = session;
      try {
        await post(session, "Profiler.enable");
        await post(session, "Profiler.start");
      } catch (err) {
        cpuSession = null;
        session.disconnect();
        throw err;
      }
    },

    async stopCpuProfile() {
      const session = cpuSession;
      if (!session) throw new ProfilerStateError("CPU profiling is not running");
      cpuSession = null;
      try {
        const { profile } = await post<{ profile: CpuProfile }>(session, "Profiler.stop");
        return await record("cpu", JSON.stringify(await remapProfile(profile)));
      } finally {
        session.disconnect();
      }
    },

    async takeHeapSnapshot() {
      // "v8" emits the format Chrome DevTools loads; the default is Bun's own.
      return await record("heap", Bun.generateHeapSnapshot("v8"));
    },

    async listSnapshots() {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return [];
      }
      const infos = await Promise.all(names.map(describe));
      return infos
        .filter((info): info is SnapshotInfo => info !== null)
        .sort((a, b) => b.createdAt - a.createdAt);
    },

    resolveSnapshot(name: string) {
      if (kindFromName(name) === null) return null;
      // Only names this module generated may be downloaded: no separators, no traversal.
      if (name !== basename(name) || !/^[\w.-]+$/.test(name)) return null;
      return join(dir, name);
    },
  };
}
