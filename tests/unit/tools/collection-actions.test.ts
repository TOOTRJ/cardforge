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
  bracketCards: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tools/queries", () => ({ checkToolAccess: m.access }));
// The actions record after the response (recordToolEventLater); the same spy
// stands in for both writers.
vi.mock("@/lib/tools/events", () => ({ recordToolEvent: m.event, recordToolEventLater: m.event }));
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
vi.mock("@/lib/tools/collection/bracket-cards", () => ({ getBracketCards: m.bracketCards }));
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

/** The tool event an action recorded: its name and its props, under the
 *  viewer and the access path the gate handed it. */
const recorded = (event: string, props: Record<string, unknown> = {}) =>
  expect.objectContaining({
    slug: "collection-builder",
    userId: "u1",
    access: "grant",
    event,
    props: expect.objectContaining(props),
  });

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
    expect(m.event).toHaveBeenCalledWith(recorded("ai_build_failed", { reason: "pool_too_small", pool: 1 }));
  });

  it("a deck type the collection can't begin to fill (below half its floor)", async () => {
    m.access.mockResolvedValue(ACCESS);
    const commander = row({ name: "Krenko", typeLine: "Legendary Creature — Goblin", canBeCommander: true });
    m.oneRow.mockResolvedValue(commander);
    const cards = Array.from({ length: 60 }, (_, i) => row({ name: `Filler ${i}` }));
    cards.push(...Array.from({ length: 9 }, (_, i) => row({ name: `Enchantment ${i}`, typeLine: "Enchantment" })));
    m.pool.mockResolvedValue({ cards, truncated: false });
    const response = await POST(
      new Request("http://x/api", { method: "POST", body: JSON.stringify({ commanderId: commander.id, deckType: "enchantress" }) }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("THEME_TOO_THIN");
    expect(body.error).toMatch(/9 Enchantress cards/);
    expect(m.spend).not.toHaveBeenCalled();
    expect(m.bracketCards).not.toHaveBeenCalled();
    expect(m.event).toHaveBeenCalledWith(
      recorded("ai_build_failed", { reason: "theme_too_thin", deck_type: "enchantress", have: 9, pool: 69 }),
    );
  });

  it("Stax below Bracket 3, before reading anything", async () => {
    m.access.mockResolvedValue(ACCESS);
    const response = await POST(
      new Request("http://x/api", { method: "POST", body: JSON.stringify({ commanderId: UUID, deckType: "stax", bracket: 2 }) }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Bracket 3 and up/);
    expect(m.oneRow).not.toHaveBeenCalled();
    expect(m.spend).not.toHaveBeenCalled();
    expect(m.event).toHaveBeenCalledWith(recorded("ai_build_failed", { reason: "invalid_choice", deck_type: "stax", bracket: 2 }));
  });

  it("a card that can't lead", async () => {
    m.access.mockResolvedValue(ACCESS);
    m.oneRow.mockResolvedValue(row({ name: "Grunt" }));
    const response = await POST(new Request("http://x/api", { method: "POST", body: JSON.stringify({ commanderId: UUID }) }));
    expect(response.status).toBe(400);
    expect(m.spend).not.toHaveBeenCalled();
    expect(m.event).toHaveBeenCalledWith(recorded("ai_build_failed", { reason: "commander_ineligible" }));
  });

  it("a commander that left the collection, and a body that isn't one", async () => {
    m.access.mockResolvedValue(ACCESS);
    m.oneRow.mockResolvedValue(null);
    const gone = await POST(new Request("http://x/api", { method: "POST", body: JSON.stringify({ commanderId: UUID }) }));
    expect(gone.status).toBe(404);
    expect(m.event).toHaveBeenLastCalledWith(recorded("ai_build_failed", { reason: "commander_gone" }));
    const bad = await POST(new Request("http://x/api", { method: "POST", body: JSON.stringify({ commanderId: "nope" }) }));
    expect(bad.status).toBe(400);
    expect(m.event).toHaveBeenLastCalledWith(recorded("ai_build_failed", { reason: "invalid" }));
    expect(m.spend).not.toHaveBeenCalled();
  });
});

describe("saving a draft", () => {
  const commander = row({ name: "Krenko, Mob Boss", typeLine: "Legendary Creature — Goblin Warrior", canBeCommander: true });

  beforeEach(() => {
    m.access.mockResolvedValue(ACCESS);
  });

  const save = (
    cardIds: string[],
    basics: Array<{ name: string; count: number }> = [],
    retry = false,
    choice: Record<string, unknown> = {},
  ) =>
    actions.saveCollectionDeckAction({ commanderId: commander.id, cardIds, basics, title: "Goblins", visibility: "public", retry, ...choice });

  /** The decks table as the action reads it: the new deck's card_count, and
   *  the delete that removes an empty one. */
  function decksTable(cardCount: number) {
    const eqOwner = vi.fn(async () => ({ error: null }));
    const eqId = vi.fn(() => ({ eq: eqOwner }));
    const del = vi.fn(() => ({ eq: eqId }));
    const maybeSingle = vi.fn(async () => ({ data: { card_count: cardCount }, error: null }));
    const select = vi.fn(() => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }));
    m.createClient.mockResolvedValue({ from: vi.fn(() => ({ delete: del, select })) });
    return { del, eqId, eqOwner };
  }

  it("goes through createDeckAction and the decklist commit, the commander on its board", async () => {
    const goblin = row({ name: "Goblin Guide" });
    m.rowsById.mockResolvedValue([commander, goblin]);
    m.createDeck.mockResolvedValue({ ok: true, deckId: "d1", slug: "goblins" });
    m.commit.mockResolvedValue({ ok: true, added: 3, merged: 0, placeholders: 0 });
    const { del } = decksTable(0);
    const result = await save([goblin.id], [{ name: "Mountain", count: 30 }]);
    expect(result).toEqual({ ok: true, slug: "goblins", title: "Goblins", placeholders: 0 });
    expect(m.createDeck).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Goblins", format: "commander", visibility: "public", deck_type: null, bracket: null }),
      { reuseRecentTwin: false },
    );
    expect(del).not.toHaveBeenCalled();
    const [payload, options] = m.commit.mock.calls[0];
    expect(options).toEqual({ quota: "deck_import_commit" });
    expect(payload.deckId).toBe("d1");
    expect(payload.firstImportOnly).toBe(true);
    expect(payload.lines).toEqual([
      { name: "Krenko, Mob Boss", quantity: 1, board: "commander", resolved: { scryfall_id: commander.scryfallId } },
      { name: "Goblin Guide", quantity: 1, board: "main", resolved: { scryfall_id: goblin.scryfallId } },
      { name: "Mountain", quantity: 30, board: "main", resolved: { scryfall_id: expect.any(String) } },
    ]);
    // Recorded once, with counts — never the deck's or a card's name.
    expect(m.event).toHaveBeenCalledTimes(1);
    expect(m.event).toHaveBeenCalledWith(recorded("save_deck", { cards: 32, visibility: "public", placeholders: 0 }));
    expect(JSON.stringify(m.event.mock.calls)).not.toMatch(/Goblin|Krenko/);
  });

  it("refuses a card the caller doesn't own (RLS hands back no row)", async () => {
    m.rowsById.mockResolvedValue([commander]);
    const result = await save([UUID]);
    expect(result.ok).toBe(false);
    expect(m.createDeck).not.toHaveBeenCalled();
    expect(m.event).toHaveBeenCalledWith(recorded("save_deck_failed", { reason: "card_gone", visibility: "public", retry: false }));
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
    expect(m.event.mock.calls.map(([input]) => [input.event, input.props.reason])).toEqual([
      ["save_deck_failed", "card_ineligible"],
      ["save_deck_failed", "duplicate_card"],
      ["save_deck_failed", "basic_off_colour"],
    ]);
  });

  it("refuses more than 100 cards", async () => {
    m.rowsById.mockResolvedValue([commander]);
    const result = await save([], [{ name: "Mountain", count: 99 }, { name: "Wastes", count: 5 }]);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("105 cards") });
    expect(m.createDeck).not.toHaveBeenCalled();
    expect(m.event).toHaveBeenCalledWith(recorded("save_deck_failed", { reason: "too_many_cards", cards: 105 }));
  });

  it("a refused commit removes the empty deck it made", async () => {
    m.rowsById.mockResolvedValue([commander]);
    m.createDeck.mockResolvedValue({ ok: true, deckId: "d1", slug: "goblins" });
    m.commit.mockResolvedValue({ ok: false, error: "Scryfall didn't respond." });
    const { eqId, eqOwner } = decksTable(0);
    const result = await save([]);
    expect(result).toMatchObject({ ok: false, error: "Scryfall didn't respond." });
    expect(eqId).toHaveBeenCalledWith("id", "d1");
    expect(eqOwner).toHaveBeenCalledWith("owner_id", "u1");
    expect(m.event).toHaveBeenCalledTimes(1);
    expect(m.event).toHaveBeenCalledWith(recorded("save_deck_failed", { reason: "commit_refused", cards: 1 }));
  });

  it("a commit that throws still removes the empty deck", async () => {
    m.rowsById.mockResolvedValue([commander]);
    m.createDeck.mockResolvedValue({ ok: true, deckId: "d1", slug: "goblins" });
    m.commit.mockRejectedValue(new Error("socket hang up"));
    const { eqId } = decksTable(0);
    await expect(save([])).rejects.toThrow("socket hang up");
    expect(eqId).toHaveBeenCalledWith("id", "d1");
    expect(m.event).toHaveBeenCalledWith(recorded("save_deck_failed", { reason: "commit_error", cards: 1 }));
  });

  it("a press after a lost answer takes back that deck — never a second one", async () => {
    m.rowsById.mockResolvedValue([commander]);
    m.createDeck.mockResolvedValue({ ok: true, deckId: "d1", slug: "goblins" });
    const { del } = decksTable(1);
    const result = await save([], [], true);
    expect(m.createDeck).toHaveBeenCalledWith(expect.anything(), { reuseRecentTwin: true });
    expect(result).toEqual({ ok: true, slug: "goblins", title: "Goblins", placeholders: 0 });
    expect(m.commit).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("a deck that couldn't be made, and a commit the quota refused, say so in the log", async () => {
    m.rowsById.mockResolvedValue([commander]);
    m.createDeck.mockResolvedValue({ ok: false, formError: "No." });
    expect((await save([])).ok).toBe(false);
    expect(m.event).toHaveBeenLastCalledWith(recorded("save_deck_failed", { reason: "deck_not_created", cards: 1 }));
    m.createDeck.mockResolvedValue({ ok: true, deckId: "d1", slug: "goblins" });
    m.commit.mockResolvedValue({ ok: false, error: "Slow down.", retryAfterSeconds: 30 });
    decksTable(0);
    expect(await save([])).toMatchObject({ ok: false, retryAfterSeconds: 30 });
    expect(m.event).toHaveBeenLastCalledWith(recorded("save_deck_failed", { reason: "rate_limited" }));
  });
});

describe("finishing a replace import", () => {
  const finish = (complete: boolean) =>
    actions.finishCollectionImportAction({
      batchId: UUID,
      mode: "replace",
      format: "csv",
      lines: 10,
      matched: 8,
      unmatched: 2,
      complete,
    });

  beforeEach(() => {
    m.access.mockResolvedValue(ACCESS);
  });

  it("an import cut short by the cap removes nothing", async () => {
    const result = await finish(false);
    expect(result).toEqual({ ok: true, removed: 0 });
    expect(m.createClient).not.toHaveBeenCalled();
  });

  it("a complete one removes every row another batch wrote", async () => {
    const or = vi.fn(async () => ({ error: null, count: 4 }));
    const eqBatch = vi.fn(async () => ({ count: 8 }));
    m.createClient.mockResolvedValue({
      from: vi.fn(() => ({
        select: () => ({ eq: eqBatch }),
        delete: () => ({ or }),
      })),
    });
    const result = await finish(true);
    expect(result).toEqual({ ok: true, removed: 4 });
    expect(eqBatch).toHaveBeenCalledWith("import_batch", UUID);
    expect(or).toHaveBeenCalledWith(`import_batch.is.null,import_batch.neq.${UUID}`);
    expect(m.event).toHaveBeenCalledWith(
      recorded("import", { format: "csv", mode: "replace", lines: 10, matched: 8, unmatched: 2, removed: 4 }),
    );
  });

  it("a sweep that failed is an import that failed, not one that finished", async () => {
    m.createClient.mockResolvedValue({
      from: vi.fn(() => ({
        select: () => ({ eq: async () => ({ count: 8 }) }),
        delete: () => ({ or: async () => ({ error: { message: "boom" }, count: null }) }),
      })),
    });
    expect((await finish(true)).ok).toBe(false);
    expect(m.event).toHaveBeenCalledTimes(1);
    expect(m.event).toHaveBeenCalledWith(recorded("import_failed", { reason: "replace_sweep_failed", mode: "replace", lines: 10 }));
  });
});

describe("the deck type and bracket a draft was built with", () => {
  const commander = row({ name: "Krenko, Mob Boss", typeLine: "Legendary Creature — Goblin Warrior", canBeCommander: true });

  it("are saved in the deck's own columns (the creature type's tribe key when no deck type)", async () => {
    m.access.mockResolvedValue(ACCESS);
    const goblin = row({ name: "Goblin Guide" });
    m.rowsById.mockResolvedValue([commander, goblin]);
    m.createDeck.mockResolvedValue({ ok: true, deckId: "d1", slug: "goblins" });
    m.commit.mockResolvedValue({ ok: true, added: 2, merged: 0, placeholders: 0 });
    const maybeSingle = vi.fn(async () => ({ data: { card_count: 2 }, error: null }));
    m.createClient.mockResolvedValue({ from: vi.fn(() => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }) })) });
    await actions.saveCollectionDeckAction({
      commanderId: commander.id,
      cardIds: [goblin.id],
      basics: [],
      title: "Goblins",
      visibility: "public",
      tribe: "Goblin",
      bracket: 2,
    });
    expect(m.createDeck).toHaveBeenCalledWith(expect.objectContaining({ deck_type: "goblins", bracket: 2 }), expect.anything());
  });

  it("the free draft reads the bracket's lists only when a bracket is picked", async () => {
    m.access.mockResolvedValue(ACCESS);
    m.oneRow.mockResolvedValue(commander);
    m.pool.mockResolvedValue({ cards: [commander, row({ name: "Goblin Guide" })], truncated: false });
    m.bracketCards.mockResolvedValue({ gameChangers: new Set(), massLandDenial: new Set(), extraTurns: new Set() });
    const plain = await actions.draftCollectionDeckAction({ commanderId: commander.id });
    expect(plain.ok).toBe(true);
    expect(m.bracketCards).not.toHaveBeenCalled();
    const bracketed = await actions.draftCollectionDeckAction({ commanderId: commander.id, deckType: "tokens", bracket: 2 });
    expect(m.bracketCards).toHaveBeenCalledTimes(1);
    expect(bracketed.ok && bracketed.draft.bracket).toBe(2);
    expect(bracketed.ok && bracketed.draft.gameChangers).toBe(0);
    expect(bracketed.ok && bracketed.draft.focus?.[0].label).toBe("Tokens");
    expect(m.event).toHaveBeenLastCalledWith(recorded("draft", { deck_type: "tokens", bracket: 2, colours: "R" }));
  });

  it("a draft that was refused says why", async () => {
    m.access.mockResolvedValue(ACCESS);
    expect((await actions.draftCollectionDeckAction({ commanderId: "nope" })).ok).toBe(false);
    expect(m.event).toHaveBeenLastCalledWith(recorded("draft_failed", { reason: "invalid" }));
    expect((await actions.draftCollectionDeckAction({ commanderId: UUID, deckType: "stax", bracket: 2 })).ok).toBe(false);
    expect(m.event).toHaveBeenLastCalledWith(recorded("draft_failed", { reason: "invalid_choice", deck_type: "stax", bracket: 2 }));
    m.oneRow.mockResolvedValue(null);
    expect((await actions.draftCollectionDeckAction({ commanderId: UUID })).ok).toBe(false);
    expect(m.event).toHaveBeenLastCalledWith(recorded("draft_failed", { reason: "commander_gone" }));
    m.oneRow.mockResolvedValue(row({ name: "Grunt" }));
    expect((await actions.draftCollectionDeckAction({ commanderId: UUID })).ok).toBe(false);
    expect(m.event).toHaveBeenLastCalledWith(recorded("draft_failed", { reason: "commander_ineligible" }));
  });
});

