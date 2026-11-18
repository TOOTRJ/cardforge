import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Re-art deck — LOCKED cards (migration 0216, lib/tools/re-art/locks.ts) and
// the rule for UNDOING a run (model.ts reartUndoOf).
//
//   * A lock is a deck ENTRY's. It is read through the owner's session for
//     the studio and the plan, with the service role (owner named) for a
//     step. A read that FAILED is never "not locked" where a paint would
//     follow: those callers get null and stop.
//   * Locks are set and removed only for entries that ARE the deck's.
//   * An undo puts a card back only while the run's own record of it is
//     still the latest and its picture is still on the card: a re-rolled
//     card to the earlier picture the run kept, a first paint to the card's
//     own art, a real card the run made back to the real card. Anything
//     else is left as it is, and said why.
// ---------------------------------------------------------------------------

type Call = {
  table: string;
  op: "select" | "upsert" | "delete";
  columns?: string;
  head?: boolean;
  row?: unknown;
  options?: unknown;
  filters: Array<[string, unknown]>;
};
type Result = { data?: unknown; count?: number | null; error?: { message: string; code?: string } | null };

const m = vi.hoisted(() => ({
  session: vi.fn(),
  admin: vi.fn(),
  adminConfigured: vi.fn(),
}));

function clientOf(answerOf: (call: Call) => Promise<Result>) {
  return {
    from: (table: string) => {
      const call: Call = { table, op: "select", filters: [] };
      const answer = () => answerOf(call);
      const chain = {
        select: (columns: string, options?: { head?: boolean }) => {
          call.columns = columns;
          call.head = Boolean(options?.head);
          return chain;
        },
        upsert: (row: unknown, options?: unknown) => {
          call.op = "upsert";
          call.row = row;
          call.options = options;
          return chain;
        },
        delete: () => {
          call.op = "delete";
          return chain;
        },
        eq: (column: string, value: unknown) => {
          call.filters.push([column, value]);
          return chain;
        },
        in: (column: string, value: unknown) => {
          call.filters.push([column, value]);
          return chain;
        },
        limit: () => chain,
        then: (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) => answer().then(resolve, reject),
      };
      return chain;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => clientOf(async (call) => m.session(call)) }));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => m.adminConfigured(),
  createAdminClient: () => clientOf(async (call) => m.admin(call)),
}));

import { isCardLocked, isEntryLockedAdmin, readLocks, setLocks } from "@/lib/tools/re-art/locks";
import {
  REART_LOCKED_COPY,
  REART_UNDO_BATCH,
  REART_UNDO_NO_REFUND_COPY,
  REART_UNDO_SKIP_COPY,
  REART_UNLOCK_FIRST,
  reartLockedEntries,
  reartUndoDetail,
  reartUndoLine,
  reartUndoNote,
  reartUndoOf,
} from "@/lib/tools/re-art/model";

const ME = "u1";
const DECK = "00000000-0000-4000-8000-0000000000d1";
const CARD = "00000000-0000-4000-8000-0000000000c1";
const E = (n: number) => `00000000-0000-4000-8000-0000000000e${n}`;
const sessionCalls = () => m.session.mock.calls.map(([call]) => call as Call);
const adminCalls = () => m.admin.mock.calls.map(([call]) => call as Call);

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.adminConfigured.mockReturnValue(true);
});

describe("what a lock means, in words", () => {
  it("a run leaves a locked card; a one-card action is told to unlock it first", () => {
    expect(REART_LOCKED_COPY).toBe("Locked — left as it is. Unlock it to change its picture.");
    expect(REART_UNLOCK_FIRST).toBe("This card is locked on this deck — unlock it first.");
  });
});

describe("reading the deck's locks (the studio, the plan)", () => {
  it("is the owner's own session, by deck: the locked entries", async () => {
    m.session.mockResolvedValue({ data: [{ entry_id: E(1) }, { entry_id: E(2) }], error: null });
    expect(await readLocks(DECK)).toEqual(new Set([E(1), E(2)]));
    expect(sessionCalls()[0]).toMatchObject({ table: "deck_reart_locks", op: "select", filters: [["deck_id", DECK]] });
    expect(m.admin).not.toHaveBeenCalled();
  });

  it("a read that FAILED is null — never “no locks” — and is logged; a database the migration hasn't reached has none", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.session.mockResolvedValue({ data: null, error: { message: "connection reset", code: "08006" } });
    expect(await readLocks(DECK)).toBeNull();
    expect(logged).toHaveBeenCalledTimes(1);
    for (const code of ["42P01", "PGRST205"]) {
      m.session.mockResolvedValue({ data: null, error: { message: "no such table", code } });
      expect(await readLocks(DECK)).toEqual(new Set());
    }
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });
});

describe("whether one entry is locked (a step)", () => {
  it("is asked with the service role, by entry, deck and owner — one row is enough", async () => {
    m.admin.mockResolvedValue({ data: [{ entry_id: E(1) }], error: null });
    expect(await isEntryLockedAdmin(ME, DECK, E(1))).toBe(true);
    expect(adminCalls()).toHaveLength(1);
    // Rows, not a HEAD count (see the deploy-window case below).
    expect(adminCalls()[0]).toMatchObject({ table: "deck_reart_locks", head: false });
    expect(adminCalls()[0].filters).toEqual([
      ["entry_id", [E(1)]],
      ["deck_id", DECK],
      ["owner_id", ME],
    ]);
    m.admin.mockResolvedValue({ data: [], error: null });
    expect(await isEntryLockedAdmin(ME, DECK, E(1))).toBe(false);
  });

  it("an entry that holds a CARD is locked by a lock on any row of the deck that holds the same card (one picture)", async () => {
    m.admin.mockImplementation(async (call: Call) =>
      call.table === "deck_cards" ? { data: [{ id: E(1) }, { id: E(2) }], error: null } : { data: [{ entry_id: E(2) }], error: null },
    );
    expect(await isEntryLockedAdmin(ME, DECK, E(1), CARD)).toBe(true);
    const [siblings, locks] = adminCalls();
    expect(siblings).toMatchObject({ table: "deck_cards", filters: [["deck_id", DECK], ["card_id", CARD]] });
    expect(locks.filters[0]).toEqual(["entry_id", [E(1), E(2)]]);
    // The card's rows couldn't be read: not “not locked”.
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.admin.mockImplementation(async (call: Call) => (call.table === "deck_cards" ? { data: null, error: { message: "boom" } } : { data: [], error: null }));
    expect(await isEntryLockedAdmin(ME, DECK, E(1), CARD)).toBeNull();
    logged.mockRestore();
  });

  it("a read that didn't answer is null (the step stops before any charge): an error, no rows at all, no service role", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.admin.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await isEntryLockedAdmin(ME, DECK, E(1))).toBeNull();
    m.admin.mockResolvedValue({ data: null, error: null });
    expect(await isEntryLockedAdmin(ME, DECK, E(1))).toBeNull();
    m.adminConfigured.mockReturnValue(false);
    expect(await isEntryLockedAdmin(ME, DECK, E(1))).toBeNull();
    logged.mockRestore();
  });

  it("a database the migration hasn't reached has no locks: not locked — as the API really says it (an error with a code; a HEAD count would carry none and stop every paint)", async () => {
    for (const code of ["PGRST205", "42P01"]) {
      m.admin.mockResolvedValue({ data: null, error: { message: "Could not find the table 'public.deck_reart_locks' in the schema cache", code } });
      expect(await isEntryLockedAdmin(ME, DECK, E(1))).toBe(false);
    }
  });
});

describe("whether a CARD is locked on the deck (a one-card action names the card)", () => {
  const answers = (entries: Result, locks: Result) =>
    m.session.mockImplementation(async (call: Call) => (call.table === "deck_cards" ? entries : locks));

  it("any of the deck's entries that hold it being locked locks it", async () => {
    answers({ data: [{ id: E(1) }, { id: E(2) }], error: null }, { data: [{ entry_id: E(2) }], error: null });
    expect(await isCardLocked(DECK, CARD)).toBe(true);
    expect(sessionCalls()[0]).toMatchObject({ table: "deck_cards", filters: [["deck_id", DECK], ["card_id", CARD]] });
    answers({ data: [{ id: E(1) }], error: null }, { data: [{ entry_id: E(9) }], error: null });
    expect(await isCardLocked(DECK, CARD)).toBe(false);
  });

  it("a card in no entry of the deck isn't locked; a read that failed is null", async () => {
    answers({ data: [], error: null }, { data: [{ entry_id: E(1) }], error: null });
    expect(await isCardLocked(DECK, CARD)).toBe(false);
    answers({ data: null, error: { message: "boom" } }, { data: [], error: null });
    expect(await isCardLocked(DECK, CARD)).toBeNull();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    answers({ data: [{ id: E(1) }], error: null }, { data: null, error: { message: "boom" } });
    expect(await isCardLocked(DECK, CARD)).toBeNull();
    logged.mockRestore();
  });
});

describe("locking and unlocking", () => {
  it("locks only entries that ARE the deck's, under the owner, and locking one twice is once", async () => {
    // The caller names three; one is another deck's.
    m.session.mockResolvedValue({ data: [{ id: E(1), card_id: CARD }, { id: E(2), card_id: null }], error: null });
    m.admin.mockResolvedValue({ error: null });
    expect(await setLocks(ME, DECK, [E(1), E(2), E(9), E(1)], true)).toBe(2);
    expect(sessionCalls()).toHaveLength(1);
    expect(sessionCalls()[0]).toMatchObject({ table: "deck_cards", filters: [["deck_id", DECK], ["id", [E(1), E(2), E(9)]]] });
    const [write] = adminCalls();
    expect(write).toMatchObject({ table: "deck_reart_locks", op: "upsert" });
    expect(write.row).toEqual([
      { entry_id: E(1), deck_id: DECK, owner_id: ME },
      { entry_id: E(2), deck_id: DECK, owner_id: ME },
    ]);
    expect(write.options).toEqual({ onConflict: "entry_id", ignoreDuplicates: true });
  });

  it("unlocks by entry, held to the deck and the owner", async () => {
    m.session.mockResolvedValue({ data: [{ id: E(1), card_id: null }], error: null });
    m.admin.mockResolvedValue({ error: null });
    expect(await setLocks(ME, DECK, [E(1)], false)).toBe(1);
    expect(adminCalls()[0]).toMatchObject({ op: "delete" });
    expect(adminCalls()[0].filters).toEqual([
      ["entry_id", [E(1)]],
      ["deck_id", DECK],
      ["owner_id", ME],
    ]);
  });

  it("an unlock also unlocks the card's other rows on the deck (the card was shown locked through them)", async () => {
    m.session.mockImplementation(async (call: Call) =>
      call.filters.some(([column]) => column === "card_id")
        ? { data: [{ id: E(1) }, { id: E(3) }], error: null }
        : { data: [{ id: E(1), card_id: CARD }], error: null },
    );
    m.admin.mockResolvedValue({ error: null });
    expect(await setLocks(ME, DECK, [E(1)], false)).toBe(1);
    expect(sessionCalls()[1]).toMatchObject({ table: "deck_cards", filters: [["deck_id", DECK], ["card_id", [CARD]]] });
    expect(adminCalls()[0].filters[0]).toEqual(["entry_id", [E(1), E(3)]]);
    // Those rows couldn't be read: nothing is unlocked.
    m.admin.mockClear();
    m.session.mockImplementation(async (call: Call) =>
      call.filters.some(([column]) => column === "card_id") ? { data: null, error: { message: "boom" } } : { data: [{ id: E(1), card_id: CARD }], error: null },
    );
    expect(await setLocks(ME, DECK, [E(1)], false)).toBeNull();
    expect(m.admin).not.toHaveBeenCalled();
  });

  it("a whole deck's worth of cards goes a hundred ids to a request, reads and unlocks alike", async () => {
    const many = Array.from({ length: 250 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
    m.session.mockImplementation(async (call: Call) => {
      const ids = call.filters.find(([column]) => column === "id")?.[1] as string[];
      return { data: ids.map((id) => ({ id, card_id: null })), error: null };
    });
    m.admin.mockResolvedValue({ error: null });
    expect(await setLocks(ME, DECK, many, false)).toBe(250);
    expect(sessionCalls().map((call) => (call.filters.find(([column]) => column === "id")?.[1] as string[]).length)).toEqual([100, 100, 50]);
    expect(adminCalls().map((call) => (call.filters[0][1] as string[]).length)).toEqual([100, 100, 50]);
    // One part that failed is a failure of the whole (a lock left behind is said).
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.admin.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: "boom" } }).mockResolvedValue({ error: null });
    expect(await setLocks(ME, DECK, many, false)).toBeNull();
    logged.mockRestore();
    // Locking is one write (rows in the body), whatever the count.
    m.admin.mockReset();
    m.admin.mockResolvedValue({ error: null });
    expect(await setLocks(ME, DECK, many, true)).toBe(250);
    expect(adminCalls()).toHaveLength(1);
    expect(adminCalls()[0].row).toHaveLength(250);
  });

  it("nothing named, or none of them the deck's: nothing is written", async () => {
    expect(await setLocks(ME, DECK, [], true)).toBe(0);
    m.session.mockResolvedValue({ data: [], error: null });
    expect(await setLocks(ME, DECK, [E(9)], true)).toBe(0);
    expect(m.admin).not.toHaveBeenCalled();
  });

  it("a read or a write that failed — or no service role — is null, never a count", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.session.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await setLocks(ME, DECK, [E(1)], true)).toBeNull();
    m.session.mockResolvedValue({ data: [{ id: E(1), card_id: null }], error: null });
    m.admin.mockResolvedValue({ error: { message: "boom" } });
    expect(await setLocks(ME, DECK, [E(1)], true)).toBeNull();
    expect(await setLocks(ME, DECK, [E(1)], false)).toBeNull();
    m.adminConfigured.mockReturnValue(false);
    expect(await setLocks(ME, DECK, [E(1)], true)).toBeNull();
    logged.mockRestore();
  });
});

describe("a lock is on the card's picture (reartLockedEntries)", () => {
  it("a locked row locks every other row of the deck that holds the same card — and no other", () => {
    const entries = [
      { id: E(1), cardId: CARD }, // locked
      { id: E(2), cardId: CARD }, // the same card, another board
      { id: E(3), cardId: "other-card" },
      { id: E(4), cardId: null }, // a real card
      { id: E(5), cardId: null }, // a real card, locked
    ];
    expect(reartLockedEntries(entries, new Set([E(1), E(5)]))).toEqual(new Set([E(1), E(2), E(5)]));
    expect(reartLockedEntries(entries, new Set())).toEqual(new Set());
    // A lock on a row that is no longer in the deck locks nothing.
    expect(reartLockedEntries(entries, new Set([E(9)]))).toEqual(new Set());
  });
});

describe("what an undo does to one card of a run", () => {
  const JOB = "job-1";
  const ART = (n: string) => `https://x.supabase.co/storage/v1/object/public/card-art/u1/${n}`;
  const row = { jobId: JOB, made: false, entryId: null, artUrl: ART("ai-2.jpg"), previousArtUrl: ART("mine.png") };
  const of = (over: Partial<Parameters<typeof reartUndoOf>[0]> = {}) =>
    reartUndoOf({
      jobId: JOB,
      stepLinked: false,
      keptRollId: null,
      row,
      cardArtUrl: ART("ai-2.jpg"),
      cardIsOwn: true,
      madeEntryLinked: false,
      locked: false,
      ...over,
    });

  it("a card the run RE-ROLLED goes back to the earlier picture the run kept — while that picture is still kept", () => {
    expect(of({ keptRollId: "roll-1" })).toEqual({ kind: "earlier", rollId: "roll-1" });
    // No longer kept (dropped past the limit): its own art instead.
    expect(of({ keptRollId: null })).toEqual({ kind: "own" });
  });

  it("a card painted for the first time gets its own art back; one that had none has nothing to go back to", () => {
    expect(of()).toEqual({ kind: "own" });
    expect(of({ row: { ...row, previousArtUrl: null } })).toEqual({ skip: "no_art_before" });
  });

  describe("a card Re-art made (its record says so for good)", () => {
    const made = { ...row, made: true, entryId: E(1), previousArtUrl: null };

    it("the run that LINKED it to its entry puts the real card back — while the entry is still linked to it", () => {
      expect(of({ row: made, stepLinked: true, madeEntryLinked: true })).toEqual({ kind: "real" });
      // Whatever art the made card shows now: the entry is what goes back.
      expect(of({ row: made, stepLinked: true, madeEntryLinked: true, cardArtUrl: ART("hand.png") })).toEqual({ kind: "real" });
      // Unlinked since (an undo did it, or the maker): the real card is back already.
      expect(of({ row: made, stepLinked: true, madeEntryLinked: false })).toEqual({ skip: "real_back" });
      expect(of({ row: { ...made, entryId: null }, stepLinked: true, madeEntryLinked: false })).toEqual({ skip: "real_back" });
    });

    it("a run that only RE-ROLLED it never unlinks it: the earlier picture goes back on the card (an earlier run made it)", () => {
      // The check's finding: run J made the card, run K re-rolled it — undoing
      // K used to plan “back to the real card” and unlink it from the deck.
      expect(of({ row: made, keptRollId: "roll-1", madeEntryLinked: true })).toEqual({ kind: "earlier", rollId: "roll-1" });
      // …and with the earlier picture no longer on record there is nothing to
      // go back to: a made card has no art of the maker's. Never the real card.
      expect(of({ row: made, keptRollId: null, madeEntryLinked: true })).toEqual({ skip: "earlier_gone" });
      expect(of({ row: made, keptRollId: "roll-1", madeEntryLinked: true, cardArtUrl: ART("hand.png") })).toEqual({ skip: "other_art" });
    });

    it("a card a later run painted again is that run's: left as it is, linked or re-rolled", () => {
      const later = { ...made, jobId: "job-2" };
      expect(of({ row: later, stepLinked: true, madeEntryLinked: true })).toEqual({ skip: "changed" });
      expect(of({ row: later, keptRollId: "roll-1", madeEntryLinked: true })).toEqual({ skip: "changed" });
    });

    it("locked: left as it is", () => {
      expect(of({ row: made, stepLinked: true, madeEntryLinked: true, locked: true })).toEqual({ skip: "locked" });
      expect(of({ row: made, keptRollId: "roll-1", madeEntryLinked: true, locked: true })).toEqual({ skip: "locked" });
    });
  });

  it("only a card whose record names THIS run's picture is the run's to undo", () => {
    for (const other of [null, undefined, { ...row, jobId: "job-2" }, { ...row, jobId: null }]) {
      expect(of({ row: other })).toEqual({ skip: "changed" });
    }
  });

  it("a card that shows other art now is left as it is", () => {
    expect(of({ cardArtUrl: ART("hand.png") })).toEqual({ skip: "other_art" });
    expect(of({ cardArtUrl: null })).toEqual({ skip: "other_art" });
  });

  it("a card whose own art is back already (“old art back”, or an undo) says so — whatever run its record names", () => {
    const back = { ...row, artUrl: null, previousArtUrl: null };
    expect(of({ row: back, cardArtUrl: ART("mine.png") })).toEqual({ skip: "own_back" });
    expect(of({ row: { ...back, jobId: null }, cardArtUrl: ART("mine.png") })).toEqual({ skip: "own_back" });
    expect(of({ row: back, cardArtUrl: ART("mine.png"), locked: true })).toEqual({ skip: "own_back" });
  });

  it("a locked card is left as it is; a card that is gone, or no longer the caller's, too", () => {
    expect(of({ locked: true })).toEqual({ skip: "locked" });
    expect(of({ cardIsOwn: false })).toEqual({ skip: "gone" });
  });

  it("every reason has its words", () => {
    expect(Object.keys(REART_UNDO_SKIP_COPY).sort()).toEqual(["changed", "earlier_gone", "gone", "locked", "no_art_before", "other_art", "own_back", "real_back"]);
    for (const words of Object.values(REART_UNDO_SKIP_COPY)) expect(words.length).toBeGreaterThan(10);
  });
});

describe("the undo's confirm, in words", () => {
  it("says how many cards go back, and what that means part by part", () => {
    expect(reartUndoLine({ earlier: 3, own: 1, real: 2 })).toBe("Puts 6 cards back");
    expect(reartUndoLine({ earlier: 1, own: 0, real: 0 })).toBe("Puts 1 card back");
    expect(reartUndoLine({ earlier: 0, own: 0, real: 0 })).toBe("Nothing of this run is left to undo");
    expect(reartUndoDetail({ earlier: 3, own: 1, real: 2 })).toEqual([
      "3 cards go back to the picture they had before this run.",
      "1 card gets its own art back.",
      // (Made by this run, or linked again by it: "made from them" is true of both.)
      "2 cards go back to being the real card in the deck. The cards made from them stay in My Cards.",
    ]);
    expect(reartUndoDetail({ earlier: 1, own: 2, real: 1 })).toEqual([
      "1 card goes back to the picture it had before this run.",
      "2 cards get their own art back.",
      "1 card goes back to being the real card in the deck. The card made from it stays in My Cards.",
    ]);
    expect(reartUndoDetail({ earlier: 0, own: 0, real: 0 })).toEqual([]);
  });

  it("says that no credit comes back — and that what it takes off a card is kept, only when it takes a picture off one", () => {
    expect(REART_UNDO_NO_REFUND_COPY).toBe("No credit is returned: the pictures were painted.");
    expect(reartUndoNote({ earlier: 1, own: 0 })).toBe(`${REART_UNDO_NO_REFUND_COPY} Each picture this takes off a card is kept under “Earlier pictures”.`);
    expect(reartUndoNote({ earlier: 0, own: 2 })).toMatch(/kept under “Earlier pictures”/);
    // A real card going back takes no picture off a card: the card it was painted on keeps it.
    expect(reartUndoNote({ earlier: 0, own: 0 })).toBe(REART_UNDO_NO_REFUND_COPY);
    expect(REART_UNDO_BATCH).toBeGreaterThan(0);
    expect(REART_UNDO_BATCH).toBeLessThanOrEqual(10);
  });
});
