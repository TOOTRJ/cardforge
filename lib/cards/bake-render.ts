// NOT a "use server" module: it used to be, which registered these internal
// helpers as callable server actions (bakeAndPersistCardRender takes a caller-
// supplied ownerId — reachable by any client that knew the action id). Every
// caller is itself a server action or route handler; "server-only" keeps it
// out of client bundles.
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUserStorageConfigured } from "@/lib/media/user-storage";
import { isAllowedMediaUrl } from "@/lib/media/media-urls";
import { renderCardImage } from "@/lib/render/card-image";
import { isBillingEnabled } from "@/lib/billing/flags";
import {
  BAKE_SELECT_COLUMNS,
  CLEARED_RENDER_POINTERS,
  rowToPreviewData,
  type CardRowForBake,
  removeRenderObjects,
  uploadRenderObjects,
} from "@/lib/cards/bake-core";
import { TRANSPARENT_PIXEL_DATA_URL, resolveRenderableImage } from "@/lib/render/art-source";
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
//   * the objects are written (and removed) with the SERVICE ROLE, in the
//     verified owner's folder only (lib/cards/bake-core.ts through
//     lib/media/user-storage.ts): users hold no storage write policy since
//     migration 0126, so nobody can upload their own picture over the bake
//   * the row's pointer to them (rendered_image_url / rendered_thumb_url /
//     rendered_at / layout_version) is written with the service role too:
//     0126's cards_guard_render_columns trigger lets an API role only CLEAR
//     those columns, so nobody can point their card at another picture
// ---------------------------------------------------------------------------

type BakeRenderResult =
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
 * Render the given card to a PNG and upload it to the card-renders bucket.
 * Returns the public URL on success (with a cache-busting `?v=` query).
 *
 * The caller is responsible for persisting `rendered_image_url` +
 * `rendered_at` on the card row. Splitting "render+upload" from "DB write"
 * lets us avoid an awkward double-mutation pattern in the save action
 * (insert → render → second update).
 */
/**
 * Resolve a card's front art to a data URL the renderer can embed, or refuse.
 * The renderer's image resolver fails SOFT (a transparent pixel for a refused
 * host, the raw URL for a fetch error, which Satori then draws as nothing) —
 * so a storage hiccup used to bake an art-less PNG and persist it as the
 * card's current, gallery-worthy render. Every path that STORES a render
 * (the save-time bake and the admin sweep) goes through this first.
 */
export async function resolveBakeArt(
  artUrl: string | null | undefined,
): Promise<{ ok: true; artUrl: string | null } | { ok: false; error: string }> {
  if (!artUrl) return { ok: true, artUrl: null };
  // Art the live preview won't draw (lib/media/media-urls.ts, migration
  // 0127 — an older row could name any host) isn't baked either: the preview
  // and the bake drop the same pictures, and an art-less render never stands
  // in for a card that has art.
  if (!isAllowedMediaUrl("card-art", artUrl)) {
    return { ok: false, error: "Art isn't one of our stored pictures — not baking it." };
  }
  const resolved = await resolveRenderableImage(artUrl);
  if (!resolved || resolved === TRANSPARENT_PIXEL_DATA_URL || resolved === artUrl) {
    return { ok: false, error: "Art unavailable — not baking an art-less render." };
  }
  return { ok: true, artUrl: resolved };
}

async function bakeCardRender(
  cardId: string,
  ownerId: string,
): Promise<BakeRenderResult> {
  // Ownership is passed in (already verified by the calling action) rather
  // than re-derived via getCurrentUser(). This bake runs inside next/server
  // `after()` — a post-response context where Supabase's `auth.getUser()` can
  // trigger a token refresh whose rotated cookies are dropped, which silently
  // invalidates the user's session (logging them out after a save). Reading
  // rows with the request-scoped client below never refreshes auth (storage
  // goes through the service role), so avoiding the auth call here keeps the
  // deferred bake session-safe.
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

  // The card row was read above and belongs to `ownerId` (the caller's
  // authenticated user): bake-core writes and removes in that user's
  // card-renders folder only.

  // A private card must not leave its render in the public-read card-renders
  // bucket — that PNG is the full card image. Skip the bake and remove any
  // render left over from when the card was public/unlisted. Owner-only views
  // fall back to the live <CardPreview>; publishing again re-bakes on save.
  // (Art is intentionally NOT removed here — remixes copy art_url, so the art
  // object can be shared; its random-id path is also never publicly exposed.)
  // removeRenderObjects logs loudly when it can't delete — including when the
  // service-role key is missing, which it checks itself: this runs BEFORE the
  // storage check below, so a missing key never skips the privacy clean-up
  // silently.
  if (card.visibility === "private") {
    await removeRenderObjects(ownerId, [card.id]);
    return { ok: true, renderedImageUrl: null, renderedThumbUrl: null };
  }

  if (!isUserStorageConfigured()) {
    return { ok: false, error: "Render storage is unavailable (SUPABASE_SECRET_KEY is not set)." };
  }

  const pipOverrides = await getPipOverrides(card.owner_id);
  const profileOverrides = await getFrameProfileOverrides();
  const previewData = rowToPreviewData(
    card as CardRowForBake,
    pipOverrides,
    profileOverrides,
  );

  // The art has to actually load (resolveBakeArt) — the caller then clears
  // the stale render on refusal and tiles show the live preview.
  const art = await resolveBakeArt(card.art_url);
  if (!art.ok) return { ok: false, error: art.error };
  if (art.artUrl) previewData.artUrl = art.artUrl; // already a data URL: no second fetch

  let pngBytes: ArrayBuffer;
  try {
    // The baked render is the DISPLAY copy (gallery tiles, OG image, free
    // downloads) and is always watermarked, whatever the owner's plan —
    // layout v20. The only clean output is a paid viewer's download, which
    // renders live (app/api/cards/[id]/png). No custom footer text here
    // either: that prints on downloads only. ROUND corners (TODO 3.26): the
    // stored PNG is the card's true shape wherever it is shown unclipped.
    const response = await renderCardImage(previewData, "hd", {
      brandMark: isBillingEnabled(),
      watermarkText: null,
      corners: "round",
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

  const uploaded = await uploadRenderObjects(ownerId, card.id, pngBytes);
  if (!uploaded.ok) return uploaded;
  return { ...uploaded, bakedFrom: card.updated_at };
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
    // Clear any previously-baked render — every pointer, both faces' (a
    // card downloads the way it looks; 0126 + 0134) — so viewers fall back
    // to the always-correct live <CardPreview> instead of an out-of-date PNG
    // that no longer matches the just-saved card. (No-op for a brand-new
    // card, whose render columns are already null.) The owner's own client
    // may CLEAR the render columns (0126's guard only refuses a new
    // pointer), so this works even without the service-role key.
    const { error: clearErr } = await supabase
      .from("cards")
      .update({ ...CLEARED_RENDER_POINTERS, layout_version: null })
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
  //
  // Who writes: a URL only through the SERVICE ROLE — migration 0126's
  // cards_guard_render_columns refuses an API role that sets a render column
  // to anything but NULL (the owner used to be able to PATCH their card at
  // any picture). The row is pinned to the verified owner as well as the id.
  // A private card's result carries no URL; that clear goes through the
  // owner's client like the failure path above.
  const writer = result.renderedImageUrl ? createAdminClient() : supabase;
  let query = writer
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
      // A private card's clear takes the back face's pointers with it
      // (migration 0134 — removeRenderObjects took both faces' objects).
      // The back BAKE, and its pointers on a successful bake, are 5.3's.
      ...(result.renderedImageUrl ? {} : { rendered_back_image_url: null, rendered_back_thumb_url: null }),
    })
    .eq("id", cardId)
    .eq("owner_id", ownerId);
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
