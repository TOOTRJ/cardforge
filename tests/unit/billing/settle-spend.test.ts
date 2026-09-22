import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Credit settlement (migration 0106): the ledger row records whether a charge
// earned its keep. Two things must stay true or the reconcile-credits sweep
// starts refunding legitimate charges (or stops refunding orphaned ones):
//   * the database side — settle_spend is service-role only, patch_job_step
//     settles a `done` patch's spend_ref, and the backfill covers every
//     sync-route ref prefix the app actually charges under;
//   * the app side — settleSpend() calls the RPC with the exact ref and never
//     throws into the request that already delivered its work.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const MIGRATION = read("supabase/migrations/0106_settle_spend.sql");

describe("migration 0106", () => {
  it("states its grants: settle_spend is executable by service_role only", () => {
    expect(MIGRATION).toContain(
      "revoke all on function public.settle_spend(text) from public, anon, authenticated;",
    );
    expect(MIGRATION).toContain(
      "grant execute on function public.settle_spend(text) to service_role;",
    );
    expect(MIGRATION).toContain(
      "revoke all on function public.patch_job_step(uuid, text, jsonb) from public, anon, authenticated;",
    );
  });

  it("settles a done step's spend_ref inside patch_job_step (same transaction as the step write)", () => {
    expect(MIGRATION).toContain("v_spend_ref text := nullif(p_patch->>'spend_ref', '')");
    expect(MIGRATION).toContain("if p_patch->>'status' = 'done' and v_spend_ref is not null then");
    expect(MIGRATION).toContain("if not public.settle_spend(v_spend_ref) then");
  });

  it("keeps the first stamp on a repeat settle (idempotent)", () => {
    expect(MIGRATION).toContain("set settled_at = coalesce(settled_at, now())");
  });

  it("backfills every sync-route ref prefix the app charges under", () => {
    // Each credited sync route mints "spend:<prefix>:{uuid}"; a prefix the
    // backfill doesn't know would have its historical charges refunded by
    // the first sweep. Job-step refs (spend:{jobId}:…) are covered by (a).
    const routes = ["app/api/ai/card-ideas/route.ts", "app/api/ai/deck-ideas/route.ts"];
    for (const route of routes) {
      const source = read(route);
      const match = source.match(/`spend:([a-z]+):\$\{randomUUID\(\)\}`/);
      expect(match, `${route} charges under a spend:<prefix>: ref`).not.toBeNull();
      expect(MIGRATION).toContain(`like 'spend:${match![1]}:%'`);
      // …and settles it once the work is delivered.
      expect(source).toContain("await settleSpend(ref);");
    }
  });
});

// ---------------------------------------------------------------------------
// settleSpend() — the sync-route half of the contract.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  billing: true,
  configured: true,
  answer: { data: true as boolean | null, error: null as { message: string } | null },
  throws: false,
  rpc: [] as Array<{ fn: string; args: unknown }>,
}));

vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => s.billing }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  getCurrentProfile: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => s.configured,
  createAdminClient: () => ({
    rpc: async (fn: string, args: unknown) => {
      s.rpc.push({ fn, args });
      if (s.throws) throw new Error("socket closed");
      return s.answer;
    },
  }),
}));

import { settleSpend } from "@/lib/ai/rate-limit";

describe("settleSpend", () => {
  beforeEach(() => {
    s.billing = true;
    s.configured = true;
    s.answer = { data: true, error: null };
    s.throws = false;
    s.rpc = [];
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("stamps the exact ref through the service-role settle_spend RPC", async () => {
    await settleSpend("spend:ideas:abc");

    expect(s.rpc).toEqual([{ fn: "settle_spend", args: { p_ref: "spend:ideas:abc" } }]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("does nothing when billing is off (nothing was charged)", async () => {
    s.billing = false;

    await settleSpend("spend:ideas:abc");

    expect(s.rpc).toHaveLength(0);
  });

  it("logs loudly, never throws, when the RPC errors or finds no spend", async () => {
    s.answer = { data: null, error: { message: "permission denied" } };
    await expect(settleSpend("spend:ideas:abc")).resolves.toBeUndefined();

    s.answer = { data: false, error: null };
    await expect(settleSpend("spend:ideas:missing")).resolves.toBeUndefined();

    s.throws = true;
    await expect(settleSpend("spend:ideas:abc")).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledTimes(3);
  });

  it("logs instead of calling anything when the admin client is not configured", async () => {
    s.configured = false;

    await settleSpend("spend:ideas:abc");

    expect(s.rpc).toHaveLength(0);
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});
