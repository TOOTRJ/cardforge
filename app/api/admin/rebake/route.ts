import { NextResponse } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { renderCardImage } from "@/lib/render/card-image";
import { isBillingEnabled } from "@/lib/billing/flags";
import { cardRenderPath } from "@/lib/cards/storage-paths";
import {
  BAKE_SELECT_COLUMNS,
  rowToPreviewData,
  type CardRowForBake,
} from "@/lib/cards/bake-core";
import { getPipOverrides } from "@/lib/pips/queries";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";

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
  if (process.env.NODE_ENV !== "production") return true;
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

  const { data: rows, error: fetchErr } = await supabase
    .from("cards")
    .select(BAKE_SELECT_COLUMNS)
    .in("visibility", ["public", "unlisted"])
    .or(staleOr)
    .order("updated_at", { ascending: true })
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

      // Same render contract as the save-time bake: HD, brand mark on the
      // public gallery surface regardless of owner tier.
      const pipOverrides = await getPipOverrides(row.owner_id);
      const response = renderCardImage(rowToPreviewData(row, pipOverrides), "hd", {
        watermark: isBillingEnabled(),
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

      const { data: urlData } = supabase.storage
        .from("card-renders")
        .getPublicUrl(path);
      const { error: updateErr } = await supabase
        .from("cards")
        .update({
          rendered_image_url: `${urlData.publicUrl}?v=${Date.now()}`,
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

  const { count: remaining } = await supabase
    .from("cards")
    .select("id", { count: "exact", head: true })
    .in("visibility", ["public", "unlisted"])
    .or(staleOr);

  return NextResponse.json({
    ok: true,
    layoutVersion: CARD_LAYOUT_VERSION,
    processed,
    failed,
    remaining: remaining ?? 0,
  });
}
