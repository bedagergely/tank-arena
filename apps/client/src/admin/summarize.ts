import { formatBytes, formatMicros, formatMicrosFine, shortenPath, truncate } from "./format.ts";

export interface SummaryStat {
  label: string;
  value: string;
}

export interface SummaryRow {
  name: string;
  detail: string;
  value: string;
  share: number;
  /** Optional extra figure per row, e.g. average time per call. */
  extra?: string;
}

export interface SummarySection {
  title: string;
  /** Header for `value` — what the main figure measures. */
  valueLabel: string;
  /** Header for `extra`, set only when the section actually has one. */
  extraLabel?: string;
  rows: SummaryRow[];
}

export interface ProfileSummary {
  stats: SummaryStat[];
  sections: SummarySection[];
  note: string;
}

export type ProfileKind = "cpu" | "heap" | "heapsampling";

const TOP_ROWS = 15;
const TOP_TYPES = 8;

const ANONYMOUS = "(anonymous)";

/**
 * V8 injects these "meta" nodes next to real call frames. None of them is a
 * function: `(idle)` is time the event loop spent waiting for work, `(program)`
 * is VM work that did not come from JavaScript, and `(garbage collector)` is
 * GC. DevTools keeps them out of application self time, so they are reported as
 * percentages rather than listed as the hottest "functions".
 */
const META_FRAMES = new Set(["(root)", "(idle)", "(program)", "(garbage collector)"]);

interface CallFrame {
  functionName?: unknown;
  url?: unknown;
  lineNumber?: unknown;
  scriptId?: unknown;
}

interface Tally {
  size: number;
  count: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function notAProfile(kind: string): never {
  throw new Error(`This does not look like a ${kind} profile.`);
}

function add(map: Map<string, Tally>, key: string, size: number): void {
  const entry = map.get(key) ?? { size: 0, count: 0 };
  entry.size += size;
  entry.count += 1;
  map.set(key, entry);
}

function toRows(
  map: Map<string, Tally>,
  total: number,
  describe: (key: string, tally: Tally) => { name: string; detail: string },
  limit = TOP_ROWS,
): SummaryRow[] {
  return [...map.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, limit)
    .map(([key, tally]) => ({
      ...describe(key, tally),
      value: formatBytes(tally.size),
      share: total > 0 ? tally.size / total : 0,
    }));
}

function frameName(frame: CallFrame): string {
  return typeof frame.functionName === "string" && frame.functionName !== "" ? frame.functionName : ANONYMOUS;
}

function isMetaFrame(name: string): boolean {
  return META_FRAMES.has(name);
}

function frameLocation(frame: CallFrame): string {
  const url = typeof frame.url === "string" ? frame.url : "";
  // No script URL means C++ code — unless it is one of V8's synthetic frames.
  if (url === "") return isMetaFrame(frameName(frame)) ? "v8 internal" : "native";
  const line = typeof frame.lineNumber === "number" && frame.lineNumber >= 0 ? `:${frame.lineNumber + 1}` : "";
  return `${shortenPath(url)}${line}`;
}

function frameKey(frame: CallFrame): string {
  return `${typeof frame.url === "string" ? frame.url : ""}\u0000${String(frame.lineNumber)}\u0000${frameName(frame)}`;
}

/**
 * Coverage reports a raw `functionName` (empty for anonymous functions), so it
 * is matched against the frame's raw name rather than the display one.
 */
function callCountKey(frame: CallFrame): string {
  const scriptId = typeof frame.scriptId === "string" ? frame.scriptId : "";
  const name = typeof frame.functionName === "string" ? frame.functionName : "";
  return `${scriptId}\u0000${name}`;
}

/** Call counts the server embedded in the profile, keyed by script and name. */
function callCountIndex(profile: Record<string, unknown> | null): Map<string, number> {
  const index = new Map<string, number>();
  if (!Array.isArray(profile?.callCounts)) return index;
  for (const entry of profile.callCounts as Array<Record<string, unknown>>) {
    const count = entry?.count;
    if (typeof count !== "number") continue;
    index.set(`${String(entry.scriptId)}\u0000${String(entry.functionName)}`, count);
  }
  return index;
}

/**
 * CPU profile: self time per function. V8 reports timestamps in microseconds
 * and tags each sample with the node it landed on, so summing the time deltas
 * of the samples per node gives exact self time.
 */
export function summarizeCpuProfile(input: unknown): ProfileSummary {
  const profile = asRecord(input);
  const nodes = Array.isArray(profile?.nodes) ? (profile.nodes as Record<string, unknown>[]) : notAProfile("CPU");
  const samples = Array.isArray(profile?.samples) ? (profile.samples as number[]) : [];
  const deltas = Array.isArray(profile?.timeDeltas) ? (profile.timeDeltas as number[]) : [];
  const start = typeof profile?.startTime === "number" ? profile.startTime : 0;
  const end = typeof profile?.endTime === "number" ? profile.endTime : 0;
  const duration = Math.max(0, end - start);

  const selfMicros = new Map<number, number>();
  if (samples.length > 0 && deltas.length === samples.length) {
    samples.forEach((id, i) => selfMicros.set(id, (selfMicros.get(id) ?? 0) + (deltas[i] ?? 0)));
  } else {
    const hits = nodes.reduce((sum, node) => sum + (typeof node.hitCount === "number" ? node.hitCount : 0), 0);
    for (const node of nodes) {
      const count = typeof node.hitCount === "number" ? node.hitCount : 0;
      if (count > 0 && hits > 0) selfMicros.set(node.id as number, (count / hits) * duration);
    }
  }

  const byFunction = new Map<string, Tally>();
  const frames = new Map<string, CallFrame>();
  const metaMicros = new Map<string, number>();
  let application = 0;
  let meta = 0;
  for (const node of nodes) {
    const micros = selfMicros.get(node.id as number) ?? 0;
    if (micros <= 0) continue;
    const frame = asRecord(node.callFrame) as CallFrame | null;
    if (frame === null) continue;

    const name = frameName(frame);
    if (isMetaFrame(name)) {
      metaMicros.set(name, (metaMicros.get(name) ?? 0) + micros);
      meta += micros;
      continue;
    }

    const key = frameKey(frame);
    add(byFunction, key, micros);
    frames.set(key, frame);
    application += micros;
  }

  // Shares are of everything that was sampled, so "Idle 69%" and "post 4%" are
  // read on the same scale.
  const profiled = application + meta;
  const metaStat = (frame: string, label: string): SummaryStat[] => {
    const micros = metaMicros.get(frame) ?? 0;
    return micros > 0 && profiled > 0 ? [{ label, value: `${((micros / profiled) * 100).toFixed(1)}%` }] : [];
  };

  const counts = callCountIndex(profile);
  const rows = [...byFunction.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, TOP_ROWS)
    .map(([key, tally]) => {
      const frame = frames.get(key) ?? {};
      const calls = counts.get(callCountKey(frame)) ?? 0;
      return {
        name: truncate(frameName(frame), 48),
        detail: frameLocation(frame),
        value: formatMicros(tally.size),
        share: profiled > 0 ? tally.size / profiled : 0,
        ...(calls > 0 ? { extra: formatMicrosFine(tally.size / calls) } : {}),
      };
    });

  const section: SummarySection = { title: "Hottest functions", valueLabel: "Self time", rows };
  if (rows.some((row) => row.extra !== undefined)) {
    section.extraLabel = "Avg / call";
    // Keep the column readable when only some functions were counted.
    for (const row of rows) row.extra ??= "—";
  }

  return {
    stats: [
      { label: "Recorded", value: formatMicros(duration) },
      { label: "Samples", value: samples.length.toLocaleString() },
      { label: "Functions", value: byFunction.size.toLocaleString() },
      ...metaStat("(idle)", "Idle"),
      ...metaStat("(garbage collector)", "GC"),
      ...metaStat("(program)", "VM"),
    ],
    sections: [section],
    note: "Time is self time — a function's own work, excluding everything it called. Idle, GC and VM are V8's own categories, not functions. Per-call averages need V8 call counts, so profiles captured before they were recorded show —.",
  };
}

/**
 * Heap snapshot: shallow size grouped by node name (the constructor or
 * function an object came from). Retained size would need a dominator tree,
 * which is far too much to build in a browser tab.
 */
export function summarizeHeapSnapshot(input: unknown): ProfileSummary {
  const json = asRecord(input);
  const snapshot = asRecord(json?.snapshot);
  const meta = snapshot === null ? null : asRecord(snapshot.meta);
  if (meta === null || !Array.isArray(meta.node_fields)) notAProfile("heap");
  if (json === null || !Array.isArray(json.nodes)) notAProfile("heap");

  const fields = meta.node_fields as string[];
  const nodes = json.nodes as number[];
  const strings = Array.isArray(json.strings) ? (json.strings as string[]) : [];

  const typeIndex = fields.indexOf("type");
  const nameIndex = fields.indexOf("name");
  const sizeIndex = fields.indexOf("self_size");
  if (typeIndex < 0 || nameIndex < 0 || sizeIndex < 0) notAProfile("heap");

  const rawTypes = Array.isArray(meta.node_types) ? meta.node_types[typeIndex] : undefined;
  const typeNames = Array.isArray(rawTypes) ? (rawTypes as string[]) : [];
  const count = typeof snapshot?.node_count === "number" ? snapshot.node_count : Math.floor(nodes.length / fields.length);
  const edges = typeof snapshot?.edge_count === "number" ? snapshot.edge_count : 0;

  const byName = new Map<string, Tally>();
  const byType = new Map<string, Tally>();
  const labels = new Map<string, { name: string; type: string }>();
  let total = 0;
  for (let i = 0; i < count; i++) {
    const base = i * fields.length;
    const size = nodes[base + sizeIndex] ?? 0;
    if (size <= 0) continue;
    total += size;

    const name = strings[nodes[base + nameIndex] ?? 0] ?? "";
    const type = typeNames.length > 0 ? (typeNames[nodes[base + typeIndex] ?? 0] ?? "unknown") : "";
    // Different node types can share a name, so keep them apart.
    const key = `${type}\u0000${name}`;
    add(byName, key, size);
    labels.set(key, { name, type });
    if (type !== "") add(byType, type, size);
  }

  const sections: SummarySection[] = [
    {
      title: "Largest by self size",
      valueLabel: "Self size",
      rows: toRows(byName, total, (key, tally) => {
        const { name, type } = labels.get(key) ?? { name: "", type: "" };
        return {
          // Array and object nodes carry no name of their own.
          name: name === "" ? `(${type || "anonymous"})` : truncate(name),
          detail: `${type || "node"} · ${tally.count.toLocaleString()} objects`,
        };
      }),
    },
  ];
  if (byType.size > 0) {
    sections.push({
      title: "By node type",
      valueLabel: "Self size",
      rows: toRows(
        byType,
        total,
        (key, tally) => ({ name: key, detail: `${tally.count.toLocaleString()} nodes` }),
        TOP_TYPES,
      ),
    });
  }

  return {
    stats: [
      { label: "Heap size", value: formatBytes(total) },
      { label: "Nodes", value: count.toLocaleString() },
      { label: "Edges", value: edges.toLocaleString() },
    ],
    sections,
    note: "Sizes are shallow (self size), not retained size.",
  };
}

/**
 * Sampling heap profile: a tree of call frames, each carrying the bytes
 * allocated directly in it — the closest thing V8 gives to "which functions
 * are using the memory".
 */
export function summarizeHeapProfile(input: unknown): ProfileSummary {
  const json = asRecord(input);
  const head = asRecord(json?.head);
  if (head === null) notAProfile("heap sampling");

  const byFunction = new Map<string, Tally>();
  const frames = new Map<string, CallFrame>();
  let total = 0;
  const stack: Record<string, unknown>[] = [head];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const size = typeof node.selfSize === "number" ? node.selfSize : 0;
    const frame = asRecord(node.callFrame) as CallFrame | null;
    if (size > 0 && frame !== null) {
      const key = frameKey(frame);
      add(byFunction, key, size);
      frames.set(key, frame);
      total += size;
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children as Record<string, unknown>[]) {
        const record = asRecord(child);
        if (record !== null) stack.push(record);
      }
    }
  }

  const rows = [...byFunction.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, TOP_ROWS)
    .map(([key, tally]) => {
      const frame = frames.get(key) ?? {};
      return {
        name: truncate(frameName(frame), 48),
        detail: frameLocation(frame),
        value: formatBytes(tally.size),
        share: total > 0 ? tally.size / total : 0,
      };
    });

  return {
    stats: [
      { label: "Sampled", value: formatBytes(total) },
      { label: "Functions", value: byFunction.size.toLocaleString() },
    ],
    sections: [{ title: "Top allocating functions", valueLabel: "Allocated", rows }],
    note: "Bytes allocated in each function, sampled while the profile ran.",
  };
}

export function summarize(kind: ProfileKind, data: unknown): ProfileSummary {
  if (kind === "cpu") return summarizeCpuProfile(data);
  if (kind === "heap") return summarizeHeapSnapshot(data);
  return summarizeHeapProfile(data);
}
