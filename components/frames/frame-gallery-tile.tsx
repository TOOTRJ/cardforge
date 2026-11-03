import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CARD_GRID_SIZES } from "@/components/cards/card-grid";
import { CardTile } from "@/components/cards/card-tile";
import { ColorPips, toPipColor, type PipColor } from "@/components/cards/color-pip";
import { FrameMasterPlaceholder } from "@/components/frames/frame-master-placeholder";
import {
  frameAnchorId,
  kindsLine,
  placeholderColorKey,
  creatorHrefForFrame,
  verifiedColorsPhrase,
  type FrameGalleryEntry,
} from "@/lib/frames/frame-gallery";
import type { FrameExample } from "@/lib/frames/frame-gallery-queries";

// ---------------------------------------------------------------------------
// One frame on /frames (TODO NV8): its example card (or its empty master),
// its name, its era or set, the card types it dresses, the colours it is
// verified in, and "Make a card" (the creator; its section says where the
// frame is picked there — creatorHrefForFrame).
//
// The example is a gallery tile like any other — CardTile around a
// BakedCardThumbnail, the card's 600 px thumbnail, its link to the card's
// page (and a double-faced card's "2 faces" button). The tile's own words
// sit outside that link, so the frame's start link is never nested in it.
// ---------------------------------------------------------------------------

/** The tile picture's `sizes`: the card grid's in the wide frame (/frames,
 *  TODO WD10). */
const TILE_SIZES = CARD_GRID_SIZES;

export function FrameGalleryTile({ entry, example }: { entry: FrameGalleryEntry; example: FrameExample | null }) {
  const headingId = `${frameAnchorId(entry.template)}-name`;
  return (
    <li id={frameAnchorId(entry.template)} className="flex min-w-0 scroll-mt-24 flex-col">
      <article aria-labelledby={headingId} className="flex flex-1 flex-col">
        {example ? (
          <CardTile
            body={(slot) => (
              <Link
                href={example.path}
                aria-label={`Example on the ${entry.fullName} frame: ${example.title}${example.ownerUsername ? ` by @${example.ownerUsername}` : ""}`}
                {...slot}
              />
            )}
            thumbnail={{
              renderedImageUrl: example.renderedImageUrl,
              renderedThumbUrl: example.renderedThumbUrl,
              renderedBackThumbUrl: example.renderedBackThumbUrl,
              title: example.title,
              alt: `${example.title} — a custom card on the ${entry.fullName} frame`,
              sizes: TILE_SIZES,
              previewData: {
                title: example.title,
                cardType: example.cardType,
                rarity: example.rarity,
                colorIdentity: example.colorIdentity,
                frameStyle: example.frameStyle,
              },
            }}
          />
        ) : (
          <FrameMasterPlaceholder
            template={entry.template}
            colorKey={placeholderColorKey(entry.colorKeys)}
            label="No example yet"
          />
        )}

        <div className="mt-3 flex flex-1 flex-col gap-1.5">
          <h3
            id={headingId}
            className="font-display text-base font-semibold leading-snug tracking-tight text-foreground [overflow-wrap:anywhere]"
          >
            {entry.name}
          </h3>
          <p className="text-xs text-muted">{entry.origin}</p>
          <p className="text-xs leading-5 text-subtle">
            <span className="sr-only">Card types: </span>
            {kindsLine(entry.kinds)}
          </p>
          <p className="flex items-center">
            <span className="sr-only">{verifiedColorsPhrase(entry.colorKeys)}</span>
            <ColorPips
              colors={entry.colorKeys.map(toPipColor).filter((c): c is PipColor => c != null)}
              size={16}
              decorative
            />
          </p>
          <div className="mt-auto flex flex-col gap-1 pt-2">
            {example ? (
              <p className="truncate text-xs text-subtle">
                Example: <span className="text-muted">{example.title}</span>
                {example.ownerUsername ? <> by @{example.ownerUsername}</> : null}
              </p>
            ) : null}
            <Link
              href={creatorHrefForFrame(entry.template)}
              className="inline-flex items-center gap-1 self-start rounded-sm text-sm font-medium text-primary-bright hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
            >
              Make a card
              <span className="sr-only">{` in the creator: ${entry.fullName}`}</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        </div>
      </article>
    </li>
  );
}
