import type { MetricsSnapshot } from "@tank-arena/server/metrics";
import type { SnapshotInfo } from "@tank-arena/server/profiler";

export interface AdminStatus {
  cpuRunning: boolean;
}

/**
 * The profiling panel API. The game server mounts it under `/admin`, behind the
 * same HTTP basic auth as the page itself; in development Vite proxies that path
 * (see vite.config.ts) so the page runs on a single origin either way.
 */
const BASE = "/admin";

async function request<T>(path: string, method: "GET" | "POST" = "GET"): Promise<T> {
  const res = await fetch(BASE + path, { method });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body as T;
}

export const getStatus = () => request<AdminStatus>("/status");

export const listSnapshots = () => request<{ snapshots: SnapshotInfo[] }>("/snapshots").then((r) => r.snapshots);

export const startCpuProfile = () => request("/cpu/start", "POST");
export const stopCpuProfile = () => request<{ snapshot: SnapshotInfo }>("/cpu/stop", "POST");

export const takeHeapSnapshot = () => request<{ snapshot: SnapshotInfo }>("/heap/snapshot", "POST");

export const snapshotUrl = (name: string) => `${BASE}/snapshots/${encodeURIComponent(name)}`;

export const getMetrics = () => request<MetricsSnapshot>("/metrics");

export const startCpuRecording = () => request("/metrics/cpu/start", "POST");
export const stopCpuRecording = () => request("/metrics/cpu/stop", "POST");

export const startMemoryRecording = () => request("/metrics/memory/start", "POST");
export const stopMemoryRecording = () => request("/metrics/memory/stop", "POST");
