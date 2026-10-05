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
  /** Remixable entries that are double-faced (two credits each, TODO 5.4). */
  doubleFaced: 0,
  /** The AI rate limit's answer. */
  rate: { ok: true } as Record<string, unknown>,
  /** How often the deck remix's estimate (its Scryfall work) ran. */
  estimateCalls: 0,
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
  checkAiRateLimit: async () => s.rate,
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
// The deck remix's estimate (TODO 5.4): `remixable` entries, `doubleFaced`
// of them priced at two credits (both faces painted).
vi.mock("@/lib/ai/remix-estimate", () => ({
  estimateDeckRemix: async () => {
    s.estimateCalls += 1;
    return {
      cards: s.remixable,
      credits: s.remixable + s.doubleFaced,
      doubleFaced: s.doubleFaced,
      skipped: 0,
      unresolved: 0,
      creditsByEntry: Object.fromEntries(
        Array.from({ length: s.remixable }, (_, i) => [`entry-${i}`, i < s.doubleFaced ? 2 : 1]),
      ),
    };
  },
}));
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
  s.doubleFaced = 0;
  s.rate = { ok: true };
  s.estimateCalls = 0;
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

  it("a rate-limited caller is refused BEFORE the deck remix's estimate does its Scryfall work", async () => {
    s.rate = { ok: false, reason: "per_minute", retryAfterSeconds: 30, message: "Slow down." };
    const { status } = await post({ kind: "deck_remix", deck_id: DECK_ID, style: "ink" });
    expect(status).toBe(429);
    expect(s.estimateCalls).toBe(0);
    expect(s.created).toHaveLength(0);
  });

  // TODO 5.4 (owner Q4): a deck remix's double-faced entries cost TWO
  // credits — the estimate prices them, the pre-check needs them, and the
  // plan's per-entry credits reach the job so each step reserves its own.
  it("prices a deck remix's double-faced entries at two credits before anything is spent", async () => {
    s.remixable = 3;
    s.doubleFaced = 2;
    s.credits = 4;
    const short = await post({ kind: "deck_remix", deck_id: DECK_ID, style: "ink" });
    expect(short.status).toBe(402);
    expect(short.json).toMatchObject({ code: "INSUFFICIENT_CREDITS", needed: 5, balance: 4 });
    expect(String(short.json.error)).toMatch(/3 cards, 2 of them double-faced at 2 credits/);
    expect(s.created).toHaveLength(0);

    s.credits = 5;
    const ok = await post({ kind: "deck_remix", deck_id: DECK_ID, style: "ink" });
    expect(ok.status).toBe(200);
    expect(s.created).toEqual([
      expect.objectContaining({
        kind: "deck_remix",
        input: expect.objectContaining({ creditsByEntry: { "entry-0": 2, "entry-1": 2, "entry-2": 1 } }),
      }),
    ]);
  });

  it("rejects a malformed body and an unknown kind", async () => {
    expect((await post({ kind: "sets", theme: "x" })).status).toBe(400);
    const res = await POST(new Request("http://x/api/ai/jobs", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
  });
});

// TODO 6.23: a per-field fill on an open emblem pins the card's own type
// (`locked`), while the design types the dialogs offer stay the nine
// standard ones (emblems are kept out until asked).
describe("POST /api/ai/jobs — an emblem's per-field fill", () => {
  it("accepts an emblem as the locked card type, and never as a design type", async () => {
    const locked = await post({ kind: "card_fill", want: ["art"], locked: { card_type: "emblem", title: "Kaito" } });
    expect(locked.status).toBe(200);
    expect(s.created.at(-1)?.kind).toBe("card_fill");
    const steered = await post({ kind: "card_fill", want: ["card_type"], steer: { card_type: "emblem" } });
    expect(steered.status).toBe(400);
    const designed = await post({ kind: "card", card_type: "emblem" });
    expect(designed.status).toBe(400);
  });
});
