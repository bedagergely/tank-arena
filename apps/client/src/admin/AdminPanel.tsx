import { Fragment, useEffect, useState } from "react";
import type { MetricsSnapshot } from "@tank-arena/server/metrics";
import type { SnapshotInfo } from "@tank-arena/server/profiler";
import { BTN, BTN_DEFAULT, BTN_PRIMARY, BTN_SM, CARD, CARD_BODY } from "../ui/controls.ts";
import { CpuGauge, GameGauge, MemoryGauge } from "./Gauges.tsx";
import { SummaryView, type InspectState } from "./SummaryView.tsx";
import { formatBytes } from "./format.ts";
import { summarize } from "./summarize.ts";
import {
  getMetrics,
  getStatus,
  listSnapshots,
  snapshotUrl,
  startCpuProfile,
  startCpuRecording,
  startGameRecording,
  startMemoryRecording,
  stopCpuProfile,
  stopCpuRecording,
  stopGameRecording,
  stopMemoryRecording,
  takeHeapSnapshot,
  type AdminStatus,
} from "./api.ts";

const KIND_LABELS: Record<SnapshotInfo["kind"], string> = {
  cpu: "CPU profile",
  heap: "Heap snapshot",
};

const IDLE: AdminStatus = { cpuRunning: false };
const POLL_MS = 1000;

/**
 * Parsing happens in this tab, which is fine for the usual profile sizes but
 * would wedge the browser on a multi-hundred-megabyte heap snapshot. Past this
 * point we send the operator to DevTools instead, which streams them.
 */
const INSPECT_LIMIT_BYTES = 100 * 1024 * 1024;

interface Inspect extends InspectState {
  name: string;
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
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [inspect, setInspect] = useState<Inspect | null>(null);

  const cpuRecording = metrics?.cpu.recording === true;
  const memoryRecording = metrics?.memory.recording === true;
  const gameRecording = metrics?.game.recording === true;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([load(), getMetrics()]).then(
      ([next, samples]) => {
        if (cancelled) return;
        setStatus(next.status);
        setSnapshots(next.snapshots);
        setMetrics(samples);
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

  // Only poll while something is being recorded; the server samples on its own
  // clock, so this just picks up the latest reading.
  useEffect(() => {
    if (!cpuRecording && !memoryRecording && !gameRecording) return;
    const id = setInterval(() => {
      void getMetrics().then(setMetrics, () => {});
    }, POLL_MS);
    return () => clearInterval(id);
  }, [cpuRecording, memoryRecording, gameRecording]);

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(label);
    setFailed(false);
    setMessage(`${label}…`);
    try {
      await action();
      const [next, samples] = await Promise.all([load(), getMetrics()]);
      setStatus(next.status);
      setSnapshots(next.snapshots);
      setMetrics(samples);
      setMessage("");
    } catch (err) {
      setFailed(true);
      setMessage(describe(err));
    } finally {
      setBusy(null);
    }
  }

  const record = (what: "CPU" | "memory" | "game", running: boolean) =>
    run(`${running ? "Stopping" : "Starting"} ${what} recording`, () => {
      if (what === "CPU") return running ? stopCpuRecording() : startCpuRecording();
      if (what === "game") return running ? stopGameRecording() : startGameRecording();
      return running ? stopMemoryRecording() : startMemoryRecording();
    });

  const toggle = (running: boolean, start: () => Promise<unknown>, stop: () => Promise<unknown>, what: string) =>
    run(`${running ? "Stopping" : "Starting"} ${what}`, running ? stop : start);

  async function toggleInspect(entry: SnapshotInfo) {
    if (inspect?.name === entry.name) {
      setInspect(null);
      return;
    }
    if (entry.size > INSPECT_LIMIT_BYTES) {
      setInspect({
        name: entry.name,
        loading: false,
        summary: null,
        error: `Too large to parse in the browser (${formatBytes(entry.size)}). Download it and open it in Chrome DevTools instead.`,
      });
      return;
    }

    setInspect({ name: entry.name, loading: true, summary: null, error: null });
    try {
      const res = await fetch(snapshotUrl(entry.name));
      if (!res.ok) throw new Error(`Could not read the profile (${res.status})`);
      setInspect({ name: entry.name, loading: false, summary: summarize(entry.kind, await res.json()), error: null });
    } catch (err) {
      setInspect({ name: entry.name, loading: false, summary: null, error: describe(err) });
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
      <h1 className="m-0 text-2xl text-primary">Profiling</h1>
      <p className={`m-0 min-h-[1.5em] text-sm ${failed ? "text-error" : "text-base-content/60"}`}>{message}</p>

      <section className={`${CARD} gap-4 p-4`}>
        <h2 className="m-0 text-lg text-primary">Live metrics</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-lg border border-base-300 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">CPU</span>
              <button
                className={`${BTN} ${BTN_SM} ${cpuRecording ? BTN_PRIMARY : BTN_DEFAULT}`}
                disabled={busy !== null}
                onClick={() => record("CPU", cpuRecording)}
              >
                {cpuRecording ? "Stop recording" : "Start recording"}
              </button>
            </div>
            <CpuGauge
              sample={metrics?.cpu.latest ?? null}
              history={metrics?.cpu.history ?? []}
              cores={metrics?.cores ?? 0}
            />
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-base-300 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">Memory</span>
              <button
                className={`${BTN} ${BTN_SM} ${memoryRecording ? BTN_PRIMARY : BTN_DEFAULT}`}
                disabled={busy !== null}
                onClick={() => record("memory", memoryRecording)}
              >
                {memoryRecording ? "Stop recording" : "Start recording"}
              </button>
            </div>
            <MemoryGauge sample={metrics?.memory.latest ?? null} history={metrics?.memory.history ?? []} />
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-base-300 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">Game</span>
              <button
                className={`${BTN} ${BTN_SM} ${gameRecording ? BTN_PRIMARY : BTN_DEFAULT}`}
                disabled={busy !== null}
                onClick={() => record("game", gameRecording)}
              >
                {gameRecording ? "Stop recording" : "Start recording"}
              </button>
            </div>
            <GameGauge sample={metrics?.game.latest ?? null} history={metrics?.game.history ?? []} />
          </div>
        </div>
      </section>

      <section className={`${CARD} gap-3 p-4`}>
        <h2 className="m-0 text-lg text-primary">Snapshots</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className={`${BTN} ${status.cpuRunning ? BTN_PRIMARY : BTN_DEFAULT}`}
            disabled={busy !== null}
            onClick={() => toggle(status.cpuRunning, startCpuProfile, stopCpuProfile, "CPU profiling")}
          >
            {status.cpuRunning ? "Stop CPU profiling" : "Start CPU profiling"}
          </button>
          <button
            className={`${BTN} ${BTN_DEFAULT}`}
            disabled={busy !== null}
            onClick={() => run("Taking heap snapshot", takeHeapSnapshot)}
          >
            Take heap snapshot
          </button>
        </div>

        <div className={CARD_BODY}>
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
              {snapshots.map((entry) => (
                <Fragment key={entry.name}>
                  <tr className="border-b border-base-300/50 last:border-0">
                    <td className="break-all p-2">{entry.name}</td>
                    <td className="p-2 whitespace-nowrap">{KIND_LABELS[entry.kind]}</td>
                    <td className="p-2 text-right tabular-nums">{formatBytes(entry.size)}</td>
                    <td className="p-2 whitespace-nowrap">{new Date(entry.createdAt).toLocaleString()}</td>
                    <td className="p-2 whitespace-nowrap">
                      <button
                        className="cursor-pointer text-primary underline disabled:cursor-progress disabled:opacity-60"
                        disabled={inspect?.name === entry.name && inspect.loading}
                        onClick={() => void toggleInspect(entry)}
                      >
                        {inspect?.name === entry.name ? "Hide" : "Inspect"}
                      </button>
                      <span className="mx-2 text-base-content/30">·</span>
                      <a className="text-primary underline" href={snapshotUrl(entry.name)} download={entry.name}>
                        Download
                      </a>
                    </td>
                  </tr>
                  {inspect?.name === entry.name && (
                    <tr className="border-b border-base-300/50">
                      <td className="bg-base-100/50 p-3" colSpan={5}>
                        <SummaryView state={inspect} />
                      </td>
                    </tr>
                  )}
                </Fragment>
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
        </div>
      </section>

      <p className="m-0 text-xs text-base-content/50">
        CPU profiles are mapped back to their TypeScript sources; open them in Chrome DevTools&apos; Performance tab.
      </p>
    </div>
  );
}
