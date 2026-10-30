import { MAX_DECK_ENTRIES } from "@/lib/decks/import-plan";
import { profaneFieldList, type ProfanityField } from "@/lib/moderation/profanity";

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
  | "failed"
  /** Not added, nothing written: the caller's own PRIVATE card asked into a
   *  deck others can open with `privateCards: "ask"` (TODO DK0.13) — the
   *  picker offers "Make it public" / "Add as private". */
  | "private_card"
  /** Not added: asked to be made public first, and it is still private
   *  (its text, a refused publish) — its error says why. */
  | "publish_refused";

export type MembershipCardResult = {
  cardId: string;
  status: MembershipCardStatus;
  /** For refused / failed: why, in words. */
  error?: string;
  /** private_card: why it can't be made public — its text holds strong
   *  language (owner policy 2026-10-28). Absent = it can. */
  blockedReason?: string;
  /** The card was made public by this call (`publish`) — on an added card,
   *  and on one the deck then refused (it stays public). */
  published?: true;
};

/** A deck whose visitors see a private card of its owner's as "Private
 *  card" (D11): a public or unlisted one. */
export function deckShowsPrivateCards(visibility: string | null | undefined): boolean {
  return visibility === "public" || visibility === "unlisted";
}

/** The offer's line (TODO DK0.13, the owner's words). */
export const PRIVATE_CARD_OFFER = "This card is private. Visitors will see “Private card” in this deck.";

/** The same for several cards. */
export function privateCardsOffer(count: number): string {
  return count === 1
    ? PRIVATE_CARD_OFFER
    : `${count} of these cards are private. Visitors will see “Private card” in this deck in place of each.`;
}

/** Why a private card can't be made public: its text (owner policy
 *  2026-10-28, lib/moderation/profanity.ts). */
export function privateCardLanguageReason(fields: readonly ProfanityField[]): string {
  return `Its ${profaneFieldList(fields)} includes strong language, so it stays private. Remove it to publish.`;
}

/** Why a private card can't be made public: no artwork (the single-card
 *  rule — no artwork → no gallery; a double-faced card's back too). */
export function privateCardArtReason(missing: "front" | "back"): string {
  return missing === "back"
    ? "Its back face has no artwork yet, so it stays private. Add artwork before publishing."
    : "It has no artwork yet, so it stays private. Add artwork before publishing.";
}

/** Why a private card can't be made public: its second face has no name. */
export const PRIVATE_CARD_UNNAMED_FACE_REASON =
  "Its second face has no name yet, so it stays private. Name it in the editor before publishing.";

/** A publish refused with no other words for it. */
export const PUBLISH_REFUSED_MESSAGE = "It couldn't be made public, so it wasn't added — add it as private instead.";

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
    const asked = count("private_card");
    const refused = results.filter(
      (r) => r.status === "refused" || r.status === "failed" || r.status === "publish_refused",
    );
    const madePublic = results.filter((r) => r.published).length;
    const parts: string[] = [];
    if (added > 0) {
      const publishedAll = madePublic > 0 && madePublic === added && results.every((r) => r.status !== "added" || r.published);
      if (single && publishedAll) parts.push(`Made public and added to ${deck}.`);
      else if (publishedAll) parts.push(`Made ${cards(added)} public and added them to ${deck}.`);
      else {
        parts.push(single ? `Added to ${deck}.` : `Added ${cards(added)} to ${deck}.`);
        if (madePublic > 0) parts.push(`${cards(madePublic)} made public.`);
      }
    } else if (madePublic > 0) {
      parts.push(single ? "Made public." : `${cards(madePublic)} made public.`);
    }
    if (already > 0) parts.push(single ? `Already in ${deck}.` : `${cards(already)} already in it.`);
    if (full > 0) parts.push(deckFullMessage(deckTitle));
    if (refused.length > 0) {
      const reason = refused[0]?.error ?? "It couldn't be added.";
      parts.push(single ? reason : `${cards(refused.length)} not added: ${reason}`);
    }
    if (asked > 0) parts.push(single ? "Not added — it's private." : `${cards(asked)} not added: private.`);
    const failed = full + refused.length + asked;
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
