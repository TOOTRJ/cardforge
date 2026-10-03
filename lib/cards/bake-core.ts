import "server-only";

import {
  isCardType,
  isColorIdentity,
  isRarity,
  type ArtPosition,
  type CardBackFace,
  type CardType,
  type ColorIdentity,
  type CardWatermark,
  type FaceContent,
  type FrameStyle,
  type Rarity,
} from "@/types/card";
import type { CardPreviewData } from "@/components/cards/card-preview";
import type { FrameProfileOverridesMap } from "@/lib/cards/profile-override";
import type { PipOverrides } from "@/lib/pips/override";
import { drawableCardMedia } from "@/lib/cards/drawable-media";
import { frontPreviewData } from "@/lib/cards/faces";
import { makeRenderThumb } from "@/lib/cards/render-thumb";
import { isUserStorageConfigured, userFolder } from "@/lib/media/user-storage";

// ---------------------------------------------------------------------------
// Shared bake plumbing — the card-row shape, column list, and row→render-input
// mapping used by BOTH the user-scoped save bake (lib/cards/bake-render.ts,
// "use server" module) and the admin re-bake sweep (app/api/admin/rebake).
// Lives outside the "use server" module so importing it never exposes a
// server action.
// ---------------------------------------------------------------------------

export type CardRowForBake = {
  id: string;
  owner_id: string;
  title: string;
  cost: string | null;
  card_type: string | null;
  supertype: string | null;
  subtypes: string[];
  rarity: string | null;
  color_identity: string[];
  rules_text: string | null;
  flavor_text: string | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  defense: string | null;
  artist_credit: string | null;
  art_url: string | null;
  art_position: unknown;
  frame_style: unknown;
  set_icon_url: string | null;
  set_icon_code: string | null;
  back_face: unknown;
  face_content: unknown;
  watermark: unknown;
  /** The collector fields (migration 0133, TODO 4.9a). OPTIONAL on the bake
   *  row: the visual-regression matrix fingerprints every stored row
   *  (tests/visual/matrix.ts canonical), and an explicit `undefined` key
   *  would redefine every existing case — which the gate never
   *  pixel-compares. A row without them renders exactly as before; nothing
   *  draws them until 4.9b. */
  set_code?: string | null;
  collector_number?: string | null;
  lang?: string | null;
  /** The back face's stored render pointer (migration 0134, TODO 5.3) —
   *  read, never drawn: a bake that writes no back (the card has no back
   *  body any more) removes the `.back.*` objects a previous bake left
   *  behind only when this says there were some. OPTIONAL for the same
   *  reason as the collector fields above (the visual matrix's rows). */
  rendered_back_image_url?: string | null;
};

/** Every column the renderer needs (plus owner/visibility for gating). */
export const BAKE_SELECT_COLUMNS =
  "id, owner_id, visibility, updated_at, title, cost, card_type, supertype, subtypes, rarity, color_identity, rules_text, flavor_text, power, toughness, loyalty, defense, artist_credit, art_url, art_position, frame_style, set_icon_url, set_icon_code, back_face, face_content, watermark, set_code, collector_number, lang, rendered_back_image_url";

export function rowToPreviewData(
  card: CardRowForBake,
  pipOverrides: PipOverrides | null = null,
  profileOverrides: FrameProfileOverridesMap | null = null,
): CardPreviewData {
  // Only the pictures CardPreview would draw (lib/cards/drawable-media.ts,
  // migration 0127): every server render of a stored card — the bake, the
  // sweep, the PNG / PDF / share image — drops the same ones the live
  // preview does. The FRONT face's double-faced block (TODO 5.1a,
  // lib/cards/faces.ts frontPreviewData: the back's P/T for the grey tab,
  // the icon family) rides on it where the template is a DFC front body;
  // every other card comes back as it is (the function returns its input).
  return frontPreviewData(drawableCardMedia({
    pipOverrides,
    profileOverrides,
    title: card.title,
    cost: card.cost,
    cardType: isCardType(card.card_type) ? (card.card_type as CardType) : null,
    supertype: card.supertype,
    subtypes: card.subtypes,
    rarity: isRarity(card.rarity) ? (card.rarity as Rarity) : null,
    colorIdentity: card.color_identity.filter(isColorIdentity) as ColorIdentity[],
    rulesText: card.rules_text,
    flavorText: card.flavor_text,
    power: card.power,
    toughness: card.toughness,
    loyalty: card.loyalty,
    defense: card.defense,
    artistCredit: card.artist_credit,
    artUrl: card.art_url,
    artPosition: (card.art_position as ArtPosition | null) ?? {},
    frameStyle: (card.frame_style as FrameStyle | null) ?? {},
    setIconUrl: card.set_icon_url,
    setIconCode: card.set_icon_code,
    // Adventure frames render the back-face content as an inline sub-panel.
    backFace: (card.back_face as CardBackFace | null) ?? null,
    // Structured loyalty/saga rows — renderers resolve structured-first with
    // a rules_text parsing fallback (lib/cards/face-content.ts).
    faceContent: (card.face_content as FaceContent | null) ?? null,
    watermark: (card.watermark as CardWatermark | null) ?? null,
    // The collector fields (TODO 4.9a) — carried, not drawn (4.9b). The
    // same three cardToPreviewData hands over (lib/cards/preview-data.ts);
    // a row read without them (an older select) carries null.
    setCode: card.set_code ?? null,
    collectorNumber: card.collector_number ?? null,
    lang: card.lang ?? null,
  }));
}

// ---------------------------------------------------------------------------
// card-renders objects, shared by every caller that writes or removes a bake:
// the save bake (lib/cards/bake-render.ts), the admin sweep
// (lib/cards/rebake-batch.ts), card delete / go-private (lib/cards/actions.ts),
// an admin hiding a reported card (lib/moderation/actions.ts) and deleting a
// frame preview (lib/cards/frame-signoff-actions.ts).
//
// Every one of them goes through the owner's folder handle
// (lib/media/user-storage.ts `userFolder("card-renders", ownerId)`): the key
// can only be one of a card's render names (renderObjectNames: the front's
// `{ownerId}/{cardId}.png` + `.thumb.webp`, the back face's `.back.png` +
// `.back.thumb.webp`), never a path a caller made up. Users hold no storage
// write policy since migration 0126, so these calls use the service role —
// each caller passes an owner it has verified (its authenticated user, or
// the owner_id of the card row it read).
// ---------------------------------------------------------------------------

/** The objects a bake may write for a card, as bare names in its owner's
 *  folder (TODO 5.0a, design 2026-10-02 §3.3): the front's HD PNG and its
 *  WebP thumbnail — `{ownerId}/{name}` is exactly `cardRenderPath(ownerId,
 *  cardId)` and `renderThumbPath()` of it (lib/cards/storage-paths.ts,
 *  lib/cards/render-thumb.ts) — and the BACK face's pair, `{cardId}.back.png`
 *  / `{cardId}.back.thumb.webp` (migration 0134's rendered_back_image_url /
 *  rendered_back_thumb_url; written by 5.3 only for a card with a back body).
 *  THE ONE LIST every reader of a render name derives from: isStoredRenderUrl
 *  and bakeObjectCardId (lib/cards/render-cdn.ts, the /render-cdn proxy),
 *  removeRenderObjects below, the moderation hide, and the orphan sweep's
 *  renderCardId (scripts/lib/storage-orphans.mjs, which can't import this
 *  module — tests/unit/cards/render-object-names.test.ts holds the two to
 *  the same four names). */
export function renderObjectNames(cardId: string): {
  png: string;
  thumb: string;
  backPng: string;
  backThumb: string;
} {
  return {
    png: `${cardId}.png`,
    thumb: `${cardId}.thumb.webp`,
    backPng: `${cardId}.back.png`,
    backThumb: `${cardId}.back.thumb.webp`,
  };
}

/** Every render name of a card, in one list (the front pair, then the back
 *  pair) — what removeRenderObjects removes; a bake writes only the faces
 *  the card has. */
export function allRenderObjectNames(cardId: string): string[] {
  const { png, thumb, backPng, backThumb } = renderObjectNames(cardId);
  return [png, thumb, backPng, backThumb];
}

/** The render POINTER columns a card row carries (migration 0126 + 0134):
 *  what every path that takes a card out of public view clears beside the
 *  object removal — the moderation hide, going private, a failed bake.
 *  `layout_version` is cleared by the bake paths only. Service-role writes
 *  set them; an API role may only clear them (cards_guard_render_columns). */
export const CLEARED_RENDER_POINTERS = Object.freeze({
  rendered_image_url: null,
  rendered_thumb_url: null,
  rendered_back_image_url: null,
  rendered_back_thumb_url: null,
  rendered_at: null,
});

const STORAGE_UNCONFIGURED =
  "Render storage is unavailable (SUPABASE_SECRET_KEY is not set).";

/**
 * Delete these cards' baked PNGs + thumbs — both faces' names, whether or
 * not the card ever had a back bake — from `ownerId`'s card-renders folder,
 * retrying once. Returns the error (null on success) — and LOGS it: the render
 * path is deterministic and the bucket is public-read, so a render that
 * survives a delete or an unpublish stays fetchable by anyone who has (or
 * guesses) the URL. A missing service-role key is logged the same way: since
 * 0126 there is no user-session fallback for this delete.
 *
 * Note: Supabase Storage's `remove` treats a missing object as success (no
 * error) — so a card with no back bake costs nothing extra — and the retry
 * only fires on a genuine transient/permission error.
 */
export async function removeRenderObjects(
  ownerId: string,
  cardIds: readonly string[],
): Promise<{ error: string | null }> {
  if (cardIds.length === 0) return { error: null };
  if (!isUserStorageConfigured()) {
    console.error(
      `[bake] ${STORAGE_UNCONFIGURED} Could not delete the render objects of ${cardIds.length} card(s) of ${ownerId}; a private or deleted card's PNG stays publicly fetchable until they are removed.`,
    );
    return { error: STORAGE_UNCONFIGURED };
  }
  const names = cardIds.flatMap(allRenderObjectNames);
  const folder = userFolder("card-renders", ownerId);
  let message = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { error } = await folder.remove(names);
    if (!error) return { error: null };
    message = error.message;
  }
  console.error(
    `[bake] Could not delete ${names.length} render object(s) of ${ownerId} after a retry: ${message}. The PNGs may remain publicly fetchable for private or deleted cards.`,
  );
  return { error: message };
}

/** The faces a bake rendered (TODO 5.3): the front's HD PNG always, the
 *  back's only for a card with a back BODY (lib/cards/faces.ts
 *  bakedBackOf) — null for every other card. */
export type BakeFaceBytes = {
  front: ArrayBuffer | Buffer;
  back: ArrayBuffer | Buffer | null;
};

export type UploadRenderResult =
  | {
      ok: true;
      renderedImageUrl: string;
      renderedThumbUrl: string | null;
      /** The back face's pair, null when the bake had no back (so the row's
       *  back pointers are written null in the same update). */
      renderedBackImageUrl: string | null;
      renderedBackThumbUrl: string | null;
    }
  | { ok: false; error: string };

type RenderFolder = ReturnType<typeof userFolder>;

/** The 600 px WebP beside a face's PNG (lib/cards/render-thumb.ts). A thumb
 *  failure is not a bake failure: tiles fall back to next/image over the
 *  front's PNG, and a back with no thumb simply offers no tile flip. */
async function uploadThumb(folder: RenderFolder, name: string, pngBytes: ArrayBuffer | Buffer, cardId: string): Promise<boolean> {
  try {
    const thumbBytes = await makeRenderThumb(pngBytes);
    const { error } = await folder.upload(name, thumbBytes, {
      cacheControl: "31536000",
      contentType: "image/webp",
      upsert: true,
    });
    if (error) {
      console.warn(`[bake] Thumb upload failed for ${cardId} (${name}): ${error.message}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(
      `[bake] Thumb encode failed for ${cardId} (${name}): ${err instanceof Error ? err.message : "error"}`,
    );
    return false;
  }
}

/**
 * Upload a card's baked PNGs (upsert — one object per name, overwritten on
 * every bake instead of a pile of versioned files to garbage-collect) plus
 * the 600 px WebP thumb beside each (lib/cards/render-thumb.ts) into
 * `ownerId`'s card-renders folder, and return the public URLs: the front's
 * pair always, the BACK's pair (`.back.png` / `.back.thumb.webp`, TODO 5.3)
 * when the bake rendered one. Order: the front PNG, the back PNG, then the
 * thumbs — a back PNG that fails to upload fails the whole bake (the caller
 * clears every pointer: a card downloads the way it looks) and takes the
 * back's names out of storage, so a half-written back never outlives the
 * failure. A bake with no back and `staleBack` (the row still pointed at a
 * back bake from before its back body went) removes the back's names too.
 */
export async function uploadRenderObjects(
  ownerId: string,
  cardId: string,
  faces: BakeFaceBytes,
  opts: { staleBack?: boolean } = {},
): Promise<UploadRenderResult> {
  if (!isUserStorageConfigured()) return { ok: false, error: STORAGE_UNCONFIGURED };
  const folder = userFolder("card-renders", ownerId);
  const { png, thumb, backPng, backThumb } = renderObjectNames(cardId);
  const { error: uploadErr } = await folder.upload(png, faces.front, {
    cacheControl: "31536000",
    contentType: "image/png",
    upsert: true,
  });
  if (uploadErr) {
    return { ok: false, error: `Upload failed: ${uploadErr.message}` };
  }

  if (faces.back) {
    const { error: backErr } = await folder.upload(backPng, faces.back, {
      cacheControl: "31536000",
      contentType: "image/png",
      upsert: true,
    });
    if (backErr) {
      await folder.remove([backPng, backThumb]);
      return { ok: false, error: `Back face upload failed: ${backErr.message}` };
    }
  } else if (opts.staleBack) {
    const { error: removeErr } = await folder.remove([backPng, backThumb]);
    if (removeErr) console.warn(`[bake] Could not remove the stale back bake of ${cardId}: ${removeErr.message}`);
  }

  const thumbOk = await uploadThumb(folder, thumb, faces.front, cardId);
  const backThumbOk = faces.back ? await uploadThumb(folder, backThumb, faces.back, cardId) : false;

  // Cache-bust query so next/image and the browser don't serve the prior
  // version after a resave. The base URL is stable; only the ?v changes —
  // shared by every PNG and thumb of the bake so they all bust together.
  const version = Date.now();
  return {
    ok: true,
    renderedImageUrl: `${folder.publicUrl(png)}?v=${version}`,
    renderedThumbUrl: thumbOk ? `${folder.publicUrl(thumb)}?v=${version}` : null,
    renderedBackImageUrl: faces.back ? `${folder.publicUrl(backPng)}?v=${version}` : null,
    renderedBackThumbUrl: backThumbOk ? `${folder.publicUrl(backThumb)}?v=${version}` : null,
  };
}
