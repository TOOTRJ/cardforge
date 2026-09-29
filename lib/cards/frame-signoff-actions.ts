"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { FRAME_COLOR_KEYS } from "@/lib/cards/frame-reference-registry";
import { pickFrameReferenceFrom } from "@/lib/cards/frame-reference-pick";
import { getFrameReviews } from "@/lib/cards/frame-reviews";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import { overrideHash } from "@/lib/cards/frame-verification-state";
import {
  latestScoreEvents,
  recordFrameReviewEvent,
} from "@/lib/cards/frame-review-events";
import { SIGN_OFF_LOW_MATCH_PCT, signOffStatus } from "@/lib/cards/frame-signoff";
import { revalidateFramePickers } from "@/lib/cards/frame-picker-revalidate";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import { scoreFrameCombo } from "@/lib/frames/score-combo";
import { removeRenderObject } from "@/lib/cards/bake-core";
import { cardRenderPath } from "@/lib/cards/storage-paths";
import { renderThumbPath } from "@/lib/cards/render-thumb";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// Admin actions behind the stepper walk-through (frames plan Phase 2):
//
//   scoreFrameColorAction      — score ONE colour of a template against its
//                                reference and record it (a "score" event).
//   signOffFrameTemplateAction — publish a whole template (2.4): every colour
//                                with a reference carries a current score +
//                                the owner's tick; stamps each like a tick.
//   deleteFramePreviewCardAction — remove a walked preview card (2.3).
//
// Admin-gated from the profile (never the request) before any write; writes
// go through the service role. Nothing here writes a card's pixels.
// ---------------------------------------------------------------------------

type ActionError = { ok: false; error: string };

async function requireAdmin(): Promise<{ id: string } | ActionError> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return { ok: false, error: "Not authorized." };
  if (!isAdminConfigured()) return { ok: false, error: "Admin key is not configured." };
  return { id: profile.id };
}

const templateSchema = z.enum(FRAME_TEMPLATE_VALUES);

// ---- Score one colour --------------------------------------------------------

const scoreSchema = z.object({
  template: templateSchema,
  colorKey: z.enum(FRAME_COLOR_KEYS),
});

export type ScoreFrameColorResult =
  | { ok: true; overall: number; referenceId: string }
  | ActionError;

export async function scoreFrameColorAction(
  payload: unknown,
): Promise<ScoreFrameColorResult> {
  const parsed = scoreSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: "Invalid frame combination." };
  const admin = await requireAdmin();
  if ("ok" in admin) return admin;

  const { template, colorKey } = parsed.data;
  // The combo's own reference (pinned, else the registry default) — the one
  // the sign-off counts, whatever alternate the compare view had open.
  const result = await scoreFrameCombo({ template, color: colorKey, ref: null });
  if (!result.ok) return { ok: false, error: result.error };

  const overrides = await getFrameProfileOverrides();
  const recorded = await recordFrameReviewEvent(createAdminClient(), {
    template,
    colorKey,
    action: "score",
    actor: admin.id,
    layoutVersion: CARD_LAYOUT_VERSION,
    overrideHash: overrideHash(overrides[template] ?? null),
    referenceScryfallId: result.referenceId,
    scoreJson: { overall: result.overall, global: result.global, slots: result.slots },
  });
  if (!recorded) {
    return { ok: false, error: "Scored, but the score couldn't be recorded — try again." };
  }
  revalidatePath("/admin/frame-compare");
  return { ok: true, overall: result.overall, referenceId: result.referenceId };
}

// ---- Sign off a template -----------------------------------------------------

const signOffSchema = z.object({
  template: templateSchema,
  /** The owner's tick: "I walked the stepper and every colour looks right." */
  confirmed: z.literal(true),
});

export type SignOffFrameTemplateResult =
  | { ok: true; published: string[]; sampleOnly: string[] }
  | ActionError;

export async function signOffFrameTemplateAction(
  payload: unknown,
): Promise<SignOffFrameTemplateResult> {
  const parsed = signOffSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: "Tick the confirmation before publishing the template." };
  }
  const admin = await requireAdmin();
  if ("ok" in admin) return admin;

  const { template } = parsed.data;
  const [reviews, overrides, scores] = await Promise.all([
    getFrameReviews(),
    getFrameProfileOverrides(),
    latestScoreEvents(template),
  ]);
  const hash = overrideHash(overrides[template] ?? null);
  // Re-derived here from the server's own reads — never the client's view.
  const status = signOffStatus({
    template,
    currentOverrideHash: hash,
    colours: FRAME_COLOR_KEYS.map((colorKey) => ({
      colorKey,
      referenceId: pickFrameReferenceFrom(reviews, template, colorKey)?.scryfallId ?? null,
      score: scores.get(colorKey) ?? null,
    })),
  });
  if (status.blocking.length > 0) {
    return {
      ok: false,
      error: `Score every colour on today's renderer first — missing or stale: ${status.blocking
        .map((k) => k.toUpperCase())
        .join(", ")}.`,
    };
  }
  if (status.publishable.length === 0) {
    return { ok: false, error: "No colour of this template can be scored — publish them individually." };
  }

  const client = createAdminClient();
  const now = new Date().toISOString();
  // Stamped exactly like a tick (setFrameReviewAction), from the recorded
  // score; the reference_* (pinned) columns are left alone.
  const rows = status.publishable.map((colorKey) => {
    const score = scores.get(colorKey)!;
    return {
      template,
      color_key: colorKey,
      verified: true,
      verified_at: now,
      verified_by: admin.id,
      verified_layout_version: CARD_LAYOUT_VERSION,
      verified_override_hash: hash,
      verified_reference_id: score.referenceScryfallId,
      score_json: score.scoreJson as never,
    };
  });
  const { error } = await client
    .from("frame_reviews")
    .upsert(rows, { onConflict: "template,color_key" });
  if (error) return { ok: false, error: error.message };

  for (const row of rows) {
    await recordFrameReviewEvent(client, {
      template,
      colorKey: row.color_key,
      action: "verify",
      actor: admin.id,
      layoutVersion: CARD_LAYOUT_VERSION,
      overrideHash: hash,
      referenceScryfallId: row.verified_reference_id,
      scoreJson: row.score_json,
    });
  }
  await recordFrameReviewEvent(client, {
    template,
    colorKey: "*",
    action: "signoff",
    actor: admin.id,
    layoutVersion: CARD_LAYOUT_VERSION,
    overrideHash: hash,
    scoreJson: {
      colours: Object.fromEntries(
        status.colours.map((c) => [c.colorKey, c.overall]),
      ),
      sampleOnly: status.sampleOnly,
      // Published anyway below the warning line (the view's confirm step
      // named them) — kept for the history, never a block.
      lowMatch: status.lowPublishable,
      lowMatchBelowPct: SIGN_OFF_LOW_MATCH_PCT,
    },
  });

  revalidateFramePickers();
  return { ok: true, published: status.publishable, sampleOnly: status.sampleOnly };
}

// ---- Delete a walked preview card ---------------------------------------------

const deleteSchema = z.object({ cardId: z.string().uuid() });

export type DeleteFramePreviewResult = { ok: true } | ActionError;

export async function deleteFramePreviewCardAction(
  payload: unknown,
): Promise<DeleteFramePreviewResult> {
  const parsed = deleteSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: "Invalid card." };
  const admin = await requireAdmin();
  if ("ok" in admin) return admin;

  const client = createAdminClient();
  // Only ever a flagged preview — this is not a general admin delete.
  const { data: card, error: readError } = await client
    .from("cards")
    .select("id, owner_id")
    .eq("id", parsed.data.cardId)
    .eq("frame_preview", true)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!card) return { ok: false, error: "That frame preview no longer exists." };

  const { error } = await client
    .from("cards")
    .delete()
    .eq("id", card.id)
    .eq("frame_preview", true);
  if (error) return { ok: false, error: error.message };

  // A preview is private, so it has no public render — but a card flagged
  // after it was baked could; drop both objects (a missing one is a no-op).
  const png = cardRenderPath(card.owner_id, card.id);
  await removeRenderObject(client, png);
  await removeRenderObject(client, renderThumbPath(png));

  revalidatePath("/admin/frame-compare");
  return { ok: true };
}
