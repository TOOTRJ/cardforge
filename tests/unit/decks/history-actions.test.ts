import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, type ChainAnswer, type ChainCall } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// The History view's read and "Restore this version" (TODO DK5.13). The gate
// is the server's, every call: signed in, a plan that reads history (Plus:
// 30 days, Pro: everything, free: locked — getEntitlements' EFFECTIVE tier),
// the deck the caller's. A restore never touches another user's deck and
// never inserts a row itself: it writes through the batch actions (which
// check the owner again and judge D3 / the private-card rules on every card
// that comes back).
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const DECK = "33333333-3333-4333-8333-333333333333";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const state = vi.hoisted(() => ({
  client: null as unknown,
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
  owner: "11111111-1111-4111-8111-111111111111",
  tier: "pro" as string,
  version: null as null | { id: number; changed_at: string },
  log: [] as unknown[],
  rows: [] as unknown[],
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
  getCurrentUser: async () => state.user,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlements: async () => ({ effectiveTier: state.tier }),
}));
const actions = vi.hoisted(() => ({
  updateDeckEntriesAction: vi.fn(),
  removeDeckEntriesAction: vi.fn(),
  restoreDeckEntriesAction: vi.fn(),
}));
vi.mock("@/lib/decks/card-actions", () => actions);

import { listDeckHistoryAction, restoreDeckVersionAction } from "@/lib/decks/history-actions";

const snap = (name: string, quantity = 1, board = "main") => ({ name, board, quantity, scryfall_id: null, card_id: null, source: "import", featured_rank: null });
const recent = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function db() {
  const stub = chainClient((table: string, calls: ChainCall[]): ChainAnswer => {
    if (table === "decks") return { data: { id: DECK, owner_id: state.owner }, error: null };
    if (table === "deck_cards") return called(calls, "range") && (calls.find((c) => c.method === "range")!.args[0] as number) > 0 ? { data: [] } : { data: state.rows };
    if (table === "deck_entry_changes") {
      if (called(calls, "maybeSingle")) return { data: state.version };
      if (called(calls, "limit", 1)) return { data: state.log.slice(0, 1) };
      if (called(calls, "range")) return (calls.find((c) => c.method === "range")!.args[0] as number) > 0 ? { data: [] } : { data: state.log.filter((row) => (row as { id: number }).id > (state.version?.id ?? 0)) };
      return { data: state.log };
    }
    return { data: null };
  });
  state.client = stub.client;
  return stub;
}

beforeEach(() => {
  state.user = { id: USER };
  state.owner = USER;
  state.tier = "pro";
  state.version = null;
  state.log = [];
  state.rows = [];
  for (const fn of Object.values(actions)) fn.mockReset();
});

describe("listDeckHistoryAction", () => {
  it("free is locked before any read of the log", async () => {
    const stub = db();
    state.tier = "free";
    expect(await listDeckHistoryAction({ deckId: DECK })).toEqual({ ok: false, error: "locked" });
    expect(stub.forTable("deck_entry_changes")).toEqual([]);
  });

  it("another user's deck is not found — its log is never read", async () => {
    const stub = db();
    state.owner = OTHER;
    expect(await listDeckHistoryAction({ deckId: DECK })).toEqual({ ok: false, error: "not_found" });
    expect(stub.forTable("deck_entry_changes")).toEqual([]);
  });

  it("Plus reads the last 30 days only; Pro reads everything", async () => {
    let stub = db();
    state.tier = "plus";
    state.log = [{ id: 2, entry_id: id(1), op: "update", before: snap("Sol Ring"), after: snap("Sol Ring", 2), actor_id: USER, tx: 2, changed_at: recent(5) }];
    const plus = await listDeckHistoryAction({ deckId: DECK });
    expect(plus).toMatchObject({ ok: true, access: { kind: "window", days: 30 }, headId: 2, nextBefore: null });
    const read = stub.forTable("deck_entry_changes").find((entry) => called(entry.calls, "limit", 301))!;
    expect(called(read.calls, "eq", "deck_id")).toBe(true);
    const since = read.calls.find((c) => c.method === "gte");
    expect(since?.args[0]).toBe("changed_at");
    const days = (Date.now() - Date.parse(String(since?.args[1]))) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);

    stub = db();
    state.tier = "pro";
    expect(await listDeckHistoryAction({ deckId: DECK })).toMatchObject({ ok: true, access: { kind: "full" } });
    expect(stub.forTable("deck_entry_changes").some((entry) => called(entry.calls, "gte"))).toBe(false);
  });
});

describe("restoreDeckVersionAction", () => {
  it("refuses free, and another user's deck, before any write", async () => {
    db();
    state.tier = "free";
    expect(await restoreDeckVersionAction({ deckId: DECK, changeId: 1 })).toMatchObject({ ok: false });
    state.tier = "pro";
    state.owner = OTHER;
    expect(await restoreDeckVersionAction({ deckId: DECK, changeId: 1 })).toEqual({ ok: false, error: "Deck not found or not yours." });
    for (const fn of Object.values(actions)) expect(fn).not.toHaveBeenCalled();
  });

  it("a version id of another deck (none in this deck's log) changes nothing", async () => {
    const stub = db();
    state.version = null;
    expect(await restoreDeckVersionAction({ deckId: DECK, changeId: 42 })).toMatchObject({ ok: false });
    const lookup = stub.forTable("deck_entry_changes").find((entry) => called(entry.calls, "maybeSingle"))!;
    expect(lookup.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([["deck_id", DECK], ["id", 42]]);
    for (const fn of Object.values(actions)) expect(fn).not.toHaveBeenCalled();
  });

  it("Plus can't restore past its 30 days", async () => {
    db();
    state.tier = "plus";
    state.version = { id: 3, changed_at: new Date(Date.now() - 40 * 86_400_000).toISOString() };
    const result = await restoreDeckVersionAction({ deckId: DECK, changeId: 3 });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("older than your plan keeps") });
    for (const fn of Object.values(actions)) expect(fn).not.toHaveBeenCalled();
  });

  it("puts the deck back through the batch actions — out, then counts, then lines back — on THIS deck only", async () => {
    db();
    state.version = { id: 3, changed_at: recent(60) };
    // Now: Sol Ring ×3, Bolt (added since). The version: Sol Ring ×1 and
    // Island ×20 (removed since).
    state.rows = [
      { id: id(1), ...snap("Sol Ring", 3) },
      { id: id(3), ...snap("Bolt") },
    ];
    state.log = [
      { id: 6, entry_id: id(3), op: "insert", before: null, after: snap("Bolt"), actor_id: USER, tx: 6, changed_at: recent(3) },
      { id: 5, entry_id: id(2), op: "delete", before: snap("Island", 20), after: null, actor_id: USER, tx: 5, changed_at: recent(4) },
      { id: 4, entry_id: id(1), op: "update", before: snap("Sol Ring", 1), after: snap("Sol Ring", 3), actor_id: USER, tx: 4, changed_at: recent(5) },
    ];
    const order: string[] = [];
    actions.removeDeckEntriesAction.mockImplementation(async () => (order.push("remove"), { ok: true, removed: [{ id: id(3) }] }));
    actions.updateDeckEntriesAction.mockImplementation(async () => (order.push("update"), { ok: true, entries: [{ id: id(1) }] }));
    actions.restoreDeckEntriesAction.mockImplementation(async () => (order.push("restore"), { ok: true, restored: [{ from: id(2), to: id(8) }] }));

    const result = await restoreDeckVersionAction({ deckId: DECK, changeId: 3 });
    expect(result).toEqual({ ok: true, headBefore: 6, removed: 1, changed: 1, restored: 1, notes: [] });
    expect(order).toEqual(["remove", "update", "restore"]);
    expect(actions.removeDeckEntriesAction).toHaveBeenCalledWith({ deckId: DECK, entryIds: [id(3)] });
    expect(actions.updateDeckEntriesAction).toHaveBeenCalledWith({ deckId: DECK, updates: [{ id: id(1), quantity: 1 }] });
    expect(actions.restoreDeckEntriesAction).toHaveBeenCalledWith({
      deckId: DECK,
      entries: [{ id: id(2), name: "Island", board: "main", quantity: 20, scryfallId: null, cardId: null, source: "import", featuredRank: null }],
    });
  });

  it("a card that can't come back (another creator's, private now) is said, not forced", async () => {
    db();
    state.version = { id: 1, changed_at: recent(60) };
    state.rows = [];
    state.log = [
      { id: 2, entry_id: id(5), op: "delete", before: { ...snap("Their Card"), card_id: id(70) }, after: null, actor_id: USER, tx: 2, changed_at: recent(1) },
    ];
    actions.restoreDeckEntriesAction.mockResolvedValue({
      ok: true,
      restored: [{ from: id(5), to: null, note: "Their Card couldn't come back." }],
    });
    const result = await restoreDeckVersionAction({ deckId: DECK, changeId: 1 });
    expect(result).toMatchObject({ ok: true, restored: 0, notes: ["Their Card couldn't come back."] });
    // The card goes through the restore path (the membership writer, D3) —
    // never an update that links it.
    expect(actions.updateDeckEntriesAction).not.toHaveBeenCalled();
    expect(actions.restoreDeckEntriesAction.mock.calls[0]![0]).toMatchObject({ deckId: DECK, entries: [{ cardId: id(70) }] });
  });

  it("nothing to write when the deck already reads as the version", async () => {
    db();
    state.version = { id: 4, changed_at: recent(5) };
    state.rows = [{ id: id(1), ...snap("Sol Ring") }];
    state.log = [{ id: 4, entry_id: id(1), op: "insert", before: null, after: snap("Sol Ring"), actor_id: USER, tx: 4, changed_at: recent(5) }];
    expect(await restoreDeckVersionAction({ deckId: DECK, changeId: 4 })).toEqual({ ok: true, headBefore: 4, removed: 0, changed: 0, restored: 0, notes: [] });
    for (const fn of Object.values(actions)) expect(fn).not.toHaveBeenCalled();
  });
});
