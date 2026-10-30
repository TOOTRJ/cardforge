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
// The commit core (import_deck_entries + the Scryfall re-fetch) — its own
// suite is tests/unit/decks/import-commit.test.ts.
vi.mock("@/lib/decks/import-commit", () => ({ commitImportLines: state.commit }));
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
        { id: id(1), name: "Card 1", board: "side", quantity: 4, scryfallId: SF, cardId: null, source: "import", featuredRank: null },
        { id: id(2), name: "Card 2", board: "main", quantity: 1, scryfallId: null, cardId: CARD, source: "creator", featuredRank: null },
      ],
    });
    const deletes = stub.forTable("deck_cards").filter((e) => called(e.calls, "delete"));
    expect(deletes).toHaveLength(1);
    expect(eqArg(deletes[0]!.calls, "deck_id")).toBe(DECK);
    expect(state.revalidations).toEqual(["ness"]);
  });
});

// ---------------------------------------------------------------------------
// The undo against a deck that BEHAVES like the database: reads, updates
// and deletes held to their filters and kept, import_deck_entries' merge
// (a line goes into the FIRST row of the deck with its board and key, else
// a new row at the end — and two lines with one key are refused), the
// featured_rank unique index and the D3 link guard.
// ---------------------------------------------------------------------------

const BOLT = "e3285e6b-3e79-4d7c-bf96-d920f973b80c";
const SENTINEL = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OTHER_CARD = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

type Row = ReturnType<typeof row> & { featured_rank?: number | null };

const sim = {
  nextId: 500,
  /** Card ids the D3 guard refuses to link. */
  unlinkable: new Set<string>(),
  /** Run inside the commit, before it writes (another tab's write). */
  beforeCommit: null as null | (() => void),
};

function rowMatches(rowValue: Record<string, unknown>, calls: ChainCall[]): boolean {
  return calls.every((c) => {
    if (c.method === "eq") return rowValue[c.args[0] as string] === c.args[1];
    if (c.method === "in") return (c.args[1] as unknown[]).includes(rowValue[c.args[0] as string]);
    if (c.method === "is") return (rowValue[c.args[0] as string] ?? null) === c.args[1];
    return true;
  });
}

function liveDb() {
  const stub = chainClient((table, calls): ChainAnswer => {
    if (table === "decks") return { data: state.deck, error: null };
    if (table !== "deck_cards") return { data: null, error: null };
    const rows = state.rows as Row[];
    if (called(calls, "update")) {
      const patch = payloadOf(calls, "update") as Record<string, unknown>;
      const hit = rows.filter((r) => rowMatches(r, calls));
      if (typeof patch.card_id === "string" && sim.unlinkable.has(patch.card_id)) {
        return { data: null, error: { message: "deck_card_not_linkable" } };
      }
      if (typeof patch.featured_rank === "number" && rows.some((r) => !hit.includes(r) && r.featured_rank === patch.featured_rank)) {
        return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } };
      }
      for (const r of hit) Object.assign(r, patch);
      return { data: hit.map((r) => ({ ...r })), error: null };
    }
    if (called(calls, "delete")) {
      const hit = rows.filter((r) => rowMatches(r, calls));
      state.rows = rows.filter((r) => !hit.includes(r));
      return { data: hit.map((r) => ({ ...r })), error: null };
    }
    const read = rows.filter((r) => rowMatches(r, calls)).sort((a, b) => a.position - b.position);
    return { data: read.map((r) => ({ ...r })), error: null, count: read.length };
  });
  state.client = stub.client;
  // import_deck_entries, as 0143/0144 write it.
  state.commit.mockImplementation(async (payload: { lines: Array<{ name: string; quantity: number; board: string; resolved: { scryfall_id: string } | null }> }) => {
    sim.beforeCommit?.();
    const rows = state.rows as Row[];
    const keyOf = (board: string, sid: string | null, name: string) => `${board}|${sid ?? `name:${name.trim().toLowerCase()}`}`;
    const keys = payload.lines.map((l) => keyOf(l.board, l.resolved?.scryfall_id ?? null, l.name));
    if (new Set(keys).size !== keys.length) return { ok: false, error: "import_entries_invalid: two entries share a board and a card" };
    let added = 0;
    let merged = 0;
    for (const [i, line] of payload.lines.entries()) {
      const hit = [...rows]
        .sort((a, b) => a.position - b.position)
        .find((r) => keyOf(r.board, r.scryfall_id as string | null, r.name) === keys[i]);
      if (hit) {
        hit.quantity += line.quantity;
        merged += 1;
        continue;
      }
      const position = Math.max(-1, ...rows.map((r) => r.position)) + 1;
      rows.push(row(sim.nextId++, { name: line.name, board: line.board, quantity: line.quantity, scryfall_id: line.resolved?.scryfall_id ?? null, position }));
      added += 1;
    }
    return { ok: true, added, merged, placeholders: 0 };
  });
  return stub;
}

const live = () => state.rows as Row[];
const onBoard = (board: string) => live().filter((r) => r.board === board);
const strip = ({ id: rowId, board, quantity, card_id, featured_rank }: Row) => ({ id: rowId, board, quantity, card_id, featured_rank: featured_rank ?? null });

describe("restoreDeckEntriesAction — a removal undone: each entry a NEW row, never merged or relinked", () => {
  beforeEach(() => {
    sim.nextId = 500;
    sim.unlinkable = new Set();
    sim.beforeCommit = null;
  });

  it("the review's case: 4 plain Lightning Bolt + your Bolt moved onto the Mainboard, removed, undone — two rows again, the plain one untouched", async () => {
    state.rows = [
      row(1, { name: "Lightning Bolt", scryfall_id: BOLT, board: "main", quantity: 4 }),
      row(2, { name: "Lightning Bolt", scryfall_id: BOLT, board: "side", quantity: 1, card_id: SENTINEL }),
    ];
    const stub = liveDb();
    // Move the sideboard copy to the Mainboard: its own row still (a Move
    // never merges).
    expect((await updateDeckEntriesAction({ deckId: DECK, updates: [{ id: id(2), board: "main" }] })).ok).toBe(true);
    expect(onBoard("main").map(strip)).toEqual([
      { id: id(1), board: "main", quantity: 4, card_id: null, featured_rank: null },
      { id: id(2), board: "main", quantity: 1, card_id: SENTINEL, featured_rank: null },
    ]);
    const removal = await removeDeckEntriesAction({ deckId: DECK, entryIds: [id(2)] });
    if (!removal.ok) throw new Error(removal.error);

    const result = await restoreDeckEntriesAction({ deckId: DECK, entries: removal.removed });

    // Never "Solemn Sentinel ×5": the plain row is as it was, and your
    // version is a row of its own on the Mainboard again.
    expect(onBoard("main").map(strip)).toEqual([
      { id: id(1), board: "main", quantity: 4, card_id: null, featured_rank: null },
      { id: id(500), board: "main", quantity: 1, card_id: SENTINEL, featured_rank: null },
    ]);
    expect(live()).toHaveLength(2);
    expect(result).toEqual({ ok: true, restored: [{ from: id(2), to: id(500) }] });
    // The row the deck held is never written by the undo.
    const undoWrites = stub.forTable("deck_cards").filter((e) => called(e.calls, "update")).slice(1);
    expect(undoWrites.every((e) => eqArg(e.calls, "id") === id(500))).toBe(true);
    // Written on another board (its own holds the printing), then moved home.
    expect(state.commit).toHaveBeenCalledWith(
      { deckId: DECK, lines: [{ name: "Lightning Bolt", quantity: 1, board: "maybe", resolved: { scryfall_id: BOLT } }] },
      { quota: "named", revalidate: false },
    );
  });

  it("two rows of one printing removed together come back as two rows — none lost, each with its own card", async () => {
    state.rows = [
      row(1, { name: "Lightning Bolt", scryfall_id: BOLT, board: "main", quantity: 4 }),
      row(2, { name: "Lightning Bolt", scryfall_id: BOLT, board: "main", quantity: 1, card_id: SENTINEL }),
      row(3, { name: "Lightning Bolt", scryfall_id: BOLT, board: "main", quantity: 2, card_id: OTHER_CARD }),
      row(4, { name: "Island", board: "main", quantity: 7 }),
    ];
    liveDb();
    const removal = await removeDeckEntriesAction({ deckId: DECK, entryIds: [id(1), id(2), id(3)] });
    if (!removal.ok) throw new Error(removal.error);
    const result = await restoreDeckEntriesAction({ deckId: DECK, entries: removal.removed });
    if (!result.ok) throw new Error(result.error);
    expect(result.restored.every((r) => r.to && !r.note)).toBe(true);
    expect(
      onBoard("main")
        .filter((r) => r.scryfall_id === BOLT)
        .map(({ quantity, card_id }) => ({ quantity, card_id }))
        .sort((a, b) => a.quantity - b.quantity),
    ).toEqual([
      { quantity: 1, card_id: SENTINEL },
      { quantity: 2, card_id: OTHER_CARD },
      { quantity: 4, card_id: null },
    ]);
    expect(onBoard("main").find((r) => r.name === "Island")?.quantity).toBe(7);
    // ONE commit (three boards free), ONE revalidation.
    expect(state.commit).toHaveBeenCalledTimes(1);
    expect(state.revalidations).toEqual(["ness", "ness"]);
  });

  it("more rows of one printing than free boards: they come back over more rounds, all of them", async () => {
    state.rows = Array.from({ length: 6 }, (_, i) =>
      row(i + 1, { name: "Lightning Bolt", scryfall_id: BOLT, board: "main", quantity: i + 1 }),
    );
    liveDb();
    const removal = await removeDeckEntriesAction({ deckId: DECK, entryIds: state.rows.map((r) => r.id as string) });
    if (!removal.ok) throw new Error(removal.error);
    const result = await restoreDeckEntriesAction({ deckId: DECK, entries: removal.removed });
    if (!result.ok) throw new Error(result.error);
    expect(result.restored.filter((r) => r.to)).toHaveLength(6);
    expect(onBoard("main").map((r) => r.quantity).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(live()).toHaveLength(6);
    expect(state.commit).toHaveBeenCalledTimes(2);
  });

  it("carries the cover pick back (0150) — and says so when another card took its place meanwhile", async () => {
    state.rows = [
      row(1, { name: "Sol Ring", scryfall_id: SF, board: "main", quantity: 1, featured_rank: 2 }),
      row(2, { name: "Ember Wyrm", board: "main", quantity: 1, card_id: CARD, source: "creator", featured_rank: 1 }),
    ];
    liveDb();
    state.membership.mockImplementation(async ({ add }: { add: string[] }) => {
      const entryId = id(sim.nextId++);
      live().push(row(Number(entryId.slice(-12)), { name: "Ember Wyrm", card_id: add[0], source: "link", position: 99 }));
      return {
        ok: true,
        deckId: DECK,
        deckTitle: "Ness",
        deckSlug: "ness",
        results: [{ cardId: add[0], status: "added" }],
        entries: [{ cardId: add[0], deckId: DECK, entryId, board: "main", quantity: 1 }],
      };
    });
    const removal = await removeDeckEntriesAction({ deckId: DECK, entryIds: [id(1), id(2)] });
    if (!removal.ok) throw new Error(removal.error);
    expect(removal.removed.map((r) => r.featuredRank)).toEqual([2, 1]);
    // Meanwhile another entry takes rank 1.
    live().push(row(9, { name: "Plains", featured_rank: 1, position: 50 }));
    const result = await restoreDeckEntriesAction({ deckId: DECK, entries: removal.removed });
    expect(live().find((r) => r.name === "Sol Ring")?.featured_rank).toBe(2);
    expect(live().find((r) => r.name === "Ember Wyrm")?.featured_rank ?? null).toBe(null);
    expect(result).toEqual({
      ok: true,
      restored: [
        { from: id(1), to: id(500) },
        { from: id(2), to: id(501), note: "Ember Wyrm is back, but no longer featured on the cover." },
      ],
    });
  });

  it("a row of the same printing written meanwhile (another tab) that the commit merged into gets its count back — the entry is reported, not glued on", async () => {
    state.rows = [row(1, { name: "Lightning Bolt", scryfall_id: BOLT, board: "main", quantity: 1, card_id: SENTINEL })];
    liveDb();
    const removal = await removeDeckEntriesAction({ deckId: DECK, entryIds: [id(1)] });
    if (!removal.ok) throw new Error(removal.error);
    sim.beforeCommit = () => {
      live().push(row(7, { name: "Lightning Bolt", scryfall_id: BOLT, board: "main", quantity: 3, position: 7 }));
      sim.beforeCommit = null;
    };
    const result = await restoreDeckEntriesAction({ deckId: DECK, entries: removal.removed });
    expect(live().map(strip)).toEqual([{ id: id(7), board: "main", quantity: 3, card_id: null, featured_rank: null }]);
    expect(result).toEqual({
      ok: true,
      restored: [{ from: id(1), to: null, note: "Lightning Bolt couldn't come back as its own entry. Try again." }],
    });
  });

  it("a merge that took a row written meanwhile to the 250 cap leaves that row alone and says so — never sets it to 0", async () => {
    state.rows = [row(1, { name: "Lightning Bolt", scryfall_id: BOLT, board: "main", quantity: 250, card_id: SENTINEL })];
    const stub = liveDb();
    const removal = await removeDeckEntriesAction({ deckId: DECK, entryIds: [id(1)] });
    if (!removal.ok) throw new Error(removal.error);
    // The import RPC caps a merge at 250.
    state.commit.mockImplementation(async () => {
      live().push(row(7, { name: "Lightning Bolt", scryfall_id: BOLT, board: "main", quantity: 250, position: 7 }));
      return { ok: true, added: 0, merged: 1, placeholders: 0 };
    });
    const writesBefore = stub.forTable("deck_cards").filter((e) => called(e.calls, "update")).length;
    const result = await restoreDeckEntriesAction({ deckId: DECK, entries: removal.removed });
    expect(live().map(strip)).toEqual([{ id: id(7), board: "main", quantity: 250, card_id: null, featured_rank: null }]);
    expect(stub.forTable("deck_cards").filter((e) => called(e.calls, "update")).length).toBe(writesBefore);
    expect(result).toEqual({
      ok: true,
      restored: [
        {
          from: id(1),
          to: null,
          note: "Lightning Bolt couldn't come back as its own entry, and was added to another Lightning Bolt row that is now at 250 copies — check its count.",
        },
      ],
    });
  });

  it("names and placeholders come back as rows of their own too; a card the D3 guard refuses comes back as the real card", async () => {
    state.rows = [
      row(1, { name: "Mystery Card", board: "main", quantity: 2 }),
      row(2, { name: "Mystery Card", board: "main", quantity: 1 }),
      row(3, { name: "Sol Ring", scryfall_id: SF, board: "side", quantity: 1, card_id: OTHER_CARD }),
    ];
    liveDb();
    sim.unlinkable.add(OTHER_CARD);
    const removal = await removeDeckEntriesAction({ deckId: DECK, entryIds: [id(2), id(3)] });
    if (!removal.ok) throw new Error(removal.error);
    const result = await restoreDeckEntriesAction({ deckId: DECK, entries: removal.removed });
    expect(onBoard("main").map((r) => r.quantity)).toEqual([2, 1]);
    expect(onBoard("side").map(strip)).toEqual([{ id: id(501), board: "side", quantity: 1, card_id: null, featured_rank: null }]);
    expect(result).toEqual({
      ok: true,
      restored: [
        { from: id(2), to: id(500) },
        { from: id(3), to: id(501), note: "Sol Ring came back without its card — that card is no longer available." },
      ],
    });
  });

  it("a PipGlyph card already back in the deck on another row stays that row — the removed entry doesn't become it", async () => {
    state.membership.mockResolvedValue({
      ok: true,
      deckId: DECK,
      deckTitle: "Ness",
      deckSlug: "ness",
      results: [{ cardId: CARD, status: "already" }],
      entries: [{ cardId: CARD, deckId: DECK, entryId: id(8), board: "side", quantity: 3 }],
    });
    liveDb();
    const result = await restoreDeckEntriesAction({
      deckId: DECK,
      entries: [{ id: id(3), name: "Ember Wyrm", board: "main", quantity: 1, scryfallId: null, cardId: CARD, source: "creator" }],
    });
    expect(result).toEqual({ ok: true, restored: [{ from: id(3), to: null, note: "Ember Wyrm is already in the deck." }] });
    expect(state.revalidations).toEqual([]);
  });

  it("says, entry by entry, what couldn't come back — and why", async () => {
    liveDb();
    state.commit.mockResolvedValue({ ok: false, error: "Scryfall didn't respond — nothing was imported. Try again in a moment." });
    state.membership.mockResolvedValue({
      ok: true,
      deckId: DECK,
      deckTitle: "Ness",
      deckSlug: "ness",
      results: [{ cardId: CARD, status: "deck_full", error: "“Ness” is full." }],
      entries: [],
    });
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

  it("a PipGlyph card alone comes back through the membership writer, then its board and count — no insert anywhere", async () => {
    state.membership.mockImplementation(async ({ add }: { add: string[] }) => {
      live().push(row(12, { name: "Ember Wyrm", card_id: add[0], source: "link", position: 12 }));
      return {
        ok: true,
        deckId: DECK,
        deckTitle: "Ness",
        deckSlug: "ness",
        results: [{ cardId: add[0], status: "added" }],
        entries: [{ cardId: add[0], deckId: DECK, entryId: id(12), board: "main", quantity: 1 }],
      };
    });
    const stub = liveDb();
    const result = await restoreDeckEntriesAction({
      deckId: DECK,
      entries: [{ id: id(3), name: "Ember Wyrm", board: "commander", quantity: 2, scryfallId: null, cardId: CARD, source: "creator" }],
    });
    expect(state.membership).toHaveBeenCalledWith({ deckId: DECK, add: [CARD] });
    expect(state.commit).not.toHaveBeenCalled();
    expect(stub.log.some((e) => called(e.calls, "insert"))).toBe(false);
    expect(live().map(strip)).toEqual([{ id: id(12), board: "commander", quantity: 2, card_id: CARD, featured_rank: null }]);
    expect(result).toEqual({ ok: true, restored: [{ from: id(3), to: id(12) }] });
    expect(state.revalidations).toEqual(["ness"]);
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
    // ONE card: the single-card quota, and the add revalidates once itself.
    expect(state.commit).toHaveBeenCalledWith(
      { deckId: DECK, lines: [{ name: "Sol Ring", quantity: 1, board: "side", resolved: { scryfall_id: SF } }] },
      { quota: "named", revalidate: false },
    );
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

  it("privateCard publish (TODO DK0.13): the writer makes it public first; the answer says so", async () => {
    state.rows = [];
    state.membership.mockResolvedValue({
      ok: true,
      deckId: DECK,
      deckTitle: "Ness",
      deckSlug: "ness",
      results: [{ cardId: CARD, status: "added", published: true }],
      entries: [{ cardId: CARD, deckId: DECK, entryId: id(7), board: "main", quantity: 1 }],
    });
    db();
    const result = await addToDeckAction({ deckId: DECK, board: "main", pick: { kind: "card", cardId: CARD }, privateCard: "publish" });
    expect(state.membership).toHaveBeenCalledWith({ deckId: DECK, add: [CARD], publish: [CARD] });
    expect(result).toMatchObject({ ok: true, entryId: id(7), published: true });
  });

  it("privateCard publish refused: not added, in the writer's words — and public-but-full says both", async () => {
    state.rows = [];
    state.membership.mockResolvedValue({
      ok: true,
      deckId: DECK,
      deckTitle: "Ness",
      deckSlug: "ness",
      results: [{ cardId: CARD, status: "publish_refused", error: "Its rules text includes strong language, so it stays private. Remove it to publish." }],
      entries: [],
    });
    db();
    expect(
      await addToDeckAction({ deckId: DECK, board: "main", pick: { kind: "card", cardId: CARD }, privateCard: "publish" }),
    ).toEqual({ ok: false, error: "Its rules text includes strong language, so it stays private. Remove it to publish." });
    state.membership.mockResolvedValue({
      ok: true,
      deckId: DECK,
      deckTitle: "Ness",
      deckSlug: "ness",
      results: [{ cardId: CARD, status: "deck_full", error: "“Ness” is full.", published: true }],
      entries: [],
    });
    expect(
      await addToDeckAction({ deckId: DECK, board: "main", pick: { kind: "card", cardId: CARD }, privateCard: "publish" }),
    ).toEqual({ ok: false, error: "Made public, but not added: “Ness” is full." });
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
