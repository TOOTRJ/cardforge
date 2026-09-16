import { NextResponse } from "next/server";
import { LEGACY_SUPABASE_HOSTS } from "@/lib/validation/card";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { renderCardImage } from "@/lib/render/card-image";
import { isBillingEnabled } from "@/lib/billing/flags";
import { cardRenderPath } from "@/lib/cards/storage-paths";
import {
  BAKE_SELECT_COLUMNS,
  rowToPreviewData,
  type CardRowForBake,
} from "@/lib/cards/bake-core";
import { makeRenderThumb, renderThumbPath } from "@/lib/cards/render-thumb";
import { getPipOverrides } from "@/lib/pips/queries";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import {
  CARD_LAYOUT_VERSION,
  isRenderStale,
  templateOfFrameStyle,
} from "@/lib/cards/layout-version";

// ---------------------------------------------------------------------------
// POST /api/admin/rebake — re-bake stored card renders whose layout_version
// predates CARD_LAYOUT_VERSION (lib/cards/layout-version.ts). Run after any
// frame-profile/renderer change so gallery PNGs catch up with what detail
// pages and downloads (which always render live) already show.
//
// Driven by scripts/rebake-renders.mjs, which loops batches until none
// remain. Secured like the cron route: `Authorization: Bearer ${CRON_SECRET}`
// — with a development-only bypass so the sweep can run against a local
// server (which talks to the same Supabase project).
//
// Batch semantics: only successfully re-baked rows get the new
// layout_version, so failures stay visible as "remaining" instead of being
// silently skipped; the driver stops when a full batch fails.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_BATCH = 8;
const MAX_BATCH = 25;

function isAuthorized(request: Request): boolean {
  // Explicit opt-in for LOCAL runs only. This drives the RLS-bypassing
  // service-role client, so the bypass is additionally gated to non-production:
  // even if ALLOW_UNAUTHENTICATED_REBAKE ever leaks into a deployed env, a
  // production build (NODE_ENV === "production") will never honor it. Local dev
  // (NODE_ENV === "development") — including the .env.local-points-at-prod
  // posture — still works, and always falls back to requiring CRON_SECRET.
  if (
    process.env.ALLOW_UNAUTHENTICATED_REBAKE === "true" &&
    process.env.NODE_ENV !== "production"
  ) {
    return true;
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

type RebakeRow = CardRowForBake & { visibility: string };

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Admin key not configured (SUPABASE_SECRET_KEY)." },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const limit = Math.min(
    MAX_BATCH,
    Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_BATCH),
  );

  const supabase = createAdminClient();
  // Stale = a public/unlisted card whose stored render is missing OR was
  // baked by an older layout generation. (Private cards never carry a
  // stored render — the save path deletes it.)
  const staleOr = `rendered_image_url.is.null,layout_version.is.null,layout_version.lt.${CARD_LAYOUT_VERSION}`;

  // ?scope=legacy-art&before=<iso>: re-bake cards whose art lives on a
  // legacy storage host and whose render predates `before` — the 2026-09-16
  // fix (lib/validation/card.ts LEGACY_SUPABASE_HOSTS) made those bakes
  // fetch their art again; every bake before it painted a black art box.
  // `before` is what keeps the sweep finite: a re-baked row moves its
  // rendered_at past it and drops out of the selection.
  const scope = url.searchParams.get("scope") === "legacy-art" ? "legacy-art" : "stale";
  const before = url.searchParams.get("before");
  if (scope === "legacy-art" && (!before || Number.isNaN(Date.parse(before)))) {
    return NextResponse.json(
      { ok: false, error: "scope=legacy-art needs before=<ISO timestamp>." },
      { status: 400 },
    );
  }
  const legacyArtOr = LEGACY_SUPABASE_HOSTS.map((host) => `art_url.like.%${host}%`).join(",");
  const applyScope = <Q extends { or: (f: string) => Q; lt: (c: string, v: string) => Q; not: (c: string, op: string, v: null) => Q }>(query: Q): Q =>
    scope === "legacy-art"
      ? query.or(legacyArtOr).not("rendered_image_url", "is", null).lt("rendered_at", before as string)
      : query.or(staleOr);

  const { data: rows, error: fetchErr } = await applyScope(
    supabase
      .from("cards")
      .select(`${BAKE_SELECT_COLUMNS}, layout_version, rendered_image_url`)
      .in("visibility", ["public", "unlisted"]),
  )
    .order(scope === "legacy-art" ? "rendered_at" : "updated_at", { ascending: true })
    .limit(limit);
  if (fetchErr) {
    return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
  }

  const processed: string[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const row of (rows ?? []) as RebakeRow[]) {
    const path = cardRenderPath(row.owner_id, row.id);
    try {
      // A private card shouldn't have a stored render at all (the save path
      // deletes it); if one slipped through, apply the same rule here.
      if (row.visibility === "private") {
        await supabase.storage.from("card-renders").remove([path]);
        await supabase
          .from("cards")
          .update({ rendered_image_url: null, rendered_at: null, layout_version: null })
          .eq("id", row.id);
        processed.push(row.id);
        continue;
      }

      // A bump that only touched other templates leaves this render
      // correct — stamp it current without spending a render. (Never in the
      // legacy-art scope: those renders are wrong whatever their version.)
      const stale = row as unknown as { layout_version: number | null; rendered_image_url: string | null };
      if (
        scope === "stale" &&
        stale.rendered_image_url &&
        !isRenderStale(stale.layout_version, templateOfFrameStyle(row.frame_style))
      ) {
        const { error: stampErr } = await supabase
          .from("cards")
          .update({ layout_version: CARD_LAYOUT_VERSION })
          .eq("id", row.id);
        if (stampErr) throw new Error(`Row update failed: ${stampErr.message}`);
        processed.push(row.id);
        continue;
      }

      // Same render contract as the save-time bake: HD, always watermarked,
      // no custom footer text (layout v20 — see lib/cards/bake-render.ts).
      const pipOverrides = await getPipOverrides(row.owner_id);
      const profileOverrides = await getFrameProfileOverrides();
      const response = await renderCardImage(rowToPreviewData(row, pipOverrides, profileOverrides), "hd", {
        brandMark: isBillingEnabled(),
        watermarkText: null,
      });
      const pngBytes = await response.arrayBuffer();

      const { error: uploadErr } = await supabase.storage
        .from("card-renders")
        .upload(path, pngBytes, {
          cacheControl: "31536000",
          contentType: "image/png",
          upsert: true,
        });
      if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

      // Tile-sized WebP beside the PNG (lib/cards/render-thumb.ts); a thumb
      // failure leaves the column null and tiles on the next/image path.
      const thumbPath = renderThumbPath(path);
      let thumbOk = false;
      try {
        const { error: thumbErr } = await supabase.storage
          .from("card-renders")
          .upload(thumbPath, await makeRenderThumb(pngBytes), {
            cacheControl: "31536000",
            contentType: "image/webp",
            upsert: true,
          });
        thumbOk = !thumbErr;
      } catch {
        thumbOk = false;
      }

      const { data: urlData } = supabase.storage
        .from("card-renders")
        .getPublicUrl(path);
      const version = Date.now();
      const { error: updateErr } = await supabase
        .from("cards")
        .update({
          rendered_image_url: `${urlData.publicUrl}?v=${version}`,
          rendered_thumb_url: thumbOk
            ? `${supabase.storage.from("card-renders").getPublicUrl(thumbPath).data.publicUrl}?v=${version}`
            : null,
          rendered_at: new Date().toISOString(),
          layout_version: CARD_LAYOUT_VERSION,
        })
        .eq("id", row.id);
      if (updateErr) throw new Error(`Row update failed: ${updateErr.message}`);

      processed.push(row.id);
    } catch (err) {
      failed.push({
        id: row.id,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  const { count: remaining } = await applyScope(
    supabase
      .from("cards")
      .select("id", { count: "exact", head: true })
      .in("visibility", ["public", "unlisted"]),
  );

  return NextResponse.json({
    ok: true,
    layoutVersion: CARD_LAYOUT_VERSION,
    scope,
    processed,
    failed,
    remaining: remaining ?? 0,
  });
}
