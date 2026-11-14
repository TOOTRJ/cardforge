import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Bulk Customize's sources (lib/tools/bulk-customize/server.ts
// resolveBulkSources): each one is resolved from the CALLER's own rows — a
// deck entry through its deck's owner — or skipped with a reason the dialog
// shows.
//
// 2026-11-13: the API refused the deck entries' read as ambiguous (migration
// 0209 made a second link between decks and deck_cards), the error was
// dropped, and every entry was told "Not found in your decks." So: the deck
// is embedded by its foreign key's NAME, and a read that FAILED says so —
// in the log and to the maker — never "not found".
// ---------------------------------------------------------------------------

type Answer = { data: unknown; error: { code?: string; message: string } | null };
type Call = { table: string; select: string; filters: Array<[string, string, unknown]> };

const m = vi.hoisted(() => ({
  answers: {} as Record<string, Answer>,
  calls: [] as Call[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const call: Call = { table, select: "", filters: [] };
      m.calls.push(call);
      const chain = {
        select: (columns: string) => {
          call.select = columns;
          return chain;
        },
        in: (column: string, value: unknown) => {
          call.filters.push(["in", column, value]);
          return chain;
        },
        eq: (column: string, value: unknown) => {
          call.filters.push(["eq", column, value]);
          return chain;
        },
        then: (resolve: (value: Answer) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(m.answers[table] ?? { data: [], error: null }).then(resolve, reject),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ isAdminConfigured: () => false, createAdminClient: vi.fn() }));

import { BULK_SOURCE_UNREAD, resolveBulkSources } from "@/lib/tools/bulk-customize/server";

const ME = "00000000-0000-4000-8000-0000000000a1";
const ENTRY = (n: number) => `00000000-0000-4000-8000-0000000000e${n}`;
const ROW = (n: number) => `00000000-0000-4000-8000-0000000000c${n}`;
const PRINTING = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  m.answers = {};
  m.calls = [];
});

describe("a deck's entries", () => {
  it("are read through their deck, by its foreign key's NAME, held to the caller", async () => {
    m.answers.deck_cards = { data: [{ id: ENTRY(1), name: "Llanowar Elves", scryfall_id: PRINTING, card_id: null }], error: null };
    const { resolved, skipped } = await resolveBulkSources(ME, [{ kind: "deck_entry", id: ENTRY(1) }]);
    expect(resolved).toMatchObject([{ scryfallId: PRINTING, name: "Llanowar Elves", deckEntryId: ENTRY(1) }]);
    expect(skipped).toEqual([]);
    const [read] = m.calls;
    expect(read.table).toBe("deck_cards");
    expect(read.select).toBe("id, name, scryfall_id, card_id, decks!deck_cards_deck_id_fkey!inner(owner_id)");
    expect(read.filters).toEqual([
      ["in", "id", [ENTRY(1)]],
      ["eq", "decks.owner_id", ME],
    ]);
  });

  it("an entry the read doesn't hand back is not the caller's: skipped as not found", async () => {
    m.answers.deck_cards = { data: [], error: null };
    const { resolved, skipped } = await resolveBulkSources(ME, [{ kind: "deck_entry", id: ENTRY(1) }]);
    expect(resolved).toEqual([]);
    expect(skipped).toMatchObject([{ name: "A deck entry", reason: "Not found in your decks." }]);
  });

  it("a read the API REFUSES is said as one — logged, and never “not found”", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.answers.deck_cards = {
      data: null,
      error: { code: "PGRST201", message: "Could not embed because more than one relationship was found for 'deck_cards' and 'decks'" },
    };
    const { resolved, skipped } = await resolveBulkSources(ME, [
      { kind: "deck_entry", id: ENTRY(1) },
      { kind: "deck_entry", id: ENTRY(2) },
    ]);
    expect(resolved).toEqual([]);
    expect(skipped.map((skip) => skip.reason)).toEqual([BULK_SOURCE_UNREAD, BULK_SOURCE_UNREAD]);
    expect(BULK_SOURCE_UNREAD).toMatch(/couldn't read/);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toMatch(/^\[bulk-customize\] deck entries not read: PGRST201 /);
    logged.mockRestore();
  });

  it("an entry that is the caller's own card already, or no real printing yet, keeps its own reason", async () => {
    m.answers.deck_cards = {
      data: [
        { id: ENTRY(1), name: "My Card", scryfall_id: null, card_id: "card-1" },
        { id: ENTRY(2), name: "Placeholder", scryfall_id: null, card_id: null },
      ],
      error: null,
    };
    const { skipped } = await resolveBulkSources(ME, [
      { kind: "deck_entry", id: ENTRY(1) },
      { kind: "deck_entry", id: ENTRY(2) },
    ]);
    expect(skipped.map((skip) => skip.reason)).toEqual(["Already one of your PipGlyph cards.", "Not a real card's printing yet."]);
  });
});

describe("a collection's cards", () => {
  it("a failed read says so too, and leaves the other sources as they are", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.answers.collection_cards = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    m.answers.deck_cards = { data: [{ id: ENTRY(1), name: "Llanowar Elves", scryfall_id: PRINTING, card_id: null }], error: null };
    const { resolved, skipped } = await resolveBulkSources(ME, [
      { kind: "collection", id: ROW(1) },
      { kind: "deck_entry", id: ENTRY(1) },
      { kind: "scryfall", id: PRINTING },
    ]);
    expect(skipped).toMatchObject([{ name: "A collection card", reason: BULK_SOURCE_UNREAD }]);
    expect(resolved.map((source) => source.source.kind)).toEqual(["deck_entry", "scryfall"]);
    expect(String(logged.mock.calls[0][0])).toMatch(/^\[bulk-customize\] collection cards not read: 57014 /);
    logged.mockRestore();
  });

  it("a row the read doesn't hand back is not found", async () => {
    const { skipped } = await resolveBulkSources(ME, [{ kind: "collection", id: ROW(1) }]);
    expect(skipped).toMatchObject([{ reason: "Not found in your collection." }]);
  });
});
