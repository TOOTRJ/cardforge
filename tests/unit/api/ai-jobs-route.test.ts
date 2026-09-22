import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// POST /api/ai/jobs pre-flight — the checks that decide whether a paid job
// starts at all: batch size defaults (never the 100-card ceiling by
// omission), the saved-card cap (403 CARD_CAPACITY with the numbers), the
// credit balance (402 INSUFFICIENT_CREDITS), the one Pro gate (deck-aware
// card design), and the deck-remix refusal for an empty/foreign deck.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  tier: "free" as "free" | "plus" | "pro",
  credits: 10,
  capacity: { used: 0, cap: 50, tier: "free" } as { used: number; cap: number; tier: "free" | "plus" | "pro" } | null,
  remixable: 5,
  created: [] as Array<{ kind: string; input: Record<string, unknown> }>,
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: "user-1" }),
  getCurrentProfile: async () => ({ is_admin: false }),
}));
vi.mock("@/lib/ai/provider", () => ({ isDesignAiConfigured: () => true }));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => true }));
vi.mock("@/lib/ai/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/rate-limit")>()),
  checkAiRateLimit: async () => ({ ok: true }),
  checkRandomCardDailyLimit: async () => ({ ok: true }),
  checkDailyActionLimit: async () => ({ ok: true }),
  getFreshCreditBalance: async () => s.credits,
}));
vi.mock("@/lib/billing/entitlements", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/entitlements")>();
  const RANK = { free: 0, plus: 1, pro: 2 };
  return {
    ...actual,
    getEntitlements: async () => ({ credits: s.credits, effectiveTier: s.tier, isPaid: s.tier !== "free" }),
    requireTier: async (min: "free" | "plus" | "pro") => {
      if (RANK[s.tier] < RANK[min]) throw new actual.UpgradeRequiredError(min);
      return { credits: s.credits, effectiveTier: s.tier };
    },
  };
});
vi.mock("@/lib/cards/capacity", () => ({ getCardCapacity: async () => s.capacity }));
vi.mock("@/lib/decks/queries", () => ({ countRemixableDeckCards: async () => s.remixable }));
vi.mock("@/lib/ai/generation-jobs", () => {
  const record = (kind: string) => async (input: Record<string, unknown>) => {
    s.created.push({ kind, input });
    return { ok: true, job: { id: `job-${kind}`, steps: [] }, deckSlug: "deck-slug" };
  };
  return {
    createCardGenerationJob: record("card"),
    createCardFillJob: record("card_fill"),
    createDeckGenerationJob: record("deck"),
    createDeckRemixJob: record("deck_remix"),
  };
});

import { POST } from "@/app/api/ai/jobs/route";

const DECK_ID = "11111111-1111-4111-8111-111111111111";
const post = async (body: unknown) => {
  const res = await POST(
    new Request("http://x/api/ai/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => {
  s.tier = "free";
  s.credits = 10;
  s.capacity = { used: 0, cap: 50, tier: "free" };
  s.remixable = 5;
  s.created = [];
});

describe("POST /api/ai/jobs", () => {
  it("defaults a deck without a size to the 3-card batch, never the 100-card ceiling", async () => {
    const { status } = await post({ kind: "deck", theme: "goblins", format: "commander" });
    expect(status).toBe(200);
    expect(s.created).toEqual([expect.objectContaining({ kind: "deck", input: expect.objectContaining({ size: 3 }) })]);
  });

  it("refuses an over-cap batch up front with 403 CARD_CAPACITY and the numbers", async () => {
    s.capacity = { used: 48, cap: 50, tier: "free" };
    const { status, json } = await post({ kind: "deck", theme: "x", format: "commander", size: 5 });
    expect(status).toBe(403);
    expect(json.code).toBe("CARD_CAPACITY");
    expect(String(json.error)).toContain("2 slots left");
    expect(s.created).toHaveLength(0);
  });

  it("answers 402 INSUFFICIENT_CREDITS before spending a plan call", async () => {
    s.credits = 1;
    const { status, json } = await post({ kind: "deck", theme: "x", format: "commander", size: 3 });
    expect(status).toBe(402);
    expect(json).toMatchObject({ code: "INSUFFICIENT_CREDITS", needed: 3, balance: 1 });
    expect(s.created).toHaveLength(0);
  });

  it("gates deck-aware card design behind Pro — the only tier gate on this route", async () => {
    const free = await post({ kind: "card", theme: "x", deck_id: DECK_ID });
    expect(free.status).toBe(403);
    expect(free.json.code).toBe("UPGRADE_REQUIRED");
    s.tier = "pro";
    const pro = await post({ kind: "card", theme: "x", deck_id: DECK_ID });
    expect(pro.status).toBe(200);
    expect(s.created.map((c) => c.kind)).toEqual(["card"]);
    // A card WITHOUT a deck needs no tier at all.
    s.tier = "free";
    expect((await post({ kind: "card", theme: "x" })).status).toBe(200);
  });

  it("refuses a deck remix with nothing to remix (or a deck that isn't the caller's) with a 400", async () => {
    s.remixable = 0;
    const { status, json } = await post({ kind: "deck_remix", deck_id: DECK_ID, style: "ink" });
    expect(status).toBe(400);
    expect(String(json.error)).toMatch(/no cards to remix/);
    s.remixable = 5;
    expect((await post({ kind: "deck_remix", deck_id: DECK_ID, style: "ink" })).status).toBe(200);
  });

  it("rejects a malformed body and an unknown kind", async () => {
    expect((await post({ kind: "sets", theme: "x" })).status).toBe(400);
    const res = await POST(new Request("http://x/api/ai/jobs", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
  });
});
