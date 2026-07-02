"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import {
  FRAME_COLOR_KEYS,
  FRAME_REFERENCES,
} from "@/lib/cards/frame-reference-registry";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";

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
  const reference =
    FRAME_REFERENCES[template as FrameTemplate]?.[colorKey] ?? null;

  const admin = createAdminClient();
  const { error } = await admin.from("frame_reviews").upsert(
    {
      template,
      color_key: colorKey,
      verified,
      verified_at: verified ? new Date().toISOString() : null,
      verified_by: verified ? profile.id : null,
      reference_scryfall_id: reference?.scryfallId ?? null,
    },
    { onConflict: "template,color_key" },
  );
  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin/frame-compare");
  return { ok: true };
}
