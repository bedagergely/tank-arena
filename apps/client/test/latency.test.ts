import { describe, expect, it } from "vitest";
import { formatLatency, latencyTone } from "../src/ui/latency.ts";

describe("formatLatency", () => {
  it("shows a dash until the first measurement lands", () => {
    expect(formatLatency(null)).toBe("—");
  });

  it("rounds to whole milliseconds", () => {
    expect(formatLatency(41.6)).toBe("42 ms");
    expect(formatLatency(0)).toBe("0 ms");
  });
});

describe("latencyTone", () => {
  it("goes green, amber then red as latency climbs", () => {
    expect(latencyTone(12)).toBe("text-success");
    expect(latencyTone(79)).toBe("text-success");
    expect(latencyTone(80)).toBe("text-warning");
    expect(latencyTone(199)).toBe("text-warning");
    expect(latencyTone(200)).toBe("text-error");
  });

  it("stays muted before there is a reading", () => {
    expect(latencyTone(null)).toBe("text-base-content/60");
  });
});
