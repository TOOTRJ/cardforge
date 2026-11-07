import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionCard } from "@/lib/tools/collection/card-row";

// ---------------------------------------------------------------------------
// The Collection Deck Builder's server actions and AI route
// (lib/tools/collection/actions.ts, app/api/tools/collection-builder/
// ai-build/route.ts): the tool's gate comes FIRST — closed, every one
// refuses before any read, write, Scryfall call or charge — and a draft is
// saved only through the deck writers, checked again on the server.
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({
  access: vi.fn(),
  createClient: vi.fn(),
  createDeck: vi.fn(),
  commit: vi.fn(),
  rowsById: vi.fn(),
  oneRow: vi.fn(),
  pool: vi.fn(),
  event: vi.fn(),
  scryfallRate: vi.fn(),
  spend: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tools/queries", () => ({ checkToolAccess: m.access }));
vi.mock("@/lib/tools/events", () => ({ recordToolEvent: m.event }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.createClient, getCurrentUser: vi.fn() }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/decks/actions", () => ({ createDeckAction: m.createDeck }));
vi.mock("@/lib/decks/import-commit", () => ({ commitImportLines: m.commit }));
vi.mock("@/lib/scryfall/client", () => ({ getCardById: vi.fn(), getCardCollection: vi.fn(), SCRYFALL_COLLECTION_MAX: 75 }));
vi.mock("@/lib/scryfall/rate-limit", () => ({ checkScryfallRateLimit: m.scryfallRate, logScryfallCall: vi.fn() }));
vi.mock("@/lib/tools/collection/queries", () => ({
  getCollectionCard: m.oneRow,
  listBuilderPool: m.pool,
  listCollectionCardsById: m.rowsById,
}));
vi.mock("@/lib/ai/provider", () => ({ isDesignAiConfigured: () => true, designModel: vi.fn() }));
vi.mock("@/lib/ai/rate-limit", () => ({
  checkAiRateLimit: vi.fn(async () => ({ ok: true })),
  getFreshCreditBalance: vi.fn(async () => 5),
  logAiCall: vi.fn(),
  refundCredits: vi.fn(),
  settleSpend: vi.fn(),
  spendCredits: m.spend,
}));

import * as actions from "@/lib/tools/collection/actions";
import { POST } from "@/app/api/tools/collection-builder/ai-build/route";

const UUID = "11111111-1111-4111-8111-111111111111";
const ACCESS = { userId: "u1", via: "grant" };

let seq = 0;
function row(over: Partial<CollectionCard> & { name: string }): CollectionCard {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    scryfallId: `20000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    typeLine: "Creature — Goblin",
    manaCost: "{R}",
    manaValue: 1,
    colorIdentity: ["R"],
    oracleText: "",
    rarity: "common",
    setCode: "tst",
    setName: "Test",
    collectorNumber: "1",
    imageUrl: null,
    quantity: 1,
    finish: "nonfoil",
    lang: "en",
    commanderLegal: true,
    canBeCommander: false,
    ...over,
  };
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
});

describe("closed tool: every action refuses before touching anything", () => {
  const calls: Array<[string, () => Promise<{ ok: boolean } | { open: boolean }>]> = [
    ["import chunk", () => actions.importCollectionChunkAction({ batchId: UUID, mode: "add", lines: [] })],
    ["finish import", () => actions.finishCollectionImportAction({ batchId: UUID, mode: "replace", format: "csv", lines: 0, matched: 0, unmatched: 0 })],
    ["add card", () => actions.addToCollectionAction({ scryfallId: UUID })],
    ["printing state", () => actions.getCollectionPrintingStateAction(UUID)],
    ["quantity", () => actions.updateCollectionQuantityAction({ id: UUID, quantity: 2 })],
    ["remove", () => actions.removeCollectionCardAction({ id: UUID })],
    ["clear", () => actions.clearCollectionAction({ confirm: "clear" })],
    ["draft", () => actions.draftCollectionDeckAction({ commanderId: UUID })],
    ["save deck", () => actions.saveCollectionDeckAction({ commanderId: UUID, cardIds: [], basics: [], title: "x", visibility: "private" })],
  ];
  for (const [name, call] of calls) {
    it(name, async () => {
      m.access.mockResolvedValue(null);
      const result = await call();
      if ("open" in result) expect(result).toEqual({ open: false });
      else expect(result).toEqual({ ok: false, error: "The Collection Deck Builder isn't open to you." });
      expect(m.createClient).not.toHaveBeenCalled();
      expect(m.scryfallRate).not.toHaveBeenCalled();
      expect(m.createDeck).not.toHaveBeenCalled();
      expect(m.event).not.toHaveBeenCalled();
    });
  }

  it("the AI route answers 404 and charges nothing", async () => {
    m.access.mockResolvedValue(null);
    const response = await POST(new Request("http://x/api", { method: "POST", body: JSON.stringify({ commanderId: UUID }) }));
    expect(response.status).toBe(404);
    expect(m.spend).not.toHaveBeenCalled();
  });
});

describe("the AI route refuses before the charge", () => {
  it("a pool too small for the AI to choose from", async () => {
    m.access.mockResolvedValue(ACCESS);
    const commander = row({ name: "Krenko", typeLine: "Legendary Creature — Goblin", canBeCommander: true });
    m.oneRow.mockResolvedValue(commander);
    m.pool.mockResolvedValue({ cards: [row({ name: "Only One" })], truncated: false });
    const response = await POST(new Request("http://x/api", { method: "POST", body: JSON.stringify({ commanderId: commander.id }) }));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("POOL_TOO_SMALL");
    expect(m.spend).not.toHaveBeenCalled();
  });

  it("a card that can't lead", async () => {
    m.access.mockResolvedValue(ACCESS);
    m.oneRow.mockResolvedValue(row({ name: "Grunt" }));
    const response = await POST(new Request("http://x/api", { method: "POST", body: JSON.stringify({ commanderId: UUID }) }));
    expect(response.status).toBe(400);
    expect(m.spend).not.toHaveBeenCalled();
  });
});

describe("saving a draft", () => {
  const commander = row({ name: "Krenko, Mob Boss", typeLine: "Legendary Creature — Goblin Warrior", canBeCommander: true });

  beforeEach(() => {
    m.access.mockResolvedValue(ACCESS);
  });

  const save = (cardIds: string[], basics: Array<{ name: string; count: number }> = []) =>
    actions.saveCollectionDeckAction({ commanderId: commander.id, cardIds, basics, title: "Goblins", visibility: "public" });

  it("goes through createDeckAction and the decklist commit, the commander on its board", async () => {
    const goblin = row({ name: "Goblin Guide" });
    m.rowsById.mockResolvedValue([commander, goblin]);
    m.createDeck.mockResolvedValue({ ok: true, deckId: "d1", slug: "goblins" });
    m.commit.mockResolvedValue({ ok: true, added: 3, merged: 0, placeholders: 0 });
    const result = await save([goblin.id], [{ name: "Mountain", count: 30 }]);
    expect(result).toEqual({ ok: true, slug: "goblins", title: "Goblins", placeholders: 0 });
    expect(m.createDeck).toHaveBeenCalledWith(expect.objectContaining({ title: "Goblins", format: "commander", visibility: "public" }));
    const [payload, options] = m.commit.mock.calls[0];
    expect(options).toEqual({ quota: "deck_import_commit" });
    expect(payload.deckId).toBe("d1");
    expect(payload.firstImportOnly).toBe(true);
    expect(payload.lines).toEqual([
      { name: "Krenko, Mob Boss", quantity: 1, board: "commander", resolved: { scryfall_id: commander.scryfallId } },
      { name: "Goblin Guide", quantity: 1, board: "main", resolved: { scryfall_id: goblin.scryfallId } },
      { name: "Mountain", quantity: 30, board: "main", resolved: { scryfall_id: expect.any(String) } },
    ]);
  });

  it("refuses a card the caller doesn't own (RLS hands back no row)", async () => {
    m.rowsById.mockResolvedValue([commander]);
    const result = await save([UUID]);
    expect(result.ok).toBe(false);
    expect(m.createDeck).not.toHaveBeenCalled();
  });

  it("refuses an off-colour card, a second copy and an off-colour basic", async () => {
    const blue = row({ name: "Counterspell", colorIdentity: ["U"] });
    const a = row({ name: "Goblin Guide" });
    const b = row({ name: "Goblin Guide" });
    m.rowsById.mockResolvedValue([commander, blue, a, b]);
    expect(await save([blue.id])).toEqual({ ok: false, error: "Counterspell is outside the commander's colours." });
    expect(await save([a.id, b.id])).toMatchObject({ ok: false, error: expect.stringContaining("twice") });
    expect(await save([], [{ name: "Island", count: 1 }])).toEqual({ ok: false, error: "Island is outside Krenko, Mob Boss's colours." });
    expect(m.createDeck).not.toHaveBeenCalled();
  });

  it("refuses more than 100 cards", async () => {
    m.rowsById.mockResolvedValue([commander]);
    const result = await save([], [{ name: "Mountain", count: 99 }, { name: "Wastes", count: 5 }]);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("105 cards") });
    expect(m.createDeck).not.toHaveBeenCalled();
  });

  it("a refused commit removes the empty deck it made", async () => {
    m.rowsById.mockResolvedValue([commander]);
    m.createDeck.mockResolvedValue({ ok: true, deckId: "d1", slug: "goblins" });
    m.commit.mockResolvedValue({ ok: false, error: "Scryfall didn't respond." });
    const eqOwner = vi.fn(async () => ({ error: null }));
    const eqId = vi.fn(() => ({ eq: eqOwner }));
    const del = vi.fn(() => ({ eq: eqId }));
    m.createClient.mockResolvedValue({ from: vi.fn(() => ({ delete: del })) });
    const result = await save([]);
    expect(result).toMatchObject({ ok: false, error: "Scryfall didn't respond." });
    expect(eqId).toHaveBeenCalledWith("id", "d1");
    expect(eqOwner).toHaveBeenCalledWith("owner_id", "u1");
  });
});
