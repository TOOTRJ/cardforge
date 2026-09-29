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
};

/** Every column the renderer needs (plus owner/visibility for gating). */
export const BAKE_SELECT_COLUMNS =
  "id, owner_id, visibility, updated_at, title, cost, card_type, supertype, subtypes, rarity, color_identity, rules_text, flavor_text, power, toughness, loyalty, defense, artist_credit, art_url, art_position, frame_style, set_icon_url, set_icon_code, back_face, face_content, watermark";

export function rowToPreviewData(
  card: CardRowForBake,
  pipOverrides: PipOverrides | null = null,
  profileOverrides: FrameProfileOverridesMap | null = null,
): CardPreviewData {
  // Only the pictures CardPreview would draw (lib/cards/drawable-media.ts,
  // migration 0127): every server render of a stored card — the bake, the
  // sweep, the PNG / PDF / share image — drops the same ones the live
  // preview does.
  return drawableCardMedia({
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
  });
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
// can only be `{ownerId}/{cardId}.png` or its `.thumb.webp`, never a path a
// caller made up. Users hold no storage write policy since migration 0126, so
// these calls use the service role — each caller passes an owner it has
// verified (its authenticated user, or the owner_id of the card row it read).
// ---------------------------------------------------------------------------

/** The two objects a bake writes for a card, as bare names in its owner's
 *  folder: the HD PNG and its WebP thumbnail. `{ownerId}/{name}` is exactly
 *  `cardRenderPath(ownerId, cardId)` and `renderThumbPath()` of it
 *  (lib/cards/storage-paths.ts, lib/cards/render-thumb.ts). */
export function renderObjectNames(cardId: string): { png: string; thumb: string } {
  return { png: `${cardId}.png`, thumb: `${cardId}.thumb.webp` };
}

const STORAGE_UNCONFIGURED =
  "Render storage is unavailable (SUPABASE_SECRET_KEY is not set).";

/**
 * Delete these cards' baked PNGs + thumbs from `ownerId`'s card-renders folder,
 * retrying once. Returns the error (null on success) — and LOGS it: the render
 * path is deterministic and the bucket is public-read, so a render that
 * survives a delete or an unpublish stays fetchable by anyone who has (or
 * guesses) the URL. A missing service-role key is logged the same way: since
 * 0126 there is no user-session fallback for this delete.
 *
 * Note: Supabase Storage's `remove` treats a missing object as success (no
 * error), so the retry only fires on a genuine transient/permission error.
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
  const names = cardIds.flatMap((id) => {
    const { png, thumb } = renderObjectNames(id);
    return [png, thumb];
  });
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

export type UploadRenderResult =
  | { ok: true; renderedImageUrl: string; renderedThumbUrl: string | null }
  | { ok: false; error: string };

/**
 * Upload a baked PNG (upsert — one object per card, overwritten on every
 * bake instead of a pile of versioned files to garbage-collect) plus the
 * 600 px WebP thumb beside it (lib/cards/render-thumb.ts) into `ownerId`'s
 * card-renders folder, and return the public URLs. A thumb failure is not a
 * bake failure: tiles fall back to next/image over the PNG.
 */
export async function uploadRenderObjects(
  ownerId: string,
  cardId: string,
  pngBytes: ArrayBuffer | Buffer,
): Promise<UploadRenderResult> {
  if (!isUserStorageConfigured()) return { ok: false, error: STORAGE_UNCONFIGURED };
  const folder = userFolder("card-renders", ownerId);
  const { png, thumb } = renderObjectNames(cardId);
  const { error: uploadErr } = await folder.upload(png, pngBytes, {
    cacheControl: "31536000",
    contentType: "image/png",
    upsert: true,
  });
  if (uploadErr) {
    return { ok: false, error: `Upload failed: ${uploadErr.message}` };
  }

  let thumbOk = false;
  try {
    const thumbBytes = await makeRenderThumb(pngBytes);
    const { error: thumbErr } = await folder.upload(thumb, thumbBytes, {
      cacheControl: "31536000",
      contentType: "image/webp",
      upsert: true,
    });
    if (thumbErr) {
      console.warn(`[bake] Thumb upload failed for ${cardId}: ${thumbErr.message}`);
    } else {
      thumbOk = true;
    }
  } catch (err) {
    console.warn(
      `[bake] Thumb encode failed for ${cardId}: ${err instanceof Error ? err.message : "error"}`,
    );
  }

  // Cache-bust query so next/image and the browser don't serve the prior
  // version after a resave. The base URL is stable; only the ?v changes —
  // shared by the PNG and its thumb so both bust together.
  const version = Date.now();
  return {
    ok: true,
    renderedImageUrl: `${folder.publicUrl(png)}?v=${version}`,
    renderedThumbUrl: thumbOk ? `${folder.publicUrl(thumb)}?v=${version}` : null,
  };
}
