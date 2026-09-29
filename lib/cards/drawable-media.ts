import type { CardPreviewData } from "@/components/cards/card-preview";
import type { PipOverrides } from "@/lib/pips/override";
import { drawableMediaUrl } from "@/lib/media/media-urls";

// ---------------------------------------------------------------------------
// The pictures a card may DRAW (migration 0127, TODO 3.14b): its art (both
// faces), a custom design watermark, an uploaded set icon and the owner's
// custom pips — each only when lib/media/media-urls.ts accepts it. A row
// written before 0127 could point any of them at an outside host.
//
// Both renderers run it on the data they are handed — CardPreview on its
// props, the Satori bake in withRenderableImages (lib/render/card-image.tsx)
// — so the preview and the bake drop exactly the same pictures (they must
// stay pixel-identical). A dropped art URL draws the empty art box; the bake
// refuses to bake a card whose art it would drop (resolveBakeArt), the same
// as art it can't fetch.
// ---------------------------------------------------------------------------

function drawablePips(pips: PipOverrides | null | undefined): PipOverrides | null | undefined {
  if (!pips) return pips;
  const kept: PipOverrides = {};
  for (const [symbol, url] of Object.entries(pips) as [keyof PipOverrides, string | undefined][]) {
    const drawable = drawableMediaUrl("pip", url);
    if (drawable) kept[symbol] = drawable;
  }
  return kept;
}

export function drawableCardMedia<T extends CardPreviewData>(card: T): T {
  const watermark =
    card.watermark?.kind === "custom" && !drawableMediaUrl("watermark", card.watermark.url)
      ? null
      : card.watermark;
  return {
    ...card,
    artUrl: drawableMediaUrl("card-art", card.artUrl),
    setIconUrl: drawableMediaUrl("set-icon", card.setIconUrl),
    watermark,
    backFace: card.backFace
      ? { ...card.backFace, art_url: drawableMediaUrl("card-art", card.backFace.art_url) ?? undefined }
      : card.backFace,
    pipOverrides: drawablePips(card.pipOverrides),
    backCard: card.backCard ? drawableCardMedia(card.backCard) : card.backCard,
  };
}
