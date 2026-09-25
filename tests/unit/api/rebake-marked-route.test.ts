import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// POST /api/admin/rebake-marked — the compare page's "Re-bake now" loop
// (TODO 0.20). Contract: same-origin only, admin session (404 otherwise),
// the billing gate (never bake clean), scope "marked" in batches of 4 with
// the skip list, and a compact result the client loop understands.
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

  it("passes a batch error through as a 500", async () => {
    state.batch.mockResolvedValue({ ok: false, error: "scan failed" });
    const res = await post({});
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "scan failed" });
  });
});
