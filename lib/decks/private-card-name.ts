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

import { containsProfanity } from "@/lib/moderation/profanity";

export const PRIVATE_CARD_NAME = "Private card";

type EntryLike = { card_id: string | null; name: string; type_line?: string | null; scryfall_id?: string | null };

/** True when the entry links a card this viewer can't read — the "Private
 *  card" tile of a visitor's view (never for the deck's owner). */
export function isPrivateForViewer(entry: Pick<EntryLike, "card_id">, card: unknown, viewerIsOwner: boolean): boolean {
  return !viewerIsOwner && Boolean(entry.card_id) && !card;
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
      ? { ...item, entry: { ...item.entry, name: PRIVATE_CARD_NAME, type_line: null } }
      : item,
  );
}
