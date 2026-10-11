import type { CpuSample, MemorySample } from "@tank-arena/server/metrics";
import { formatBytes } from "./format.ts";

/** Semicircle from (10,60) to (110,60); `pathLength` lets the value drive the dash. */
const ARC = "M 10 60 A 50 50 0 0 1 110 60";

const CPU_HISTORY_MAX = 100;

interface Segment {
  label: string;
  value: number;
  share: number;
  color: string;
}

/**
 * Splits RSS the way Node accounts for it: the V8 heap (used and reserved),
 * external C++ allocations (Buffers and friends), and everything else — code,
 * stacks and native allocations. The shares always sum to the resident set.
 */
function memorySegments({ rss, heapUsed, heapTotal, external }: MemorySample): Segment[] {
  const values: Array<[string, number, string]> = [
    ["Heap used", heapUsed, "bg-primary"],
    ["Heap unused", Math.max(0, heapTotal - heapUsed), "bg-primary/25"],
    ["External", Math.max(0, external), "bg-secondary"],
    ["Other", Math.max(0, rss - heapTotal - external), "bg-info"],
  ];
  return values.map(([label, value, color]) => ({
    label,
    value,
    color,
    share: rss > 0 ? value / rss : 0,
  }));
}

function Sparkline({ values, max, className }: { values: number[]; max: number; className: string }) {
  if (values.length < 2) return null;
  const step = 100 / (values.length - 1);
  const points = values
    .map((value, i) => {
      const height = max > 0 ? Math.min(1, value / max) : 0;
      return `${(i * step).toFixed(2)},${(100 - height * 100).toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={`h-10 w-full ${className}`} aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function CpuGauge({ sample, history, cores }: { sample: CpuSample | null; history: CpuSample[]; cores: number }) {
  const usage = sample?.usage ?? 0;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg viewBox="0 0 120 70" className="w-44" role="img" aria-label={sample ? `${usage.toFixed(0)}% CPU` : "idle"}>
        <path d={ARC} fill="none" strokeWidth={10} strokeLinecap="round" className="stroke-base-300" />
        <path
          d={ARC}
          fill="none"
          strokeWidth={10}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${Math.min(100, Math.max(0, usage))} 100`}
          className="stroke-primary"
        />
        <text x="60" y="50" textAnchor="middle" className="fill-base-content text-xl font-semibold tabular-nums">
          {sample ? `${usage.toFixed(0)}%` : "—"}
        </text>
        <text x="60" y="64" textAnchor="middle" className="fill-base-content/50 text-[8px]">
          of one core
        </text>
      </svg>
      <span className="text-xs text-base-content/50">{cores > 0 ? `${cores} cores available` : "not sampled yet"}</span>
      <Sparkline values={history.map((s) => s.usage)} max={CPU_HISTORY_MAX} className="text-primary" />
    </div>
  );
}

export function MemoryGauge({ sample, history }: { sample: MemorySample | null; history: MemorySample[] }) {
  const segments = sample ? memorySegments(sample) : [];
  const rssHistory = history.map((s) => s.rss);
  const maxRss = rssHistory.length > 0 ? Math.max(...rssHistory) : 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-base-content/60">Resident set</span>
        <span className="text-lg font-semibold tabular-nums">{sample ? formatBytes(sample.rss) : "—"}</span>
      </div>
      <div className="flex h-6 w-full overflow-hidden rounded-md border border-base-300 bg-base-100">
        {segments.map((segment) => (
          <div
            key={segment.label}
            className={segment.color}
            style={{ width: `${segment.share * 100}%` }}
            title={`${segment.label}: ${formatBytes(segment.value)}`}
          />
        ))}
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-xs">
        {segments.map((segment) => (
          <li key={segment.label} className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-sm ${segment.color}`} />
            {segment.label}
            <span className="text-base-content/60 tabular-nums">{formatBytes(segment.value)}</span>
          </li>
        ))}
      </ul>
      <Sparkline values={rssHistory} max={maxRss} className="text-info" />
    </div>
  );
}
