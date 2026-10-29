import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// AI deck building is paused (owner 2026-10-28, TODO DK1,
// lib/ai/deck-ai-pause.ts). Greying the deck pages is cosmetic without the
// server, so the two sync deck AI routes refuse a NEW request too:
//   POST /api/ai/deck-ideas       — theme ideas, 1 credit
//   POST /api/decks/[id]/guide    — a new or refreshed deck guide, Pro, 1 credit
// with 403 DECK_AI_PAUSED, BEFORE the rate limit, the tier check, any charge
// and any AI call. (The jobs route and the remix estimate have their cases
// in ai-jobs-route.test.ts and remix-estimate-route.test.ts.) The pause is
// mocked here — on and off — so the routes are held whichever way the
// constant is set.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  paused: true,
  user: { id: "user-1" } as { id: string } | null,
  rate: vi.fn(),
  spend: vi.fn(),
  refund: vi.fn(),
  settle: vi.fn(),
  ideas: vi.fn(),
  guide: vi.fn(),
  requireTier: vi.fn(),
}));

vi.mock("@/lib/ai/deck-ai-pause", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/deck-ai-pause")>()),
  isDeckAiPaused: () => s.paused,
}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => s.user,
  createClient: async () => ({
    from: () => ({
      insert: async () => ({ error: null }),
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "deck-1", owner_id: "user-1" } }) }) }),
    }),
  }),
}));
vi.mock("@/lib/ai/provider", () => ({ isDesignAiConfigured: () => true }));
vi.mock("@/lib/ai/rate-limit", () => ({
  checkAiRateLimit: s.rate,
  getFreshCreditBalance: async () => 4,
  logAiCall: async () => undefined,
  spendCredits: s.spend,
  refundCredits: s.refund,
  settleSpend: s.settle,
}));
vi.mock("@/lib/billing/entitlements", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/entitlements")>()),
  requireTier: s.requireTier,
}));
vi.mock("@/lib/ai/deck-ideas", () => ({ generateDeckIdeas: s.ideas }));
vi.mock("@/lib/decks/guides", () => ({ buildAndStoreDeckGuide: s.guide }));

import { POST as postIdeas } from "@/app/api/ai/deck-ideas/route";
import { POST as postGuide } from "@/app/api/decks/[id]/guide/route";

const PAUSED_BODY = {
  ok: false,
  code: "DECK_AI_PAUSED",
  error: "AI deck building is paused while we rebuild decks. It's coming back soon. No credits were used.",
};

const ideas = async () => {
  const res = await postIdeas(
    new Request("http://x/api/ai/deck-ideas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format: "commander", hint: "goblins" }),
    }),
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

const guide = async () => {
  const res = await postGuide(new Request("http://x/api/decks/deck-1/guide", { method: "POST" }), {
    params: Promise.resolve({ id: "deck-1" }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

/** Nothing that limits, charges or calls the AI was reached. */
const nothingRan = () => {
  expect(s.rate).not.toHaveBeenCalled();
  expect(s.requireTier).not.toHaveBeenCalled();
  expect(s.spend).not.toHaveBeenCalled();
  expect(s.ideas).not.toHaveBeenCalled();
  expect(s.guide).not.toHaveBeenCalled();
};

beforeEach(() => {
  s.paused = true;
  s.user = { id: "user-1" };
  s.rate.mockReset().mockResolvedValue({ ok: true });
  s.spend.mockReset().mockResolvedValue({ ok: true, balance: 4, charged: true });
  s.refund.mockReset().mockResolvedValue(true);
  s.settle.mockReset().mockResolvedValue(undefined);
  s.ideas.mockReset().mockResolvedValue([{ title: "Goblin Grin", theme: "goblins", style: "ink", pitch: "Go wide." }]);
  s.guide.mockReset().mockResolvedValue({ ok: true, guide: { overview: "Swing." } });
  s.requireTier.mockReset().mockResolvedValue({ credits: 4, effectiveTier: "pro" });
});

describe("the sync deck AI routes while AI deck building is paused", () => {
  it("POST /api/ai/deck-ideas answers 403 DECK_AI_PAUSED before any limit, charge or AI call", async () => {
    const { status, json } = await ideas();
    expect(status).toBe(403);
    expect(json).toEqual(PAUSED_BODY);
    nothingRan();
  });

  it("POST /api/decks/[id]/guide answers 403 DECK_AI_PAUSED before the Pro check, any charge or AI call (D4)", async () => {
    const { status, json } = await guide();
    expect(status).toBe(403);
    expect(json).toEqual(PAUSED_BODY);
    nothingRan();
  });

  it("signed out is still the sign-in answer", async () => {
    s.user = null;
    expect((await ideas()).status).toBe(401);
    expect((await guide()).status).toBe(401);
    nothingRan();
  });
});

describe("the same routes with the pause lifted (the one constant flipped)", () => {
  beforeEach(() => {
    s.paused = false;
  });

  it("deck ideas are charged, designed and settled as before", async () => {
    const { status, json } = await ideas();
    expect(status).toBe(200);
    expect(json).toMatchObject({ ok: true, ideas: [{ title: "Goblin Grin" }] });
    expect(s.spend).toHaveBeenCalledTimes(1);
    expect(s.settle).toHaveBeenCalledTimes(1);
  });

  it("a deck guide is tier-checked, charged, written and settled as before", async () => {
    const { status } = await guide();
    expect(status).toBe(200);
    expect(s.requireTier).toHaveBeenCalledWith("pro");
    expect(s.guide).toHaveBeenCalledWith("deck-1", "analysis");
    expect(s.settle).toHaveBeenCalledTimes(1);
  });
});

describe("lib/ai/deck-ai-pause.ts", () => {
  it("the routes' answer: one code, the shared sentence, and no credit taken", async () => {
    const actual = await vi.importActual<typeof import("@/lib/ai/deck-ai-pause")>("@/lib/ai/deck-ai-pause");
    expect(actual.deckAiPausedBody()).toEqual(PAUSED_BODY);
    expect(actual.DECK_AI_PAUSED_STATUS).toBe(403);
    expect(actual.isDeckAiPaused()).toBe(actual.DECK_AI_PAUSED);
  });
});
