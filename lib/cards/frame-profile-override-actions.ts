"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { FRAME_PROFILE_OVERRIDES_TAG } from "@/lib/cards/frame-profile-overrides";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { frameProfileOverrideSchema } from "@/lib/cards/profile-override";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// Admin mutations for frame layout overrides (the visual editor's Save /
// Reset). Saving marks that template's baked public/unlisted renders stale
// via `layout_version = null` — the existing rebake sweep query already
// treats NULL as stale, so no new machinery. The affected count is returned
// so the admin sees the blast radius.
// ---------------------------------------------------------------------------

const saveSchema = z.object({
  template: z.enum(FRAME_TEMPLATE_VALUES),
  overrides: frameProfileOverrideSchema,
});

const resetSchema = z.object({
  template: z.enum(FRAME_TEMPLATE_VALUES),
});

export type FrameProfileOverrideResult =
  | { ok: true; staleCount: number }
  | { ok: false; error: string };

async function requireAdmin(): Promise<
  { ok: true; adminId: string } | { ok: false; error: string }
> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return { ok: false, error: "Not authorized." };
  if (!isAdminConfigured()) {
    return { ok: false, error: "Admin key is not configured." };
  }
  return { ok: true, adminId: profile.id };
}

/** Mark baked renders of a template stale so the rebake sweep refreshes
 *  them with the new geometry. Best-effort; returns the affected count. */
async function markTemplateRendersStale(
  admin: ReturnType<typeof createAdminClient>,
  template: string,
): Promise<number> {
  const { data } = await admin
    .from("cards")
    .update({ layout_version: null })
    .in("visibility", ["public", "unlisted"])
    .not("rendered_image_url", "is", null)
    .filter("frame_style->>template", "eq", template)
    .select("id");
  return data?.length ?? 0;
}

export async function saveFrameProfileOverrideAction(
  payload: unknown,
): Promise<FrameProfileOverrideResult> {
  const parsed = saveSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: "Invalid override payload." };
  }
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const { template, overrides } = parsed.data;
  const admin = createAdminClient();

  if (Object.keys(overrides).length === 0) {
    // An empty override is a reset.
    const { error } = await admin
      .from("frame_profile_overrides")
      .delete()
      .eq("template", template);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await admin.from("frame_profile_overrides").upsert(
      {
        template,
        overrides,
        updated_at: new Date().toISOString(),
        updated_by: gate.adminId,
      },
      { onConflict: "template" },
    );
    if (error) return { ok: false, error: error.message };
  }

  const staleCount = await markTemplateRendersStale(admin, template);
  revalidateTag(FRAME_PROFILE_OVERRIDES_TAG, "max");
  revalidatePath("/admin/frame-compare");
  return { ok: true, staleCount };
}

export async function resetFrameProfileOverrideAction(
  payload: unknown,
): Promise<FrameProfileOverrideResult> {
  const parsed = resetSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: "Invalid template." };
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const admin = createAdminClient();
  const { error } = await admin
    .from("frame_profile_overrides")
    .delete()
    .eq("template", parsed.data.template);
  if (error) return { ok: false, error: error.message };

  const staleCount = await markTemplateRendersStale(admin, parsed.data.template);
  revalidateTag(FRAME_PROFILE_OVERRIDES_TAG, "max");
  revalidatePath("/admin/frame-compare");
  return { ok: true, staleCount };
}
