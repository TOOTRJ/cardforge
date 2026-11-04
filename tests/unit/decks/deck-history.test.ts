import { describe, expect, it } from "vitest";
import {
  DECK_HISTORY_PLUS_DAYS,
  deckStateAfter,
  describeChange,
  groupChanges,
  historyAccessFor,
  historySince,
  parseChangeRow,
  planRestore,
  withinHistory,
  type ChangeRow,
  type DeckRow,
  type EntrySnapshot,
} from "@/lib/decks/deck-history";

// ---------------------------------------------------------------------------
// The deck change history's rules (TODO DK5.13): retention by plan, the log
// read back, versions in words, and a version rebuilt and planned back.
// ---------------------------------------------------------------------------

const OWNER = "11111111-1111-4111-8111-111111111111";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const snap = (over: Partial<EntrySnapshot> = {}): EntrySnapshot => ({
  name: "Sol Ring",
  board: "main",
  quantity: 1,
  scryfall_id: null,
  card_id: null,
  source: "import",
  featured_rank: null,
  ...over,
});
const row = (n: number, over: Partial<EntrySnapshot> = {}): DeckRow => ({ ...snap(over), id: id(n) });
let seq = 0;
function change(op: ChangeRow["op"], entry: number, before: EntrySnapshot | null, after: EntrySnapshot | null, over: Partial<ChangeRow> = {}): ChangeRow {
  seq += 1;
  return { id: seq, entry_id: id(entry), op, before, after, actor_id: OWNER, tx: seq, changed_at: new Date(Date.UTC(2026, 10, 1, 12, 0, seq * 10)).toISOString(), ...over };
}

describe("retention by plan", () => {
  it("Pro reads everything, Plus 30 days, free nothing", () => {
    expect(historyAccessFor("pro")).toEqual({ kind: "full" });
    expect(historyAccessFor("plus")).toEqual({ kind: "window", days: DECK_HISTORY_PLUS_DAYS });
    expect(DECK_HISTORY_PLUS_DAYS).toBe(30);
    expect(historyAccessFor("free")).toEqual({ kind: "locked" });
  });

  it("the Plus window ends 30 days back; Pro has none; free reads no change", () => {
    const now = new Date("2026-11-03T12:00:00Z");
    expect(historySince({ kind: "window", days: 30 }, now)).toBe("2026-10-04T12:00:00.000Z");
    expect(historySince({ kind: "full" }, now)).toBeNull();
    expect(withinHistory({ kind: "window", days: 30 }, "2026-10-05T00:00:00Z", now)).toBe(true);
    expect(withinHistory({ kind: "window", days: 30 }, "2026-10-01T00:00:00Z", now)).toBe(false);
    expect(withinHistory({ kind: "full" }, "2020-01-01T00:00:00Z", now)).toBe(true);
    expect(withinHistory({ kind: "locked" }, "2026-11-03T11:00:00Z", now)).toBe(false);
  });
});

describe("the log read back", () => {
  it("parses a row and refuses a malformed one", () => {
    const raw = { id: "7", entry_id: id(1), op: "update", before: snap(), after: snap({ quantity: 3 }), actor_id: OWNER, tx: "9", changed_at: "2026-11-01T00:00:00Z" };
    expect(parseChangeRow(raw)).toMatchObject({ id: 7, tx: 9, op: "update", after: { quantity: 3 } });
    expect(parseChangeRow({ ...raw, op: "truncate" })).toBeNull();
    expect(parseChangeRow({ ...raw, before: { name: "", board: "main", quantity: 1 } })).toBeNull();
    expect(parseChangeRow({ ...raw, after: { name: "X", board: "nowhere", quantity: 1 } })).toBeNull();
  });
});

describe("versions in words", () => {
  it("names each kind of change", () => {
    expect(describeChange(change("insert", 1, null, snap({ quantity: 4, name: "Island" })))).toBe("Added 4× Island");
    expect(describeChange(change("insert", 1, null, snap({ board: "side" })))).toBe("Added Sol Ring to the Sideboard");
    expect(describeChange(change("delete", 1, snap(), null))).toBe("Removed Sol Ring");
    expect(describeChange(change("update", 1, snap(), snap({ quantity: 3 })))).toBe("Sol Ring: 1 → 3 copies");
    expect(describeChange(change("update", 1, snap(), snap({ board: "maybe" })))).toBe("Sol Ring: moved to the Maybeboard");
    expect(describeChange(change("update", 1, snap(), snap({ card_id: id(9) })))).toBe("Sol Ring: linked to a card");
  });

  it("one write, or one burst by one person, is one version; newest first", () => {
    const at = (s: number) => new Date(Date.UTC(2026, 10, 1, 12, 0, s)).toISOString();
    const rows: ChangeRow[] = [
      change("update", 1, snap(), snap({ quantity: 2 }), { id: 10, tx: 5, changed_at: at(50) }),
      change("insert", 2, null, snap({ name: "Bolt" }), { id: 9, tx: 4, changed_at: at(30) }),
      change("insert", 3, null, snap({ name: "Island" }), { id: 8, tx: 4, changed_at: at(30) }),
      change("delete", 4, snap({ name: "Opt" }), null, { id: 7, tx: 3, changed_at: at(29) }),
      change("delete", 5, snap({ name: "Ponder" }), null, { id: 6, tx: 2, changed_at: at(10), actor_id: null }),
    ];
    const versions = groupChanges(rows, OWNER);
    expect(versions.map((v) => [v.headId, v.count, v.byOwner])).toEqual([
      [10, 1, true],
      [9, 3, true], // two transactions a second apart: one burst
      [6, 1, false], // the platform's
    ]);
    expect(versions[1]!.summary).toBe("Added 2 cards, removed 1 card");
    expect(versions[0]!.summary).toBe("Sol Ring: 1 → 2 copies");
  });
});

describe("a version back (restore)", () => {
  it("rebuilds the deck as it read after the version, newest change put back first", () => {
    const current = [row(1, { quantity: 3 }), row(3, { name: "Bolt" })];
    const since = [
      // newest first: Bolt added, Island removed, Sol Ring 1 → 3
      change("insert", 3, null, snap({ name: "Bolt" })),
      change("delete", 2, snap({ name: "Island", quantity: 20 }), null),
      change("update", 1, snap({ quantity: 1 }), snap({ quantity: 3 })),
    ];
    const target = deckStateAfter(current, since);
    expect(target.sort((a, b) => a.id.localeCompare(b.id))).toEqual([row(1, { quantity: 1 }), row(2, { name: "Island", quantity: 20 })]);
  });

  it("plans the writes: changed rows updated, extra rows out, missing lines back through the restore path", () => {
    const plan = planRestore(
      [row(1, { quantity: 3 }), row(3, { name: "Bolt" }), row(4, { name: "Opt", board: "side" })],
      [row(1, { quantity: 1, board: "side" }), row(2, { name: "Island", quantity: 20, scryfall_id: id(77) }), row(4, { name: "Opt", board: "side" })],
    );
    expect(plan.update).toEqual([{ id: id(1), quantity: 1, board: "side" }]);
    expect(plan.remove).toEqual([id(3)]);
    expect(plan.restore).toEqual([
      { id: id(2), name: "Island", board: "main", quantity: 20, scryfallId: id(77), cardId: null, source: "import", featuredRank: null },
    ]);
  });

  it("a line an undo brought back under a new id is that line, never removed and added again", () => {
    const plan = planRestore([row(9, { name: "Island", quantity: 2 })], [row(2, { name: "Island", quantity: 5 })]);
    expect(plan).toEqual({ remove: [], update: [{ id: id(9), quantity: 5 }], restore: [] });
  });

  it("a row whose card changed is replaced — the card is never linked by hand (D3 judged again)", () => {
    const plan = planRestore([row(1, { card_id: id(50) })], [row(1, { card_id: id(60) })]);
    expect(plan.remove).toEqual([id(1)]);
    expect(plan.restore).toEqual([expect.objectContaining({ id: id(1), cardId: id(60) })]);
    expect(plan.update).toEqual([]);
  });

  it("nothing to do when the deck already reads as the version", () => {
    expect(planRestore([row(1)], [row(1)])).toEqual({ remove: [], update: [], restore: [] });
  });
});
