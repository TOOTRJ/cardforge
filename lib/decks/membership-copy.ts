import { MAX_DECK_ENTRIES } from "@/lib/decks/import-plan";

// ---------------------------------------------------------------------------
// Deck membership, as words (TODO DK9): the creator's "Add to a deck" box,
// My Cards' "Add to deck…" and the gallery's picker say the same thing about
// the same results. Client-safe — no server imports.
// ---------------------------------------------------------------------------

/** The most cards ONE membership call adds or removes (one RPC per card,
 *  in order, under the deck's lock): a bigger My Cards selection is sent in
 *  calls of this size. */
export const MAX_MEMBERSHIP_BATCH = 100;

/** The most cards the picker reads memberships for at once — My Cards'
 *  whole list (listMyCards' cap). */
export const MAX_PICKER_CARDS = 1000;

/** What happened to one card in a membership batch
 *  (changeDeckMembershipAction, lib/decks/membership-actions.ts). */
export type MembershipCardStatus =
  /** A new entry (main board, one copy — or the board / quantity asked). */
  | "added"
  /** Already in the deck, on any board: nothing written. */
  | "already"
  /** Its entries in the deck are gone (or, for an entry that came with a
   *  printing, the card is unlinked and the real card stays). */
  | "removed"
  /** Asked to leave a deck it wasn't in: nothing written. */
  | "not_in_deck"
  /** Not added: another creator's card that isn't public (D3), a card that
   *  can't be read, an admin's frame preview. */
  | "refused"
  /** Not added: the deck holds MAX_DECK_ENTRIES entries. */
  | "deck_full"
  /** The write failed (its error says why). */
  | "failed";

export type MembershipCardResult = {
  cardId: string;
  status: MembershipCardStatus;
  /** For refused / failed: why, in words. */
  error?: string;
};

/** A deck at the 500-entry cap (`deck_entry_limit`, migrations 0143/0144),
 *  for ONE card or a few being added — the import's own message
 *  (deckEntryLimitMessage) talks about decklist lines. */
export function deckFullMessage(deckTitle?: string | null): string {
  const cap = MAX_DECK_ENTRIES.toLocaleString("en-US");
  const deck = deckTitle?.trim() ? `“${deckTitle.trim()}”` : "That deck";
  return `${deck} is full — a deck holds at most ${cap} different entries. Remove some from it, or add the card to another deck.`;
}

/** Another creator's card that isn't public can't join a deck (owner
 *  decision D3; the database's deck_cards_guard_card_link). */
export const NOT_LINKABLE_MESSAGE =
  "Another creator's card can join a deck only while it's public.";

/** An admin's frame preview is a test card: it never joins a deck (the
 *  create action skips its deck_id for the same reason). */
export const FRAME_PREVIEW_MESSAGE = "A frame preview never joins a deck.";

const cards = (n: number) => `${n} card${n === 1 ? "" : "s"}`;

/**
 * One sentence for a batch's results — the toast and the picker's status
 * line. `adding` = the batch asked to add (else to remove). Null when there
 * is nothing worth saying (an empty batch).
 */
export function describeMembershipResults(
  results: readonly MembershipCardResult[],
  deckTitle: string,
  adding: boolean,
): { tone: "success" | "error" | "info"; message: string } | null {
  if (results.length === 0) return null;
  const count = (status: MembershipCardStatus) => results.filter((r) => r.status === status).length;
  const deck = `“${deckTitle}”`;
  const single = results.length === 1;

  if (adding) {
    const added = count("added");
    const already = count("already");
    const full = count("deck_full");
    const refused = results.filter((r) => r.status === "refused" || r.status === "failed");
    const parts: string[] = [];
    if (added > 0) parts.push(single ? `Added to ${deck}.` : `Added ${cards(added)} to ${deck}.`);
    if (already > 0) parts.push(single ? `Already in ${deck}.` : `${cards(already)} already in it.`);
    if (full > 0) parts.push(deckFullMessage(deckTitle));
    if (refused.length > 0) {
      const reason = refused[0]?.error ?? "It couldn't be added.";
      parts.push(single ? reason : `${cards(refused.length)} not added: ${reason}`);
    }
    const failed = full + refused.length;
    return {
      tone: failed > 0 ? (added > 0 ? "info" : "error") : "success",
      message: parts.join(" "),
    };
  }

  const removed = count("removed");
  const missing = count("not_in_deck");
  const failed = results.filter((r) => r.status === "failed");
  const parts: string[] = [];
  if (removed > 0) parts.push(single ? `Removed from ${deck}.` : `Removed ${cards(removed)} from ${deck}.`);
  if (missing > 0 && removed === 0) parts.push(single ? `It wasn't in ${deck}.` : `None of them were in ${deck}.`);
  if (failed.length > 0) {
    const reason = failed[0]?.error ?? "It couldn't be removed.";
    parts.push(single ? reason : `${cards(failed.length)} not removed: ${reason}`);
  }
  return {
    tone: failed.length > 0 ? (removed > 0 ? "info" : "error") : "success",
    message: parts.join(" "),
  };
}

/** The My Cards chip: "In 2 decks". Null at 0 (the chip reads "Add to deck"). */
export function inDecksLabel(count: number): string | null {
  if (count <= 0) return null;
  return `In ${count} deck${count === 1 ? "" : "s"}`;
}
