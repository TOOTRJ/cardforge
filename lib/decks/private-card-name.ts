// ---------------------------------------------------------------------------
// A deck entry's name on a PUBLIC deck surface (owner 2026-10-28, with the
// strong-language rule, lib/moderation/profanity.ts). A custom card's deck
// entry keeps its own copy of the card's name (`deck_cards.name`, written
// when the card joined the deck), so a card the rule kept PRIVATE still
// printed that name in someone else's view of a public deck.
//
// The narrow rule: for a viewer who is not the deck's owner, an entry that
// links a card the viewer can NOT read (`card` null under RLS — private, or
// gone) AND whose own name or type line holds strong language shows the
// neutral "Private card" and no type line. Every other entry — an ordinary
// private card in a public deck, a printing, a placeholder — is exactly as
// today, and the owner always sees the real name. Pure.
// ---------------------------------------------------------------------------

import { containsProfanity } from "@/lib/moderation/profanity";

export const PRIVATE_CARD_NAME = "Private card";

type EntryLike = { card_id: string | null; name: string; type_line?: string | null };

/** True when this entry's name is hidden from a viewer who isn't the owner. */
export function hidesEntryName(entry: EntryLike, card: unknown, viewerIsOwner: boolean): boolean {
  return (
    !viewerIsOwner &&
    Boolean(entry.card_id) &&
    !card &&
    (containsProfanity(entry.name) || containsProfanity(entry.type_line ?? null))
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

/** The deck's items as a viewer sees them (the owner's untouched). */
export function publicDeckItems<T extends { entry: EntryLike; card: unknown }>(items: readonly T[], viewerIsOwner: boolean): T[] {
  return items.map((item) =>
    hidesEntryName(item.entry, item.card, viewerIsOwner)
      ? { ...item, entry: { ...item.entry, name: PRIVATE_CARD_NAME, type_line: null } }
      : item,
  );
}
