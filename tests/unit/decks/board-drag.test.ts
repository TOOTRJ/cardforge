// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { boardOfGroup, canDropOn, draggedIds, dragStartsFrom, dropHint } from "@/lib/decks/board-drag";
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

describe("canDropOn — a drop moves something, onto a board the menus offer", () => {
  it("a board the card is already on is no target; another board is", () => {
    expect(canDropOn("main", ["main"], true)).toBe(false);
    expect(canDropOn("side", ["main"], true)).toBe(true);
  });

  it("a selection on two boards can drop on either (the other card moves)", () => {
    expect(canDropOn("main", ["main", "side"], false)).toBe(true);
    expect(canDropOn("side", ["main", "side"], false)).toBe(true);
  });

  it("the commander zone only where the format has one — exactly the menus' list", () => {
    expect(canDropOn("commander", ["main"], true)).toBe(true);
    expect(canDropOn("commander", ["main"], false)).toBe(false);
    for (const hasCommander of [true, false]) {
      for (const board of ["commander", "companion", "main", "side", "maybe"] as const) {
        expect(canDropOn(board, ["maybe", "main"].filter((b) => b !== board) as never, hasCommander)).toBe(
          moveTargets(hasCommander).includes(board),
        );
      }
    }
  });

  it("no board, or nothing held, is no target", () => {
    expect(canDropOn(null, ["main"], true)).toBe(false);
    expect(canDropOn("side", [], true)).toBe(false);
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
