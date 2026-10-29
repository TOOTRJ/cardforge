import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer, type ChainCall } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// The deck page's batch writes (TODO DK5.4 / DK5.8, lib/decks/card-actions.ts
// + lib/decks/add-actions.ts): ONE deck a call, every entry of it at once,
// every statement held to the deck, ONE revalidation (the deck's paths with
// IndexNow, and My Cards' chips) — and the undo of a removal through the
// paths a card comes INTO a deck by: the decklist commit and the ONE
// membership writer, never a direct insert. An add lands on the row the
// board has (one copy more) or comes in through those same two paths.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const DECK = "33333333-3333-4333-8333-333333333333";
const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const SF = "581b7327-3215-4a4f-b4ae-d9d4002ba882";
const CARD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const state = vi.hoisted(() => ({
  client: null as unknown,
  deck: null as null | Record<string, unknown>,
  /** The deck's rows (reads answer them; the stub never really writes). */
  rows: [] as Array<Record<string, unknown>>,
  failWrite: null as null | string,
  revalidations: [] as string[],
  commit: vi.fn(),
  membership: vi.fn(),
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
  getCurrentUser: async () => ({ id: USER }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isAdminConfigured: () => false }));
vi.mock("@/lib/analytics/funnel-server", () => ({ recordFunnelEvent: vi.fn() }));
vi.mock("@/lib/profile/username", () => ({ revalidateProfilePage: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/decks/revalidate", () => ({
  revalidateDeckEntryChange: async (_supabase: unknown, _owner: string, slug: string) => {
    state.revalidations.push(slug);
  },
}));
vi.mock("@/lib/decks/import", () => ({ commitDeckImportAction: state.commit }));
vi.mock("@/lib/decks/membership-actions", () => ({ changeDeckMembershipAction: state.membership }));

import { removeDeckEntriesAction, restoreDeckEntriesAction, updateDeckEntriesAction } from "@/lib/decks/card-actions";
import { addToDeckAction } from "@/lib/decks/add-actions";

const inArg = (calls: ChainCall[], column: string) =>
  (calls.find((c) => c.method === "in" && c.args[0] === column)?.args[1] ?? []) as string[];
const eqArg = (calls: ChainCall[], column: string) => calls.find((c) => c.method === "eq" && c.args[0] === column)?.args[1];

function db() {
  const stub = chainClient((table, calls): ChainAnswer => {
    if (table === "decks") return { data: state.deck, error: null };
    if (table === "deck_cards") {
      for (const op of ["update", "delete"] as const) {
        if (!called(calls, op)) continue;
        if (state.failWrite === op) return { data: null, error: { message: `${op} refused` } };
        const ids = inArg(calls, "id");
        const one = eqArg(calls, "id") as string | undefined;
        const hit = state.rows.filter((row) => (ids.length ? ids.includes(row.id as string) : row.id === one));
        if (op === "update") {
          const patch = payloadOf(calls, "update") as Record<string, unknown>;
          const updated = hit.map((row) => ({ ...row, ...patch }));
          return { data: called(calls, "maybeSingle") ? (updated[0] ?? null) : updated, error: null };
        }
        return { data: hit, error: null };
      }
      return { data: state.rows, error: null, count: state.rows.length };
    }
    return { data: null, error: null };
  });
  state.client = stub.client;
  return stub;
}

const row = (n: number, over: Record<string, unknown> = {}) => ({
  id: id(n),
  deck_id: DECK,
  name: `Card ${n}`,
  board: "main",
  quantity: 1,
  scryfall_id: null,
  card_id: null,
  source: "import",
  position: n,
  ...over,
});

beforeEach(() => {
  state.deck = { id: DECK, slug: "ness", title: "Ness", owner_id: USER };
  state.rows = [];
  state.failWrite = null;
  state.revalidations = [];
  state.commit.mockReset().mockResolvedValue({ ok: true, added: 1, merged: 0, placeholders: 0 });
  state.membership.mockReset();
});

describe("updateDeckEntriesAction — quantities and boards, many at once", () => {
  it("one statement per distinct change, each held to the deck; ONE revalidation", async () => {
    state.rows = [row(1), row(2), row(3)];
    const stub = db();
    const result = await updateDeckEntriesAction({
      deckId: DECK,
      updates: [
        { id: id(1), board: "side" },
        { id: id(2), board: "side" },
        { id: id(3), quantity: 4 },
      ],
    });
    expect(result.ok).toBe(true);
    const writes = stub.forTable("deck_cards").filter((e) => called(e.calls, "update"));
    expect(writes.map((e) => [payloadOf(e.calls, "update"), inArg(e.calls, "id")])).toEqual([
      [{ board: "side" }, [id(1), id(2)]],
      [{ quantity: 4 }, [id(3)]],
    ]);
    for (const write of writes) expect(eqArg(write.calls, "deck_id")).toBe(DECK);
    expect(state.revalidations).toEqual(["ness"]);
  });

  it("refuses another owner's deck, a bad payload, a quantity out of 1–250 — before any write", async () => {
    state.deck = { id: DECK, slug: "ness", title: "Ness", owner_id: "someone-else" };
    const stub = db();
    expect(await updateDeckEntriesAction({ deckId: DECK, updates: [{ id: id(1), quantity: 2 }] })).toEqual({
      ok: false,
      error: "Deck not found or not yours.",
    });
    expect((await updateDeckEntriesAction({ deckId: DECK, updates: [{ id: id(1), quantity: 0 }] })).ok).toBe(false);
    expect((await updateDeckEntriesAction({ deckId: DECK, updates: [{ id: id(1), quantity: 251 }] })).ok).toBe(false);
    expect((await updateDeckEntriesAction({ deckId: DECK, updates: [{ id: id(1), board: "graveyard" }] })).ok).toBe(false);
    expect((await updateDeckEntriesAction({ deckId: DECK, updates: [{ id: id(1) }] })).ok).toBe(false);
    expect((await updateDeckEntriesAction({ deckId: "nope", updates: [] })).ok).toBe(false);
    expect(stub.forTable("deck_cards")).toHaveLength(0);
    expect(state.revalidations).toEqual([]);
  });

  it("a refused statement is the answer, in its words — the edit rolls back on the page", async () => {
    state.rows = [row(1)];
    state.failWrite = "update";
    db();
    expect(await updateDeckEntriesAction({ deckId: DECK, updates: [{ id: id(1), quantity: 2 }] })).toEqual({
      ok: false,
      error: "update refused",
    });
    expect(state.revalidations).toEqual([]);
  });
});

describe("removeDeckEntriesAction — and the undo it hands back", () => {
  it("deletes the entries of ONE deck and returns each line as it was", async () => {
    state.rows = [row(1, { scryfall_id: SF, quantity: 4, board: "side" }), row(2, { card_id: CARD, source: "creator" })];
    const stub = db();
    const result = await removeDeckEntriesAction({ deckId: DECK, entryIds: [id(1), id(2)] });
    expect(result).toEqual({
      ok: true,
      removed: [
        { id: id(1), name: "Card 1", board: "side", quantity: 4, scryfallId: SF, cardId: null, source: "import" },
        { id: id(2), name: "Card 2", board: "main", quantity: 1, scryfallId: null, cardId: CARD, source: "creator" },
      ],
    });
    const deletes = stub.forTable("deck_cards").filter((e) => called(e.calls, "delete"));
    expect(deletes).toHaveLength(1);
    expect(eqArg(deletes[0]!.calls, "deck_id")).toBe(DECK);
    expect(state.revalidations).toEqual(["ness"]);
  });
});

describe("restoreDeckEntriesAction — a removal undone, never a direct insert", () => {
  it("printings and names through ONE decklist commit, cards through the membership writer, then each its card, board and count", async () => {
    // The deck after the commit: the printing's line back (no card yet) and
    // the placeholder's.
    state.rows = [
      row(10, { name: "Sol Ring", scryfall_id: SF, board: "side", quantity: 4 }),
      row(11, { name: "Mystery Card", board: "main", quantity: 2 }),
    ];
    state.membership.mockResolvedValue({
      ok: true,
      deckId: DECK,
      deckTitle: "Ness",
      deckSlug: "ness",
      results: [{ cardId: CARD, status: "added" }],
      entries: [{ cardId: CARD, deckId: DECK, entryId: id(12), board: "main", quantity: 1 }],
    });
    const stub = db();
    const result = await restoreDeckEntriesAction({
      deckId: DECK,
      entries: [
        { id: id(1), name: "Sol Ring", board: "side", quantity: 4, scryfallId: SF, cardId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", source: "import" },
        { id: id(2), name: "Mystery Card", board: "main", quantity: 2, scryfallId: null, cardId: null, source: "import" },
        { id: id(3), name: "Ember Wyrm", board: "commander", quantity: 1, scryfallId: null, cardId: CARD, source: "creator" },
      ],
    });
    expect(state.commit).toHaveBeenCalledTimes(1);
    expect(state.commit).toHaveBeenCalledWith({
      deckId: DECK,
      lines: [
        { name: "Sol Ring", quantity: 4, board: "side", resolved: { scryfall_id: SF } },
        { name: "Mystery Card", quantity: 2, board: "main", resolved: null },
      ],
    });
    expect(state.membership).toHaveBeenCalledWith({ deckId: DECK, add: [CARD] });
    // No insert anywhere.
    expect(stub.log.some((e) => called(e.calls, "insert"))).toBe(false);
    const updates = stub.forTable("deck_cards").filter((e) => called(e.calls, "update"));
    // The printing's card linked back (only onto a row with none), the
    // card's entry onto its board.
    expect(updates.map((e) => payloadOf(e.calls, "update"))).toEqual([
      { card_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
      { board: "commander" },
    ]);
    expect(called(updates[0]!.calls, "is", "card_id")).toBe(true);
    expect(result).toEqual({
      ok: true,
      restored: [
        { from: id(1), to: id(10) },
        { from: id(2), to: id(11) },
        { from: id(3), to: id(12) },
      ],
    });
    expect(state.revalidations).toEqual(["ness"]);
  });

  it("says, entry by entry, what couldn't come back — and why", async () => {
    state.commit.mockResolvedValue({ ok: false, error: "Scryfall didn't respond — nothing was imported. Try again in a moment." });
    state.membership.mockResolvedValue({
      ok: true,
      deckId: DECK,
      deckTitle: "Ness",
      deckSlug: "ness",
      results: [{ cardId: CARD, status: "deck_full", error: "“Ness” is full." }],
      entries: [],
    });
    db();
    const result = await restoreDeckEntriesAction({
      deckId: DECK,
      entries: [
        { id: id(1), name: "Sol Ring", board: "main", quantity: 1, scryfallId: SF, cardId: null, source: "import" },
        { id: id(3), name: "Ember Wyrm", board: "main", quantity: 1, scryfallId: null, cardId: CARD, source: "link" },
      ],
    });
    expect(result).toEqual({
      ok: true,
      restored: [
        { from: id(1), to: null, note: "Scryfall didn't respond — nothing was imported. Try again in a moment." },
        { from: id(3), to: null, note: "“Ness” is full." },
      ],
    });
    expect(state.revalidations).toEqual([]);
  });
});

describe("addToDeckAction — the add box's one add", () => {
  it("a card already on the board: one copy more on its row — no RPC, no Scryfall", async () => {
    state.rows = [row(1, { name: "Sol Ring", scryfall_id: SF, quantity: 2 })];
    const stub = db();
    const result = await addToDeckAction({ deckId: DECK, board: "main", pick: { kind: "printing", scryfallId: "99999999-9999-4999-8999-999999999999", name: "Sol Ring" } });
    expect(result).toEqual({ ok: true, entryId: id(1), board: "main", quantity: 3, merged: true, name: "Sol Ring" });
    expect(state.commit).not.toHaveBeenCalled();
    expect(payloadOf(stub.forTable("deck_cards").find((e) => called(e.calls, "update"))!.calls, "update")).toEqual({ quantity: 3 });
  });

  it("a real card not in the deck: a ONE-LINE decklist import on the board", async () => {
    state.rows = [];
    const stub = db();
    // The commit "writes" the row the read-back finds.
    state.commit.mockImplementation(async () => {
      state.rows = [row(5, { name: "Sol Ring", scryfall_id: SF, board: "side" })];
      return { ok: true, added: 1, merged: 0, placeholders: 0 };
    });
    const result = await addToDeckAction({ deckId: DECK, board: "side", pick: { kind: "printing", scryfallId: SF, name: "Sol Ring" } });
    expect(state.commit).toHaveBeenCalledWith({
      deckId: DECK,
      lines: [{ name: "Sol Ring", quantity: 1, board: "side", resolved: { scryfall_id: SF } }],
    });
    expect(result).toEqual({ ok: true, entryId: id(5), board: "side", quantity: 1, merged: false, name: "Sol Ring" });
    expect(stub.log.some((e) => called(e.calls, "insert"))).toBe(false);
    expect(state.revalidations).toEqual(["ness"]);
  });

  it("a PipGlyph card: the ONE membership writer, then the board the box names", async () => {
    state.rows = [];
    state.membership.mockResolvedValue({
      ok: true,
      deckId: DECK,
      deckTitle: "Ness",
      deckSlug: "ness",
      results: [{ cardId: CARD, status: "added" }],
      entries: [{ cardId: CARD, deckId: DECK, entryId: id(7), board: "main", quantity: 1 }],
    });
    const stub = db();
    const result = await addToDeckAction({ deckId: DECK, board: "commander", pick: { kind: "card", cardId: CARD } });
    expect(state.membership).toHaveBeenCalledWith({ deckId: DECK, add: [CARD] });
    expect(payloadOf(stub.forTable("deck_cards").find((e) => called(e.calls, "update"))!.calls, "update")).toEqual({ board: "commander" });
    expect(result).toMatchObject({ ok: true, entryId: id(7), board: "commander", merged: false });
  });

  it("a PipGlyph card already on ANOTHER board stays there, and the answer says where", async () => {
    state.rows = [row(1, { name: "Ember Wyrm", card_id: CARD, board: "side" })];
    db();
    const result = await addToDeckAction({ deckId: DECK, board: "main", pick: { kind: "card", cardId: CARD } });
    expect(result).toEqual({
      ok: false,
      error: "Ember Wyrm is already in the deck, on the Sideboard. Move it there to change boards.",
      elsewhere: { entryId: id(1), board: "side" },
    });
    expect(state.membership).not.toHaveBeenCalled();
  });

  it("a refusal of the membership writer (D3, a full deck) comes back in its words", async () => {
    state.membership.mockResolvedValue({
      ok: true,
      deckId: DECK,
      deckTitle: "Ness",
      deckSlug: "ness",
      results: [{ cardId: CARD, status: "refused", error: "You can add your own cards, or another creator's public card." }],
      entries: [],
    });
    db();
    expect(await addToDeckAction({ deckId: DECK, board: "main", pick: { kind: "card", cardId: CARD } })).toEqual({
      ok: false,
      error: "You can add your own cards, or another creator's public card.",
    });
  });
});
