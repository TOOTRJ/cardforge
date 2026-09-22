"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  createClient,
  getCurrentProfile,
  getCurrentUser,
} from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cardRenderPath } from "@/lib/cards/storage-paths";
import { renderThumbPath } from "@/lib/cards/render-thumb";
import { purgeHiddenCard, revalidateCardPaths } from "@/lib/cards/revalidate";
import {
  reportDetailsSchema,
  reportReasonSchema,
} from "@/lib/moderation/schemas";
import { notifyAdminsOfReport } from "@/lib/moderation/notify";
import { isUuid } from "@/lib/ids";
import { lookupUsername } from "@/lib/profile/username";

// User reporting + admin moderation actions for public cards.
// Reason/details rules live in lib/moderation/schemas.ts, shared with the
// report dialog so client and server can't drift.

const reportSchema = z.object({
  cardId: z.string().uuid("Invalid card."),
  reason: reportReasonSchema,
  details: reportDetailsSchema,
});

export type ReportResult = { ok: true } | { ok: false; error: string };

/** Reports a single account may file per rolling day (cards + comments). Each
 *  report fans out to Slack, email and every admin's bell, so this is what
 *  stands between one annoyed user and a flooded moderation queue. Generous
 *  for anyone acting in good faith. (Not exported: a "use server" module may
 *  only export async functions — Turbopack 500s every page otherwise.) */
const REPORTS_PER_DAY = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const RATE_LIMITED =
  "You've filed a lot of reports today. Please try again tomorrow — or contact us if it's urgent.";

/** The reporter's own reports in the last 24h (RLS: users read their own).
 *  Fails open on a query error, like the other limiters. */
async function reporterIsOverLimit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<boolean> {
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const [cards, comments] = await Promise.all([
    supabase
      .from("card_reports")
      .select("id", { count: "exact", head: true })
      .eq("reporter_id", userId)
      .gte("created_at", since),
    supabase
      .from("comment_reports")
      .select("id", { count: "exact", head: true })
      .eq("reporter_id", userId)
      .gte("created_at", since),
  ]);
  if (cards.error || comments.error) return false;
  return (cards.count ?? 0) + (comments.count ?? 0) >= REPORTS_PER_DAY;
}

export async function reportCardAction(input: unknown): Promise<ReportResult> {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid report." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in to report a card." };

  const supabase = await createClient();

  // Only a card the reporter can actually see (public/unlisted — RLS hides
  // private ones). Without this, any UUID produced an admin alert.
  const { data: target } = await supabase
    .from("cards")
    .select("id, title")
    .eq("id", parsed.data.cardId)
    .in("visibility", ["public", "unlisted"])
    .maybeSingle();
  if (!target) return { ok: false, error: "That card isn't available to report." };

  if (await reporterIsOverLimit(supabase, user.id)) {
    return { ok: false, error: RATE_LIMITED };
  }

  const { error } = await supabase.from("card_reports").insert({
    card_id: parsed.data.cardId,
    reporter_id: user.id,
    reason: parsed.data.reason,
    details: parsed.data.details ?? null,
  });

  if (error) {
    // 23505 = this user already has a PENDING report on this card (0098 made
    // the uniqueness pending-only, so a resolved report never blocks a new
    // one) → treat as success (idempotent).
    if ((error as { code?: string }).code === "23505") return { ok: true };
    return { ok: false, error: "Couldn't file the report. Please try again." };
  }

  await notifyAdminsOfReport({
    kind: "card",
    reason: parsed.data.reason,
    details: parsed.data.details ?? null,
    context: target.title,
  });
  return { ok: true };
}

const commentReportSchema = z.object({
  commentId: z.string().uuid("Invalid comment."),
  reason: reportReasonSchema,
  details: reportDetailsSchema,
});

export async function reportCommentAction(input: unknown): Promise<ReportResult> {
  const parsed = commentReportSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid report." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in to report a comment." };

  const supabase = await createClient();

  // Same guards as cards: the comment must be readable by the reporter (RLS
  // scopes comments to cards they can see) and the reporter must be under
  // the daily cap.
  const { data: target } = await supabase
    .from("card_comments")
    .select("id, body")
    .eq("id", parsed.data.commentId)
    .maybeSingle();
  if (!target) return { ok: false, error: "That comment isn't available to report." };

  if (await reporterIsOverLimit(supabase, user.id)) {
    return { ok: false, error: RATE_LIMITED };
  }

  const { error } = await supabase.from("comment_reports").insert({
    comment_id: parsed.data.commentId,
    reporter_id: user.id,
    reason: parsed.data.reason,
    details: parsed.data.details ?? null,
  });
  if (error) {
    if ((error as { code?: string }).code === "23505") return { ok: true };
    return { ok: false, error: "Couldn't file the report. Please try again." };
  }

  await notifyAdminsOfReport({
    kind: "comment",
    reason: parsed.data.reason,
    details: parsed.data.details ?? null,
    context: target.body,
  });
  return { ok: true };
}

export type CommentResolveAction = "remove" | "dismiss";

// Admin-only. "remove" deletes the comment (its reports cascade away);
// "dismiss" clears the pending reports, leaving the comment.
export async function resolveCommentReportsAction(input: {
  commentId: string;
  action: CommentResolveAction;
}): Promise<ResolveResult> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return { ok: false, error: "Not authorized." };

  if (!isUuid(input.commentId)) return { ok: false, error: "Invalid comment id." };

  const admin = createAdminClient();
  if (input.action === "remove") {
    // Resolve the card first so the page can be purged after the delete.
    const { data: comment } = await admin
      .from("card_comments")
      .select("card_id, cards(slug, owner_id)")
      .eq("id", input.commentId)
      .maybeSingle();
    const { error } = await admin.from("card_comments").delete().eq("id", input.commentId);
    if (error) return { ok: false, error: `Couldn't remove the comment: ${error.message}` };

    const card = (comment as { cards?: { slug: string | null; owner_id: string } | null } | null)
      ?.cards;
    if (card?.slug) {
      revalidateCardPaths(card.slug, await lookupUsername(admin, card.owner_id));
    }
  } else {
    const { error } = await admin
      .from("comment_reports")
      .update({
        status: "dismissed",
        resolved_at: new Date().toISOString(),
        resolved_by: profile.id,
      })
      .eq("comment_id", input.commentId)
      .eq("status", "pending");
    if (error) return { ok: false, error: `Couldn't dismiss the reports: ${error.message}` };
  }

  revalidatePath("/admin/moderation");
  return { ok: true };
}

export type ResolveAction = "hide" | "dismiss";
export type ResolveResult = { ok: true } | { ok: false; error: string };

// Admin-only. Resolves ALL pending reports for a card: "hide" un-publishes the
// card (→ private, render cleaned) and marks reports actioned; "dismiss" clears
// the reports with no change to the card. Runs via the service role (bypasses
// owner RLS) — gated on is_admin here.
export async function resolveCardReportsAction(input: {
  cardId: string;
  action: ResolveAction;
}): Promise<ResolveResult> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return { ok: false, error: "Not authorized." };

  if (!isUuid(input.cardId)) return { ok: false, error: "Invalid card id." };

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  if (input.action === "hide") {
    const { data: card } = await admin
      .from("cards")
      .select("owner_id, slug")
      .eq("id", input.cardId)
      .maybeSingle();
    if (!card) return { ok: false, error: "Card not found — it may already be deleted." };

    // Every step used to be fire-and-forget: a rejected update still produced
    // "Card hidden" and actioned the reports while the card stayed public.
    const { error: hideError } = await admin
      .from("cards")
      .update({ visibility: "private", rendered_image_url: null, rendered_thumb_url: null, rendered_at: null })
      .eq("id", input.cardId);
    if (hideError) return { ok: false, error: `Couldn't hide the card: ${hideError.message}` };

    // Both public render objects (the thumb used to be left behind).
    const png = cardRenderPath(card.owner_id, input.cardId);
    const { error: removeError } = await admin.storage
      .from("card-renders")
      .remove([png, renderThumbPath(png)]);
    if (removeError) {
      console.error(`[moderation] hid ${input.cardId} but could not delete its render: ${removeError.message}`);
    }

    const { error: reportsError } = await admin
      .from("card_reports")
      .update({ status: "actioned", resolved_at: nowIso, resolved_by: profile.id })
      .eq("card_id", input.cardId)
      .eq("status", "pending");
    if (reportsError) {
      return { ok: false, error: `Card hidden, but the reports weren't marked: ${reportsError.message}` };
    }

    // Same purge the owner's private flip gets: card page, profile, gallery,
    // discovery surfaces AND the CDN copy of the share image.
    await purgeHiddenCard(
      { id: input.cardId, slug: card.slug },
      await lookupUsername(admin, card.owner_id),
    );
  } else {
    const { error } = await admin
      .from("card_reports")
      .update({ status: "dismissed", resolved_at: nowIso, resolved_by: profile.id })
      .eq("card_id", input.cardId)
      .eq("status", "pending");
    if (error) return { ok: false, error: `Couldn't dismiss the reports: ${error.message}` };
  }

  revalidatePath("/admin/moderation");
  return { ok: true };
}
