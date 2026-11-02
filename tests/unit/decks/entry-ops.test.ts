import { describe, expect, it } from "vitest";
import {
  applyEntryOp,
  clampQuantity,
  describeEdit,
  movePatches,
  moveTargets,
  opEntryIds,
  restoringPatches,
  sideToggleBoard,
  stepPatches,
} from "@/lib/decks/entry-ops";
import { reduceEditorItems } from "@/components/decks/use-deck-editor";
import type { DeckBoard } from "@/types/deck";

// ---------------------------------------------------------------------------
// The deck page's edits as data (TODO DK5.4 / DK5.8, lib/decks/entry-ops.ts)
// — what the owner's page draws the moment an edit is made. Every edit is
// the VALUE it wants, so drawn over rows that already hold it nothing
// changes: the server's answer and the drawn edit can land in either order.
// ---------------------------------------------------------------------------

const item = (id: string, quantity = 1, board: DeckBoard = "main") => ({ entry: { id, quantity, board }, card: null, cardOwner: null });

describe("an edit drawn over the rows", () => {
  const rows = [item("a", 2), item("b", 1, "side"), item("c", 4)];

  it("sets quantities and boards — and drawn again over its own result, changes nothing", () => {
    const op = { kind: "update" as const, updates: [{ id: "a", quantity: 3 }, { id: "b", board: "main" as const }] };
    const once = applyEntryOp(rows, op);
    expect(once.map((r) => [r.entry.id, r.entry.quantity, r.entry.board])).toEqual([
      ["a", 3, "main"],
      ["b", 1, "main"],
      ["c", 4, "main"],
    ]);
    // The server's answer already holds it: the same rows, the same objects.
    const twice = applyEntryOp(once, op);
    expect(twice.map((r, i) => r === once[i])).toEqual([true, true, true]);
    // A row the edit doesn't name keeps its identity (no re-render of it).
    expect(once[2]).toBe(rows[2]);
  });

  it("holds a quantity to 1–250 and ignores entries that are gone", () => {
    expect(applyEntryOp(rows, { kind: "update", updates: [{ id: "a", quantity: 0 }] })[0]!.entry.quantity).toBe(1);
    expect(applyEntryOp(rows, { kind: "update", updates: [{ id: "a", quantity: 999 }] })[0]!.entry.quantity).toBe(250);
    expect(applyEntryOp(rows, { kind: "update", updates: [{ id: "gone", quantity: 2 }] })).toEqual(rows);
    expect(clampQuantity(Number.NaN)).toBe(1);
  });

  it("removes rows, once; an insert never draws a row twice (the answer came first)", () => {
    expect(applyEntryOp(rows, { kind: "remove", ids: ["b", "gone"] }).map((r) => r.entry.id)).toEqual(["a", "c"]);
    const back = { ...item("b", 1, "side"), pending: true as const };
    expect(applyEntryOp(rows, { kind: "insert", items: [back] }).map((r) => r.entry.id)).toEqual(["a", "b", "c"]);
    const without = applyEntryOp(rows, { kind: "remove", ids: ["b"] });
    expect(applyEntryOp(without, { kind: "insert", items: [back] }).map((r) => r.entry.id)).toEqual(["a", "c", "b"]);
  });

  it("the editor marks the rows an update is saving", () => {
    const drawn = reduceEditorItems(rows as never, { kind: "update", updates: [{ id: "c", quantity: 5 }] });
    expect(drawn.map((r) => Boolean(r.saving))).toEqual([false, false, true]);
    expect(opEntryIds({ kind: "remove", ids: ["x", "y"] })).toEqual(["x", "y"]);
  });
});

describe("the patches an action sends", () => {
  const rows = [item("a", 1), item("b", 250), item("c", 3, "side")];

  it("steps each entry, leaving out the ones already at the limit", () => {
    expect(stepPatches(rows, ["a", "b", "c"], 1)).toEqual([
      { id: "a", quantity: 2 },
      { id: "c", quantity: 4 },
    ]);
    expect(stepPatches(rows, ["a", "c"], -1)).toEqual([{ id: "c", quantity: 2 }]);
  });

  it("moves only the entries not already there", () => {
    expect(movePatches(rows, ["a", "c"], "side")).toEqual([{ id: "a", board: "side" }]);
  });

  it("an update's undo is read before it: the values as they were", () => {
    expect(restoringPatches(rows, ["c", "a"])).toEqual([
      { id: "a", quantity: 1, board: "main" },
      { id: "c", quantity: 3, board: "side" },
    ]);
  });

  it("S sends a card to the sideboard — and from it, back to the deck", () => {
    expect(sideToggleBoard("main")).toBe("side");
    expect(sideToggleBoard("commander")).toBe("side");
    expect(sideToggleBoard("side")).toBe("main");
  });

  it("the commander zone is a move target only where the format has one", () => {
    expect(moveTargets(true)).toEqual(["commander", "main", "side", "maybe", "companion"]);
    expect(moveTargets(false)).not.toContain("commander");
  });

  it("says what it did, for the live region and the undo", () => {
    expect(describeEdit({ kind: "update", updates: [{ id: "a", quantity: 3 }] }, ["Sol Ring"])).toBe("Sol Ring: 3 copies.");
    expect(describeEdit({ kind: "update", updates: [{ id: "a", quantity: 1 }] }, ["Sol Ring"])).toBe("Sol Ring: 1 copy.");
    expect(describeEdit({ kind: "update", updates: [{ id: "a", board: "side" }] }, ["Sol Ring"])).toBe("Moved Sol Ring to the Sideboard.");
    expect(describeEdit({ kind: "update", updates: [{ id: "a", board: "maybe" }, { id: "b", board: "maybe" }] }, ["A", "B"])).toBe(
      "Moved 2 cards to the Maybeboard.",
    );
    expect(describeEdit({ kind: "remove", ids: ["a"] }, ["Sol Ring"])).toBe("Removed Sol Ring.");
  });
});
