// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { boardOfGroup, boardsShownIn, draggedIds, dragStartsFrom, dropHint, movedByDrop } from "@/lib/decks/board-drag";
import type { DeckBoard } from "@/types/deck";
import { moveTargets } from "@/lib/decks/entry-ops";

// ---------------------------------------------------------------------------
// TODO DK5.15 — dragging a deck entry between boards: the pure rules the
// owner's page reads (lib/decks/board-drag.ts).
// ---------------------------------------------------------------------------

describe("boardOfGroup — the board a group of the page stands for", () => {
  it("a board's own group is that board", () => {
    for (const board of ["commander", "companion", "main", "side", "maybe"] as const) expect(boardOfGroup(board)).toBe(board);
  });

  it("the deck's own groups are the mainboard (Group by None's Deck, the type / mana / colour… groups)", () => {
    expect(boardOfGroup("deck")).toBe("main");
    expect(boardOfGroup("main-Creature")).toBe("main");
    expect(boardOfGroup("main-3")).toBe("main");
    expect(boardOfGroup("main-land")).toBe("main");
  });

  it("anything else is no target", () => {
    expect(boardOfGroup("tokens")).toBeNull();
    expect(boardOfGroup("")).toBeNull();
  });
});

const held = (...boards: DeckBoard[]) => boards.map((board, i) => ({ id: `e${i}`, board }));

describe("movedByDrop — a drop moves something, onto a board the menus offer", () => {
  it("a board the card is already on is no target; another board is", () => {
    expect(movedByDrop(held("main"), "main", ["main"], true)).toEqual([]);
    expect(movedByDrop(held("main"), "side", ["side"], true)).toEqual(["e0"]);
  });

  it("a selection on two boards can drop on either: only the other card moves", () => {
    expect(movedByDrop(held("main", "side"), "main", ["main"], false)).toEqual(["e1"]);
    expect(movedByDrop(held("main", "side"), "side", ["side"], false)).toEqual(["e0"]);
  });

  it("the commander zone only where the format has one — exactly the menus' list", () => {
    expect(movedByDrop(held("main"), "commander", ["commander"], true)).toEqual(["e0"]);
    expect(movedByDrop(held("main"), "commander", ["commander"], false)).toEqual([]);
    for (const hasCommander of [true, false]) {
      for (const board of ["commander", "companion", "main", "side", "maybe"] as const) {
        const cards = held(...(["maybe", "main"].filter((b) => b !== board) as DeckBoard[]));
        expect(movedByDrop(cards, board, [board], hasCommander).length > 0).toBe(moveTargets(hasCommander).includes(board));
      }
    }
  });

  it("no board, or nothing held, moves nothing", () => {
    expect(movedByDrop(held("main"), null, [], true)).toEqual([]);
    expect(movedByDrop([], "side", ["side"], true)).toEqual([]);
  });

  it("Group by None's Deck group shows the commander and the companion: dropped back there they stay (#724 check)", () => {
    expect(boardsShownIn("deck")).toEqual(["commander", "companion", "main"]);
    const deck = boardsShownIn("deck");
    expect(movedByDrop(held("commander"), boardOfGroup("deck"), deck, true)).toEqual([]);
    expect(movedByDrop(held("companion"), boardOfGroup("deck"), deck, true)).toEqual([]);
    // Dragged with a sideboard card, only the sideboard card moves.
    expect(movedByDrop(held("commander", "side"), boardOfGroup("deck"), deck, true)).toEqual(["e1"]);
  });

  it("a type group shows the mainboard only: the commander dropped there moves to the Mainboard", () => {
    expect(boardsShownIn("main-Creature")).toEqual(["main"]);
    expect(movedByDrop(held("commander"), boardOfGroup("main-Creature"), boardsShownIn("main-Creature"), true)).toEqual(["e0"]);
    expect(boardsShownIn("tokens")).toEqual([]);
  });
});

describe("dropHint / draggedIds", () => {
  it("names the board, and the count when several cards are held", () => {
    expect(dropHint("side", 1)).toBe("Move here — the Sideboard");
    expect(dropHint("maybe", 3)).toBe("Move 3 cards here — the Maybeboard");
  });

  it("a card carries the selection only while selecting and only when it is part of it", () => {
    expect(draggedIds("a", { selecting: false, ids: ["a", "b"] })).toEqual(["a"]);
    expect(draggedIds("a", { selecting: true, ids: ["a", "b"] })).toEqual(["a", "b"]);
    expect(draggedIds("c", { selecting: true, ids: ["a", "b"] })).toEqual(["c"]);
  });
});

describe("dragStartsFrom — never from a control beside the card", () => {
  it("the opener (and what's inside it) drags; the stepper, the ⋯ and the 2 faces button don't", () => {
    document.body.innerHTML = `
      <li>
        <button data-deck-entry="e1"><img id="thumb" alt="" /><span id="name">Sol Ring</span></button>
        <div role="group"><button id="more">+</button></div>
        <button id="faces">2 faces</button>
        <span id="bare">gap</span>
      </li>`;
    const el = (id: string) => document.getElementById(id);
    expect(dragStartsFrom(el("thumb"))).toBe(true);
    expect(dragStartsFrom(el("name"))).toBe(true);
    expect(dragStartsFrom(el("bare"))).toBe(true);
    expect(dragStartsFrom(el("more"))).toBe(false);
    expect(dragStartsFrom(el("faces"))).toBe(false);
    expect(dragStartsFrom(null)).toBe(true);
  });
});
