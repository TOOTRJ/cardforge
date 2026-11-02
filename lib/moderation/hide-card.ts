import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { CLEARED_RENDER_POINTERS, removeRenderObjects } from "@/lib/cards/bake-core";
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
//   1. the card → private, every render pointer (both faces', 0126 + 0134)
//      cleared AND the moderation lock set (migration 0156,
//      lib/moderation/lock.ts: it stays private until an admin unhides it),
//      in ONE update;
//   2. every render object (the PNG + thumb of each face) removed from the
//      owner's card-renders folder (removeRenderObjects retries once and
//      logs);
//   3. the card's pending reports → actioned;
//   4. the purge: card page, profile, gallery, discovery surfaces AND the CDN
//      copies of its share image and its /render-cdn bake (tag card-<id>) —
//      after the remove, so the CDN can't be refilled from the object.
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;

/** Why moderation hid the card — the lock's reason CODE (0156's CHECK),
 *  never report text. */
export type HideCardReason = "report" | "flagged_file";

/** A database 0156 hasn't reached (PostgREST: no such column in its schema
 *  cache, or Postgres' own undefined_column) — the hide must still happen. */
function isMissingLockColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (error.code === "PGRST204" || error.code === "42703") && (error.message ?? "").includes("moderation_hidden");
}

export type HideCardResult =
  | { ok: true; ownerId: string }
  | { ok: false; error: string; notFound?: true };

export async function hideCard(
  admin: AdminClient,
  cardId: string,
  options: { resolvedBy: string | null; reason: HideCardReason },
): Promise<HideCardResult> {
  const { data: card, error: readError } = await admin
    .from("cards")
    .select("owner_id, slug")
    .eq("id", cardId)
    .maybeSingle();
  if (readError) return { ok: false, error: `Couldn't read the card: ${readError.message}` };
  if (!card) return { ok: false, error: "Card not found — it may already be deleted.", notFound: true };

  const hide = { visibility: "private" as const, ...CLEARED_RENDER_POINTERS };
  let { error: hideError } = await admin
    .from("cards")
    .update({ ...hide, moderation_hidden_at: new Date().toISOString(), moderation_hidden_reason: options.reason })
    .eq("id", cardId);
  if (isMissingLockColumn(hideError)) {
    // Between a deploy and migration 0156 landing: hide without the lock
    // rather than not at all (0156's backfill then locks it if a report was
    // actioned; a rescan hide with no report stays unlocked — logged).
    console.error(`[moderation] ${cardId} hidden without the lock — migration 0156 has not landed here`);
    ({ error: hideError } = await admin.from("cards").update(hide).eq("id", cardId));
  }
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
