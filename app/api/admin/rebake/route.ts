import { NextResponse } from "next/server";
import { LEGACY_SUPABASE_HOSTS } from "@/lib/validation/card";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderCardImage } from "@/lib/render/card-image";
import { isBillingEnabled } from "@/lib/billing/flags";
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
import { cronRouteGuard, isCronAuthorized } from "@/lib/api/cron-auth";

// ---------------------------------------------------------------------------
// POST /api/admin/rebake — re-bake stored card renders, one batch per call.
// Driven by scripts/rebake-renders.mjs; secured like the cron routes
// (`Authorization: Bearer ${CRON_SECRET}`, or ALLOW_UNAUTHENTICATED_REBAKE
// on a non-production dev server that talks to the same Supabase project).
//
// SCOPES (required — there is no "everything below current" default any
// more; that is how the opt-in v22 typography update got swept along with
// v23 on 2026-09-16):
//   ?scope=version&version=N   re-bake only cards whose output bump N changed
//                              (N must be a "sweep"-policy version — see
//                              lib/cards/layout-version.ts VERSION_ROLLOUT)
//   ?scope=sweep               re-bake cards with ANY pending sweep-policy bump
//   ?scope=legacy-art&before=  re-bake cards whose art lives on a legacy
//                              storage host and whose render predates `before`
//
// Every scope: cards with nothing pending are STAMPED current (no render);
// cards whose only pending bumps are opt-in are LEFT ALONE, badge intact.
//
// ?dry=1 plans without writing: bucket counts {rebake, stamp, optIn} for the
// scope. The driver always runs this first and prints the plan.
//
// Environment gate: a bake carries the pipglyph.com mark only when
// isBillingEnabled() — a sweep server without NEXT_PUBLIC_BILLING_ENABLED
// bakes every card CLEAN (layout v21, and again on 2026-09-16). The route
// refuses to write unless the flag is on, or ALLOW_UNWATERMARKED_SWEEP=true
// is set deliberately. The response always reports `billingEnabled`.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_BATCH = 8;
const MAX_BATCH = 25;
/** Rows scanned per call to find a batch worth of work (opt-in rows are
 *  skipped, so the scan reads past the batch size). */
const SCAN_PAGE = 250;
const SCAN_MAX = 5000;

/** A local dev server may skip the bearer — never in production. */
function devBypass(): boolean {
  return (
    process.env.ALLOW_UNAUTHENTICATED_REBAKE === "true" &&
    process.env.NODE_ENV !== "production"
  );
}

type RebakeRow = CardRowForBake & {
  visibility: string;
  layout_version: number | null;
  rendered_image_url: string | null;
  rendered_at: string | null;
};

type Scope =
  | { kind: "version"; version: number }
  | { kind: "sweep" }
  | { kind: "legacy-art"; before: string };

function parseScope(url: URL): Scope | { error: string } {
  const scope = url.searchParams.get("scope");
  if (scope === "version") {
    const version = Number(url.searchParams.get("version"));
    if (!Number.isInteger(version) || version < 1 || version > CARD_LAYOUT_VERSION) {
      return { error: `scope=version needs version=1..${CARD_LAYOUT_VERSION}.` };
    }
    if (rolloutPolicy(version) !== "sweep") {
      return { error: `Layout v${version} is owner opt-in (VERSION_ROLLOUT) — it is not swept.` };
    }
    return { kind: "version", version };
  }
  if (scope === "sweep") return { kind: "sweep" };
  if (scope === "legacy-art") {
    const before = url.searchParams.get("before");
    if (!before || Number.isNaN(Date.parse(before))) {
      return { error: "scope=legacy-art needs before=<ISO timestamp>." };
    }
    return { kind: "legacy-art", before };
  }
  return { error: "scope is required: version&version=N | sweep | legacy-art&before=<iso>." };
}

/** legacy-art rows are always re-baked (their art was never fetched);
 *  everything else goes through the rollout classifier. */
function verdictFor(row: RebakeRow, scope: Scope): SweepVerdict {
  if (scope.kind === "legacy-art") return "rebake";
  return classifyForSweep(row, scope.kind === "version" ? scope.version : undefined);
}

export async function POST(request: Request) {
  const denied = cronRouteGuard(request, {
    authorized: devBypass() || isCronAuthorized(request),
  });
  if (denied) return denied;

  const url = new URL(request.url);
  const scope = parseScope(url);
  if ("error" in scope) return NextResponse.json({ ok: false, error: scope.error }, { status: 400 });
  const dry = url.searchParams.get("dry") === "1";
  const limit = Math.min(MAX_BATCH, Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_BATCH));
  const billingEnabled = isBillingEnabled();

  if (!dry && !billingEnabled && process.env.ALLOW_UNWATERMARKED_SWEEP !== "true") {
    return NextResponse.json(
      {
        ok: false,
        billingEnabled,
        error:
          "Refusing to bake: NEXT_PUBLIC_BILLING_ENABLED is not \"true\" on this server, so every render would be unwatermarked. Set the flag as production has it (or ALLOW_UNWATERMARKED_SWEEP=true if that is really intended).",
      },
      { status: 412 },
    );
  }

  const supabase = createAdminClient();

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
    } else {
      q = q
        .or(`rendered_image_url.is.null,layout_version.is.null,layout_version.lt.${CARD_LAYOUT_VERSION}`)
        .order("updated_at", { ascending: true });
    }
    return q.range(from, from + SCAN_PAGE - 1);
  };

  const plan = { rebake: 0, stamp: 0, optIn: 0 };
  const batch: Array<{ row: RebakeRow; verdict: SweepVerdict }> = [];
  for (let from = 0; from < SCAN_MAX; from += SCAN_PAGE) {
    const { data, error } = await candidates(from);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    const rows = (data ?? []) as unknown as RebakeRow[];
    for (const row of rows) {
      const verdict = verdictFor(row, scope);
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

  if (dry) {
    return NextResponse.json({
      ok: true,
      dry: true,
      scope,
      layoutVersion: CARD_LAYOUT_VERSION,
      billingEnabled,
      plan,
    });
  }

  const processed: Array<{ id: string; verdict: SweepVerdict; renderedImageUrl?: string }> = [];
  const failed: { id: string; error: string }[] = [];
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
      const response = await renderCardImage(rowToPreviewData(row, pipOverrides, profileOverrides), "hd", {
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

  // Work left for the driver: what this call's plan counted minus what it did.
  const remaining = Math.max(0, plan.rebake + plan.stamp - processed.length);

  return NextResponse.json({
    ok: true,
    scope,
    layoutVersion: CARD_LAYOUT_VERSION,
    billingEnabled,
    plan,
    processed,
    failed,
    remaining,
  });
}
