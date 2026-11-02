// ---------------------------------------------------------------------------
// The moderation lock (migration 0156, owner approval 2026-10-30): a card
// the moderation hide took out of view (lib/moderation/hide-card.ts — a
// report's "Hide card", or the flagged-file rescan) stays PRIVATE until an
// admin unhides it (admin_unhide_card, /admin/moderation). The database
// holds it (cards_moderation_lock_private: a locked card is private for
// every role); every go-public path reads the lock FIRST and answers with a
// typed reason rather than the database's error:
//
//   * updateCardAction — the edit is saved PRIVATE, `moderationLocked: true`
//     (the creator's Publish step already offers neither Public nor
//     Unlisted and says why);
//   * updateCardsVisibilityAction — My Cards' bulk bar and the deck's
//     "Make public" leave the card as it is and count it
//     (`skippedModeration`, like `skippedLanguage`);
//   * any other surface that offers "make public" (the deck's join offer,
//     PR #706) asks `moderationLockReasonOf(card)` and offers nothing for a
//     locked card.
//
// The owner sees the card as "Hidden by moderation" (card page, My Cards),
// with a way to contact the team; the reason code is never shown raw.
// Pure and client-safe.
// ---------------------------------------------------------------------------

import { VISIBILITY_LABELS, type Visibility } from "@/types/card";

/** What a row must carry for the lock to be read. Absent (a select that
 *  does not name the column, a database 0156 hasn't reached) = unlocked. */
export type ModerationLockable = { moderation_hidden_at?: string | null };

/** The one reason a lock gives. */
export type ModerationLockReason = "moderation";

/** "moderation" when the card is locked by moderation, else null — the ONE
 *  question every go-public offer asks before it offers anything. */
export function moderationLockReasonOf(card: ModerationLockable | null | undefined): ModerationLockReason | null {
  return card?.moderation_hidden_at ? "moderation" : null;
}

export function isModerationLocked(card: ModerationLockable | null | undefined): boolean {
  return moderationLockReasonOf(card) !== null;
}

/** The CHECK a go-public write on a locked card breaks (0156). */
export const MODERATION_LOCK_CONSTRAINT = "cards_moderation_lock_private";

/** True for Postgres' answer to a go-public write on a locked card — the
 *  race where the lock landed after the action read the row. */
export function isModerationLockViolation(error: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(error && error.code === "23514" && (error.message ?? "").includes(MODERATION_LOCK_CONSTRAINT));
}

/** Where the owner reaches the team (the site's feedback form). */
export const MODERATION_CONTACT_HREF = "/feedback";

/** The label the owner sees in place of "Private". */
export const HIDDEN_BY_MODERATION_LABEL = "Hidden by moderation";

/** A card's visibility as its OWNER reads it (My Cards, the card page):
 *  "Hidden by moderation" for a locked card, else the plain label. */
export function ownerVisibilityLabel(card: ModerationLockable & { visibility: Visibility }): string {
  return isModerationLocked(card) ? HIDDEN_BY_MODERATION_LABEL : VISIBILITY_LABELS[card.visibility];
}

/** The owner's note (card page, the Publish step); a "Contact us" link to
 *  MODERATION_CONTACT_HREF follows it. */
export const MODERATION_LOCK_NOTE =
  "Our moderation team hid this card, so it stays private until they review it again.";

/** An unavailable visibility chip's reason. */
export const MODERATION_LOCK_CHOICE_REASON = "Unavailable — this card was hidden by moderation.";

/** The toast after an edit the lock kept private. */
export function moderationLockedSavedMessage(title: string): string {
  return `Saved “${title}” as private — it was hidden by moderation and stays private until our team reviews it.`;
}

/** A remix of a locked card is refused (owner decision 2026-10-30) — by
 *  createCardAction, the AI remix and the deck remix's plan, before any art
 *  is copied or any credit spent. */
export const MODERATION_LOCKED_REMIX_CODE = "MODERATION_LOCKED_REMIX";
export const MODERATION_LOCKED_REMIX_MESSAGE =
  "This card was hidden by moderation, so it can't be remixed. Contact us if you think that's a mistake.";

/** A refused write (the race above), in words. */
export const MODERATION_LOCK_REFUSED =
  "This card was hidden by moderation, so it stays private — nothing was published.";

/** The cards a bulk publish / unlist left as they were because moderation
 *  hid them, as a sentence the toast adds — "" when there were none. */
export function moderationLockedSkippedLine(skipped: number | undefined): string {
  if (!skipped || skipped <= 0) return "";
  return skipped === 1
    ? "1 card stayed private: it was hidden by moderation."
    : `${skipped} cards stayed private: they were hidden by moderation.`;
}
