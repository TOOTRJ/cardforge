import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// GET /api/cron/auto-rebake — the Vercel cron entry for the automatic
// re-bake. Contract: cronRouteGuard first (401 without the bearer, 503
// without the service role), the deployment's billing flag passed through
// (the loop refuses → 412, never a clean bake), errors → 500, the loop's
// outcome as the body.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  configured: true,
  billing: true,
  run: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ tag: "admin-client" }),
  isAdminConfigured: () => state.configured,
}));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => state.billing }));
vi.mock("@/lib/cards/auto-rebake", () => ({ runAutoRebake: state.run }));

import { GET, maxDuration } from "@/app/api/cron/auto-rebake/route";

const get = (auth?: string) =>
  GET(new Request("https://www.pipglyph.com/api/cron/auto-rebake", { headers: auth ? { authorization: auth } : {} }));

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "s3cret");
  state.configured = true;
  state.billing = true;
  state.run.mockReset();
  state.run.mockResolvedValue({ ok: true, outcome: "idle", pending: 0 });
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/cron/auto-rebake", () => {
  it("answers 401 without the cron bearer and 503 without the service role — before any work", async () => {
    expect((await get()).status).toBe(401);
    expect((await get("Bearer wrong")).status).toBe(401);
    state.configured = false;
    expect((await get("Bearer s3cret")).status).toBe(503);
    expect(state.run).not.toHaveBeenCalled();
  });

  it("runs the loop with the deployment's billing flag and returns its outcome", async () => {
    const res = await get("Bearer s3cret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: "idle", pending: 0 });
    expect(state.run).toHaveBeenCalledWith({ tag: "admin-client" }, { billingEnabled: true });
  });

  it("answers 412 when the loop refuses to bake without the billing flag", async () => {
    state.billing = false;
    state.run.mockResolvedValue({ ok: false, outcome: "refused", error: "Refusing to bake" });
    const res = await get("Bearer s3cret");
    expect(res.status).toBe(412);
    expect(state.run).toHaveBeenCalledWith({ tag: "admin-client" }, { billingEnabled: false });
  });

  it("answers 500 on a loop error", async () => {
    state.run.mockResolvedValue({ ok: false, outcome: "error", error: "state read failed" });
    expect((await get("Bearer s3cret")).status).toBe(500);
  });

  it("has room for the 240 s budget plus the hard stop", () => {
    expect(maxDuration).toBe(300);
  });
});
