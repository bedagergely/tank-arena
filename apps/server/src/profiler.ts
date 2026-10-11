import { Session } from "node:inspector";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { remapProfile, type CpuProfile } from "./sourcemap.ts";

export type SnapshotKind = "cpu" | "heap" | "heapsampling";

export interface SnapshotInfo {
  name: string;
  kind: SnapshotKind;
  size: number;
  /** File mtime in milliseconds since the epoch. */
  createdAt: number;
}

/**
 * How many times a function was entered, from V8's precise coverage. A
 * `.cpuprofile` only records time, so without this there is no way to average
 * it per call. Stored inside the profile under `callCounts`.
 */
export interface CallCount {
  scriptId: string;
  functionName: string;
  count: number;
}

interface CoverageFunction {
  functionName: string;
  ranges: Array<{ count: number }>;
}

interface CoverageScript {
  scriptId: string;
  functions: CoverageFunction[];
}

/** Thrown when a start/stop call does not match the profiler's current state. */
export class ProfilerStateError extends Error {}

export interface Profiler {
  readonly cpuRunning: boolean;
  readonly heapSamplingRunning: boolean;
  startCpuProfile(): Promise<void>;
  stopCpuProfile(): Promise<SnapshotInfo>;
  takeHeapSnapshot(): Promise<SnapshotInfo>;
  startHeapSampling(): Promise<void>;
  stopHeapSampling(): Promise<SnapshotInfo>;
  listSnapshots(): Promise<SnapshotInfo[]>;
  /** Absolute path of a stored snapshot, or `null` when the name is not a snapshot we recorded. */
  resolveSnapshot(name: string): string | null;
}

const EXTENSIONS: Record<SnapshotKind, string> = {
  cpu: ".cpuprofile",
  heap: ".heapsnapshot",
  heapsampling: ".heapprofile",
};

const SAMPLING_INTERVAL_BYTES = 32768;

/** Promisified `session.post`, which only exposes callbacks. */
function post<T>(session: Session, method: string, params?: object): Promise<T> {
  return new Promise((resolve, reject) => {
    session.post(method, params ?? {}, (err: Error | null, result?: unknown) => {
      if (err) reject(err);
      else resolve(result as T);
    });
  });
}

/** Best-effort: profiling still works if coverage is unavailable. */
async function startCallCounts(session: Session): Promise<void> {
  try {
    await post(session, "Profiler.startPreciseCoverage", { callCount: true, detailed: false });
  } catch {
    // Not every inspector build exposes coverage; the profile is still useful.
  }
}

async function takeCallCounts(session: Session): Promise<CallCount[]> {
  try {
    const { result } = await post<{ result: CoverageScript[] }>(session, "Profiler.takePreciseCoverage");
    await post(session, "Profiler.stopPreciseCoverage");
    return result.flatMap((script) =>
      script.functions.map((fn) => ({
        scriptId: script.scriptId,
        functionName: fn.functionName,
        count: fn.ranges[0]?.count ?? 0,
      })),
    );
  } catch {
    return [];
  }
}

function withCallCounts(profile: CpuProfile, callCounts: CallCount[]): CpuProfile {
  return callCounts.length > 0 ? { ...profile, callCounts } : profile;
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
 * Profilers backed by Node's built-in inspector. Snapshots are written into
 * `dir` and served back by the admin panel; nothing is kept in memory beyond
 * the profile currently being recorded.
 */
export function createInspectorProfiler(dir: string): Profiler {
  let cpuSession: Session | null = null;
  let samplingSession: Session | null = null;

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

    get heapSamplingRunning() {
      return samplingSession !== null;
    },

    async startCpuProfile() {
      if (cpuSession) throw new ProfilerStateError("CPU profiling is already running");
      const session = new Session();
      session.connect();
      cpuSession = session;
      try {
        await post(session, "Profiler.enable");
        await startCallCounts(session);
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
        // Coverage counts survive the source-map remap, which only rewrites urls.
        const callCounts = await takeCallCounts(session);
        return await record("cpu", JSON.stringify(withCallCounts(await remapProfile(profile), callCounts)));
      } finally {
        session.disconnect();
      }
    },

    async takeHeapSnapshot() {
      const session = new Session();
      session.connect();
      const chunks: string[] = [];
      session.on("HeapProfiler.addHeapSnapshotChunk", (message: { params: { chunk: string } }) => {
        chunks.push(message.params.chunk);
      });
      try {
        await post(session, "HeapProfiler.enable");
        await post(session, "HeapProfiler.takeHeapSnapshot", { reportProgress: false });
        return await record("heap", chunks.join(""));
      } finally {
        session.disconnect();
      }
    },

    async startHeapSampling() {
      if (samplingSession) throw new ProfilerStateError("Heap sampling is already running");
      const session = new Session();
      session.connect();
      samplingSession = session;
      try {
        await post(session, "HeapProfiler.enable");
        await post(session, "HeapProfiler.startSampling", { samplingInterval: SAMPLING_INTERVAL_BYTES });
      } catch (err) {
        samplingSession = null;
        session.disconnect();
        throw err;
      }
    },

    async stopHeapSampling() {
      const session = samplingSession;
      if (!session) throw new ProfilerStateError("Heap sampling is not running");
      samplingSession = null;
      try {
        const { profile } = await post<{ profile: unknown }>(session, "HeapProfiler.stopSampling");
        return await record("heapsampling", JSON.stringify(profile));
      } finally {
        session.disconnect();
      }
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
