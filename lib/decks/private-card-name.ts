// ---------------------------------------------------------------------------
// A deck entry's name on a deck someone else is looking at — a card that
// viewer can't read (owner decision D11, TODO DK5.17; with the
// strong-language rule of 2026-10-28, lib/moderation/profanity.ts).
//
// A private card may sit in a public deck (D11): the deck's visitors see a
// "Private card" tile in its place — never the card's title or art. The
// entry keeps its own copy of a name (`deck_cards.name`, written when the
// card joined the deck), and what that copy IS depends on the entry:
//   * an entry with a PRINTING (an import, customized; an AI restyle of
//     one) holds the REAL card's name ("Sol Ring") — the visitor sees it
//     beside "Private card": it is what the deck plays, and it is not the
//     private card's;
//   * an entry with no printing (a card added from the creator, a card
//     linked onto a pasted name) holds the CARD's own title as it was when
//     it joined — so a visitor sees "Private card" alone, no name.
// Either way an entry whose own name or type line holds strong language
// shows "Private card" and no type line.
//
// "A card the viewer can't read" is an entry that links a card RLS hands
// back as null (the owner's private card), or that listDeckCards withholds
// (another creator's card that is no longer public, D3) — a visitor can't
// tell those apart, and neither can this rule. A printing or a placeholder
// (no linked card) is as it always was, and the owner always sees every
// real name. Pure.
// ---------------------------------------------------------------------------

import { bringsCard } from "@/lib/decks/entry-status";
import { containsProfanity } from "@/lib/moderation/profanity";

export const PRIVATE_CARD_NAME = "Private card";

/** What a visitor reads in place of a DELETED card's entry (0153): the card
 *  is gone, so "Private card" would say something untrue about it — never
 *  its title either (0152 masks it). The status badge's words too
 *  (lib/decks/deck-view.ts NO_LONGER_AVAILABLE). */
export const GONE_CARD_NAME = "No longer available";

type EntryLike = {
  card_id: string | null;
  name: string;
  type_line?: string | null;
  scryfall_id?: string | null;
  /** How the entry got into the deck (0144); absent = not known. */
  source?: string | null;
};

/** True when the entry links a card this viewer can't read — or its card is
 *  GONE (no card, no printing, an entry that came WITH a card: its name is
 *  the deleted card's title, deckEntryUnavailable's case) — the "Private
 *  card" tile of a visitor's view (never for the deck's owner, who keeps the
 *  stored name, "No longer available"). Migration 0152's deck_entry_hidden
 *  is the database's side: such a row reaches a visitor masked. */
export function isPrivateForViewer(
  entry: Pick<EntryLike, "card_id" | "scryfall_id" | "source">,
  card: unknown,
  viewerIsOwner: boolean,
): boolean {
  if (viewerIsOwner) return false;
  if (entry.card_id) return !card;
  return !entry.scryfall_id && bringsCard(entry.source);
}

/** True when the entry is hidden from this viewer because its card was
 *  DELETED (no card, no printing, a card-bringing source) — the "No longer
 *  available" face of isPrivateForViewer (migration 0153). */
export function isGoneForViewer(
  entry: Pick<EntryLike, "card_id" | "scryfall_id" | "source">,
  viewerIsOwner: boolean,
): boolean {
  return !viewerIsOwner && !entry.card_id && !entry.scryfall_id && bringsCard(entry.source);
}

/** The name a visitor reads in place of a hidden entry's: "No longer
 *  available" for a deleted card, else "Private card". */
export function hiddenEntryName(entry: Pick<EntryLike, "card_id" | "scryfall_id" | "source">, viewerIsOwner: boolean): string {
  return isGoneForViewer(entry, viewerIsOwner) ? GONE_CARD_NAME : PRIVATE_CARD_NAME;
}

/** True when this entry's name is hidden from a viewer who isn't the owner:
 *  a private card's entry with no printing behind it (its name is the
 *  card's own), or one whose name or type line holds strong language. */
export function hidesEntryName(entry: EntryLike, card: unknown, viewerIsOwner: boolean): boolean {
  return (
    isPrivateForViewer(entry, card, viewerIsOwner) &&
    (!entry.scryfall_id || containsProfanity(entry.name) || containsProfanity(entry.type_line ?? null))
  );
}

/** A format warning as a viewer reads it: one that quotes a name with
 *  strong language (the copy-limit warning names the card) quotes "Private
 *  card" instead. Warnings are judged on the REAL entries, so two private
 *  cards never count as copies of one name. */
export function publicDeckWarning<T extends { message: string }>(warning: T, viewerIsOwner: boolean): T {
  if (viewerIsOwner || !containsProfanity(warning.message)) return warning;
  return { ...warning, message: warning.message.replace(/“[^”]*”/g, (quoted) => (containsProfanity(quoted) ? `“${PRIVATE_CARD_NAME}”` : quoted)) };
}

/** The deck's items as a viewer sees them (the owner's untouched). Every
 *  surface of the page reads through it — the list, its pop-up, the copied
 *  decklist — so no name leaves by another door. */
export function publicDeckItems<T extends { entry: EntryLike; card: unknown }>(items: readonly T[], viewerIsOwner: boolean): T[] {
  return items.map((item) =>
    hidesEntryName(item.entry, item.card, viewerIsOwner)
      ? { ...item, entry: { ...item.entry, name: hiddenEntryName(item.entry, viewerIsOwner), type_line: null } }
      : item,
  );
}
