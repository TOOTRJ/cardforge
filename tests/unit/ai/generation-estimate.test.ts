import { describe, expect, it } from "vitest";
import { estimateRemainingMs, formatDuration } from "@/components/ai/generation-details-dialog";

describe("generation time estimate", () => {
  it("scales the measured pace by the remaining steps and the worker pool", () => {
    // 6 steps finished in 60s of wall-clock (pool included) → 10s each; 9 left → 90s.
    const stats = { startedAt: 0, completions: [10, 20, 30, 40, 50, 60].map((s) => s * 1000), concurrency: 3 };
    expect(estimateRemainingMs(stats, 9, 60_000)).toBe(90_000);
    expect(estimateRemainingMs(stats, 1, 60_000)).toBe(10_000);
  });

  it("has no estimate before the first completion and zero when nothing remains", () => {
    expect(estimateRemainingMs({ startedAt: 0, completions: [], concurrency: 3 }, 5, 5000)).toBeNull();
    expect(estimateRemainingMs({ startedAt: 0, completions: [1], concurrency: 3 }, 0)).toBe(0);
  });

  it("formats durations for people", () => {
    expect(formatDuration(4_000)).toBe("4s");
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(formatDuration(3_600_000)).toBe("1h 0m");
  });
});
