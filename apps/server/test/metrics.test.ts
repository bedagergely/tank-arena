import { describe, expect, it } from "vitest";
import { createGameStats, MAX_TICKS_PER_WINDOW } from "../src/gameStats.ts";
import { createMetrics } from "../src/metrics.ts";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("createMetrics", () => {
  it("reports nothing until a recorder is started", () => {
    const snapshot = createMetrics().snapshot();
    expect(snapshot.cpu).toEqual({ recording: false, latest: null, history: [] });
    expect(snapshot.memory).toEqual({ recording: false, latest: null, history: [] });
    expect(snapshot.game).toEqual({ recording: false, latest: null, history: [] });
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

describe("createGameStats", () => {
  it("counts rooms and seats from lifecycle calls", () => {
    const stats = createGameStats();
    stats.roomOpened();
    stats.roomOpened();
    stats.roomClosed();
    stats.seatTaken();
    stats.seatTaken();
    stats.seatTaken();
    stats.seatFreed();

    const sample = stats.sample(1000);
    expect(sample.rooms).toBe(1);
    expect(sample.players).toBe(2);
  });

  it("reports tick percentiles with nearest-rank", () => {
    const stats = createGameStats();
    stats.sample(0);
    for (const ms of [1, 2, 3, 4]) stats.recordTick(ms);

    const sample = stats.sample(1000);
    expect(sample.tickP50).toBe(2);
    expect(sample.tickP95).toBe(4);
  });

  it("turns events into a per-second rate over the window and resets it", () => {
    const stats = createGameStats();
    stats.sample(0);
    stats.recordEvent("fire");
    stats.recordEvent("fire");
    stats.recordEvent("bounce");
    stats.recordEvent("hit");
    stats.recordEvent("hit");
    stats.recordEvent("loot");

    const first = stats.sample(1000);
    expect(first.eventsPerSecond).toEqual({ fire: 2, bounce: 1, hit: 2, loot: 1 });

    // The next window starts empty: nothing carried over.
    const second = stats.sample(3000);
    expect(second.eventsPerSecond).toEqual({ fire: 0, bounce: 0, hit: 0, loot: 0 });
    expect(second.tickP50).toBe(0);
    expect(second.tickP95).toBe(0);
  });

  it("scales the event rate by the window length", () => {
    const stats = createGameStats();
    stats.sample(0);
    stats.recordEvent("hit");
    // One event over two seconds is half an event per second.
    expect(stats.sample(2000).eventsPerSecond.hit).toBe(0.5);
  });

  it("bounds the tick buffer so an unsampled process cannot grow without limit", () => {
    const stats = createGameStats();
    stats.sample(0);
    for (let i = 0; i < MAX_TICKS_PER_WINDOW * 4; i++) stats.recordTick(i);

    const sample = stats.sample(1000);
    // Only the newest ticks survive, so the median sits near the largest value fed.
    expect(sample.tickP50).toBeGreaterThan(MAX_TICKS_PER_WINDOW * 3);
    expect(sample.tickP95).toBeLessThan(MAX_TICKS_PER_WINDOW * 4);
  });

  it("never reports a negative room or seat count", () => {
    const stats = createGameStats();
    stats.roomClosed();
    stats.seatFreed();

    const sample = stats.sample(1000);
    expect(sample.rooms).toBe(0);
    expect(sample.players).toBe(0);
  });
});

describe("createMetrics game channel", () => {
  it("records game samples while running and stops cleanly", async () => {
    const stats = createGameStats();
    const metrics = createMetrics({ intervalMs: 5, historyLimit: 3, stats });

    expect(metrics.game.recording).toBe(false);
    expect(metrics.game.latest).toBeNull();

    metrics.game.start();
    expect(metrics.game.recording).toBe(true);
    stats.roomOpened();
    stats.seatTaken();
    await delay(40);
    metrics.game.stop();

    expect(metrics.game.recording).toBe(false);
    const latest = metrics.game.latest;
    expect(latest).not.toBeNull();
    expect(latest!.rooms).toBe(1);
    expect(latest!.players).toBe(1);
    expect(metrics.game.history.length).toBeLessThanOrEqual(3);
  });

  it("hands out copies so a caller cannot mutate the game history", async () => {
    const metrics = createMetrics({ intervalMs: 10, stats: createGameStats() });
    metrics.game.start();
    await delay(30);
    metrics.game.stop();

    const before = metrics.game.history.length;
    metrics.snapshot().game.history.push({
      at: 0,
      rooms: 0,
      players: 0,
      tickP50: 0,
      tickP95: 0,
      eventsPerSecond: { fire: 0, bounce: 0, hit: 0, loot: 0 },
    });
    expect(metrics.game.history.length).toBe(before);
  });
});
