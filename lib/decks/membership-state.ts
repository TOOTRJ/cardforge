import type { DeckBoard, DeckFormat } from "@/types/deck";
import type { Visibility } from "@/types/card";

// ---------------------------------------------------------------------------
// The deck picker's state (TODO DK9.1), pure and client-safe: the decks it
// lists, which of them hold the card(s) it was opened for, and how a batch's
// results move that. The server reads (lib/decks/membership-queries.ts) and
// the action (lib/decks/membership-actions.ts) speak these types.
// ---------------------------------------------------------------------------

/** One of the owner's decks, as the picker lists it. */
export type PickerDeck = {
  id: string;
  title: string;
  format: DeckFormat | string;
  slug?: string;
  /** Absent where the caller doesn't know it (the creator's create-mode
   *  list, `DeckOption`). */
  visibility?: Visibility;
};

/** One entry of a deck that links the card. */
export type DeckMembershipEntry = {
  deckId: string;
  entryId: string;
  board: DeckBoard;
  quantity: number;
};

/** card id → its entries in the owner's decks. */
export type DeckMemberships = Record<string, DeckMembershipEntry[]>;

/** A deck's checkbox: every card is in it, some are, or none. */
export type DeckTick = "all" | "some" | "none";

export type DeckRowState = {
  tick: DeckTick;
  /** How many of the cards are in the deck. */
  holders: number;
  /** The ONE entry the row's board and quantity edit: set only when the
   *  picker is open for one card that has exactly one entry in the deck (a
   *  card on two boards of a deck is edited on the deck page). */
  entry: DeckMembershipEntry | null;
};

/** Each deck's row for these cards. */
export function deckRowStates(
  decks: readonly PickerDeck[],
  memberships: DeckMemberships,
  cardIds: readonly string[],
): Record<string, DeckRowState> {
  const states: Record<string, DeckRowState> = {};
  for (const deck of decks) {
    const holders = cardIds.filter((cardId) =>
      (memberships[cardId] ?? []).some((entry) => entry.deckId === deck.id),
    );
    const tick: DeckTick =
      cardIds.length > 0 && holders.length === cardIds.length
        ? "all"
        : holders.length > 0
          ? "some"
          : "none";
    const own = cardIds.length === 1 ? (memberships[cardIds[0]!] ?? []).filter((e) => e.deckId === deck.id) : [];
    states[deck.id] = { tick, holders: holders.length, entry: own.length === 1 ? own[0]! : null };
  }
  return states;
}

/**
 * The memberships after a batch on `deckId`: the entries the server read
 * back for the cards it added (or found already there) replace what was
 * known of them in that deck; the cards it removed leave it.
 */
export function withMembershipChange(
  memberships: DeckMemberships,
  deckId: string,
  change: {
    /** The cards whose entries in the deck were read back (added or already
     *  there) — what is known of them there is replaced by `entries`. */
    readCardIds?: readonly string[];
    entries?: readonly MembershipEntryWithCard[];
    removedCardIds?: readonly string[];
  },
): DeckMemberships {
  const next: DeckMemberships = { ...memberships };
  const leave = (cardId: string) => {
    next[cardId] = (next[cardId] ?? []).filter((entry) => entry.deckId !== deckId);
  };
  for (const cardId of change.removedCardIds ?? []) leave(cardId);
  for (const cardId of change.readCardIds ?? []) leave(cardId);
  for (const { cardId, ...entry } of change.entries ?? []) {
    if (entry.deckId !== deckId) continue;
    next[cardId] = [...(next[cardId] ?? []), entry];
  }
  return next;
}

/** An entry as the membership action hands it back: with its card. */
export type MembershipEntryWithCard = DeckMembershipEntry & { cardId: string };

/** The number of DIFFERENT decks each card is in. */
export function deckCountOf(memberships: DeckMemberships, cardId: string): number {
  return new Set((memberships[cardId] ?? []).map((entry) => entry.deckId)).size;
}
