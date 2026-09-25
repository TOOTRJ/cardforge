"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { FRAME_COLOR_KEYS } from "@/lib/cards/frame-reference-registry";
import { validateReferenceForCombo } from "@/lib/cards/frame-reference-validation";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// Admin mutation for the frame verification checklist. Checking a combo
// publishes it to the frame picker (see lib/cards/frame-availability.ts);
// unchecking withdraws it. Existing cards always keep rendering — gating
// only affects NEW frame selection in the picker.
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  template: z.enum(FRAME_TEMPLATE_VALUES),
  colorKey: z.enum(FRAME_COLOR_KEYS),
  verified: z.boolean(),
});

export type SetFrameReviewResult =
  | { ok: true }
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

  const admin = createAdminClient();
  // NOTE: deliberately does NOT touch the reference_* columns — those belong
  // to setFrameReferenceAction (admin-pinned reference). Writing them here
  // used to make every verified combo look "admin-pinned".
  const { error } = await admin.from("frame_reviews").upsert(
    {
      template,
      color_key: colorKey,
      verified,
      verified_at: verified ? new Date().toISOString() : null,
      verified_by: verified ? profile.id : null,
    },
    { onConflict: "template,color_key" },
  );
  if (error) {
    return { ok: false, error: error.message };
  }

  revalidateFramePickers();
  return { ok: true };
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
  scryfallId: z
    .string()
    .regex(/^[0-9a-f-]{8,}$/i, "Invalid Scryfall id.")
    .nullable(),
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

  revalidatePath("/admin/frame-compare");
  return {
    ok: true,
    warning: warnings.length > 0 ? warnings.join(" ") : null,
    name: card.name,
  };
}
