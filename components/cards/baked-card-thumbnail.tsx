import Image from "next/image";
import { cn } from "@/lib/utils";
import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";
import { BakedCardFlip } from "@/components/cards/baked-card-flip";
import { isLandscapeFrame } from "@/lib/cards/card-orientation";
import { isStoredRenderUrl, toRenderCdnUrl } from "@/lib/cards/render-cdn";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { resolveWhiteBorder } from "@/lib/cards/white-border";
import { tileBackThumbOf } from "@/lib/cards/tile-faces";

// ---------------------------------------------------------------------------
// BakedCardThumbnail — the canonical way to render a *saved* card in any
// gallery-style list (gallery, profile, set, dashboard, booster).
//
// When the card has a baked render, we show it: the 600 px WebP thumbnail
// the bake writes beside the HD PNG (cards.rendered_thumb_url,
// lib/cards/render-thumb.ts) as a plain lazy <img> — ~40 KB, no optimizer
// hop — or, for cards baked before thumbnails existed, the HD PNG through
// next/image. The card's layout is frozen at save time and looks identical
// to every other card on the page, regardless of how long its rules text
// is.
//
// When the URL is missing (the card was saved before the bake-on-save
// path existed, or the bake transiently failed), we fall back to the live
// React preview. The next time the card is saved, the PNG will be baked
// and this fallback won't fire again.
//
// Only a bake in OUR card-renders bucket is drawn (isStoredRenderUrl,
// lib/cards/render-cdn.ts). Since migration 0126 only the service role can
// set these columns, but a row written before it — when an owner could PATCH
// their card through PostgREST — might point anywhere: an outside host (a
// viewer-IP tracking pixel, an unmoderated picture) or a raw upload in
// card-art (no watermark). Such a URL is treated as no render at all (the
// live preview), and a thumb that isn't ours is skipped for the PNG.
//
// Landscape frames (Battle) are 7:5. Every gallery grid is a uniform 5:7
// tile, so a landscape card is letterboxed — centered in the portrait tile
// with breathing room above/below — rather than cropped (object-cover would
// zoom into the middle of a Siege). This keeps every grid aligned while the
// battle card stays whole and undistorted.
//
// Corners (TODO 3.26): the card is clipped at the ONE card corner — by the
// tile itself for a portrait card (`.card-corners` on the 5:7 box), by a
// centred 7:5 inner box for a landscape one (`.card-corners-landscape`), so
// the battle's own corners round rather than the empty letterbox (and a
// pre-v31 square bake rounds too). The image sits on the card's #101015 (the
// live preview's root colour), never on the page colour: a v31 bake has
// transparent rounded corners, and the tile's clip inside its 1 px border is
// a hair tighter than the image's own arc — over bg-background that sliver
// showed as a pale rim on every dark-bordered card in LIGHT theme. A
// WHITE-bordered card (TODO 4.30, frame_style.border on a frame that draws
// it) sits on its own white instead: on #101015 the same sliver was a grey
// arc round each corner of a white card.
//
// A DOUBLE-FACED card (TODO 5.3 + 5.15, owner decisions 2026-10-12): with
// the back face's thumbnail too (cards.rendered_back_thumb_url — the bake's
// second WebP, written only for a card with a back BODY), the tile shows the
// front with a labelled "2 faces" button in its bottom-left corner that
// turns it over in place, and — with a real hovering pointer, motion allowed
// — it also turns when the pointer rests on it
// (components/cards/baked-card-flip.tsx). Which cards: ONE answer,
// lib/cards/tile-faces.ts (only a portrait pair, only our own bakes). A tile
// without a back thumb is exactly what it was — an older two-faced card with
// no back picture shows nothing, and neither does the live fallback below
// (a card whose pointers an edit has just cleared: no back picture yet).
//
// The editor still uses <CardPreview> directly — that's where the live
// preview matters and where the bake-from-form-state would be a chicken-
// and-egg problem.
// ---------------------------------------------------------------------------

export type BakedCardThumbnailProps = {
  /** Public URL of the baked PNG (cards.rendered_image_url). */
  renderedImageUrl: string | null | undefined;
  /** Public URL of the tile-sized WebP (cards.rendered_thumb_url). Preferred
   *  over the PNG whenever present. */
  renderedThumbUrl?: string | null;
  /** The BACK face's tile-sized WebP (cards.rendered_back_thumb_url, TODO
   *  5.3): with it, the tile gets its "2 faces" button and hover-turn
   *  (TODO 5.15). */
  renderedBackThumbUrl?: string | null;
  /** Card title — used as the <img>'s accessible label. */
  title: string | null | undefined;
  /** Image alt override — defaults to the card title. */
  alt?: string;
  /** Same field set passed to <CardPreview> for the fallback render. */
  previewData: CardPreviewData;
  className?: string;
  /** Forwarded to <Image>; lets the browser ship the right sized image. */
  sizes?: string;
  /**
   * When true, render at higher priority (eager + fetchpriority high).
   * Use for the very first row of thumbnails above the fold.
   */
  priority?: boolean;
};

const DEFAULT_SIZES =
  "(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw";

export function BakedCardThumbnail({
  renderedImageUrl,
  renderedThumbUrl = null,
  renderedBackThumbUrl = null,
  title,
  alt,
  previewData,
  className,
  sizes = DEFAULT_SIZES,
  priority = false,
}: BakedCardThumbnailProps) {
  const isLandscape = isLandscapeFrame(previewData.frameStyle);
  const pngUrl = isStoredRenderUrl(renderedImageUrl) ? renderedImageUrl : null;
  const thumbUrl = pngUrl && isStoredRenderUrl(renderedThumbUrl) ? renderedThumbUrl : null;
  // The back's thumb — only beside a front thumb, only portrait, only ours.
  const backThumbUrl = tileBackThumbOf({
    rendered_image_url: renderedImageUrl,
    rendered_thumb_url: renderedThumbUrl,
    rendered_back_thumb_url: renderedBackThumbUrl,
    frame_style: previewData.frameStyle,
  });

  if (!pngUrl) {
    // Live-preview fallback. Portrait cards fill the cell; landscape (Battle)
    // cards are centered in a portrait tile so they don't break the grid.
    if (isLandscape) {
      return (
        <div
          className={cn(
            "flex aspect-[5/7] w-full items-center overflow-hidden card-corners",
            className,
          )}
        >
          <CardPreview {...previewData} />
        </div>
      );
    }
    return <CardPreview {...previewData} className={className} />;
  }

  const label = alt ?? (title?.trim() || "Card");
  // The backdrop behind the bake: the card's own border colour — #101015, or
  // the printed white of a white-bordered card (the header says why).
  const backdrop = resolveWhiteBorder(getFrameProfile(previewData.frameStyle?.template), previewData.frameStyle)
    ? "bg-[#ececea]"
    : "bg-[#101015]";
  // The #101015 backdrop sits directly behind the image (see the header): it
  // only ever shows through a rounded bake's transparent corner sliver.
  const image = backThumbUrl && thumbUrl ? (
    <BakedCardFlip
      frontSrc={toRenderCdnUrl(thumbUrl) ?? thumbUrl}
      backSrc={toRenderCdnUrl(backThumbUrl) ?? backThumbUrl}
      label={label}
      title={title?.trim() || "this card"}
      priority={priority}
    />
  ) : thumbUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={toRenderCdnUrl(thumbUrl) ?? thumbUrl}
      alt={label}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      className={cn("absolute inset-0 h-full w-full object-cover", backdrop)}
    />
  ) : (
    <Image
      src={pngUrl}
      alt={label}
      fill
      sizes={sizes}
      priority={priority}
      className={cn("object-cover", backdrop)}
    />
  );

  // The wrapper mirrors the rounded-frame look so the thumbnail integrates with
  // the same hover effects and shadows the live preview gets. A portrait render
  // is 5:7 and fills the tile; a landscape render is letterboxed in it, inside
  // its own 7:5 card box.
  return (
    <div
      className={cn(
        "relative aspect-[5/7] w-full overflow-hidden card-corners border border-border/40 bg-background shadow-[0_18px_60px_-30px_rgba(0,0,0,0.85)]",
        isLandscape && "flex items-center",
        className,
      )}
    >
      {isLandscape ? (
        <div className="relative aspect-[7/5] w-full overflow-hidden card-corners-landscape">
          {image}
        </div>
      ) : (
        image
      )}
    </div>
  );
}
