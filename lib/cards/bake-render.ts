"use server";

import "server-only";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { renderCardImage } from "@/lib/render/card-image";
import { cardRenderPath } from "@/lib/cards/storage-paths";
import {
  isCardType,
  isColorIdentity,
  isRarity,
  type ArtPosition,
  type CardBackFace,
  type CardType,
  type ColorIdentity,
  type FrameStyle,
  type Rarity,
} from "@/types/card";
import type { CardPreviewData } from "@/components/cards/card-preview";

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

type CardRowForBake = {
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
};

function rowToPreviewData(card: CardRowForBake): CardPreviewData {
  return {
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
  };
}

export type BakeRenderResult =
  | { ok: true; renderedImageUrl: string | null }
  | { ok: false; error: string };

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
): Promise<BakeRenderResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Not signed in." };
  }

  const supabase = await createClient();

  // Re-read the card after the save so we render exactly what's in the DB,
  // not what the action handler thinks it just wrote. Catches edge cases
  // where validation munged a field or a trigger normalized it.
  const { data: card, error: fetchErr } = await supabase
    .from("cards")
    .select(
      "id, owner_id, visibility, title, cost, card_type, supertype, subtypes, rarity, color_identity, rules_text, flavor_text, power, toughness, loyalty, defense, artist_credit, art_url, art_position, frame_style, set_icon_url, set_icon_code, back_face",
    )
    .eq("id", cardId)
    .maybeSingle();

  if (fetchErr || !card) {
    return { ok: false, error: fetchErr?.message ?? "Card not found." };
  }
  if (card.owner_id !== user.id) {
    return { ok: false, error: "Not the card owner." };
  }

  const path = cardRenderPath(user.id, card.id);

  // A private card must not leave its render in the public-read card-renders
  // bucket — that PNG is the full card image. Skip the bake and remove any
  // render left over from when the card was public/unlisted. Owner-only views
  // fall back to the live <CardPreview>; publishing again re-bakes on save.
  // (Art is intentionally NOT removed here — remixes copy art_url, so the art
  // object can be shared; its random-id path is also never publicly exposed.)
  if (card.visibility === "private") {
    await supabase.storage.from("card-renders").remove([path]);
    return { ok: true, renderedImageUrl: null };
  }

  const previewData = rowToPreviewData(card as CardRowForBake);

  let pngBytes: ArrayBuffer;
  try {
    const response = renderCardImage(previewData, "hd");
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
): Promise<string | null> {
  const result = await bakeCardRender(cardId);
  if (!result.ok) {
    // Best-effort logging. We deliberately don't throw — the card itself
    // saved successfully; the bake is a nice-to-have that can be retried.
    console.warn(
      `[bake-render] Failed to bake card ${cardId}: ${result.error}`,
    );
    return null;
  }

  const supabase = await createClient();
  const { error: updateErr } = await supabase
    .from("cards")
    .update({
      // null for private cards (no public render); a URL otherwise.
      rendered_image_url: result.renderedImageUrl,
      rendered_at: result.renderedImageUrl ? new Date().toISOString() : null,
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
