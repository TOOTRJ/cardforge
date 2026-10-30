import { missingSecondFaceName } from "@/lib/cards/second-face-name";
import {
  storedArtMissing,
  storedLanguageBlocks,
  type VisibilityPreflightRow,
} from "@/lib/cards/visibility-preflight";
import { moderationLockReasonOf } from "@/lib/moderation/lock";
import {
  PRIVATE_CARD_MODERATION_REASON,
  PRIVATE_CARD_UNNAMED_FACE_REASON,
  privateCardArtReason,
  privateCardLanguageReason,
} from "@/lib/decks/membership-copy";

// ---------------------------------------------------------------------------
// Why a stored PRIVATE card can't be made public as it is (TODO DK0.13): the
// publish's own rules, read on the row the pre-flight read — FIRST the
// moderation lock (migration 0156: it stays private until an admin unhides
// it, lib/moderation/lock.ts), then its text
// (strong language, owner policy 2026-10-28), its artwork (no artwork → no
// gallery; a double-faced card's back too) and an unnamed second face. The
// deck paths never send such a card to the publish (one unnamed face would
// refuse a whole batch) and show this reason instead of "Make it public".
// Pure.
// ---------------------------------------------------------------------------

export function publishBlockReason(row: VisibilityPreflightRow): string | null {
  if (moderationLockReasonOf(row)) return PRIVATE_CARD_MODERATION_REASON;
  const fields = storedLanguageBlocks(row, "public");
  if (fields.length > 0) return privateCardLanguageReason(fields);
  const art = storedArtMissing(row);
  if (art) return privateCardArtReason(art);
  if (missingSecondFaceName(row.back_face as { title?: string | null } | null, "public")) {
    return PRIVATE_CARD_UNNAMED_FACE_REASON;
  }
  return null;
}
