import "server-only";

import { resolveBakeArt } from "@/lib/cards/bake-render";
import { LEGACY_SUPABASE_HOSTS } from "@/lib/validation/card";
import type { createAdminClient } from "@/lib/supabase/admin";
import { renderCardImage } from "@/lib/render/card-image";
import { cardRenderPath } from "@/lib/cards/storage-paths";
import {
  BAKE_SELECT_COLUMNS,
  rowToPreviewData,
  type CardRowForBake,
  uploadRenderObjects,
} from "@/lib/cards/bake-core";
import { getPipOverrides } from "@/lib/pips/queries";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import {
  CARD_LAYOUT_VERSION,
  classifyForSweep,
  rolloutPolicy,
  type SweepVerdict,
} from "@/lib/cards/layout-version";

// ---------------------------------------------------------------------------
// One batch of a stored-render re-bake — the work behind POST
// /api/admin/rebake (cron secret / scripts/rebake-renders.mjs) and the
// compare page's "Re-bake now" (admin session, lib/cards/rebake-actions.ts).
//
// SCOPES (required — there is no "everything below current" default; that
// is how the opt-in v22 typography update got swept along with v23 on
// 2026-09-16):
//   version N    re-bake only cards whose output bump N changed (N must be a
//                "sweep"-policy version — lib/cards/layout-version.ts)
//   sweep        re-bake cards with ANY pending sweep-policy bump
//   marked       re-bake baked cards whose stamp is null: a frame-geometry
//                change (frame_profile_overrides save/reset) marked them.
//                What the compare page runs after a save. A card whose bake
//                FAILED (no render — usually art that can't be fetched) is
//                not "marked": a layout change never touches it and a retry
//                fails the same way (the sweep scope still covers it).
//   legacy-art   re-bake cards whose art lives on a legacy storage host and
//                whose render predates `before`
//
// Every scope: cards with nothing pending are STAMPED current (no render);
// cards whose only pending bumps are opt-in are LEFT ALONE, badge intact.
// A dry run plans without writing: bucket counts {rebake, stamp, optIn}.
//
// Environment gate (callers enforce it before calling): a bake carries the
// pipglyph.com mark only when isBillingEnabled() — a server without
// NEXT_PUBLIC_BILLING_ENABLED bakes every card CLEAN (layout v21, and again
// on 2026-09-16).
// ---------------------------------------------------------------------------

export const DEFAULT_BATCH = 8;
export const MAX_BATCH = 25;
/** Rows scanned per call to find a batch worth of work (opt-in rows are
 *  skipped, so the scan reads past the batch size). */
const SCAN_PAGE = 250;
const SCAN_MAX = 5000;

export type RebakeScope =
  | { kind: "version"; version: number }
  | { kind: "sweep" }
  | { kind: "marked" }
  | { kind: "legacy-art"; before: string };

export type RebakeRow = CardRowForBake & {
  visibility: string;
  layout_version: number | null;
  rendered_image_url: string | null;
  rendered_at: string | null;
};

export function parseRebakeScope(params: URLSearchParams): RebakeScope | { error: string } {
  const scope = params.get("scope");
  if (scope === "version") {
    const version = Number(params.get("version"));
    if (!Number.isInteger(version) || version < 1 || version > CARD_LAYOUT_VERSION) {
      return { error: `scope=version needs version=1..${CARD_LAYOUT_VERSION}.` };
    }
    if (rolloutPolicy(version) !== "sweep") {
      return { error: `Layout v${version} is owner opt-in (VERSION_ROLLOUT) — it is not swept.` };
    }
    return { kind: "version", version };
  }
  if (scope === "sweep") return { kind: "sweep" };
  if (scope === "marked") return { kind: "marked" };
  if (scope === "legacy-art") {
    const before = params.get("before");
    if (!before || Number.isNaN(Date.parse(before))) {
      return { error: "scope=legacy-art needs before=<ISO timestamp>." };
    }
    return { kind: "legacy-art", before };
  }
  return { error: "scope is required: version&version=N | sweep | marked | legacy-art&before=<iso>." };
}

/** legacy-art and marked rows are always re-baked (their bake is known to
 *  be wrong or missing); everything else goes through the rollout
 *  classifier. Exported for tests. */
export function rebakeVerdictFor(row: RebakeRow, scope: RebakeScope): SweepVerdict {
  if (scope.kind === "legacy-art" || scope.kind === "marked") return "rebake";
  return classifyForSweep(row, scope.kind === "version" ? scope.version : undefined);
}

export type RebakeBatchResult = {
  ok: true;
  scope: RebakeScope;
  layoutVersion: number;
  billingEnabled: boolean;
  dry: boolean;
  plan: { rebake: number; stamp: number; optIn: number };
  processed: Array<{ id: string; verdict: SweepVerdict; renderedImageUrl?: string }>;
  failed: Array<{ id: string; error: string }>;
  /** Work left in scope after this call (excluding `skipIds`). */
  remaining: number;
};

type Admin = ReturnType<typeof createAdminClient>;

export async function runRebakeBatch(
  supabase: Admin,
  opts: {
    scope: RebakeScope;
    limit: number;
    dry: boolean;
    /** Brand mark on the bake — the caller's isBillingEnabled(). */
    billingEnabled: boolean;
    /** Cards that already failed in this run: never picked again, so one
     *  unbakeable card can't wedge a client-driven loop. */
    skipIds?: readonly string[];
  },
): Promise<RebakeBatchResult | { ok: false; error: string }> {
  const { scope, dry, billingEnabled } = opts;
  const limit = Math.min(MAX_BATCH, Math.max(1, Math.floor(opts.limit) || DEFAULT_BATCH));
  const skip = new Set(opts.skipIds ?? []);

  // Scan candidates in pages, classify, and stop once we have a batch (or,
  // for a dry run, once every candidate is counted).
  const select = `${BAKE_SELECT_COLUMNS}, layout_version, rendered_image_url, rendered_at`;
  const candidates = (from: number) => {
    let q = supabase.from("cards").select(select).in("visibility", ["public", "unlisted"]);
    if (scope.kind === "legacy-art") {
      q = q
        .or(LEGACY_SUPABASE_HOSTS.map((host) => `art_url.like.%${host}%`).join(","))
        .not("rendered_image_url", "is", null)
        .lt("rendered_at", scope.before)
        .order("rendered_at", { ascending: true });
    } else if (scope.kind === "marked") {
      q = q
        .is("layout_version", null)
        .not("rendered_image_url", "is", null)
        .order("updated_at", { ascending: true });
    } else {
      q = q
        .or(`rendered_image_url.is.null,layout_version.is.null,layout_version.lt.${CARD_LAYOUT_VERSION}`)
        .order("updated_at", { ascending: true });
    }
    // Stable tiebreak so paging never skips or repeats a row.
    return q.order("id", { ascending: true }).range(from, from + SCAN_PAGE - 1);
  };

  const plan = { rebake: 0, stamp: 0, optIn: 0 };
  const batch: Array<{ row: RebakeRow; verdict: SweepVerdict }> = [];
  for (let from = 0; from < SCAN_MAX; from += SCAN_PAGE) {
    const { data, error } = await candidates(from);
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as unknown as RebakeRow[];
    for (const row of rows) {
      if (skip.has(row.id)) continue;
      const verdict = rebakeVerdictFor(row, scope);
      if (verdict === "rebake") plan.rebake += 1;
      else if (verdict === "stamp") plan.stamp += 1;
      else if (verdict === "opt-in") plan.optIn += 1;
      if (!dry && (verdict === "rebake" || verdict === "stamp") && batch.length < limit) {
        batch.push({ row, verdict });
      }
    }
    if (rows.length < SCAN_PAGE) break;
    if (!dry && batch.length >= limit) break;
  }

  const base = { ok: true as const, scope, layoutVersion: CARD_LAYOUT_VERSION, billingEnabled, plan };
  if (dry) return { ...base, dry: true, processed: [], failed: [], remaining: plan.rebake + plan.stamp };

  const processed: RebakeBatchResult["processed"] = [];
  const failed: RebakeBatchResult["failed"] = [];
  let profileOverrides: Awaited<ReturnType<typeof getFrameProfileOverrides>> | null = null;

  for (const { row, verdict } of batch) {
    const path = cardRenderPath(row.owner_id, row.id);
    try {
      if (verdict === "stamp") {
        const { error: stampErr } = await supabase
          .from("cards")
          .update({ layout_version: CARD_LAYOUT_VERSION })
          .eq("id", row.id);
        if (stampErr) throw new Error(`Row update failed: ${stampErr.message}`);
        processed.push({ id: row.id, verdict });
        continue;
      }

      // Same render contract as the save-time bake: HD, always watermarked
      // (when billing is on), no custom footer text (layout v20).
      profileOverrides ??= await getFrameProfileOverrides();
      const pipOverrides = await getPipOverrides(row.owner_id);
      const previewData = rowToPreviewData(row, pipOverrides, profileOverrides);
      // Same art guard as the save-time bake: never store an art-less PNG as
      // the card's current render because its art host refused or hiccuped.
      const art = await resolveBakeArt(row.art_url);
      if (!art.ok) throw new Error(art.error);
      if (art.artUrl) previewData.artUrl = art.artUrl;
      const response = await renderCardImage(previewData, "hd", {
        brandMark: billingEnabled,
        watermarkText: null,
      });
      const pngBytes = await response.arrayBuffer();

      const uploaded = await uploadRenderObjects(supabase, path, pngBytes, row.id);
      if (!uploaded.ok) throw new Error(uploaded.error);
      const { renderedImageUrl } = uploaded;
      const { error: updateErr } = await supabase
        .from("cards")
        .update({
          rendered_image_url: renderedImageUrl,
          rendered_thumb_url: uploaded.renderedThumbUrl,
          rendered_at: new Date().toISOString(),
          layout_version: CARD_LAYOUT_VERSION,
        })
        .eq("id", row.id);
      if (updateErr) throw new Error(`Row update failed: ${updateErr.message}`);
      processed.push({ id: row.id, verdict, renderedImageUrl });
    } catch (err) {
      failed.push({ id: row.id, error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  // Work left for the driver: what this call's plan counted minus what it
  // did, not counting the rows that just failed (a caller that skips them
  // next time won't see them again).
  const remaining = Math.max(0, plan.rebake + plan.stamp - processed.length - failed.length);
  return { ...base, dry: false, processed, failed, remaining };
}

/** Published, baked cards a platform re-bake is owed to (null stamp) — the
 *  count the compare page shows. Caller must be admin-gated. */
export async function countMarkedRenders(supabase: Admin): Promise<number> {
  const { count } = await supabase
    .from("cards")
    .select("id", { count: "exact", head: true })
    .in("visibility", ["public", "unlisted"])
    .is("layout_version", null)
    .not("rendered_image_url", "is", null);
  return count ?? 0;
}
