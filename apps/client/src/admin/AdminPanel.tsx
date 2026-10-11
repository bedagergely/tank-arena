import { useEffect, useState } from "react";
import type { SnapshotInfo } from "@tank-arena/server/profiler";
import { BTN, BTN_DEFAULT, BTN_PRIMARY, CARD, CARD_BODY } from "../ui/controls.ts";
import {
  getStatus,
  listSnapshots,
  snapshotUrl,
  startCpuProfile,
  startHeapSampling,
  stopCpuProfile,
  stopHeapSampling,
  takeHeapSnapshot,
  type AdminStatus,
} from "./api.ts";

const KIND_LABELS: Record<SnapshotInfo["kind"], string> = {
  cpu: "CPU profile",
  heap: "Heap snapshot",
  heapsampling: "Heap sampling profile",
};

const IDLE: AdminStatus = { cpuRunning: false, heapSamplingRunning: false };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface Loaded {
  status: AdminStatus;
  snapshots: SnapshotInfo[];
}

const load = (): Promise<Loaded> =>
  Promise.all([getStatus(), listSnapshots()]).then(([status, snapshots]) => ({ status, snapshots }));

export function AdminPanel() {
  const [status, setStatus] = useState<AdminStatus>(IDLE);
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void load().then(
      (next) => {
        if (cancelled) return;
        setStatus(next.status);
        setSnapshots(next.snapshots);
      },
      (err: unknown) => {
        if (cancelled) return;
        setFailed(true);
        setMessage(describe(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(label);
    setFailed(false);
    setMessage(`${label}…`);
    try {
      await action();
      const next = await load();
      setStatus(next.status);
      setSnapshots(next.snapshots);
      setMessage("");
    } catch (err) {
      setFailed(true);
      setMessage(describe(err));
    } finally {
      setBusy(null);
    }
  }

  const toggle = (running: boolean, start: () => Promise<unknown>, stop: () => Promise<unknown>, what: string) =>
    run(`${running ? "Stopping" : "Starting"} ${what}`, running ? stop : start);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
      <h1 className="m-0 text-2xl text-primary">Profiling</h1>

      <section className={`${CARD} gap-3 p-4`}>
        <div className="flex flex-wrap gap-2">
          <button
            className={`${BTN} ${status.cpuRunning ? BTN_PRIMARY : BTN_DEFAULT}`}
            disabled={busy !== null}
            onClick={() => toggle(status.cpuRunning, startCpuProfile, stopCpuProfile, "CPU profiling")}
          >
            {status.cpuRunning ? "Stop CPU profiling" : "Start CPU profiling"}
          </button>
          <button
            className={`${BTN} ${status.heapSamplingRunning ? BTN_PRIMARY : BTN_DEFAULT}`}
            disabled={busy !== null}
            onClick={() => toggle(status.heapSamplingRunning, startHeapSampling, stopHeapSampling, "heap sampling")}
          >
            {status.heapSamplingRunning ? "Stop heap sampling" : "Start heap sampling"}
          </button>
          <button
            className={`${BTN} ${BTN_DEFAULT}`}
            disabled={busy !== null}
            onClick={() => run("Taking heap snapshot", takeHeapSnapshot)}
          >
            Take heap snapshot
          </button>
        </div>
        <p className={`m-0 min-h-[1.5em] text-sm ${failed ? "text-error" : "text-base-content/60"}`}>{message}</p>
      </section>

      <section className={`${CARD} ${CARD_BODY}`}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-base-content/60">
              <th className="border-b border-base-300 p-2 font-semibold">Snapshot</th>
              <th className="border-b border-base-300 p-2 font-semibold">Type</th>
              <th className="border-b border-base-300 p-2 text-right font-semibold">Size</th>
              <th className="border-b border-base-300 p-2 font-semibold">Created</th>
              <th className="border-b border-base-300 p-2" />
            </tr>
          </thead>
          <tbody>
            {snapshots.map((snapshot) => (
              <tr key={snapshot.name} className="border-b border-base-300/50 last:border-0">
                <td className="break-all p-2">{snapshot.name}</td>
                <td className="p-2 whitespace-nowrap">{KIND_LABELS[snapshot.kind]}</td>
                <td className="p-2 text-right tabular-nums">{formatBytes(snapshot.size)}</td>
                <td className="p-2 whitespace-nowrap">{new Date(snapshot.createdAt).toLocaleString()}</td>
                <td className="p-2">
                  <a className="text-primary underline" href={snapshotUrl(snapshot.name)} download={snapshot.name}>
                    Download
                  </a>
                </td>
              </tr>
            ))}
            {snapshots.length === 0 && (
              <tr>
                <td className="p-2 text-base-content/50" colSpan={5}>
                  No snapshots yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <p className="m-0 text-xs text-base-content/50">
        CPU profiles are mapped back to their TypeScript sources; open them in Chrome DevTools&apos; Performance tab.
      </p>
    </div>
  );
}
