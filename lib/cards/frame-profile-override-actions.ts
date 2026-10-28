"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { FRAME_PROFILE_OVERRIDES_TAG } from "@/lib/cards/frame-profile-overrides";
import {
  backFaceDrawsOn,
  staleBackBodyFilter,
  staleTemplateFilter,
} from "@/lib/cards/frame-override-stale";
import type { CardFaceColumns } from "@/lib/cards/faces";
import { selectScopeColumns } from "@/lib/cards/bake-select";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { frameProfileOverrideSchema } from "@/lib/cards/profile-override";
import { overrideHash } from "@/lib/cards/frame-verification-state";
import { recordFrameReviewEvent } from "@/lib/cards/frame-review-events";
import { CARD_LAYOUT_VERSION, hasNewerLook, type ScopeCard } from "@/lib/cards/layout-version";
import { artSlotOverrideRefusal } from "@/lib/frames/art-window-override";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// Admin mutations for frame layout overrides (the visual editor's Save /
// Reset). Saving marks that template's baked public/unlisted renders with
// `layout_version = null` — "a platform re-bake is owed". That is NOT an
// owner badge (hasNewerLook ignores null stamps, TODO 0.20): the editor
// starts the "marked" re-bake right away (/api/admin/rebake-marked) and
// the compare page shows what is left. The affected count is returned so
// the admin sees the blast radius. A BACK body's save marks the cards whose
// back face is drawn on it as well (lib/cards/frame-override-stale.ts): the
// stamp is the card's, so the re-bake writes both faces again.
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
// router.refresh), so the tool could not read its own save. The tag is
// busted right after the row write and BEFORE the marking (a save bake
// reads the cached map; see bustOverridesCache).
//
// Reset only touches renders when a row actually existed: a draft-only
// "reset" used to null the layout_version of every baked card on the
// template, firing "newer look" badges and render_update notifications for
// a geometry that never changed.
//
// An override that moves an ART SLOT must pass the art-window check first
// (lib/frames/art-window-override.ts — the rule CI holds the code profiles
// to, TODO 7.6, on the masters the bake draws): a slot that leaves the
// frame's window showing #101015 is refused with the finding, before any
// write. Reset needs no check — it returns to the code profile.
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
  const backFilter = staleBackBodyFilter(template);
  const toMark: string[] = [];
  // A card is counted once, whichever scan finds it (a template a card
  // wore as a front AND a back would otherwise count it twice).
  const seen = new Set<string>();
  let alreadyMarked = 0;
  let keptForOwner = 0;
  type ScanQuery = ReturnType<ReturnType<typeof admin.from>["select"]>;
  type ScanRow = ScopeCard &
    CardFaceColumns & {
      id: string;
      visibility: string | null;
      layout_version: number | null;
      rendered_image_url: string | null;
    };
  const scan = async (
    narrow: (query: ScanQuery) => ScanQuery,
    keep: (card: CardFaceColumns) => boolean,
  ): Promise<void> => {
    for (let from = 0; from < 50 * MARK_PAGE; from += MARK_PAGE) {
      // Only the columns the scope rules read: ScopeCard's, from the ONE
      // list (lib/cards/bake-select.ts SCOPE_CARD_COLUMNS — a column left
      // out reads as "owes the bump" on every card, which would null-stamp
      // cards that owe nothing). The collector fields (TODO 4.9a) join them
      // only if a correction is ever scoped by set or language.
      const { data, error } = await selectScopeColumns("id, visibility, layout_version, rendered_image_url", (columns) =>
        narrow(
          admin
            .from("cards")
            .select(columns)
            .in("visibility", ["public", "unlisted"])
            .not("rendered_image_url", "is", null),
        )
          .order("id", { ascending: true })
          .range(from, from + MARK_PAGE - 1),
      );
      if (error || !data) break;
      const rows = data as unknown as ScanRow[];
      for (const card of rows) {
        if (seen.has(card.id) || !keep(card)) continue;
        seen.add(card.id);
        if (card.layout_version == null) alreadyMarked += 1;
        else if (hasNewerLook(card)) keptForOwner += 1;
        else toMark.push(card.id);
      }
      if (rows.length < MARK_PAGE) break;
    }
  };
  // The cards whose FRONT draws on the template — unchanged since 0.20.
  await scan(
    (query) =>
      filter.kind === "or"
        ? query.or(filter.expression)
        : query.filter("frame_style->>template", "eq", filter.template),
    () => true,
  );
  // The cards whose BACK face is drawn on it (a DFC back body, TODO 5.3):
  // their `.back.png` / `.back.thumb.webp` carry the layout too. ONE stamp
  // per card, so nulling it re-bakes both faces in one write
  // (runRebakeBatch, scope "marked").
  if (backFilter) {
    await scan(
      (query) => query.filter(backFilter.column, "eq", backFilter.template),
      (card) => backFaceDrawsOn(card, template),
    );
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

/** Bust the overrides read cache — RIGHT AFTER the row write, BEFORE any
 *  card is marked stale, so nothing that reads the cached map after the
 *  marking (the live previews, the editor's own refresh) draws the old one.
 *  The stored bakes read the overrides uncached behind the override-stamp
 *  guard (lib/cards/override-stamps.ts), which catches a save mid-bake. */
function bustOverridesCache(): void {
  updateTag(FRAME_PROFILE_OVERRIDES_TAG);
}

function publish(): void {
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
    const refusal = await artSlotOverrideRefusal(template, overrides);
    if (refusal) return { ok: false, error: refusal };
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

  bustOverridesCache();
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

  bustOverridesCache();
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
