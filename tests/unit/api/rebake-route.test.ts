import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// POST /api/admin/rebake — the manual driver's route (scripts/rebake-renders.mjs)
// now shares the sweep lease with the automatic re-bake:
//   * a dry run (the plan) takes no lease;
//   * a writing call takes the lease (waiting for the cron to hand over),
//     PARKS it after a batch with work left (the cron stays out between the
//     driver's calls) and releases it when nothing is left;
//   * a lease still busy after the wait answers 503 + Retry-After with a
//     plain message (never 409, which the driver treats as fatal) and bakes
//     nothing;
//   * the billing gate still answers 412 before any lease.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  billing: true,
  batch: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ tag: "admin-client" }),
  isAdminConfigured: () => true,
}));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => state.billing }));
vi.mock("@/lib/cards/rebake-batch", () => ({
  DEFAULT_BATCH: 8,
  MAX_BATCH: 25,
  parseRebakeScope: (params: URLSearchParams) =>
    params.get("scope") === "sweep" ? { kind: "sweep" } : { error: "scope is required" },
  runRebakeBatch: state.batch,
}));
vi.mock("@/lib/cards/sweep-lease", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/sweep-lease")>();
  return { ...real, acquireManualLease: state.acquire, releaseSweepLease: state.release };
});

import { POST } from "@/app/api/admin/rebake/route";

const post = (qs: string) =>
  POST(
    new Request(`https://www.pipglyph.com/api/admin/rebake?${qs}`, {
      method: "POST",
      headers: { authorization: "Bearer s3cret" },
    }),
  );

const batchResult = (remaining: number) => ({
  ok: true,
  dry: false,
  scope: { kind: "sweep" },
  layoutVersion: 32,
  billingEnabled: true,
  plan: { rebake: 3, stamp: 0, optIn: 0 },
  processed: [{ id: "a", verdict: "rebake" }],
  failed: [],
  superseded: [],
  remaining,
});

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "s3cret");
  state.billing = true;
  state.batch.mockReset();
  state.acquire.mockReset();
  state.release.mockReset();
  state.acquire.mockImplementation(async (_admin: unknown, token: string) => ({ ok: true, token, waitedMs: 0 }));
  state.release.mockResolvedValue(true);
  state.batch.mockResolvedValue(batchResult(2));
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/admin/rebake — the shared sweep lease", () => {
  it("plans a dry run without taking the lease", async () => {
    state.batch.mockResolvedValue({ ...batchResult(3), dry: true });
    const res = await post("scope=sweep&dry=1");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, dry: true, plan: { rebake: 3 }, remaining: 3 });
    expect(state.acquire).not.toHaveBeenCalled();
    expect(state.release).not.toHaveBeenCalled();
  });

  it("takes the lease for a writing batch and parks it while work is left", async () => {
    const res = await post("scope=sweep");
    expect(res.status).toBe(200);
    expect((await res.json()).remaining).toBe(2);
    expect(state.acquire).toHaveBeenCalledTimes(1);
    const token = state.acquire.mock.calls[0][1];
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect(state.release).toHaveBeenCalledWith({ tag: "admin-client" }, token, { parkSeconds: 120 });
    // The lease was taken BEFORE the batch ran.
    expect(state.acquire.mock.invocationCallOrder[0]).toBeLessThan(state.batch.mock.invocationCallOrder[0]);
  });

  it("releases the lease outright once nothing is left", async () => {
    state.batch.mockResolvedValue(batchResult(0));
    await post("scope=sweep");
    expect(state.release).toHaveBeenCalledWith({ tag: "admin-client" }, expect.any(String), {});
  });

  it("parks the lease even when the batch throws", async () => {
    state.batch.mockRejectedValue(new Error("render crashed"));
    await expect(post("scope=sweep")).rejects.toThrow("render crashed");
    expect(state.release).toHaveBeenCalledWith({ tag: "admin-client" }, expect.any(String), { parkSeconds: 120 });
  });

  it("answers 503 + Retry-After with a plain message when the lease stays busy — and bakes nothing", async () => {
    state.acquire.mockResolvedValue({ ok: false, holder: "cron", expiresAt: "2026-09-28T12:05:10Z", waitedMs: 120_000 });
    const res = await post("scope=sweep");
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("60");
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, busy: true, holder: "cron" });
    expect(body.error).toMatch(/automatic re-bake is mid-batch.*try again in a minute/);
    expect(state.batch).not.toHaveBeenCalled();
    expect(state.release).not.toHaveBeenCalled();
  });

  it("answers 500 when the lease itself is unavailable (fail closed)", async () => {
    state.acquire.mockRejectedValue(new Error("Sweep lease: function does not exist"));
    const res = await post("scope=sweep");
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/function does not exist/);
    expect(state.batch).not.toHaveBeenCalled();
  });

  it("still refuses to bake clean before touching the lease", async () => {
    state.billing = false;
    const res = await post("scope=sweep");
    expect(res.status).toBe(412);
    expect(state.acquire).not.toHaveBeenCalled();
    expect(state.batch).not.toHaveBeenCalled();
  });
});
