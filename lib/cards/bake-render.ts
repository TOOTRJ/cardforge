"use server";

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { renderCardImage } from "@/lib/render/card-image";
import { isBillingEnabled } from "@/lib/billing/flags";
import { cardRenderPath } from "@/lib/cards/storage-paths";
import {
  BAKE_SELECT_COLUMNS,
  rowToPreviewData,
  type CardRowForBake,
} from "@/lib/cards/bake-core";
import { TRANSPARENT_PIXEL_DATA_URL, resolveRenderableImage } from "@/lib/render/art-source";
import { makeRenderThumb, renderThumbPath } from "@/lib/cards/render-thumb";
import { getPipOverrides } from "@/lib/pips/queries";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";

// ---------------------------------------------------------------------------
// Bake a card to a PNG and upload it to the `card-renders` bucket.
//
// Called from createCardAction / updateCardAction after the row write
// succeeds. The bake is best-effort: a render or upload failure does NOT
// roll back the card save — the gallery falls back to the live React
// preview when `rendered_image_url` is null. This keeps a transient render
// glitch from blocking a user's save flow.
//
// Path layout: card-renders/{owner_id}/{card_id}.png
//   * single object per card, overwritten on every save
//   * cache-busted via a `?v={timestamp}` query string on the stored URL
//   * RLS (migration 0021) restricts writes to the card owner
// ---------------------------------------------------------------------------

export type BakeRenderResult =
  | {
      ok: true;
      renderedImageUrl: string | null;
      renderedThumbUrl: string | null;
      /** The row's updated_at the bake rendered from — the persist step's
       *  compare-and-set key (see bakeAndPersistCardRender). */
      bakedFrom?: string;
    }
  | { ok: false; error: string; superseded?: boolean };

/**
 * Delete a card's baked PNG from the public `card-renders` bucket, retrying
 * once before giving up. Unlike a best-effort `.remove().catch(() => {})`,
 * this surfaces a persistent failure loudly: the render path is deterministic
 * and the bucket is public-read, so a render that fails to delete when a card
 * goes private stays fetchable by anyone who has (or guesses) the URL — a
 * privacy leak we want visible in logs rather than swallowed.
 *
 * Note: Supabase Storage's `remove` treats a missing object as success (no
 * error), so the retry only fires on a genuine transient/permission error.
 */
async function removeRenderObject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  path: string,
): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { error } = await supabase.storage
      .from("card-renders")
      .remove([path]);
    if (!error) return;
    if (attempt === 2) {
      console.error(
        `[bake-render] Could not delete render object ${path} after a retry: ${error.message}. The PNG may remain publicly fetchable for a now-private card.`,
      );
    }
  }
}

/**
 * Render the given card to a PNG and upload it to the card-renders bucket.
 * Returns the public URL on success (with a cache-busting `?v=` query).
 *
 * The caller is responsible for persisting `rendered_image_url` +
 * `rendered_at` on the card row. Splitting "render+upload" from "DB write"
 * lets us avoid an awkward double-mutation pattern in the save action
 * (insert → render → second update).
 */
export async function bakeCardRender(
  cardId: string,
  ownerId: string,
): Promise<BakeRenderResult> {
  // Ownership is passed in (already verified by the calling action) rather
  // than re-derived via getCurrentUser(). This bake runs inside next/server
  // `after()` — a post-response context where Supabase's `auth.getUser()` can
  // trigger a token refresh whose rotated cookies are dropped, which silently
  // invalidates the user's session (logging them out after a save). Reading
  // rows/storage with the request-scoped client below never refreshes auth, so
  // avoiding the auth call here keeps the deferred bake session-safe.
  if (!ownerId) {
    return { ok: false, error: "Missing owner." };
  }

  const supabase = await createClient();

  // Re-read the card after the save so we render exactly what's in the DB,
  // not what the action handler thinks it just wrote. Catches edge cases
  // where validation munged a field or a trigger normalized it.
  const { data: card, error: fetchErr } = await supabase
    .from("cards")
    .select(BAKE_SELECT_COLUMNS)
    .eq("id", cardId)
    .maybeSingle();

  if (fetchErr || !card) {
    return { ok: false, error: fetchErr?.message ?? "Card not found." };
  }
  if (card.owner_id !== ownerId) {
    return { ok: false, error: "Not the card owner." };
  }

  const path = cardRenderPath(ownerId, card.id);

  // A private card must not leave its render in the public-read card-renders
  // bucket — that PNG is the full card image. Skip the bake and remove any
  // render left over from when the card was public/unlisted. Owner-only views
  // fall back to the live <CardPreview>; publishing again re-bakes on save.
  // (Art is intentionally NOT removed here — remixes copy art_url, so the art
  // object can be shared; its random-id path is also never publicly exposed.)
  if (card.visibility === "private") {
    await removeRenderObject(supabase, path);
    await removeRenderObject(supabase, renderThumbPath(path));
    return { ok: true, renderedImageUrl: null, renderedThumbUrl: null };
  }

  const pipOverrides = await getPipOverrides(card.owner_id);
  const profileOverrides = await getFrameProfileOverrides();
  const previewData = rowToPreviewData(
    card as CardRowForBake,
    pipOverrides,
    profileOverrides,
  );

  // The art has to actually load. The renderer's image resolver fails SOFT
  // (a transparent pixel for a refused host, the raw URL for a fetch error,
  // which Satori then draws as nothing) — so a storage hiccup used to bake
  // an art-less PNG and persist it as the card's current, gallery-worthy
  // render. Resolve the front art up front and refuse to bake without it;
  // the caller then clears the stale render and tiles show the live preview.
  if (card.art_url) {
    const resolved = await resolveRenderableImage(card.art_url);
    if (!resolved || resolved === TRANSPARENT_PIXEL_DATA_URL || resolved === card.art_url) {
      return { ok: false, error: "Art unavailable — not baking an art-less render." };
    }
    previewData.artUrl = resolved; // already a data URL: no second fetch
  }

  let pngBytes: ArrayBuffer;
  try {
    // The baked render is the DISPLAY copy (gallery tiles, OG image, free
    // downloads) and is always watermarked, whatever the owner's plan —
    // layout v20. The only clean output is a paid viewer's download, which
    // renders live (app/api/cards/[id]/png). No custom footer text here
    // either: that prints on downloads only.
    const response = await renderCardImage(previewData, "hd", {
      brandMark: isBillingEnabled(),
      watermarkText: null,
    });
    pngBytes = await response.arrayBuffer();
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Render error";
    return { ok: false, error: `Render failed: ${detail}` };
  }

  // Overlap guard, part 1: rendering is the slow step (seconds). If the card
  // was saved again meanwhile, THAT save's bake owns the row now — uploading
  // ours would overwrite the newer PNG with older pixels. (A residual race
  // between this read and the upload remains; part 2 below catches the row.)
  const { data: fresh } = await supabase
    .from("cards")
    .select("updated_at")
    .eq("id", cardId)
    .maybeSingle();
  if (!fresh || fresh.updated_at !== card.updated_at) {
    return { ok: false, error: "Superseded by a newer save.", superseded: true };
  }

  // upsert: true overwrites on resave instead of creating a pile of versioned
  // files we'd then need to garbage-collect.
  const { error: uploadErr } = await supabase.storage
    .from("card-renders")
    .upload(path, pngBytes, {
      cacheControl: "31536000",
      contentType: "image/png",
      upsert: true,
    });

  if (uploadErr) {
    return { ok: false, error: `Upload failed: ${uploadErr.message}` };
  }

  // The tile-sized WebP beside the PNG (lib/cards/render-thumb.ts). A thumb
  // failure is not a bake failure: tiles fall back to next/image over the PNG.
  const thumbPath = renderThumbPath(path);
  let thumbOk = false;
  try {
    const thumbBytes = await makeRenderThumb(pngBytes);
    const { error: thumbErr } = await supabase.storage
      .from("card-renders")
      .upload(thumbPath, thumbBytes, {
        cacheControl: "31536000",
        contentType: "image/webp",
        upsert: true,
      });
    if (thumbErr) {
      console.warn(`[bake-render] Thumb upload failed for ${cardId}: ${thumbErr.message}`);
    } else {
      thumbOk = true;
    }
  } catch (err) {
    console.warn(
      `[bake-render] Thumb encode failed for ${cardId}: ${err instanceof Error ? err.message : "error"}`,
    );
  }

  const { data: urlData } = supabase.storage
    .from("card-renders")
    .getPublicUrl(path);

  // Cache-bust query so next/image and the browser don't serve the prior
  // version after a resave. The base URL is stable; only the ?v changes —
  // shared by the PNG and its thumb so both bust together.
  const version = Date.now();
  const renderedImageUrl = `${urlData.publicUrl}?v=${version}`;
  const renderedThumbUrl = thumbOk
    ? `${supabase.storage.from("card-renders").getPublicUrl(thumbPath).data.publicUrl}?v=${version}`
    : null;

  return { ok: true, renderedImageUrl, renderedThumbUrl, bakedFrom: card.updated_at };
}

/**
 * Convenience wrapper: bake the render and immediately persist the URL +
 * timestamp on the card row. The post-render update touches only the
 * render-tracking columns; the trigger will bump `updated_at` again, but
 * that's harmless — we don't compare those timestamps anywhere.
 *
 * Returns the URL on success, or null on any failure (logged server-side).
 * Callers should treat null as "render not ready, fall back to live
 * preview" rather than an error to surface to the user.
 */
export async function bakeAndPersistCardRender(
  cardId: string,
  ownerId: string,
): Promise<string | null> {
  const result = await bakeCardRender(cardId, ownerId);
  const supabase = await createClient();

  if (!result.ok) {
    // A superseded bake is not a failure: the newer save's bake is (or was)
    // running and will persist its own render. Touching the row here would
    // clear THAT render.
    if (result.superseded) return null;
    // Best-effort logging. We deliberately don't throw — the card itself
    // saved successfully; the bake is a nice-to-have that can be retried.
    console.warn(
      `[bake-render] Failed to bake card ${cardId}: ${result.error}`,
    );
    // Clear any previously-baked render so viewers fall back to the
    // always-correct live <CardPreview> instead of an out-of-date PNG that
    // no longer matches the just-saved card. (No-op for a brand-new card,
    // whose render columns are already null.)
    const { error: clearErr } = await supabase
      .from("cards")
      .update({
        rendered_image_url: null,
        rendered_thumb_url: null,
        rendered_at: null,
        layout_version: null,
      })
      .eq("id", cardId);
    if (clearErr) {
      console.warn(
        `[bake-render] Failed to clear stale render for card ${cardId}: ${clearErr.message}`,
      );
    }
    return null;
  }

  // Overlap guard, part 2 (compare-and-set): only the bake that rendered the
  // row as it currently is may write its URL. `bakedFrom` is the updated_at
  // the bake read; a newer save changed it, so a stale bake matches no row.
  let query = supabase
    .from("cards")
    .update({
      // null for private cards (no public render); a URL otherwise.
      rendered_image_url: result.renderedImageUrl,
      rendered_thumb_url: result.renderedThumbUrl,
      rendered_at: result.renderedImageUrl ? new Date().toISOString() : null,
      // Records WHICH renderer/profile generation baked this PNG, so
      // scripts/rebake-renders.mjs can find stale renders after template
      // changes (see lib/cards/layout-version.ts).
      layout_version: result.renderedImageUrl ? CARD_LAYOUT_VERSION : null,
    })
    .eq("id", cardId);
  if (result.bakedFrom) query = query.eq("updated_at", result.bakedFrom);
  const { data: written, error: updateErr } = await query.select("id");

  if (!updateErr && (!written || written.length === 0)) {
    console.warn(`[bake-render] Bake for card ${cardId} was superseded before persisting; skipped.`);
    return null;
  }
  if (updateErr) {
    console.warn(
      `[bake-render] Failed to persist render URL for card ${cardId}: ${updateErr.message}`,
    );
    return null;
  }

  return result.renderedImageUrl;
}
