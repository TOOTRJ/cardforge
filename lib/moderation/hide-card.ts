import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { removeRenderObjects } from "@/lib/cards/bake-core";
import { purgeHiddenCard } from "@/lib/cards/revalidate";
import { lookupUsername } from "@/lib/profile/username";

// ---------------------------------------------------------------------------
// The moderation HIDE — one code path for the admin's "Hide" on a reported
// card (resolveCardReportsAction, lib/moderation/actions.ts) and for a card
// that uses a file the moderation rescan flagged
// (scripts/sweep-storage-orphans.mjs --rescan-review --apply, through
// POST /api/admin/storage-sweep). Plain module, not "use server": the caller
// has already checked who is asking (an admin session, or the cron bearer).
//
// In order, each step checked (they used to be fire-and-forget: a rejected
// update still produced "Card hidden" while the card stayed public):
//   1. the card → private, render pointer cleared, in ONE update;
//   2. both render objects (PNG + thumb) removed from the owner's
//      card-renders folder (removeRenderObjects retries once and logs);
//   3. the card's pending reports → actioned;
//   4. the purge: card page, profile, gallery, discovery surfaces AND the CDN
//      copies of its share image and its /render-cdn bake (tag card-<id>) —
//      after the remove, so the CDN can't be refilled from the object.
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;

export type HideCardResult =
  | { ok: true; ownerId: string }
  | { ok: false; error: string; notFound?: true };

export async function hideCard(
  admin: AdminClient,
  cardId: string,
  options: { resolvedBy: string | null },
): Promise<HideCardResult> {
  const { data: card, error: readError } = await admin
    .from("cards")
    .select("owner_id, slug")
    .eq("id", cardId)
    .maybeSingle();
  if (readError) return { ok: false, error: `Couldn't read the card: ${readError.message}` };
  if (!card) return { ok: false, error: "Card not found — it may already be deleted.", notFound: true };

  const { error: hideError } = await admin
    .from("cards")
    .update({ visibility: "private", rendered_image_url: null, rendered_thumb_url: null, rendered_at: null })
    .eq("id", cardId);
  if (hideError) return { ok: false, error: `Couldn't hide the card: ${hideError.message}` };

  const { error: removeError } = await removeRenderObjects(card.owner_id, [cardId]);
  if (removeError) {
    console.error(`[moderation] hid ${cardId} but could not delete its render: ${removeError}`);
  }

  const { error: reportsError } = await admin
    .from("card_reports")
    .update({ status: "actioned", resolved_at: new Date().toISOString(), resolved_by: options.resolvedBy })
    .eq("card_id", cardId)
    .eq("status", "pending");

  // The purge runs even when the reports weren't marked: the card IS hidden.
  await purgeHiddenCard({ id: cardId, slug: card.slug }, await lookupUsername(admin, card.owner_id));

  if (reportsError) {
    return { ok: false, error: `Card hidden, but the reports weren't marked: ${reportsError.message}` };
  }
  return { ok: true, ownerId: card.owner_id };
}
