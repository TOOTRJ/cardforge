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
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/tools/queries", () => ({ checkToolAccess: m.access }));
vi.mock("@/lib/tools/events", () => ({ recordToolEvent: m.event }));
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
const THREE = [commander("A"), commander("B", ["U"]), commander("C", ["G"])];

beforeEach(() => {
  vi.clearAllMocks();
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
  });

  it("fewer than three legal commanders", async () => {
    m.commanders.mockResolvedValue([commander("A"), commander("B"), commander("Banned", ["R"], false)]);
    const response = await post({});
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("TOO_FEW_COMMANDERS");
    expect(m.spend).not.toHaveBeenCalled();
  });

  it("fewer than three in the wanted colours", async () => {
    const response = await post({ colours: ["R"] });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/in those colours/);
    expect(m.spend).not.toHaveBeenCalled();
  });

  it("preferences that don't parse", async () => {
    expect((await post({ deckType: "storm" })).status).toBe(400);
    expect((await post({ bracket: 9 })).status).toBe(400);
    expect(m.spend).not.toHaveBeenCalled();
  });

  it("a collection that can't be read", async () => {
    m.cards.mockRejectedValue(new Error("scoring read failed"));
    expect((await post({})).status).toBe(503);
    expect(m.spend).not.toHaveBeenCalled();
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
    expect(m.event).toHaveBeenCalledWith(expect.objectContaining({ event: "ai_suggest" }));
    // The shortlist and the preferences reach the call.
    expect(m.suggest.mock.calls[0][0].preferences).toEqual({ deckType: "tokens", bracket: 2 });
  });

  it("a failed call is refunded, never settled", async () => {
    const error = new Error("unreadable");
    error.name = "AiOutputError";
    m.suggest.mockRejectedValue(error);
    const response = await post({});
    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe("design_unreadable");
    expect(m.settle).not.toHaveBeenCalled();
    const ref = m.spend.mock.calls[0][2].ref;
    expect(m.refund).toHaveBeenCalledWith("u1", 1, "suggest_collection_commander", `refund:${ref}`);
  });

  it("out of credits answers 402 and never calls the AI", async () => {
    m.spend.mockResolvedValue({ ok: false, reason: "insufficient_credits", message: "You're out of AI credits.", balance: 0 });
    const response = await post({});
    expect(response.status).toBe(402);
    expect(m.suggest).not.toHaveBeenCalled();
  });
});
