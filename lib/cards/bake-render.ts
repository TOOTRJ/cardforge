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
import { getPipOverrides } from "@/lib/pips/queries";
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
  | { ok: true; renderedImageUrl: string | null }
  | { ok: false; error: string };

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
    return { ok: true, renderedImageUrl: null };
  }

  const pipOverrides = await getPipOverrides(card.owner_id);
  const previewData = rowToPreviewData(card as CardRowForBake, pipOverrides);

  let pngBytes: ArrayBuffer;
  try {
    // The public gallery render always carries the brand mark, regardless of
    // owner tier: it's a public marketing surface, and keeping it independent
    // of entitlement avoids stale-cache leaks (the bake is long-cached at a
    // fixed path). Paid users still get clean, hi-res output via the
    // entitlement-gated download routes.
    const response = renderCardImage(previewData, "hd", {
      watermark: isBillingEnabled(),
    });
    pngBytes = await response.arrayBuffer();
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Render error";
    return { ok: false, error: `Render failed: ${detail}` };
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

  const { data: urlData } = supabase.storage
    .from("card-renders")
    .getPublicUrl(path);

  // Cache-bust query so next/image and the browser don't serve the prior
  // version after a resave. The base URL is stable; only the ?v changes.
  const renderedImageUrl = `${urlData.publicUrl}?v=${Date.now()}`;

  return { ok: true, renderedImageUrl };
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

  const { error: updateErr } = await supabase
    .from("cards")
    .update({
      // null for private cards (no public render); a URL otherwise.
      rendered_image_url: result.renderedImageUrl,
      rendered_at: result.renderedImageUrl ? new Date().toISOString() : null,
      // Records WHICH renderer/profile generation baked this PNG, so
      // scripts/rebake-renders.mjs can find stale renders after template
      // changes (see lib/cards/layout-version.ts).
      layout_version: result.renderedImageUrl ? CARD_LAYOUT_VERSION : null,
    })
    .eq("id", cardId);

  if (updateErr) {
    console.warn(
      `[bake-render] Failed to persist render URL for card ${cardId}: ${updateErr.message}`,
    );
    return null;
  }

  return result.renderedImageUrl;
}
