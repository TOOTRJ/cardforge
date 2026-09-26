"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { FRAME_PROFILE_OVERRIDES_TAG } from "@/lib/cards/frame-profile-overrides";
import { staleTemplateFilter } from "@/lib/cards/frame-override-stale";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { frameProfileOverrideSchema } from "@/lib/cards/profile-override";
import { overrideHash } from "@/lib/cards/frame-verification-state";
import { recordFrameReviewEvent } from "@/lib/cards/frame-review-events";
import { CARD_LAYOUT_VERSION, hasNewerLook } from "@/lib/cards/layout-version";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// Admin mutations for frame layout overrides (the visual editor's Save /
// Reset). Saving marks that template's baked public/unlisted renders with
// `layout_version = null` — "a platform re-bake is owed". That is NOT an
// owner badge (hasNewerLook ignores null stamps, TODO 0.20): the editor
// starts the "marked" re-bake right away (/api/admin/rebake-marked) and
// the compare page shows what is left. The affected count is returned so
// the admin sees the blast radius.
//
// A card whose owner has NOT accepted a pending opt-in look (hasNewerLook)
// is left alone: re-baking it would force that look on them and silently
// drop their badge (review of TODO 0.20). It keeps its stamp and badge;
// accepting the update brings the geometry fix along. The count of those
// cards is returned too, so the save toast can say so.
//
// Cache: the read side (lib/cards/frame-profile-overrides.ts) is an
// unstable_cache entry tagged FRAME_PROFILE_OVERRIDES_TAG. A write must use
// `updateTag` — `revalidateTag(tag, "max")` is stale-while-revalidate and
// served the OLD map to the very next request (the editor's own
// router.refresh), so the tool could not read its own save.
//
// Reset only touches renders when a row actually existed: a draft-only
// "reset" used to null the layout_version of every baked card on the
// template, firing "newer look" badges and render_update notifications for
// a geometry that never changed.
// ---------------------------------------------------------------------------

const saveSchema = z.object({
  template: z.enum(FRAME_TEMPLATE_VALUES),
  overrides: frameProfileOverrideSchema,
});

const resetSchema = z.object({
  template: z.enum(FRAME_TEMPLATE_VALUES),
});

export type FrameProfileOverrideResult =
  | {
      ok: true;
      /** Baked renders now owed a re-bake (0 when nothing changed). */
      staleCount: number;
      /** Baked renders left alone because their owner hasn't accepted a
       *  pending opt-in look — they get the fix when the owner updates. */
      keptForOwner: number;
      /** False when the request was a no-op (reset with no saved row). */
      changed: boolean;
    }
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

/** Rows scanned per page / ids updated per request. */
const MARK_PAGE = 1000;
const MARK_CHUNK = 200;

/** Mark baked renders of a template as owed a re-bake (null stamp) so the
 *  compare page's re-bake — or the sweep — refreshes them with the new
 *  geometry, except cards whose owner has a pending opt-in look (see the
 *  header). Best-effort; returns the counts. */
async function markTemplateRendersStale(
  admin: ReturnType<typeof createAdminClient>,
  template: string,
): Promise<{ marked: number; keptForOwner: number }> {
  const filter = staleTemplateFilter(template);
  const toMark: string[] = [];
  let alreadyMarked = 0;
  let keptForOwner = 0;
  for (let from = 0; from < 50 * MARK_PAGE; from += MARK_PAGE) {
    let query = admin
      .from("cards")
      .select(
        "id, visibility, layout_version, rendered_image_url, frame_style, rarity, set_icon_url, set_icon_code, title, supertype, card_type, subtypes, power, toughness, loyalty, defense, back_face",
      )
      .in("visibility", ["public", "unlisted"])
      .not("rendered_image_url", "is", null);
    query =
      filter.kind === "or"
        ? query.or(filter.expression)
        : query.filter("frame_style->>template", "eq", filter.template);
    const { data, error } = await query.order("id", { ascending: true }).range(from, from + MARK_PAGE - 1);
    if (error || !data) break;
    for (const card of data) {
      if (card.layout_version == null) alreadyMarked += 1;
      else if (hasNewerLook(card)) keptForOwner += 1;
      else toMark.push(card.id);
    }
    if (data.length < MARK_PAGE) break;
  }
  let marked = alreadyMarked;
  for (let i = 0; i < toMark.length; i += MARK_CHUNK) {
    const { data } = await admin
      .from("cards")
      .update({ layout_version: null })
      .in("id", toMark.slice(i, i + MARK_CHUNK))
      .select("id");
    marked += data?.length ?? 0;
  }
  return { marked, keptForOwner };
}

/** Delete a template's override row; true when a row existed. */
async function deleteOverrideRow(
  admin: ReturnType<typeof createAdminClient>,
  template: string,
): Promise<{ ok: true; existed: boolean } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from("frame_profile_overrides")
    .delete()
    .eq("template", template)
    .select("template");
  if (error) return { ok: false, error: error.message };
  return { ok: true, existed: (data?.length ?? 0) > 0 };
}

function publish(): void {
  updateTag(FRAME_PROFILE_OVERRIDES_TAG);
  revalidatePath("/admin/frame-compare");
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
    const deleted = await deleteOverrideRow(admin, template);
    if (!deleted.ok) return deleted;
    if (!deleted.existed) {
      revalidatePath("/admin/frame-compare");
      return { ok: true, staleCount: 0, keptForOwner: 0, changed: false };
    }
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

  const { marked: staleCount, keptForOwner } = await markTemplateRendersStale(admin, template);
  // Template-wide history row ("*"): every colour's verification now
  // measures against a different layout — the checklist flags them.
  await recordFrameReviewEvent(admin, {
    template,
    colorKey: "*",
    action: Object.keys(overrides).length === 0 ? "override_reset" : "override_saved",
    actor: gate.adminId,
    layoutVersion: CARD_LAYOUT_VERSION,
    overrideHash: overrideHash(Object.keys(overrides).length === 0 ? null : overrides),
  });
  publish();
  return { ok: true, staleCount, keptForOwner, changed: true };
}

export async function resetFrameProfileOverrideAction(
  payload: unknown,
): Promise<FrameProfileOverrideResult> {
  const parsed = resetSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: "Invalid template." };
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const admin = createAdminClient();
  const deleted = await deleteOverrideRow(admin, parsed.data.template);
  if (!deleted.ok) return deleted;
  if (!deleted.existed) {
    // Nothing was saved for this template — the on-screen draft is the only
    // thing to discard, and that's the caller's job. No renders changed.
    revalidatePath("/admin/frame-compare");
    return { ok: true, staleCount: 0, keptForOwner: 0, changed: false };
  }

  const { marked: staleCount, keptForOwner } = await markTemplateRendersStale(admin, parsed.data.template);
  await recordFrameReviewEvent(admin, {
    template: parsed.data.template,
    colorKey: "*",
    action: "override_reset",
    actor: gate.adminId,
    layoutVersion: CARD_LAYOUT_VERSION,
    overrideHash: "none",
  });
  publish();
  return { ok: true, staleCount, keptForOwner, changed: true };
}
