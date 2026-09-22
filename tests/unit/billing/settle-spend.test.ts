import { readdirSync, readFileSync } from "node:fs";
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

  it("backfills the sync-route ref prefixes that existed before it", () => {
    // Charges minted before 0106 had no settlement proof; the backfill
    // settles the never-refunded ones so the first sweep doesn't hand them
    // back. Prefixes introduced later start settled by their own route.
    for (const prefix of ["ideas", "deckideas"]) {
      expect(MIGRATION).toContain(`like 'spend:${prefix}:%'`);
    }
  });
});

// ---------------------------------------------------------------------------
// Every sync route that charges a credit outside a job step mints
// "spend:<prefix>:{uuid}" and MUST settle it once its work is delivered —
// otherwise the sweep refunds the charge a day later (the deck-guide route
// shipped without it and made "Analyze this deck" free). This walks app/ and
// lib/ so a new charged route can't forget.
// ---------------------------------------------------------------------------

const SYNC_REF = /`spend:([a-z]+):\$\{(?:crypto\.)?randomUUID\(\)\}`/g;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

const syncCharges = ["app", "lib"]
  .flatMap((dir) => walk(join(process.cwd(), dir)))
  .map((file) => ({
    file: file.slice(process.cwd().length + 1),
    source: readFileSync(file, "utf8"),
  }))
  .map((entry) => ({
    ...entry,
    prefixes: [...entry.source.matchAll(SYNC_REF)].map((m) => m[1]),
  }))
  .filter((entry) => entry.prefixes.length > 0);

describe("sync credit charges", () => {
  it("finds the known charged routes", () => {
    const files = syncCharges.map((c) => c.file).sort();
    expect(files).toEqual([
      "app/api/ai/card-ideas/route.ts",
      "app/api/ai/deck-ideas/route.ts",
      "app/api/decks/[id]/guide/route.ts",
    ]);
  });

  it("every charged route settles its ref once the work is delivered", () => {
    for (const charge of syncCharges) {
      expect(charge.source, `${charge.file} mints ${charge.prefixes.join(", ")}`).toContain(
        "await settleSpend(ref)",
      );
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
