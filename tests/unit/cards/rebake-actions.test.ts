import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// rebakeMarkedRendersAction — the compare page's "Re-bake now" (TODO 0.20).
// Contract: admin session gate (not the cron secret), the same billing gate
// as the cron route (a server without NEXT_PUBLIC_BILLING_ENABLED would
// bake clean), scope "marked" in small batches, skipIds forwarded and
// validated.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  profile: { id: "admin", is_admin: true } as null | { id: string; is_admin: boolean },
  configured: true,
  billing: true,
  batch: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: async () => state.profile }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ tag: "admin-client" }),
  isAdminConfigured: () => state.configured,
}));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => state.billing }));
vi.mock("@/lib/cards/rebake-batch", () => ({ runRebakeBatch: state.batch }));

import { rebakeMarkedRendersAction } from "@/lib/cards/rebake-actions";

const ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  state.profile = { id: "admin", is_admin: true };
  state.configured = true;
  state.billing = true;
  state.batch.mockReset();
  state.batch.mockResolvedValue({
    ok: true,
    processed: [{ id: "a", verdict: "rebake" }, { id: "b", verdict: "rebake" }],
    failed: [{ id: ID, error: "art host refused" }],
    remaining: 5,
  });
  vi.unstubAllEnvs();
});

describe("rebakeMarkedRendersAction", () => {
  it("refuses a non-admin before touching anything", async () => {
    state.profile = { id: "u", is_admin: false };
    expect(await rebakeMarkedRendersAction()).toEqual({ ok: false, error: "Not authorized." });
    state.profile = null;
    expect(await rebakeMarkedRendersAction()).toEqual({ ok: false, error: "Not authorized." });
    expect(state.batch).not.toHaveBeenCalled();
  });

  it("refuses to bake clean when the billing flag is off", async () => {
    state.billing = false;
    const result = await rebakeMarkedRendersAction();
    expect(result.ok).toBe(false);
    expect(state.batch).not.toHaveBeenCalled();
  });

  it("runs one small marked batch with the skip list and maps the result", async () => {
    const result = await rebakeMarkedRendersAction({ skipIds: [ID] });
    expect(state.batch).toHaveBeenCalledWith(
      { tag: "admin-client" },
      { scope: { kind: "marked" }, limit: 4, dry: false, billingEnabled: true, skipIds: [ID] },
    );
    expect(result).toEqual({ ok: true, rebaked: 2, failed: [{ id: ID, error: "art host refused" }], remaining: 5 });
  });

  it("rejects malformed skip ids", async () => {
    expect(await rebakeMarkedRendersAction({ skipIds: ["not-a-uuid"] })).toEqual({ ok: false, error: "Invalid request." });
  });

  it("passes a batch error through", async () => {
    state.batch.mockResolvedValue({ ok: false, error: "scan failed" });
    expect(await rebakeMarkedRendersAction()).toEqual({ ok: false, error: "scan failed" });
  });
});
