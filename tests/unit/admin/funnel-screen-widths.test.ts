import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, called, type ChainAnswer, type ChainCall } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// The Funnel tab's "Screen widths" (TODO WD9): tab sessions per bucket and
// their share, every bucket in width order; read as one exact head count per
// bucket over the page's PERIOD (it was a fixed 30 days); a failed read is
// flagged, never zeros.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  counts: {} as Record<string, number>,
  fail: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/users-queries", async () => {
  const { chainClient: makeClient } = await import("@/tests/stubs/supabase-chain");
  return {
    requireAdminClient: async () => {
      const stub = makeClient((table, calls) => resolve(table, calls));
      chains.push(stub.log);
      return { ...stub.client, rpc: async () => ({ data: [], error: null }) };
    },
  };
});

const chains: Array<ReturnType<typeof chainClient>["log"]> = [];

function bucketOf(calls: ChainCall[]): string | undefined {
  const eq = calls.find((c) => c.method === "eq" && c.args[0] === "props->>bucket");
  return eq?.args[1] as string | undefined;
}

function resolve(table: string, calls: ChainCall[]): ChainAnswer {
  if (table !== "funnel_events") return { data: [] };
  if (called(calls, "eq", "event") && calls.some((c) => c.method === "eq" && c.args[1] === "screen_width")) {
    if (state.fail) return { data: null, error: { message: "boom" } };
    return { data: null, count: state.counts[bucketOf(calls) ?? ""] ?? 0 };
  }
  return { data: [] };
}

import { buildScreenWidths, getFunnelSummary } from "@/lib/admin/funnel-queries";
import { analyticsPeriod } from "@/lib/admin/analytics/params";
import { SCREEN_WIDTH_BUCKETS } from "@/lib/analytics/screen-width";

const NOW = new Date("2026-11-10T15:30:00.000Z");

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  state.counts = {};
  state.fail = false;
  chains.length = 0;
  log = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => log.mockRestore());

describe("buildScreenWidths", () => {
  it("lists every bucket in width order with its sessions and share (one decimal)", () => {
    expect(buildScreenWidths({ "0-639": 30, "1366-1535": 50, "1920-2559": 20, "2560-up": 0 })).toEqual([
      { bucket: "0-639", label: "<640", sessions: 30, share: 30 },
      { bucket: "640-1023", label: "640–1023", sessions: 0, share: 0 },
      { bucket: "1024-1365", label: "1024–1365", sessions: 0, share: 0 },
      { bucket: "1366-1535", label: "1366–1535", sessions: 50, share: 50 },
      { bucket: "1536-1919", label: "1536–1919", sessions: 0, share: 0 },
      { bucket: "1920-2559", label: "1920–2559", sessions: 20, share: 20 },
      { bucket: "2560-up", label: "2560+", sessions: 0, share: 0 },
    ]);
    expect(buildScreenWidths({ "0-639": 1, "640-1023": 2 }).slice(0, 2).map((r) => r.share)).toEqual([33.3, 66.7]);
  });

  it("an empty window has no shares (no division by zero)", () => {
    const rows = buildScreenWidths({});
    expect(rows).toHaveLength(SCREEN_WIDTH_BUCKETS.length);
    expect(rows.every((r) => r.sessions === 0 && r.share === null)).toBe(true);
  });
});

describe("getFunnelSummary — screen widths", () => {
  it.each([7, 30, 90] as const)("counts each bucket exactly over the page's period of %i days (head counts, no row read)", async (days) => {
    state.counts = { "640-1023": 3, "1536-1919": 9 };
    const period = analyticsPeriod(days, NOW);
    const summary = await getFunnelSummary(period);
    expect(summary?.screenWidths?.find((r) => r.bucket === "1536-1919")).toMatchObject({ sessions: 9, share: 75 });
    expect(summary?.screenWidths?.find((r) => r.bucket === "640-1023")).toMatchObject({ sessions: 3, share: 25 });

    const reads = chains.flat().filter((e) => e.calls.some((c) => c.method === "eq" && c.args[1] === "screen_width"));
    expect(reads.map((e) => bucketOf(e.calls))).toEqual(SCREEN_WIDTH_BUCKETS.map((b) => b.key));
    for (const read of reads) {
      expect(read.calls.find((c) => c.method === "select")?.args).toEqual(["id", { count: "exact", head: true }]);
      // [since, until): from the start of the period's first UTC day to now.
      expect(read.calls.find((c) => c.method === "gte" && c.args[0] === "created_at")?.args[1]).toBe(period.since.toISOString());
      expect(read.calls.find((c) => c.method === "lt" && c.args[0] === "created_at")?.args[1]).toBe(NOW.toISOString());
    }
    expect(period.since.toISOString()).toBe(new Date(Date.UTC(2026, 10, 10 - (days - 1))).toISOString());
  });

  it("a failed read is logged and flagged (null) — never a table of zeros, and the rest of the tab still loads", async () => {
    state.fail = true;
    const summary = await getFunnelSummary(analyticsPeriod(30, NOW));
    expect(summary).not.toBeNull();
    expect(summary?.screenWidths).toBeNull();
    expect(summary?.counts).not.toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("screen widths read failed"), "boom");
  });
});
