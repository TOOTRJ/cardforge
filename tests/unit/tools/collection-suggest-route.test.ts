import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionCard } from "@/lib/tools/collection/card-row";

// ---------------------------------------------------------------------------
// POST /api/tools/collection-builder/suggest — "Suggest a commander" (1
// credit, label suggest_collection_commander): the tool's gate first;
// everything that can refuse refuses BEFORE the charge (too few
// commanders, none in the wanted colours, preferences that don't parse);
// the credit is reserved before the call, SETTLED once the answer is
// delivered, refunded when the call fails.
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({
  access: vi.fn(),
  commanders: vi.fn(),
  cards: vi.fn(),
  rows: vi.fn(),
  spend: vi.fn(),
  settle: vi.fn(),
  refund: vi.fn(),
  suggest: vi.fn(),
  event: vi.fn(),
  keep: vi.fn(),
  start: vi.fn(),
  end: vi.fn(),
  calls: [] as Array<Record<string, unknown>>,
  order: [] as string[],
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/tools/queries", () => ({ checkToolAccess: m.access }));
// The actions record after the response (recordToolEventLater); the same spy
// stands in for both writers.
vi.mock("@/lib/tools/events", () => ({ recordToolEvent: m.event, recordToolEventLater: m.event }));
vi.mock("@/lib/ai/provider", () => ({ isDesignAiConfigured: () => true, designModel: vi.fn() }));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => false }));
vi.mock("@/lib/ai/rate-limit", () => ({
  checkAiRateLimit: vi.fn(async () => ({ ok: true })),
  getFreshCreditBalance: vi.fn(async () => 4),
  logAiCall: vi.fn(),
  refundCredits: m.refund,
  settleSpend: m.settle,
  spendCredits: m.spend,
}));
vi.mock("@/lib/tools/collection/queries", () => ({
  listOwnedCommanders: m.commanders,
  listScoringCards: m.cards,
  listCollectionCardsById: m.rows,
}));
vi.mock("@/lib/tools/collection/ai-suggest", () => ({ suggestCommanders: m.suggest }));
vi.mock("@/lib/tools/collection/ai-results", () => ({
  keepCollectionAiResult: m.keep,
  startCollectionAiResult: m.start,
  endCollectionAiResult: m.end,
  // The real wrapper's contract (held in collection-ai-recovery.test.ts);
  // here it hands each call's bookkeeping to the test.
  withCollectionAiRecord: async (_kind: string, handle: (call: Record<string, unknown>) => Promise<Response>) => {
    const call = { userId: null, requestId: null, charged: false, ended: false };
    m.calls.push(call);
    return handle(call);
  },
}));

import { POST } from "@/app/api/tools/collection-builder/suggest/route";

let seq = 0;
function commander(name: string, colorIdentity: string[] = ["R"], commanderLegal = true): CollectionCard {
  seq += 1;
  return {
    id: `c0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    scryfallId: `s0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    name,
    typeLine: "Legendary Creature — Goblin",
    manaCost: "{2}",
    manaValue: 2,
    colorIdentity,
    oracleText: "",
    rarity: "rare",
    setCode: "tst",
    setName: "Test",
    collectorNumber: String(seq),
    imageUrl: null,
    quantity: 1,
    finish: "nonfoil",
    lang: "en",
    commanderLegal,
    canBeCommander: true,
  };
}

const post = (body: unknown) => POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }));

/** The tool event the route recorded: its name and its props, under the
 *  viewer and the access path the gate handed it. */
const recorded = (event: string, props: Record<string, unknown> = {}) =>
  expect.objectContaining({
    slug: "collection-builder",
    userId: "u1",
    access: "grant",
    event,
    props: expect.objectContaining(props),
  });
const THREE = [commander("A"), commander("B", ["U"]), commander("C", ["G"])];

beforeEach(() => {
  vi.clearAllMocks();
  m.keep.mockReset();
  m.start.mockReset();
  m.end.mockReset();
  m.settle.mockReset();
  m.keep.mockResolvedValue("kept");
  m.start.mockResolvedValue("started");
  m.order.length = 0;
  m.calls.length = 0;
  m.access.mockResolvedValue({ userId: "u1", via: "grant" });
  m.commanders.mockResolvedValue(THREE);
  m.cards.mockResolvedValue([]);
  m.rows.mockResolvedValue([]);
  m.spend.mockResolvedValue({ ok: true, charged: true });
  m.refund.mockResolvedValue(true);
});

describe("refusals before the charge", () => {
  it("a closed tool answers 404 and reads nothing", async () => {
    m.access.mockResolvedValue(null);
    expect((await post({})).status).toBe(404);
    expect(m.commanders).not.toHaveBeenCalled();
    expect(m.spend).not.toHaveBeenCalled();
    // Nobody the tool let in: nothing to record.
    expect(m.event).not.toHaveBeenCalled();
  });

  it("fewer than three legal commanders", async () => {
    m.commanders.mockResolvedValue([commander("A"), commander("B"), commander("Banned", ["R"], false)]);
    const response = await post({});
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("TOO_FEW_COMMANDERS");
    expect(m.spend).not.toHaveBeenCalled();
    expect(m.event).toHaveBeenCalledTimes(1);
    expect(m.event).toHaveBeenCalledWith(recorded("ai_suggest_failed", { reason: "too_few_commanders", commanders: 2 }));
  });

  it("fewer than three in the wanted colours", async () => {
    const response = await post({ colours: ["R"] });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/in those colours/);
    expect(m.spend).not.toHaveBeenCalled();
    expect(m.event).toHaveBeenCalledWith(
      recorded("ai_suggest_failed", { reason: "too_few_in_colours", commanders: 3, shortlist: 1, colour_filter: 1 }),
    );
  });

  it("preferences that don't parse", async () => {
    expect((await post({ deckType: "storm" })).status).toBe(400);
    expect((await post({ bracket: 9 })).status).toBe(400);
    expect(m.spend).not.toHaveBeenCalled();
    expect(m.event.mock.calls.map(([input]) => [input.event, input.props])).toEqual([
      ["ai_suggest_failed", { reason: "invalid" }],
      ["ai_suggest_failed", { reason: "invalid" }],
    ]);
  });

  it("a collection that can't be read", async () => {
    m.cards.mockRejectedValue(new Error("scoring read failed"));
    expect((await post({})).status).toBe(503);
    expect(m.spend).not.toHaveBeenCalled();
    expect(m.event).toHaveBeenCalledWith(recorded("ai_suggest_failed", { reason: "collection_unreadable" }));
  });
});

describe("the charge", () => {
  it("is reserved under its own label, settled once delivered, the key cards' pictures added", async () => {
    m.suggest.mockResolvedValue({
      overview: "Goblins.",
      suggestions: [
        { commanderId: THREE[0].id, name: "A", keyCards: [{ id: "row-1", name: "Goblin" }] },
        { commanderId: THREE[1].id, name: "B", keyCards: [] },
        { commanderId: THREE[2].id, name: "C", keyCards: [] },
      ],
    });
    m.rows.mockResolvedValue([{ id: "row-1", imageUrl: "https://cards.scryfall.io/normal/front/a/b/x.jpg" }]);
    const response = await post({ deckType: "tokens", bracket: 2 });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.suggestions[0].keyCards[0].imageUrl).toMatch(/^https:\/\/cards\.scryfall\.io/);
    const [amount, label, options] = m.spend.mock.calls[0];
    expect(amount).toBe(1);
    expect(label).toBe("suggest_collection_commander");
    expect(options.ref).toMatch(/^spend:collection-suggest:/);
    expect(m.settle).toHaveBeenCalledWith(options.ref);
    expect(m.refund).not.toHaveBeenCalled();
    // The success, once: its counts, what was asked for and the credit charged.
    expect(m.event).toHaveBeenCalledTimes(1);
    expect(m.event).toHaveBeenCalledWith(
      recorded("ai_suggest", { commanders: 3, shortlist: 3, suggested: 3, deck_type: "tokens", bracket: 2, credits: 1, ms: expect.any(Number) }),
    );
    // The shortlist and the preferences reach the call.
    expect(m.suggest.mock.calls[0][0].preferences).toEqual({ deckType: "tokens", bracket: 2 });
  });

  it("the request is on record BEFORE the charge, and its answer is KEPT before the credit is settled — a lost response can't lose it", async () => {
    const REQUEST = "5b0c6c0e-7d0b-4a52-9f3e-0c1d2e3f4a5b";
    m.suggest.mockImplementation(async () => {
      m.order.push("ai");
      return { overview: "Goblins.", suggestions: THREE.map((c, i) => ({ commanderId: c.id, name: `S${i}`, keyCards: [] })) };
    });
    m.spend.mockImplementation(async () => {
      m.order.push("spend");
      return { ok: true, charged: true };
    });
    m.start.mockImplementation(async () => {
      m.order.push("start");
      return "started";
    });
    m.keep.mockImplementation(async () => {
      m.order.push("keep");
      return "kept";
    });
    m.settle.mockImplementation(async () => void m.order.push("settle"));
    const response = await post({ deckType: "tokens", requestId: REQUEST });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(m.order).toEqual(["start", "spend", "ai", "keep", "settle"]);
    expect(m.start).toHaveBeenCalledWith("u1", "suggest", REQUEST);
    // What is kept is what the page is sent.
    expect(m.keep).toHaveBeenCalledWith("u1", "suggest", REQUEST, body.result);
    // The route wrote the row's ending itself.
    expect(m.calls.at(-1)).toEqual({ userId: "u1", requestId: REQUEST, charged: true, ended: true });
    // The id is the page's bookkeeping: it never reaches the AI call.
    expect(m.suggest.mock.calls[0][0].preferences).toEqual({ deckType: "tokens" });
  });

  it("a request that can't be put on record is REFUSED before any charge — one that may be charged always has a row", async () => {
    m.start.mockResolvedValue("failed");
    const response = await post({ requestId: "5b0c6c0e-7d0b-4a52-9f3e-0c1d2e3f4a5b" });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/nothing was charged/);
    expect(m.spend).not.toHaveBeenCalled();
    expect(m.suggest).not.toHaveBeenCalled();
    expect(m.event).toHaveBeenCalledWith(recorded("ai_suggest_failed", { reason: "not_recorded" }));
  });

  it("an answer that could NOT be kept is still delivered, but its credit is left unsettled (the sweep returns it) and its row is not called done", async () => {
    m.suggest.mockResolvedValue({ overview: "x", suggestions: THREE.map((c) => ({ commanderId: c.id, name: "S", keyCards: [] })) });
    m.keep.mockResolvedValue("failed");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await post({ requestId: "5b0c6c0e-7d0b-4a52-9f3e-0c1d2e3f4a5b" });
    expect(response.status).toBe(200);
    expect((await response.json()).result.suggestions).toHaveLength(3);
    expect(m.settle).not.toHaveBeenCalled();
    expect(m.calls.at(-1)).toMatchObject({ charged: true, ended: false });
    expect(m.event).toHaveBeenCalledWith(recorded("ai_suggest", { credits: 0, unsettled: true }));
  });

  it("a page with no request id (or one that is no uuid) is served and settled as before — it just can't be asked about again", async () => {
    m.suggest.mockResolvedValue({ overview: "x", suggestions: THREE.map((c) => ({ commanderId: c.id, name: "S", keyCards: [] })) });
    m.start.mockResolvedValue("skipped");
    m.keep.mockResolvedValue("skipped");
    expect((await post({})).status).toBe(200);
    expect(m.start.mock.calls[0][2]).toBeUndefined();
    expect((await post({ requestId: "not-a-uuid" })).status).toBe(200);
    expect(m.start.mock.calls[1][2]).toBeNull();
    expect(m.settle).toHaveBeenCalledTimes(2);
    expect(m.calls.at(-1)).toMatchObject({ requestId: null });
  });

  it("a refusal before the charge leaves its row to be ended `refused` (charged: false, no ending written)", async () => {
    m.spend.mockResolvedValue({ ok: false, reason: "insufficient_credits", message: "Out of credits.", balance: 0 });
    expect((await post({ requestId: "5b0c6c0e-7d0b-4a52-9f3e-0c1d2e3f4a5b" })).status).toBe(402);
    expect(m.calls.at(-1)).toEqual({ userId: "u1", requestId: "5b0c6c0e-7d0b-4a52-9f3e-0c1d2e3f4a5b", charged: false, ended: false });
    expect(m.keep).not.toHaveBeenCalled();
  });

  it("a failed call is refunded, never settled", async () => {
    const error = new Error("unreadable");
    error.name = "AiOutputError";
    m.suggest.mockRejectedValue(error);
    const response = await post({});
    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe("design_unreadable");
    expect(m.settle).not.toHaveBeenCalled();
    expect(m.keep).not.toHaveBeenCalled();
    // …and the request's row says it failed, so a page that lost this answer is told so.
    expect(m.end).toHaveBeenCalledWith("u1", "suggest", undefined, "failed");
    expect(m.calls.at(-1)).toMatchObject({ charged: true, ended: true });
    const ref = m.spend.mock.calls[0][2].ref;
    expect(m.refund).toHaveBeenCalledWith("u1", 1, "suggest_collection_commander", `refund:${ref}`);
    // The failure, with the AI's own failure kind and the credit back.
    expect(m.event).toHaveBeenCalledTimes(1);
    expect(m.event).toHaveBeenCalledWith(
      recorded("ai_suggest_failed", { reason: "design_unreadable", refunded: true, refund_pending: false, commanders: 3, shortlist: 3 }),
    );
    expect(m.event.mock.calls[0][0].props).not.toHaveProperty("credits");
  });

  it("a refund that didn't land is recorded as pending, never as returned", async () => {
    m.suggest.mockRejectedValue(new Error("provider timeout"));
    m.refund.mockResolvedValue(false);
    expect((await post({})).status).toBe(502);
    expect(m.event).toHaveBeenCalledWith(recorded("ai_suggest_failed", { refunded: false, refund_pending: true }));
  });

  it("nothing charged (an admin, billing off) is recorded as zero credits", async () => {
    m.spend.mockResolvedValue({ ok: true, charged: false });
    m.suggest.mockResolvedValue({ overview: "", suggestions: [] });
    expect((await post({})).status).toBe(200);
    expect(m.event).toHaveBeenCalledWith(recorded("ai_suggest", { credits: 0 }));
  });

  it("out of credits answers 402 and never calls the AI", async () => {
    m.spend.mockResolvedValue({ ok: false, reason: "insufficient_credits", message: "You're out of AI credits.", balance: 0 });
    const response = await post({});
    expect(response.status).toBe(402);
    expect(m.suggest).not.toHaveBeenCalled();
    expect(m.event).toHaveBeenCalledWith(recorded("ai_suggest_failed", { reason: "insufficient_credits" }));
  });

  it("a credit check that failed, and the AI rate limit, are their own reasons", async () => {
    m.spend.mockResolvedValue({ ok: false, reason: "error", message: "Try again.", balance: Number.NaN });
    expect((await post({})).status).toBe(503);
    expect(m.event).toHaveBeenLastCalledWith(recorded("ai_suggest_failed", { reason: "credit_check_failed" }));
    const { checkAiRateLimit } = await import("@/lib/ai/rate-limit");
    vi.mocked(checkAiRateLimit).mockResolvedValueOnce({ ok: false, retryAfterSeconds: 30, message: "Slow down." } as never);
    expect((await post({})).status).toBe(429);
    expect(m.event).toHaveBeenLastCalledWith(recorded("ai_suggest_failed", { reason: "rate_limited" }));
    expect(m.suggest).not.toHaveBeenCalled();
  });
});
