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
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { makeRenderThumb, renderThumbPath } from "@/lib/cards/render-thumb";

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
  return {
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
  };
}

// ---------------------------------------------------------------------------
// Bucket plumbing shared by the same two callers.
// ---------------------------------------------------------------------------

/** Any server-side client that may write the bucket: the owner's cookie-bound
 *  client (save bake) or the service role (admin sweep). */
export type RenderStorageClient = SupabaseClient<Database>;

/**
 * Delete a card's baked object from the public `card-renders` bucket, retrying
 * once before giving up. Unlike a best-effort `.remove().catch(() => {})`,
 * this surfaces a persistent failure loudly: the render path is deterministic
 * and the bucket is public-read, so a render that fails to delete when a card
 * goes private stays fetchable by anyone who has (or guesses) the URL — a
 * privacy leak we want visible in logs rather than swallowed.
 *
 * Note: Supabase Storage's `remove` treats a missing object as success (no
 * error), so the retry only fires on a genuine transient/permission error.
 */
export async function removeRenderObject(
  supabase: RenderStorageClient,
  path: string,
): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { error } = await supabase.storage
      .from("card-renders")
      .remove([path]);
    if (!error) return;
    if (attempt === 2) {
      console.error(
        `[bake] Could not delete render object ${path} after a retry: ${error.message}. The PNG may remain publicly fetchable for a now-private card.`,
      );
    }
  }
}

export type UploadRenderResult =
  | { ok: true; renderedImageUrl: string; renderedThumbUrl: string | null }
  | { ok: false; error: string };

/**
 * Upload a baked PNG (upsert — one object per card, overwritten on every
 * bake instead of a pile of versioned files to garbage-collect) plus the
 * 600 px WebP thumb beside it (lib/cards/render-thumb.ts), and return the
 * public URLs. A thumb failure is not a bake failure: tiles fall back to
 * next/image over the PNG.
 */
export async function uploadRenderObjects(
  supabase: RenderStorageClient,
  path: string,
  pngBytes: ArrayBuffer | Buffer,
  cardId: string,
): Promise<UploadRenderResult> {
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
      console.warn(`[bake] Thumb upload failed for ${cardId}: ${thumbErr.message}`);
    } else {
      thumbOk = true;
    }
  } catch (err) {
    console.warn(
      `[bake] Thumb encode failed for ${cardId}: ${err instanceof Error ? err.message : "error"}`,
    );
  }

  const { data: urlData } = supabase.storage
    .from("card-renders")
    .getPublicUrl(path);

  // Cache-bust query so next/image and the browser don't serve the prior
  // version after a resave. The base URL is stable; only the ?v changes —
  // shared by the PNG and its thumb so both bust together.
  const version = Date.now();
  return {
    ok: true,
    renderedImageUrl: `${urlData.publicUrl}?v=${version}`,
    renderedThumbUrl: thumbOk
      ? `${supabase.storage.from("card-renders").getPublicUrl(thumbPath).data.publicUrl}?v=${version}`
      : null,
  };
}
