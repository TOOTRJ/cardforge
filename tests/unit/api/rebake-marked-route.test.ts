import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// POST /api/admin/rebake-marked — the compare page's "Re-bake now" loop
// (TODO 0.20). Contract: same-origin only, admin session (404 otherwise),
// the billing gate (never bake clean), scope "marked" in batches of 4 with
// the skip list, and a compact result the client loop understands. Every
// batch runs under the shared sweep lease (lib/cards/sweep-lease.ts): parked
// between the loop's calls, released when nothing is left, a 503 the panel
// shows when the automatic re-bake doesn't hand over.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  profile: { id: "admin", is_admin: true } as null | { id: string; is_admin: boolean },
  configured: true,
  billing: true,
  batch: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: async () => state.profile }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ tag: "admin-client" }),
  isAdminConfigured: () => state.configured,
}));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => state.billing }));
vi.mock("@/lib/cards/rebake-batch", () => ({ runRebakeBatch: state.batch }));
vi.mock("@/lib/cards/sweep-lease", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/sweep-lease")>();
  return { ...real, acquireManualLease: state.acquire, releaseSweepLease: state.release };
});
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

import { POST } from "@/app/api/admin/rebake-marked/route";

const ORIGIN = "https://www.pipglyph.com";
const ID = "11111111-1111-4111-8111-111111111111";

function post(body: unknown, origin: string | null = ORIGIN) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  return POST(new Request(`${ORIGIN}/api/admin/rebake-marked`, { method: "POST", headers, body: JSON.stringify(body) }));
}

beforeEach(() => {
  state.profile = { id: "admin", is_admin: true };
  state.configured = true;
  state.billing = true;
  state.batch.mockReset();
  state.acquire.mockReset();
  state.release.mockReset();
  state.acquire.mockImplementation(async (_admin: unknown, token: string) => ({ ok: true, token, waitedMs: 0 }));
  state.release.mockResolvedValue(true);
  state.batch.mockResolvedValue({
    ok: true,
    processed: [{ id: "a", verdict: "rebake" }, { id: "b", verdict: "rebake" }],
    failed: [{ id: ID, error: "art host refused" }],
    superseded: ["c"],
    remaining: 5,
  });
});

describe("POST /api/admin/rebake-marked", () => {
  it("refuses a cross-origin or origin-less request before anything else", async () => {
    expect((await post({}, "https://evil.example")).status).toBe(403);
    expect((await post({}, null)).status).toBe(403);
    expect(state.batch).not.toHaveBeenCalled();
  });

  it("answers 404 to a non-admin", async () => {
    state.profile = { id: "u", is_admin: false };
    expect((await post({})).status).toBe(404);
    state.profile = null;
    expect((await post({})).status).toBe(404);
    expect(state.batch).not.toHaveBeenCalled();
  });

  it("refuses to bake clean when the billing flag is off", async () => {
    state.billing = false;
    const res = await post({});
    expect(res.status).toBe(412);
    expect(state.batch).not.toHaveBeenCalled();
  });

  it("rejects malformed skip ids", async () => {
    expect((await post({ skipIds: ["nope"] })).status).toBe(400);
  });

  it("runs one marked batch of 4 with the skip list and maps the result", async () => {
    const res = await post({ skipIds: [ID] });
    expect(res.status).toBe(200);
    expect(state.batch).toHaveBeenCalledWith(
      { tag: "admin-client" },
      { scope: { kind: "marked" }, limit: 4, dry: false, billingEnabled: true, skipIds: [ID] },
    );
    expect(await res.json()).toEqual({
      ok: true,
      rebaked: 2,
      failed: [{ id: ID, error: "art host refused" }],
      superseded: 1,
      remaining: 5,
    });
  });

  it("refreshes the ISR pages once, when a run finishes having re-baked something", async () => {
    revalidatePath.mockClear();
    await post({});
    expect(revalidatePath).not.toHaveBeenCalled(); // remaining 5
    state.batch.mockResolvedValue({ ok: true, processed: [{ id: "a", verdict: "rebake" }], failed: [], superseded: [], remaining: 0 });
    await post({});
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    revalidatePath.mockClear();
    state.batch.mockResolvedValue({ ok: true, processed: [], failed: [], superseded: [], remaining: 0 });
    await post({});
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("runs each batch under the sweep lease: parked while cards are left, released when done", async () => {
    await post({});
    expect(state.acquire).toHaveBeenCalledTimes(1);
    expect(state.acquire.mock.invocationCallOrder[0]).toBeLessThan(state.batch.mock.invocationCallOrder[0]);
    expect(state.release).toHaveBeenLastCalledWith({ tag: "admin-client" }, state.acquire.mock.calls[0][1], { parkSeconds: 120 });
    state.batch.mockResolvedValue({ ok: true, processed: [], failed: [], superseded: [], remaining: 0 });
    await post({});
    expect(state.release).toHaveBeenLastCalledWith({ tag: "admin-client" }, expect.any(String), {});
  });

  it("answers 503 with the busy message when the automatic re-bake doesn't hand over — nothing baked", async () => {
    state.acquire.mockResolvedValue({ ok: false, holder: "cron", expiresAt: null, waitedMs: 120_000 });
    const res = await post({});
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/automatic re-bake is mid-batch/);
    expect(state.batch).not.toHaveBeenCalled();
  });

  it("passes a batch error through as a 500", async () => {
    state.batch.mockResolvedValue({ ok: false, error: "scan failed" });
    const res = await post({});
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "scan failed" });
  });
});
