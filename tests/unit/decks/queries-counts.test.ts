import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Deck lists past PostgREST's 1000-row cap (DK0.1) and empty decks out of
// the public lists (DK0.8):
//   * tile counts come off the deck row (decks.card_count /
//     linked_card_count, migration 0143) — no list reads deck_cards at all;
//   * every public list and count asks for card_count > 0;
//   * a deck's entries are read in pages, ordered on a unique key last;
//   * linked cards are looked up 100 ids a request (a short URL).
// ---------------------------------------------------------------------------

type Call = { table: string; ops: Array<[string, ...unknown[]]> };

const s = vi.hoisted(() => ({
  calls: [] as Call[],
  /** Rows a query answers, by table; deck_cards is answered by range. */
  rows: {} as Record<string, unknown[]>,
  entries: [] as Record<string, unknown>[],
  withCount: true,
  /** A linked card's maker, by card id (default: the deck's owner). */
  cardOwner: {} as Record<string, string>,
}));

function client() {
  return {
    from(table: string) {
      const call: Call = { table, ops: [] };
      s.calls.push(call);
      const answer = () => {
        if (table === "deck_cards") {
          const range = call.ops.find((op) => op[0] === "range");
          const [from, to] = range ? [range[1] as number, range[2] as number] : [0, 999];
          return {
            data: s.entries.slice(from, Math.min(to + 1, from + 1000)),
            error: null,
            count: s.withCount ? s.entries.length : null,
          };
        }
        if (table === "cards") {
          const ids = (call.ops.find((op) => op[0] === "in")?.[2] ?? []) as string[];
          return { data: ids.map((id) => ({ id, title: id, color_identity: [], owner_id: s.cardOwner[id] ?? "owner-1" })), error: null };
        }
        return { data: s.rows[table] ?? [], error: null, count: (s.rows[table] ?? []).length };
      };
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "gt", "in", "or", "order", "range", "limit"]) {
        chain[op] = (...args: unknown[]) => {
          call.ops.push([op, ...args]);
          return chain;
        };
      }
      chain.maybeSingle = async () => ({ data: (s.rows[table] ?? [])[0] ?? null, error: null });
      chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(answer()).then(resolve, reject);
      return chain;
    },
  };
}

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/public", () => ({ createPublicClient: () => client() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => client(),
  getCurrentUser: async () => ({ id: "owner-1" }),
}));

import {
  countDeckEntries,
  countPublicDecks,
  countPublicDecksByOwner,
  listDeckCards,
  listMyDecks,
  listPublicDecks,
  listPublicDecksByOwner,
} from "@/lib/decks/queries";

const deckRow = (id: string, card_count: number, linked_card_count: number) => ({
  id,
  owner_id: "owner-1",
  title: id,
  slug: id,
  description: null,
  format: "commander",
  visibility: "public",
  cover_url: null,
  cover_position: null,
  deck_type: null,
  bracket: null,
  likes_count: 0,
  view_count: 0,
  card_count,
  linked_card_count,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
});

const hasOp = (call: Call | undefined, ...op: unknown[]) =>
  Boolean(call?.ops.some((o) => JSON.stringify(o) === JSON.stringify(op)));

beforeEach(() => {
  s.calls = [];
  s.rows = {};
  s.entries = [];
  s.withCount = true;
  s.cardOwner = {};
});

describe("deck tiles read their counts off the deck row", () => {
  it("listPublicDecks: card_count > 0, counts mapped to cards_count / linked_count, no deck_cards read", async () => {
    s.rows.decks = [deckRow("a", 100, 40), deckRow("b", 2400, 0)];
    const decks = await listPublicDecks({ anonymous: true, limit: 25 });
    expect(decks.map((d) => [d.id, d.cards_count, d.linked_count])).toEqual([
      ["a", 100, 40],
      ["b", 2400, 0],
    ]);
    const deckQuery = s.calls.find((c) => c.table === "decks");
    expect(hasOp(deckQuery, "eq", "visibility", "public")).toBe(true);
    expect(hasOp(deckQuery, "gt", "card_count", 0)).toBe(true);
    expect(hasOp(deckQuery, "range", 0, 24)).toBe(true);
    expect(s.calls.some((c) => c.table === "deck_cards")).toBe(false);
  });

  it("listPublicDecksByOwner and both public counts leave empty decks out", async () => {
    s.rows.decks = [deckRow("a", 60, 60)];
    const decks = await listPublicDecksByOwner("owner-1", 6);
    expect(decks[0]).toMatchObject({ cards_count: 60, linked_count: 60 });
    await countPublicDecksByOwner("owner-1");
    await countPublicDecks();
    const deckQueries = s.calls.filter((c) => c.table === "decks");
    expect(deckQueries).toHaveLength(3);
    for (const call of deckQueries) expect(hasOp(call, "gt", "card_count", 0)).toBe(true);
    expect(s.calls.some((c) => c.table === "deck_cards")).toBe(false);
  });

  it("listMyDecks keeps the owner's empty decks (the dashboard is where they're filled)", async () => {
    s.rows.decks = [deckRow("draft", 0, 0), deckRow("full", 99, 12)];
    const decks = await listMyDecks();
    expect(decks.map((d) => [d.id, d.cards_count, d.linked_count])).toEqual([
      ["draft", 0, 0],
      ["full", 99, 12],
    ]);
    expect(hasOp(s.calls.find((c) => c.table === "decks"), "gt", "card_count", 0)).toBe(false);
    expect(s.calls.some((c) => c.table === "deck_cards")).toBe(false);
  });

  it("countDeckEntries (the deck page's robots gate) reads the stored card_count", async () => {
    s.rows.decks = [{ card_count: 7 }];
    expect(await countDeckEntries("deck-robots")).toBe(7);
    expect(s.calls.map((c) => c.table)).toEqual(["decks"]);
  });
});

describe("listDeckCards reads a whole deck", () => {
  it("pages past 1000 rows on a unique order, stops at the exact count, and looks linked cards up in chunks", async () => {
    s.entries = Array.from({ length: 1003 }, (_, i) => ({
      id: `e-${i}`,
      deck_id: "big",
      board: "main",
      quantity: 1,
      position: i,
      card_id: i < 450 ? `card-${i}` : null,
      name: `Card ${i}`,
    }));
    const items = await listDeckCards("big");
    expect(items).toHaveLength(1003);
    expect(items.filter((item) => item.card)).toHaveLength(450);

    const entryCalls = s.calls.filter((c) => c.table === "deck_cards");
    expect(entryCalls.map((c) => c.ops.find((op) => op[0] === "range"))).toEqual([
      ["range", 0, 999],
      ["range", 1000, 1999],
    ]);
    for (const call of entryCalls) {
      expect(hasOp(call, "order", "id", { ascending: true })).toBe(true);
      expect(hasOp(call, "select", "*", { count: "exact" })).toBe(true);
    }

    const cardCalls = s.calls.filter((c) => c.table === "cards");
    expect(cardCalls.map((c) => (c.ops.find((op) => op[0] === "in")?.[2] as string[]).length)).toEqual([
      100, 100, 100, 100, 50,
    ]);
  });

  it("another creator's card names its maker (D3); the owner's own cards and printings don't", async () => {
    s.rows.decks = [{ owner_id: "owner-1" }];
    s.rows.profiles = [{ id: "artist-1", username: "dev_artist" }];
    s.cardOwner = { "card-foreign": "artist-1" };
    s.entries = [
      { id: "e-own", deck_id: "d", board: "main", quantity: 1, position: 0, card_id: "card-own", name: "Own", source: "creator" },
      { id: "e-foreign", deck_id: "d", board: "main", quantity: 1, position: 1, card_id: "card-foreign", name: "Theirs", source: "link" },
      { id: "e-print", deck_id: "d", board: "main", quantity: 1, position: 2, card_id: null, scryfall_id: "x", name: "Bolt", source: "bogus" },
    ];
    const items = await listDeckCards("d");
    expect(items.map((item) => item.cardOwner)).toEqual([null, { username: "dev_artist" }, null]);
    // One profiles read, for the other makers only.
    const makerReads = s.calls.filter((c) => c.table === "profiles");
    expect(makerReads).toHaveLength(1);
    expect(makerReads[0]!.ops.find((op) => op[0] === "in")).toEqual(["in", "id", ["artist-1"]]);
    // `source` narrowed: a value outside the CHECK's list reads as none.
    expect(items.map((item) => item.entry.source)).toEqual(["creator", "link", null]);
  });

  it("a deck with only its owner's cards reads no profile", async () => {
    s.rows.decks = [{ owner_id: "owner-1" }];
    s.entries = [{ id: "e", deck_id: "d", board: "main", quantity: 1, position: 0, card_id: "card-own", name: "Own" }];
    const items = await listDeckCards("d");
    expect(items[0]!.cardOwner).toBeNull();
    // A database 0144 hasn't reached: no source at all.
    expect(items[0]!.entry.source).toBeNull();
    expect(s.calls.filter((c) => c.table === "profiles")).toHaveLength(0);
  });

  it("an ordinary deck is ONE request (the exact count says it's all there)", async () => {
    s.entries = Array.from({ length: 99 }, (_, i) => ({ id: `e-${i}`, deck_id: "d", board: "main", quantity: 1, position: i, card_id: null, name: `C${i}` }));
    expect(await listDeckCards("d")).toHaveLength(99);
    expect(s.calls.filter((c) => c.table === "deck_cards")).toHaveLength(1);
  });
});
