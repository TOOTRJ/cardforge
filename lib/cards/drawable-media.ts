import type { CardPreviewData } from "@/components/cards/card-preview";
import type { PipOverrides } from "@/lib/pips/override";
import { drawableMediaUrl } from "@/lib/media/media-urls";
import { setIconForRarity } from "@/lib/tools/set-symbol/naming";

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

/**
 * `local`: the `blob:` URLs of pictures THIS page holds — a guest's picks in
 * the signed-out creator (TODO HM3), kept in the browser until sign-in. Only
 * the creator's live preview passes them; a blob: URL is the document's own
 * and never reaches a stored row or the bake (the save uploads it first).
 */
export function drawableCardMedia<T extends CardPreviewData>(card: T, local?: readonly string[]): T {
  const drawable = (kind: Parameters<typeof drawableMediaUrl>[0], url: string | null | undefined) =>
    url && local?.includes(url) && url.startsWith("blob:") ? url : drawableMediaUrl(kind, url);
  const watermark =
    card.watermark?.kind === "custom" && !drawable("watermark", card.watermark.url)
      ? null
      : card.watermark;
  return {
    ...card,
    artUrl: drawable("card-art", card.artUrl),
    // A Set Symbol Studio "follows the rarity" icon draws the card's rarity's
    // file (lib/tools/set-symbol/naming.ts); every other icon as stored.
    setIconUrl: drawableMediaUrl("set-icon", setIconForRarity(card.setIconUrl, card.rarity)),
    watermark,
    backFace: card.backFace
      ? { ...card.backFace, art_url: drawable("card-art", card.backFace.art_url) ?? undefined }
      : card.backFace,
    pipOverrides: drawablePips(card.pipOverrides),
    backCard: card.backCard ? drawableCardMedia(card.backCard, local) : card.backCard,
  };
}
