import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// GET /api/ai/card-fill — the unclaimed fill offered back on the creator.
// A double-faced fill (the AI dialog, PR 3) has two steps: its FRONT, paid
// for, is offered whatever became of its back — failed, still running, or
// never reached because the answer was lost (the job then stays
// "generating"; review of #639). A finished back's picture is merged in.
// A one-step fill is offered exactly as before.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  statusFilter: null as unknown,
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/admin", () => ({ isAdminConfigured: () => true, createAdminClient: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: "user-1" }),
  createClient: async () => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: (column: string, values: unknown) => {
        if (column === "status") s.statusFilter = values;
        return chain;
      },
      gte: () => chain,
      order: () => chain,
      limit: async () => ({ data: s.rows, error: null }),
    };
    return { from: () => chain };
  },
}));

import { GET } from "@/app/api/ai/card-fill/route";

const ask = async () => {
  const res = await GET(new Request("http://x/api/ai/card-fill?scope=create"));
  return (await res.json()) as { ok: boolean; fill: { jobId: string; result: Record<string, unknown> } | null };
};
const front = { title: "Hollow Village Smith", art_url: "https://x/front.png", back_face: { title: "Moonlit Ravager" } };
const row = (status: string, steps: Record<string, unknown>[], over: Record<string, unknown> = {}) => ({
  id: "job-1",
  owner_id: "user-1",
  kind: "card_fill",
  status,
  request: { scope: "create", claimed_at: null },
  steps,
  created_at: new Date().toISOString(),
  ...over,
});

beforeEach(() => {
  s.rows = [];
  s.statusFilter = null;
});

describe("GET /api/ai/card-fill", () => {
  it("never asks for a cancelled job", async () => {
    await ask();
    expect(s.statusFilter).toEqual(["generating", "done", "done_with_errors"]);
  });

  it("offers a double-faced front whose back was never reached (the job still generating)", async () => {
    s.rows = [row("generating", [{ key: "fill:0", status: "done", fill: front }, { key: "fill:1", status: "pending" }])];
    const out = await ask();
    expect(out.fill?.result).toEqual(front);
  });

  it("merges a finished back's picture", async () => {
    s.rows = [
      row("done", [
        { key: "fill:0", status: "done", fill: front },
        { key: "fill:1", status: "done", fill: { back_face: { art_url: "https://x/back.png", artist_credit: "Tester" } } },
      ]),
    ];
    const out = await ask();
    expect(out.fill?.result.back_face).toEqual({ title: "Moonlit Ravager", art_url: "https://x/back.png", artist_credit: "Tester" });
  });

  it("offers the front of a fill whose back failed", async () => {
    s.rows = [row("done_with_errors", [{ key: "fill:0", status: "done", fill: front }, { key: "fill:1", status: "failed", refunded: 1 }])];
    expect((await ask()).fill?.result).toEqual(front);
  });

  it("never a front that isn't done, nor a claimed one", async () => {
    s.rows = [
      row("generating", [{ key: "fill:0", status: "running" }, { key: "fill:1", status: "pending" }]),
      row("done", [{ key: "fill:0", status: "done", fill: front }], { request: { scope: "create", claimed_at: "2026-10-28T00:00:00Z" } }),
    ];
    expect((await ask()).fill).toBeNull();
  });

  it("a one-step fill is offered as before", async () => {
    s.rows = [row("done", [{ key: "fill:0", status: "done", fill: { title: "Ember" } }])];
    expect((await ask()).fill?.result).toEqual({ title: "Ember" });
  });
});
