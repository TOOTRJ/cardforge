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
  /** A linked card's visibility, by card id (default: public). */
  cardVisibility: {} as Record<string, string>,
  /** RPC calls made, and what the next one answers. */
  rpcCalls: [] as Array<[string, unknown]>,
  rpcAnswer: { data: null as unknown, error: null as unknown },
  /** A cards column the database doesn't have (42703 when a select names it). */
  missingColumn: null as string | null,
}));

function client() {
  return {
    async rpc(name: string, args: unknown) {
      s.rpcCalls.push([name, args]);
      return s.rpcAnswer;
    },
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
          const select = String(call.ops.find((op) => op[0] === "select")?.[1] ?? "");
          if (s.missingColumn && select.split(", ").includes(s.missingColumn)) {
            return { data: null, error: { code: "42703", message: `column cards.${s.missingColumn} does not exist` } };
          }
          const ids = (call.ops.find((op) => op[0] === "in")?.[2] ?? []) as string[];
          return { data: ids.map((id) => ({ id, title: id, color_identity: [], owner_id: s.cardOwner[id] ?? "owner-1", visibility: s.cardVisibility[id] ?? "public" })), error: null };
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
  DECK_PAGE_CARD_COLUMNS,
  listDeckCards,
  listDeckPageCards,
  listMyDecks,
  listPublicDecks,
  listPublicDecksByOwner,
  listPublicDecksContaining,
  listPublicDeckTilesContaining,
  listTrendingDecks,
  publicDeckCountsForCards,
  countPublicDecksForCard,
  CARD_PAGE_DECKS_MAX,
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
  s.cardVisibility = {};
  s.rpcCalls = [];
  s.rpcAnswer = { data: null, error: null };
  s.missingColumn = null;
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
    s.rows.decks = [{ owner_id: "owner-1" }];
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

  it("another creator's card that is no longer PUBLIC is withheld (M2: RLS hands an unlisted card to anyone)", async () => {
    s.rows.decks = [{ owner_id: "owner-1" }];
    s.rows.profiles = [{ id: "artist-1", username: "dev_artist" }];
    s.cardOwner = { "card-unlisted": "artist-1", "card-public": "artist-1" };
    s.cardVisibility = { "card-unlisted": "unlisted", "card-public": "public", "card-own-unlisted": "unlisted", "card-own-private": "private" };
    s.entries = [
      { id: "e1", deck_id: "d", board: "main", quantity: 1, position: 0, card_id: "card-unlisted", name: "Theirs, unlisted", source: "link" },
      { id: "e2", deck_id: "d", board: "main", quantity: 1, position: 1, card_id: "card-public", name: "Theirs, public", source: "link" },
      { id: "e3", deck_id: "d", board: "main", quantity: 1, position: 2, card_id: "card-own-unlisted", name: "Mine, unlisted", source: "creator" },
      { id: "e4", deck_id: "d", board: "main", quantity: 1, position: 3, card_id: "card-own-private", name: "Mine, private", source: "creator" },
    ];
    const items = await listDeckCards("d");
    // Withheld: no card, no credit — the entry keeps its card_id and name
    // ("No longer available" to the owner).
    expect(items.map((item) => [item.entry.name, item.card?.id ?? null, item.cardOwner])).toEqual([
      ["Theirs, unlisted", null, null],
      ["Theirs, public", "card-public", { username: "dev_artist" }],
      ["Mine, unlisted", "card-own-unlisted", null],
      ["Mine, private", "card-own-private", null],
    ]);
    expect(items[0]!.entry.card_id).toBe("card-unlisted");
  });

  it("no readable deck row: no entries (another creator's card can't be told from the owner's)", async () => {
    s.rows.decks = [];
    s.entries = [{ id: "e", deck_id: "d", board: "main", quantity: 1, position: 0, card_id: "card-own", name: "Own" }];
    expect(await listDeckCards("d")).toEqual([]);
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
    s.rows.decks = [{ owner_id: "owner-1" }];
    s.entries = Array.from({ length: 99 }, (_, i) => ({ id: `e-${i}`, deck_id: "d", board: "main", quantity: 1, position: i, card_id: null, name: `C${i}` }));
    expect(await listDeckCards("d")).toHaveLength(99);
    expect(s.calls.filter((c) => c.table === "deck_cards")).toHaveLength(1);
  });
});

// The deck PAGE's read (TODO DK5.11): listDeckCards' rules with only the
// columns the page draws — never `cards.*`.
describe("listDeckPageCards", () => {
  const cardSelects = () =>
    s.calls.filter((c) => c.table === "cards").map((c) => String(c.ops.find((op) => op[0] === "select")?.[1]));

  it("names its columns (no `*`), and keeps the D3 rule and the makers' credit", async () => {
    s.rows.decks = [{ owner_id: "owner-1" }];
    s.rows.profiles = [{ id: "artist-1", username: "dev_artist" }];
    s.cardOwner = { "card-unlisted": "artist-1", "card-public": "artist-1" };
    s.cardVisibility = { "card-unlisted": "unlisted", "card-public": "public", "card-own-private": "private" };
    s.entries = [
      { id: "e1", deck_id: "d", board: "main", quantity: 1, position: 0, card_id: "card-unlisted", name: "Theirs, unlisted", source: "link" },
      { id: "e2", deck_id: "d", board: "main", quantity: 1, position: 1, card_id: "card-public", name: "Theirs, public", source: "link" },
      { id: "e3", deck_id: "d", board: "main", quantity: 1, position: 2, card_id: "card-own-private", name: "Mine, private", source: "creator" },
    ];
    const items = await listDeckPageCards("d");
    expect(items.map((item) => [item.card?.id ?? null, item.cardOwner])).toEqual([
      [null, null],
      ["card-public", { username: "dev_artist" }],
      ["card-own-private", null],
    ]);
    expect(cardSelects()).toEqual([DECK_PAGE_CARD_COLUMNS.join(", ")]);
    expect(cardSelects()[0]).not.toContain("*");
    for (const column of ["search_vector", "metadata", "oracle_text", "created_at"]) {
      expect(cardSelects()[0]!.split(", ")).not.toContain(column);
    }
  });

  it("a database without 0144: read again ONCE without both provenance columns (#664's degrade)", async () => {
    s.rows.decks = [{ owner_id: "owner-1" }];
    s.missingColumn = "import_scryfall_id";
    s.entries = [{ id: "e", deck_id: "d", board: "main", quantity: 1, position: 0, card_id: "card-own", name: "Own" }];
    const items = await listDeckPageCards("d");
    expect(items[0]!.card?.id).toBe("card-own");
    const [first, second, ...rest] = cardSelects();
    expect(rest).toEqual([]);
    expect(first).toContain("import_scryfall_id");
    expect(second!.split(", ")).not.toContain("import_scryfall_id");
    expect(second!.split(", ")).not.toContain("import_fingerprint");
    expect(second!.split(", ")).toContain("title");
  });

  it("any other error reads no cards — never a retry loop", async () => {
    s.rows.decks = [{ owner_id: "owner-1" }];
    s.missingColumn = "title";
    s.entries = [{ id: "e", deck_id: "d", board: "main", quantity: 1, position: 0, card_id: "card-own", name: "Own" }];
    const items = await listDeckPageCards("d");
    expect(items[0]!.card).toBeNull();
    expect(cardSelects()).toHaveLength(1);
  });
});

// The card page's "In decks" and its JSON-LD isPartOf (D3, the reviewer's
// L3): ONE read, the database's rule (0144 public_decks_containing_card —
// the owner's own public non-empty decks, another real creator's while the
// card is public; the throwaway account's deck is proved left out on the
// local stack, PR body). No table is read around it.
describe("listPublicDecksContaining", () => {
  it("is the 0144 function (since 0149 over the shared pairs), six at most, mapped as it answers", async () => {
    s.rpcAnswer = { data: [{ slug: "dev_pro/elves", title: "Elves" }], error: null };
    expect(await listPublicDecksContaining("card-in-decks")).toEqual([{ slug: "dev_pro/elves", title: "Elves" }]);
    expect(s.rpcCalls).toEqual([["public_decks_containing_card", { p_card_id: "card-in-decks", p_limit: CARD_PAGE_DECKS_MAX }]]);
    expect(s.calls).toHaveLength(0);
  });

  it("names none on a database the function hasn't reached (never the old any-deck read)", async () => {
    s.rpcAnswer = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    expect(await listPublicDecksContaining("card-before-0144")).toEqual([]);
    expect(s.calls).toHaveLength(0);
  });
});

// TODO DK8.4: the gallery's "In N decks" — ONE batched call per page of
// cards, the card page's own rule (0149 public_deck_counts_for_cards over
// public_deck_card_pairs, the function the list reads too). A card no deck
// names is absent (0); an unreadable answer is null — the tile says nothing.
describe("publicDeckCountsForCards / countPublicDecksForCard", () => {
  it("is one call for the page, mapped by card", async () => {
    s.rpcAnswer = { data: [{ card_id: "c1", deck_count: 3 }], error: null };
    const counts = await publicDeckCountsForCards(client() as never, ["c1", "c2"]);
    expect(s.rpcCalls).toEqual([["public_deck_counts_for_cards", { p_card_ids: ["c1", "c2"] }]]);
    expect(counts?.get("c1")).toBe(3);
    expect(counts?.get("c2")).toBeUndefined();
    expect(s.calls).toHaveLength(0);
  });

  it("no ids, no call; an unreadable answer (0149 not reached) is null, never a wrong 0", async () => {
    expect(await publicDeckCountsForCards(client() as never, [])).toEqual(new Map());
    expect(s.rpcCalls).toHaveLength(0);
    s.rpcAnswer = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    expect(await publicDeckCountsForCards(client() as never, ["c1"])).toBeNull();
    expect(await countPublicDecksForCard("c1")).toBeNull();
  });

  it("one card: its count, 0 when no public deck names it", async () => {
    s.rpcAnswer = { data: [], error: null };
    expect(await countPublicDecksForCard("c9")).toBe(0);
    s.rpcAnswer = { data: [{ card_id: "c9", deck_count: 2 }], error: null };
    expect(await countPublicDecksForCard("c9")).toBe(2);
  });
});

// The card page's "Decks with this card" tiles are the SAME list as its
// "In decks" row and JSON-LD isPartOf — hydrated by slug, in the list's
// order, never a second rule.
describe("listPublicDeckTilesContaining", () => {
  it("hydrates the list's decks in the list's order, public rows only, anonymously", async () => {
    s.rpcAnswer = { data: [{ slug: "b", title: "B" }, { slug: "a", title: "A" }], error: null };
    s.rows.decks = [deckRow("a", 60, 10), deckRow("b", 99, 50)];
    const decks = await listPublicDeckTilesContaining("card-x");
    expect(decks.map((d) => d.slug)).toEqual(["b", "a"]);
    expect(decks[0]).toMatchObject({ cards_count: 99, linked_count: 50, liked_by_viewer: false });
    const deckQuery = s.calls.find((c) => c.table === "decks");
    expect(hasOp(deckQuery, "in", "slug", ["b", "a"])).toBe(true);
    expect(hasOp(deckQuery, "eq", "visibility", "public")).toBe(true);
    // No viewer read: the like hearts hydrate client-side.
    expect(s.calls.some((c) => c.table === "deck_likes")).toBe(false);
  });

  it("an empty list reads no deck", async () => {
    s.rpcAnswer = { data: [], error: null };
    expect(await listPublicDeckTilesContaining("card-y")).toEqual([]);
    expect(s.calls).toHaveLength(0);
  });
});

// TODO DK8.2: "Trending now" is 0149's list_trending_decks (the week's
// likes; real creators' non-empty decks only — no admin-owned deck, no
// throwaway account's — proved on the local stack),
// hydrated with owners, cookie-free; nothing to show (or no function yet)
// lists none, and the row hides itself.
describe("listTrendingDecks", () => {
  it("asks the function for a row's worth, in its order, with owners", async () => {
    s.rpcAnswer = { data: [deckRow("hot", 60, 20), deckRow("warm", 40, 0)], error: null };
    s.rows.profiles = [{ id: "owner-1", username: "dev_pro", display_name: "Priya", avatar_url: null }];
    const decks = await listTrendingDecks();
    expect(s.rpcCalls).toEqual([["list_trending_decks", { p_limit: 4 }]]);
    expect(decks.map((d) => d.id)).toEqual(["hot", "warm"]);
    expect(decks[0].owner?.username).toBe("dev_pro");
    expect(s.calls.some((c) => c.table === "deck_likes")).toBe(false);
  });

  it("lists none on an error or an empty week", async () => {
    s.rpcAnswer = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    expect(await listTrendingDecks()).toEqual([]);
    s.rpcAnswer = { data: [], error: null };
    expect(await listTrendingDecks()).toEqual([]);
  });
});

// TODO DK8.5: a profile's "See all decks" — /decks/browse?owner=<handle>.
describe("listPublicDecks — one creator's decks", () => {
  it("resolves the handle and filters on its owner id; an unknown handle lists nothing", async () => {
    s.rows.profiles = [{ id: "owner-9" }];
    s.rows.decks = [deckRow("a", 60, 0)];
    await listPublicDecks({ ownerUsername: "Dev_Artist", anonymous: true });
    const profileQuery = s.calls.find((c) => c.table === "profiles");
    expect(hasOp(profileQuery, "eq", "username", "dev_artist")).toBe(true);
    expect(hasOp(s.calls.find((c) => c.table === "decks"), "eq", "owner_id", "owner-9")).toBe(true);

    s.calls = [];
    s.rows.profiles = [];
    expect(await listPublicDecks({ ownerUsername: "nobody_here", anonymous: true })).toEqual([]);
    expect(s.calls.some((c) => c.table === "decks" && hasOp(c, "range", 0, 23))).toBe(false);
  });
});
