import Image from "next/image";
import { cn } from "@/lib/utils";
import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";
import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import { getFrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// BakedCardThumbnail — the canonical way to render a *saved* card in any
// gallery-style list (gallery, profile, set, dashboard, booster).
//
// When the card has a baked render URL (the PNG written to the
// card-renders bucket by lib/cards/bake-render.ts), we serve that PNG via
// next/image. The card's layout is frozen at save time and looks identical
// to every other card on the page, regardless of how long its rules text
// is.
//
// When the URL is missing (the card was saved before the bake-on-save
// path existed, or the bake transiently failed), we fall back to the live
// React preview. The next time the card is saved, the PNG will be baked
// and this fallback won't fire again.
//
// Landscape frames (Battle) are 7:5. Every gallery grid is a uniform 5:7
// tile, so a landscape card is letterboxed — centered in the portrait tile
// with breathing room above/below — rather than cropped (object-cover would
// zoom into the middle of a Siege). This keeps every grid aligned while the
// battle card stays whole and undistorted.
//
// The editor still uses <CardPreview> directly — that's where the live
// preview matters and where the bake-from-form-state would be a chicken-
// and-egg problem.
// ---------------------------------------------------------------------------

export type BakedCardThumbnailProps = {
  /** Public URL of the baked PNG (cards.rendered_image_url). */
  renderedImageUrl: string | null | undefined;
  /** Card title — used as the <img>'s accessible label. */
  title: string | null | undefined;
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
  title,
  previewData,
  className,
  sizes = DEFAULT_SIZES,
  priority = false,
}: BakedCardThumbnailProps) {
  const isLandscape =
    getFrameProfile(normalizeFrameTemplate(previewData.frameStyle?.template))
      .orientation === "landscape";

  if (!renderedImageUrl) {
    // Live-preview fallback. Portrait cards fill the cell; landscape (Battle)
    // cards are centered in a portrait tile so they don't break the grid.
    if (isLandscape) {
      return (
        <div
          className={cn(
            "flex aspect-[5/7] w-full items-center overflow-hidden rounded-frame",
            className,
          )}
        >
          <CardPreview {...previewData} />
        </div>
      );
    }
    return <CardPreview {...previewData} className={className} />;
  }

  // The wrapper mirrors the rounded-frame look so the thumbnail integrates with
  // the same hover effects and shadows the live preview gets. Portrait renders
  // are 5:7 (object-cover fills the tile); landscape renders are letterboxed.
  return (
    <div
      className={cn(
        "relative aspect-[5/7] w-full overflow-hidden rounded-frame border border-border/40 bg-background shadow-[0_18px_60px_-30px_rgba(0,0,0,0.85)]",
        className,
      )}
    >
      <Image
        src={renderedImageUrl}
        alt={title?.trim() || "Card"}
        fill
        sizes={sizes}
        priority={priority}
        className={isLandscape ? "object-contain" : "object-cover"}
      />
    </div>
  );
}
