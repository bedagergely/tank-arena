import { describe, expect, it } from "vitest";
import { createMetrics } from "../src/metrics.ts";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("createMetrics", () => {
  it("reports nothing until a recorder is started", () => {
    const snapshot = createMetrics().snapshot();
    expect(snapshot.cpu).toEqual({ recording: false, latest: null, history: [] });
    expect(snapshot.memory).toEqual({ recording: false, latest: null, history: [] });
    expect(snapshot.cores).toBeGreaterThan(0);
  });

  it("samples memory as soon as it starts", () => {
    const metrics = createMetrics({ intervalMs: 20 });
    metrics.memory.start();
    expect(metrics.memory.recording).toBe(true);

    const sample = metrics.memory.latest;
    expect(sample).not.toBeNull();
    expect(sample!.rss).toBeGreaterThan(0);
    expect(sample!.heapUsed).toBeLessThanOrEqual(sample!.heapTotal);

    metrics.memory.stop();
    expect(metrics.memory.recording).toBe(false);
  });

  it("needs a baseline before it can report CPU usage", async () => {
    const metrics = createMetrics({ intervalMs: 10 });
    metrics.cpu.start();
    // The first tick only records the counter, so there is nothing to show yet.
    expect(metrics.cpu.latest).toBeNull();

    await delay(60);
    const sample = metrics.cpu.latest;
    expect(sample).not.toBeNull();
    expect(sample!.usage).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(sample!.usage)).toBe(true);

    metrics.cpu.stop();
  });

  it("bounds the history it keeps", async () => {
    const metrics = createMetrics({ intervalMs: 5, historyLimit: 3 });
    metrics.memory.start();
    await delay(80);
    metrics.memory.stop();

    expect(metrics.memory.history.length).toBeGreaterThan(1);
    expect(metrics.memory.history.length).toBeLessThanOrEqual(3);
  });

  it("starts a clean run each time", async () => {
    const metrics = createMetrics({ intervalMs: 10 });
    metrics.memory.start();
    await delay(40);
    expect(metrics.memory.history.length).toBeGreaterThan(1);
    metrics.memory.stop();

    metrics.memory.start();
    expect(metrics.memory.history.length).toBe(1);
    metrics.memory.stop();
  });

  it("is idempotent on start and stop", () => {
    const metrics = createMetrics({ intervalMs: 1000 });
    metrics.memory.start();
    metrics.memory.start();
    expect(metrics.memory.latest).not.toBeNull();

    metrics.memory.stop();
    metrics.memory.stop();
    expect(metrics.memory.recording).toBe(false);
  });

  it("hands out copies so a caller cannot mutate the history", async () => {
    const metrics = createMetrics({ intervalMs: 10 });
    metrics.memory.start();
    await delay(30);
    metrics.memory.stop();

    const before = metrics.memory.history.length;
    metrics.snapshot().memory.history.push({ at: 0, rss: 0, heapUsed: 0, heapTotal: 0, external: 0 });
    expect(metrics.memory.history.length).toBe(before);
  });
});
