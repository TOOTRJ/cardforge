"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { renderCardImage, RENDER_PRESETS, type RenderPreset } from "@/lib/render/card-image";
import {
  isCardType,
  isColorIdentity,
  isRarity,
  type ArtPosition,
  type CardType,
  type ColorIdentity,
  type Rarity,
} from "@/types/card";
import type { CardPreviewData } from "@/components/cards/card-preview";

export type ExportCardResult =
  | {
      ok: true;
      fileUrl: string;
      width: number;
      height: number;
      format: "png";
      preset: RenderPreset;
    }
  | { ok: false; error: string };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Render a PNG of the given card and upload it to the public `card-exports`
 * bucket. The card's owner is the only role allowed to call this — we
 * pre-flight ownership before rendering so other users can't burn render
 * cycles by hammering an arbitrary id.
 *
 * Returns the public file URL on success. The caller can open it in a new
 * tab or hand it to a download anchor.
 */
export async function exportCardAction(
  cardId: string,
  preset: RenderPreset = "hd",
): Promise<ExportCardResult> {
  if (!UUID_PATTERN.test(cardId)) {
    return { ok: false, error: "Invalid card id." };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to export cards." };
  }

  const supabase = await createClient();

  // Pre-flight: ownership check. RLS would also reject the upload because
  // of the storage bucket's path policy, but a friendlier error surfaces
  // here.
  const { data: card } = await supabase
    .from("cards")
    .select("*")
    .eq("id", cardId)
    .maybeSingle();

  if (!card || card.owner_id !== user.id) {
    return {
      ok: false,
      error: "Card not found or not yours to export.",
    };
  }

  const previewData: CardPreviewData = {
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
    artPosition: (card.art_position as ArtPosition) ?? {},
    frameStyle: {},
  };

  let pngBytes: ArrayBuffer;
  try {
    const response = renderCardImage(previewData, preset);
    pngBytes = await response.arrayBuffer();
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unknown render error.";
    return {
      ok: false,
      error: `Could not render card: ${detail}`,
    };
  }

  const timestamp = Date.now();
  const path = `${user.id}/${card.id}-${timestamp}.png`;

  const { error: uploadErr } = await supabase.storage
    .from("card-exports")
    .upload(path, pngBytes, {
      cacheControl: "31536000",
      contentType: "image/png",
      upsert: false,
    });

  if (uploadErr) {
    return {
      ok: false,
      error: `Upload failed: ${uploadErr.message}`,
    };
  }

  const { data: urlData } = supabase.storage
    .from("card-exports")
    .getPublicUrl(path);
  const fileUrl = urlData.publicUrl;
  const { width, height } = RENDER_PRESETS[preset];

  // Best-effort export-history insert. If the row insert fails (e.g. RLS),
  // the file is still in storage and the user gets the URL back; we just
  // skip recording the entry.
  await supabase.from("card_exports").insert({
    card_id: card.id,
    owner_id: user.id,
    file_url: fileUrl,
    storage_path: path,
    width,
    height,
    format: "png",
  });

  revalidatePath(`/card/${card.slug}`);
  revalidatePath(`/card/${card.slug}/edit`);

  return {
    ok: true,
    fileUrl,
    width,
    height,
    format: "png",
    preset,
  };
}
