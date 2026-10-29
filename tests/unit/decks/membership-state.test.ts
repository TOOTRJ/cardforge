import { describe, expect, it } from "vitest";
import { deckRowStates, withMembershipChange, type DeckMemberships } from "@/lib/decks/membership-state";
import { describeMembershipResults, deckFullMessage, inDecksLabel } from "@/lib/decks/membership-copy";
import { MAX_DECK_ENTRIES } from "@/lib/decks/import-plan";

// ---------------------------------------------------------------------------
// The deck picker's state and words (TODO DK9): which decks hold the cards
// it was opened for, how a batch's answer moves that, and the ONE sentence
// each batch is reported in.
// ---------------------------------------------------------------------------

const DECKS = [
  { id: "d1", title: "Goblins", format: "modern" },
  { id: "d2", title: "Dragons", format: "commander" },
];
const entry = (deckId: string, entryId: string) => ({ deckId, entryId, board: "main" as const, quantity: 1 });

describe("deckRowStates", () => {
  it("all, some or none of the cards; the ONE entry a one-card row edits", () => {
    const memberships: DeckMemberships = { a: [entry("d1", "e1")], b: [entry("d1", "e2"), entry("d2", "e3")] };
    expect(deckRowStates(DECKS, memberships, ["a", "b"])).toEqual({
      d1: { tick: "all", holders: 2, entry: null },
      d2: { tick: "some", holders: 1, entry: null },
    });
    expect(deckRowStates(DECKS, memberships, ["a"])).toEqual({
      d1: { tick: "all", holders: 1, entry: entry("d1", "e1") },
      d2: { tick: "none", holders: 0, entry: null },
    });
  });

  it("a card on two boards of one deck is in it, its entries edited on the deck page", () => {
    const memberships: DeckMemberships = { a: [entry("d1", "main"), { ...entry("d1", "side"), board: "side" }] };
    expect(deckRowStates(DECKS, memberships, ["a"]).d1).toEqual({ tick: "all", holders: 1, entry: null });
  });
});

describe("withMembershipChange", () => {
  it("the entries read back replace what was known of those cards in that deck; removed cards leave it", () => {
    const before: DeckMemberships = { a: [entry("d2", "x")], b: [entry("d1", "old"), entry("d2", "y")] };
    const after = withMembershipChange(before, "d1", {
      readCardIds: ["a"],
      entries: [{ cardId: "a", ...entry("d1", "new") }],
      removedCardIds: ["b"],
    });
    expect(after).toEqual({ a: [entry("d2", "x"), entry("d1", "new")], b: [entry("d2", "y")] });
    // The memberships it was given are left as they were.
    expect(before.b).toHaveLength(2);
  });
});

describe("the words", () => {
  it("a full deck names the deck and the way out", () => {
    expect(deckFullMessage("Goblins")).toBe(
      `“Goblins” is full — a deck holds at most ${MAX_DECK_ENTRIES} different entries. Remove some from it, or add the card to another deck.`,
    );
    expect(deckFullMessage(null)).toMatch(/^That deck is full/);
  });

  it("one card, and a batch with a partial failure", () => {
    expect(describeMembershipResults([{ cardId: "a", status: "added" }], "Goblins", true)).toEqual({
      tone: "success",
      message: "Added to “Goblins”.",
    });
    expect(
      describeMembershipResults(
        [
          { cardId: "a", status: "added" },
          { cardId: "b", status: "already" },
          { cardId: "c", status: "refused", error: "Another creator's card can join a deck only while it's public." },
        ],
        "Goblins",
        true,
      ),
    ).toEqual({
      tone: "info",
      message:
        "Added 1 card to “Goblins”. 1 card already in it. 1 card not added: Another creator's card can join a deck only while it's public.",
    });
    expect(
      describeMembershipResults([{ cardId: "a", status: "deck_full", error: deckFullMessage("Goblins") }], "Goblins", true),
    ).toEqual({ tone: "error", message: deckFullMessage("Goblins") });
    expect(describeMembershipResults([{ cardId: "a", status: "removed" }, { cardId: "b", status: "removed" }], "Goblins", false)).toEqual({
      tone: "success",
      message: "Removed 2 cards from “Goblins”.",
    });
    expect(describeMembershipResults([], "Goblins", true)).toBeNull();
  });

  it("the chip", () => {
    expect(inDecksLabel(0)).toBeNull();
    expect(inDecksLabel(1)).toBe("In 1 deck");
    expect(inDecksLabel(3)).toBe("In 3 decks");
  });
});
