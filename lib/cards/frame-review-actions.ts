"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { FRAME_COLOR_KEYS } from "@/lib/cards/frame-reference-registry";
import { validateReferenceForCombo } from "@/lib/cards/frame-reference-validation";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import { overrideHash } from "@/lib/cards/frame-verification-state";
import { recordFrameReviewEvent } from "@/lib/cards/frame-review-events";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import { scoreFrameCombo } from "@/lib/frames/score-combo";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// Admin mutation for the frame verification checklist. Checking a combo
// publishes it to the frame picker (see lib/cards/frame-availability.ts);
// unchecking withdraws it. Existing cards always keep rendering — gating
// only affects NEW frame selection in the picker.
//
// A tick RECORDS what it measured (migration 0115): the renderer layout
// version, the hash of the template's layout override, the reference
// printing that was on screen and the alignment score at that moment —
// so the checklist can say "needs re-verification" when the renderer or
// the override moves on. Every change appends to frame_review_events.
// ---------------------------------------------------------------------------

const SCRYFALL_ID = /^[0-9a-f-]{8,}$/i;

const inputSchema = z.object({
  template: z.enum(FRAME_TEMPLATE_VALUES),
  colorKey: z.enum(FRAME_COLOR_KEYS),
  verified: z.boolean(),
  /** The reference printing the admin was looking at when ticking
   *  (registry pick, pinned or default) — recorded, and scored. */
  referenceId: z.string().regex(SCRYFALL_ID).nullable().optional(),
});

export type SetFrameReviewResult =
  | { ok: true; scored: boolean }
  | { ok: false; error: string };

/** Every page that renders the frame picker from the verified set. `/create`
 *  is dynamic and reads the table per request; the guest creator is ISR
 *  (revalidate 3600) and would otherwise show or hide a frame up to an hour
 *  late. */
function revalidateFramePickers(): void {
  revalidatePath("/admin/frame-compare");
  revalidatePath("/create-guest");
  revalidatePath("/create");
}

export async function setFrameReviewAction(
  payload: unknown,
): Promise<SetFrameReviewResult> {
  const parsed = inputSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: "Invalid frame combination." };
  }

  const profile = await getCurrentProfile();
  if (!profile?.is_admin) {
    return { ok: false, error: "Not authorized." };
  }
  if (!isAdminConfigured()) {
    return { ok: false, error: "Admin key is not configured." };
  }

  const { template, colorKey, verified } = parsed.data;
  const referenceId = parsed.data.referenceId ?? null;
  const admin = createAdminClient();

  if (!verified) {
    // Withdraw: the stamped columns stay as the record of the last tick.
    const { error } = await admin.from("frame_reviews").upsert(
      {
        template,
        color_key: colorKey,
        verified: false,
        verified_at: null,
        verified_by: null,
      },
      { onConflict: "template,color_key" },
    );
    if (error) return { ok: false, error: error.message };
    await recordFrameReviewEvent(admin, {
      template,
      colorKey,
      action: "withdraw",
      actor: profile.id,
      layoutVersion: CARD_LAYOUT_VERSION,
    });
    revalidateFramePickers();
    return { ok: true, scored: false };
  }

  // What this tick measures against. The score is best-effort: a Scryfall
  // hiccup must not block publishing a frame the admin has eyeballed.
  const overrides = await getFrameProfileOverrides();
  const hash = overrideHash(overrides[template] ?? null);
  let score: unknown = null;
  let scoredReferenceId = referenceId;
  try {
    const result = await scoreFrameCombo({ template, color: colorKey, ref: referenceId });
    if (result.ok) {
      score = { overall: result.overall, global: result.global, slots: result.slots };
      scoredReferenceId = result.referenceId;
    }
  } catch (error) {
    console.warn(`[frame-review] score failed for ${template}/${colorKey}:`, error);
  }

  // NOTE: deliberately does NOT touch the reference_* columns — those belong
  // to setFrameReferenceAction (admin-pinned reference). Writing them here
  // used to make every verified combo look "admin-pinned".
  const { error } = await admin.from("frame_reviews").upsert(
    {
      template,
      color_key: colorKey,
      verified: true,
      verified_at: new Date().toISOString(),
      verified_by: profile.id,
      verified_layout_version: CARD_LAYOUT_VERSION,
      verified_override_hash: hash,
      verified_reference_id: scoredReferenceId,
      score_json: score as never,
    },
    { onConflict: "template,color_key" },
  );
  if (error) {
    return { ok: false, error: error.message };
  }

  await recordFrameReviewEvent(admin, {
    template,
    colorKey,
    action: "verify",
    actor: profile.id,
    layoutVersion: CARD_LAYOUT_VERSION,
    overrideHash: hash,
    referenceScryfallId: scoredReferenceId,
    scoreJson: score,
  });

  revalidateFramePickers();
  return { ok: true, scored: score !== null };
}

// ---------------------------------------------------------------------------
// Admin-chosen reference card per combo (frame-compare tool). The chosen
// printing replaces the registry default everywhere the tool shows or
// renders the reference; null reverts to the default. A printing whose
// colour or kind doesn't match the row is refused (the compare view would
// render and score a different frame than the checkbox publishes); scan
// quality and era mismatches are non-blocking warnings.
// ---------------------------------------------------------------------------

const referenceSchema = z.object({
  template: z.enum(FRAME_TEMPLATE_VALUES),
  colorKey: z.enum(FRAME_COLOR_KEYS),
  /** Scryfall id of the printing to pin, or null to revert to the
   *  registry default. */
  scryfallId: z.string().regex(SCRYFALL_ID, "Invalid Scryfall id.").nullable(),
});

export type SetFrameReferenceResult =
  | { ok: true; warning: string | null; name: string | null }
  | { ok: false; error: string };

export async function setFrameReferenceAction(
  payload: unknown,
): Promise<SetFrameReferenceResult> {
  const parsed = referenceSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: "Invalid reference payload." };
  }

  const profile = await getCurrentProfile();
  if (!profile?.is_admin) {
    return { ok: false, error: "Not authorized." };
  }
  if (!isAdminConfigured()) {
    return { ok: false, error: "Admin key is not configured." };
  }

  const { template, colorKey, scryfallId } = parsed.data;
  const admin = createAdminClient();

  if (scryfallId === null) {
    // Revert to the registry default: clear the pinned reference, keep the
    // verified state.
    const { error } = await admin.from("frame_reviews").upsert(
      {
        template,
        color_key: colorKey,
        reference_scryfall_id: null,
        reference_name: null,
        reference_set: null,
      },
      { onConflict: "template,color_key" },
    );
    if (error) return { ok: false, error: error.message };
    await recordFrameReviewEvent(admin, {
      template,
      colorKey,
      action: "unpin",
      actor: profile.id,
    });
    revalidatePath("/admin/frame-compare");
    return { ok: true, warning: null, name: null };
  }

  // Re-fetch server-side — never trust client-supplied card data.
  const { getCardById, assessPrintImageQuality } = await import(
    "@/lib/scryfall/client"
  );
  const card = await getCardById(scryfallId);
  if (!card) {
    return { ok: false, error: "Scryfall card not found." };
  }

  const check = validateReferenceForCombo(card, template, colorKey);
  if (check.errors.length > 0) {
    return { ok: false, error: check.errors.join(" ") };
  }

  const warnings = [...check.warnings];
  const quality = assessPrintImageQuality(card);
  if (quality !== "ok") {
    warnings.unshift(
      quality === "lowres"
        ? "This printing only has a low-resolution scan."
        : "Scryfall only has a placeholder image for this printing.",
    );
  }

  const { error } = await admin.from("frame_reviews").upsert(
    {
      template,
      color_key: colorKey,
      reference_scryfall_id: card.id,
      reference_name: card.name,
      reference_set: card.set ?? null,
    },
    { onConflict: "template,color_key" },
  );
  if (error) return { ok: false, error: error.message };

  await recordFrameReviewEvent(admin, {
    template,
    colorKey,
    action: "pin",
    actor: profile.id,
    referenceScryfallId: card.id,
  });

  revalidatePath("/admin/frame-compare");
  return {
    ok: true,
    warning: warnings.length > 0 ? warnings.join(" ") : null,
    name: card.name,
  };
}
