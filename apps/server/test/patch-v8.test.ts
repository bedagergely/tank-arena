import v8 from "node:v8";
import { describe, expect, it } from "vitest";

// Importing the patch mutates the shared `v8` module object; that side effect is the point.
import "../src/patch-v8.ts";

describe("patch-v8", () => {
  it("hides getHeapStatistics from hasOwnProperty so @pm2/io aborts its polling timer", () => {
    expect(Object.prototype.hasOwnProperty.call(v8, "getHeapStatistics")).toBe(false);
  });

  it("keeps getHeapStatistics callable so @colyseus/tools still reads memory figures", () => {
    const stats = v8.getHeapStatistics();
    expect(stats.heap_size_limit).toBeGreaterThan(0);
    expect(stats.used_heap_size).toBeGreaterThan(0);
    expect(stats.used_heap_size).toBeLessThanOrEqual(stats.total_heap_size);
  });
});
