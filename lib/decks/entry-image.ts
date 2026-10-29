import { isStoredRenderUrl, toRenderCdnUrl } from "@/lib/cards/render-cdn";
import { hasBackPicture, type TileRenderPointers } from "@/lib/cards/tile-faces";
import { drawableMediaUrl } from "@/lib/media/media-urls";

// ---------------------------------------------------------------------------
// A deck entry's pictures at the size a surface draws them (TODO DK5.11).
//
// The printing: the importer stores Scryfall's "normal" JPEG (488 × 680,
// lib/decks/import-resolution.ts toResolvedCardData) — right for a card
// tile, but ~70 KB a row where the list draws a 32 px thumb: 6–10 MB for a
// 100-card deck. Scryfall serves every printing at each size under the same
// path, so a row asks for "small" (146 × 204, ~10 KB) instead. Only a
// picture `drawableMediaUrl("deck-card-image")` accepts is drawn (a Scryfall
// printing image, migration 0127), and only Scryfall's own path shape is
// rewritten: `/<size>/<face>/…` with a JPEG size ("small", "normal",
// "large"). Anything else — "png", "art_crop", another shape — is drawn as
// stored.
//
// The PipGlyph card: its bake's 600 px WebP thumb where the bake wrote one,
// never the HD PNG beside a thumb (TODO 5.15), and only a bake in our
// card-renders bucket (lib/cards/render-cdn.ts): a row written before
// migration 0126 could point the card anywhere. Pure, client-safe.
// ---------------------------------------------------------------------------

const SCRYFALL_SIZED = /^(https:\/\/cards\.scryfall\.io\/)(small|normal|large)(\/(?:front|back)\/)/;

export type EntryImageSize = "small" | "normal";

/** The entry's Scryfall picture at `size`, or null when it has none we draw. */
export function entryPrintingImage(imageUrl: string | null | undefined, size: EntryImageSize): string | null {
  const stored = drawableMediaUrl("deck-card-image", imageUrl ?? null);
  if (!stored) return null;
  return stored.replace(SCRYFALL_SIZED, `$1${size}$3`);
}

/** A list row's pictures: the card's bake (the thumb, else the PNG of a
 *  bake older than thumbnails), the printing at "small", and whether the
 *  card turns — the ONE answer (lib/cards/tile-faces.ts), the row's mark. */
export function entryRowPictures(
  entry: { image_url: string | null },
  card: TileRenderPointers | null,
): { proxy: string | null; printing: string | null; twoFaces: boolean } {
  const proxyPng = card && isStoredRenderUrl(card.rendered_image_url) ? card.rendered_image_url : null;
  const proxyThumb = proxyPng && card && isStoredRenderUrl(card.rendered_thumb_url) ? card.rendered_thumb_url : null;
  return {
    proxy: proxyThumb ? (toRenderCdnUrl(proxyThumb) ?? proxyThumb) : proxyPng,
    printing: entryPrintingImage(entry.image_url, "small"),
    twoFaces: Boolean(card && hasBackPicture(card)),
  };
}
