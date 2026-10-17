import { describe, expect, it } from "bun:test";
import { summarize, summarizeCpuProfile, summarizeHeapSnapshot } from "../src/admin/summarize.ts";

const CPU_PROFILE = {
  nodes: [
    { id: 1, callFrame: { functionName: "(root)", url: "", lineNumber: -1 }, hitCount: 0 },
    { id: 2, callFrame: { functionName: "tick", url: "file:///app/src/loop.ts", lineNumber: 9 }, hitCount: 3 },
    { id: 3, callFrame: { functionName: "tick", url: "file:///app/src/loop.ts", lineNumber: 9 }, hitCount: 1 },
    { id: 4, callFrame: { functionName: "gc", url: "node:internal/gc", lineNumber: 4 }, hitCount: 0 },
  ],
  samples: [2, 2, 2, 3, 4],
  timeDeltas: [1000, 2000, 3000, 4000, 5000],
  startTime: 0,
  endTime: 15000,
};

const HEAP_SNAPSHOT = {
  snapshot: {
    meta: {
      node_fields: ["type", "name", "id", "self_size", "edge_count"],
      node_types: [["hidden", "array", "object"], "string", "number", "number", "number"],
    },
    node_count: 3,
    edge_count: 2,
  },
  nodes: [
    2, 0, 1, 300, 1,
    1, 1, 2, 500, 0,
    2, 0, 3, 200, 1,
  ],
  edges: [],
  strings: ["Widget", "items"],
};

describe("summarizeCpuProfile", () => {
  it("sums self time per function across call paths", () => {
    const summary = summarizeCpuProfile(CPU_PROFILE);

    expect(summary.stats).toEqual([
      { label: "Recorded", value: "15 ms" },
      { label: "Samples", value: "5" },
      { label: "Functions", value: "2" },
    ]);

    const rows = summary.sections[0]!.rows;
    // The two `tick` nodes are the same function and must be merged: 6000 + 4000.
    expect(rows[0]).toMatchObject({ name: "tick", value: "10 ms", share: 10000 / 15000 });
    expect(rows[0]!.detail).toBe("/app/src/loop.ts:10");
    expect(rows[1]).toMatchObject({ name: "gc", value: "5 ms", share: 5000 / 15000 });
    expect(rows[1]!.detail).toBe("node:internal/gc:5");
  });

  it("falls back to hit counts when there are no samples", () => {
    const summary = summarizeCpuProfile({ ...CPU_PROFILE, samples: [], timeDeltas: [] });
    expect(summary.sections[0]!.rows[0]!.name).toBe("tick");
    expect(summary.stats[1]).toEqual({ label: "Samples", value: "0" });
  });

  it("reports V8's synthetic frames as percentages, not functions", () => {
    const profile = {
      nodes: [
        { id: 1, callFrame: { functionName: "(idle)", url: "", lineNumber: -1 }, hitCount: 0 },
        { id: 2, callFrame: { functionName: "(garbage collector)", url: "", lineNumber: -1 }, hitCount: 0 },
        { id: 3, callFrame: { functionName: "(program)", url: "", lineNumber: -1 }, hitCount: 0 },
        { id: 4, callFrame: { functionName: "writev", url: "", lineNumber: -1 }, hitCount: 0 },
        { id: 5, callFrame: { functionName: "tick", url: "file:///app/src/loop.ts", lineNumber: 9 }, hitCount: 0 },
      ],
      samples: [1, 1, 1, 1, 1, 1, 1, 1, 2, 3, 4, 5],
      timeDeltas: [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 500, 500, 500, 500],
      startTime: 0,
      endTime: 8500,
    };

    const summary = summarizeCpuProfile(profile);
    const stats = Object.fromEntries(summary.stats.map((stat) => [stat.label, stat.value]));
    expect(stats["Idle"]).toBe("80.0%");
    expect(stats["GC"]).toBe("5.0%");
    expect(stats["VM"]).toBe("5.0%");
    // Only the two real functions are counted, and only they are listed.
    expect(stats["Functions"]).toBe("2");

    const rows = summary.sections[0]!.rows;
    expect(rows.map((row) => row.name)).toEqual(["writev", "tick"]);
    expect(rows.some((row) => row.name.startsWith("("))).toBe(false);
    // writev has no script URL because it is C++.
    expect(rows[0]!.detail).toBe("native");
    expect(rows[0]!.share).toBe(500 / 10000);
  });

  it("rejects something that is not a CPU profile", () => {
    expect(() => summarizeCpuProfile({ nope: true })).toThrow(/CPU profile/);
  });
});

describe("summarizeHeapSnapshot", () => {
  it("groups shallow sizes by name and by node type", () => {
    const summary = summarizeHeapSnapshot(HEAP_SNAPSHOT);

    expect(summary.stats).toEqual([
      { label: "Heap size", value: "1000 B" },
      { label: "Nodes", value: "3" },
      { label: "Edges", value: "2" },
    ]);

    const [byName, byType] = summary.sections;
    expect(byName!.rows.map((r) => [r.name, r.value, r.detail])).toEqual([
      ["Widget", "500 B", "object · 2 objects"],
      ["items", "500 B", "array · 1 objects"],
    ]);
    expect(byType!.title).toBe("By node type");
    expect(byType!.rows.map((r) => r.name).sort()).toEqual(["array", "object"]);
  });

  it("labels unnamed nodes by type and cuts down huge names", () => {
    // Real snapshots name nodes after string contents, which can be a whole source file.
    const source = "x".repeat(300);
    const summary = summarizeHeapSnapshot({
      snapshot: {
        meta: {
          node_fields: ["type", "name", "self_size"],
          node_types: [["hidden", "array", "string"], "string", "number"],
        },
        node_count: 2,
        edge_count: 0,
      },
      nodes: [1, 0, 100, 2, 1, 200],
      strings: ["", source],
    });

    const rows = summary.sections[0]!.rows;
    expect(rows[0]!.name).toHaveLength(73);
    expect(rows[0]!.name.endsWith("…")).toBe(true);
    expect(rows[0]!.detail).toBe("string · 1 objects");
    expect(rows[1]!.name).toBe("(array)");
  });

  it("rejects something that is not a heap snapshot", () => {
    expect(() => summarizeHeapSnapshot({ snapshot: {} })).toThrow(/heap profile/);
  });
});

describe("summarize", () => {
  it("dispatches on the snapshot kind", () => {
    expect(summarize("cpu", CPU_PROFILE).sections[0]!.title).toBe("Hottest functions");
    expect(summarize("heap", HEAP_SNAPSHOT).sections[0]!.title).toBe("Largest by self size");
  });
});
