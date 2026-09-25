import "server-only";

import { resolveBakeArt } from "@/lib/cards/bake-render";
import { LEGACY_SUPABASE_HOSTS } from "@/lib/validation/card";
import type { createAdminClient } from "@/lib/supabase/admin";
import { renderCardImage } from "@/lib/render/card-image";
import { cardRenderPath } from "@/lib/cards/storage-paths";
import {
  BAKE_SELECT_COLUMNS,
  removeRenderObject,
  rowToPreviewData,
  type CardRowForBake,
  uploadRenderObjects,
} from "@/lib/cards/bake-core";
import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import { getPipOverrides } from "@/lib/pips/queries";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import {
  CARD_LAYOUT_VERSION,
  classifyForSweep,
  rolloutPolicy,
  templateOfFrameStyle,
  type SweepVerdict,
} from "@/lib/cards/layout-version";

// ---------------------------------------------------------------------------
// One batch of a stored-render re-bake — the work behind POST
// /api/admin/rebake (cron secret / scripts/rebake-renders.mjs) and the
// compare page's "Re-bake now" (admin session, /api/admin/rebake-marked).
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
// Overlap guards (mirroring lib/cards/bake-render.ts): rendering takes
// seconds, so right before uploading the batch re-reads the card and the
// card's frame override. If the owner saved or unpublished the card, an
// admin saved that template's layout again, or another run already
// re-baked it, the render is SUPERSEDED: it is not uploaded and the row
// keeps its state (a marked card stays marked, so a running loop picks it
// up again). The row write is a compare-and-set on updated_at + visibility
// (+ the stamp it read); a lost race on a card that just went private
// removes the objects it uploaded. A layout save cannot move updated_at
// (0108 excludes layout_version), so after a successful write the override
// is read AGAIN: if it moved during the upload, the card is re-marked
// (conditional on the render we just wrote) instead of staying "current"
// with the previous geometry.
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
  updated_at: string;
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
  /** Rendered but not written: the card or its template's layout changed
   *  while it rendered (still in scope; the next call retries it). */
  superseded: string[];
  /** Work left in scope after this call (excluding `skipIds`). Exact for the
   *  marked scope (a count query); a lower bound for the others. */
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
  // Every marked row is a candidate, so a marked call reads only what it
  // can use (plus the rows it must skip) instead of a full page.
  const pageSize =
    scope.kind === "marked" && !dry ? Math.min(SCAN_PAGE, limit + skip.size) : SCAN_PAGE;
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
    return q.order("id", { ascending: true }).range(from, from + pageSize - 1);
  };

  const plan = { rebake: 0, stamp: 0, optIn: 0 };
  const batch: Array<{ row: RebakeRow; verdict: SweepVerdict }> = [];
  for (let from = 0; from < SCAN_MAX; from += pageSize) {
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
    if (rows.length < pageSize) break;
    if (!dry && batch.length >= limit) break;
  }

  const base = { ok: true as const, scope, layoutVersion: CARD_LAYOUT_VERSION, billingEnabled, plan };
  if (dry) {
    return { ...base, dry: true, processed: [], failed: [], superseded: [], remaining: plan.rebake + plan.stamp };
  }

  const processed: RebakeBatchResult["processed"] = [];
  const failed: RebakeBatchResult["failed"] = [];
  const superseded: string[] = [];
  let profileOverrides: Awaited<ReturnType<typeof getFrameProfileOverrides>> | null = null;
  // The layout each render used, per template (uncached): a save during the
  // batch changes it, and the render must not be stamped current.
  const overrideStamps = await readOverrideStamps(supabase);

  for (const { row, verdict } of batch) {
    const path = cardRenderPath(row.owner_id, row.id);
    try {
      if (verdict === "stamp") {
        // Conditional on the stamp we classified: a layout save that nulled
        // it since the scan must win (it owes the card a re-bake).
        let stamp = supabase.from("cards").update({ layout_version: CARD_LAYOUT_VERSION }).eq("id", row.id);
        stamp = row.layout_version == null ? stamp.is("layout_version", null) : stamp.eq("layout_version", row.layout_version);
        const { data: stamped, error: stampErr } = await stamp.select("id");
        if (stampErr) throw new Error(`Row update failed: ${stampErr.message}`);
        if (!stamped || stamped.length === 0) superseded.push(row.id);
        else processed.push({ id: row.id, verdict });
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

      // Overlap guard, part 1: is the card (and its layout) still what we
      // rendered? A residual race remains until the write; part 2 catches it.
      const template = normalizeFrameTemplate(templateOfFrameStyle(row.frame_style));
      const [{ data: fresh }, layoutNow] = await Promise.all([
        supabase.from("cards").select("updated_at, visibility, layout_version").eq("id", row.id).maybeSingle(),
        readOverrideStamp(supabase, template),
      ]);
      if (
        !fresh ||
        fresh.updated_at !== row.updated_at ||
        !["public", "unlisted"].includes(fresh.visibility as string) ||
        (scope.kind === "marked" && fresh.layout_version != null) ||
        layoutNow !== (overrideStamps.get(template) ?? null)
      ) {
        superseded.push(row.id);
        continue;
      }

      const uploaded = await uploadRenderObjects(supabase, path, pngBytes, row.id);
      if (!uploaded.ok) throw new Error(uploaded.error);
      const { renderedImageUrl } = uploaded;
      // Part 2 (compare-and-set): only the row as rendered may take the URL.
      const renderedAt = new Date().toISOString();
      const { data: written, error: updateErr } = await supabase
        .from("cards")
        .update({
          rendered_image_url: renderedImageUrl,
          rendered_thumb_url: uploaded.renderedThumbUrl,
          rendered_at: renderedAt,
          layout_version: CARD_LAYOUT_VERSION,
        })
        .eq("id", row.id)
        .eq("updated_at", row.updated_at)
        .in("visibility", ["public", "unlisted"])
        .select("id");
      if (updateErr) throw new Error(`Row update failed: ${updateErr.message}`);
      if (!written || written.length === 0) {
        // Lost the race. If the card went private meanwhile, the objects we
        // just uploaded must not stay public (the unpublish deleted its own).
        const { data: now } = await supabase.from("cards").select("visibility").eq("id", row.id).maybeSingle();
        if (!now || now.visibility === "private") await removeRenderObject(supabase, path);
        superseded.push(row.id);
        continue;
      }
      // Part 3: a layout save during the upload can't be seen by the write
      // (it doesn't move updated_at). If the override moved, re-mark the
      // card — only if the row still holds OUR render.
      if ((await readOverrideStamp(supabase, template)) !== (overrideStamps.get(template) ?? null)) {
        await supabase
          .from("cards")
          .update({ layout_version: null })
          .eq("id", row.id)
          .eq("rendered_at", renderedAt);
        superseded.push(row.id);
        continue;
      }
      processed.push({ id: row.id, verdict, renderedImageUrl });
    } catch (err) {
      failed.push({ id: row.id, error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  // Work left for the driver. The marked scope counts exactly, leaving out
  // the cards this caller will skip (earlier failures + this call's) that
  // are still marked. The other scopes only know the pages they scanned and
  // their driver (scripts/rebake-renders.mjs) retries failed rows, so those
  // stay in the lower bound.
  let remaining: number;
  try {
    remaining =
      scope.kind === "marked"
        ? Math.max(
            0,
            (await countMarkedRenders(supabase)) -
              (await countMarkedRenders(supabase, [...skip, ...failed.map((f) => f.id)])),
          )
        : Math.max(0, plan.rebake + plan.stamp - processed.length);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not count the remaining cards." };
  }
  return { ...base, dry: false, processed, failed, superseded, remaining };
}

/** template → the override row's updated_at (uncached), for the overlap guard. */
async function readOverrideStamps(supabase: Admin): Promise<Map<string, string>> {
  const { data } = await supabase.from("frame_profile_overrides").select("template, updated_at");
  return new Map((data ?? []).map((r) => [r.template as string, r.updated_at as string]));
}

async function readOverrideStamp(supabase: Admin, template: string): Promise<string | null> {
  const { data } = await supabase
    .from("frame_profile_overrides")
    .select("updated_at")
    .eq("template", template)
    .maybeSingle();
  return (data?.updated_at as string | undefined) ?? null;
}

/** Published, baked cards a platform re-bake is owed to (null stamp) — the
 *  count the compare page shows — optionally only among `ids`. Throws on a
 *  query error: a failed count must never read as "nothing left". Caller
 *  must be admin-gated. */
export async function countMarkedRenders(supabase: Admin, ids?: readonly string[]): Promise<number> {
  if (ids && ids.length === 0) return 0;
  const chunks = ids ? chunk(ids, 200) : [null];
  let total = 0;
  for (const part of chunks) {
    let query = supabase
      .from("cards")
      .select("id", { count: "exact", head: true })
      .in("visibility", ["public", "unlisted"])
      .is("layout_version", null)
      .not("rendered_image_url", "is", null);
    if (part) query = query.in("id", part);
    const { count, error } = await query;
    if (error) throw new Error(`Counting marked cards failed: ${error.message}`);
    total += count ?? 0;
  }
  return total;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
