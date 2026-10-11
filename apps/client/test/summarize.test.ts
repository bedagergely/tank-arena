import { describe, expect, it } from "vitest";
import { summarize, summarizeCpuProfile, summarizeHeapProfile, summarizeHeapSnapshot } from "../src/admin/summarize.ts";

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

const HEAP_PROFILE = {
  head: {
    callFrame: { functionName: "(root)", url: "", lineNumber: -1 },
    selfSize: 0,
    children: [
      {
        callFrame: { functionName: "parse", url: "file:///app/src/parse.ts", lineNumber: 4 },
        selfSize: 1024,
        children: [
          {
            callFrame: { functionName: "decode", url: "file:///app/src/decode.ts", lineNumber: 9 },
            selfSize: 2048,
            children: [],
          },
        ],
      },
      { callFrame: { functionName: "parse", url: "file:///app/src/parse.ts", lineNumber: 4 }, selfSize: 512, children: [] },
    ],
  },
  samples: [],
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

describe("summarizeHeapProfile", () => {
  it("walks the call tree and merges the same function", () => {
    const summary = summarizeHeapProfile(HEAP_PROFILE);

    expect(summary.stats).toEqual([
      { label: "Sampled", value: "3.5 KB" },
      { label: "Functions", value: "2" },
    ]);

    const rows = summary.sections[0]!.rows;
    expect(rows[0]).toMatchObject({ name: "decode", value: "2.0 KB" });
    expect(rows[1]).toMatchObject({ name: "parse", value: "1.5 KB" });
  });

  it("survives a very deep call tree", () => {
    let node: Record<string, unknown> = { callFrame: { functionName: "leaf", url: "f.ts", lineNumber: 0 }, selfSize: 64 };
    for (let i = 0; i < 20_000; i++) {
      node = { callFrame: { functionName: `f${i}`, url: "f.ts", lineNumber: i }, selfSize: 0, children: [node] };
    }
    expect(summarizeHeapProfile({ head: node }).stats[0]!.value).toBe("64 B");
  });

  it("rejects something that is not a heap sampling profile", () => {
    expect(() => summarizeHeapProfile({ samples: [] })).toThrow(/heap sampling/);
  });
});

describe("summarize", () => {
  it("dispatches on the snapshot kind", () => {
    expect(summarize("cpu", CPU_PROFILE).sections[0]!.title).toBe("Hottest functions");
    expect(summarize("heap", HEAP_SNAPSHOT).sections[0]!.title).toBe("Largest by self size");
    expect(summarize("heapsampling", HEAP_PROFILE).sections[0]!.title).toBe("Top allocating functions");
  });
});
