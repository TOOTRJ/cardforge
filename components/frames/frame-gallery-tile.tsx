import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CardTile } from "@/components/cards/card-tile";
import { ManaPip } from "@/components/cards/mana-pip";
import { FrameMasterPlaceholder } from "@/components/frames/frame-master-placeholder";
import {
  frameAnchorId,
  kindsLine,
  placeholderColorKey,
  startWithFrameHref,
  verifiedColorsPhrase,
  type FrameGalleryEntry,
} from "@/lib/frames/frame-gallery";
import type { FrameExample } from "@/lib/frames/frame-gallery-queries";

// ---------------------------------------------------------------------------
// One frame on /frames (TODO NV8): its example card (or its empty master),
// its name, its era or set, the card types it dresses, the colours it is
// verified in, and "Start with this frame".
//
// The example is a gallery tile like any other — CardTile around a
// BakedCardThumbnail, the card's 600 px thumbnail, its link to the card's
// page (and a double-faced card's "2 faces" button). The tile's own words
// sit outside that link, so the frame's start link is never nested in it.
// ---------------------------------------------------------------------------

/** The tile picture's `sizes`: two columns on a phone up to five at 1280. */
const TILE_SIZES = "(min-width: 1280px) 240px, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw";

/** The colour dots' symbol per frame colour key; gold has no mana symbol of
 *  its own and is drawn as the deck tiles draw it. */
const PIP_SYMBOL: Record<string, string> = { w: "W", u: "U", b: "B", r: "R", g: "G", c: "C" };

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
            <span aria-hidden className="inline-flex flex-wrap items-center gap-0.5">
              {entry.colorKeys.map((key) =>
                PIP_SYMBOL[key] ? (
                  <ManaPip key={key} symbol={PIP_SYMBOL[key]} size="xs" />
                ) : (
                  <span key={key} className="inline-block h-3.5 w-3.5 rounded-full border border-gold/60 bg-gold" />
                ),
              )}
            </span>
          </p>
          <div className="mt-auto flex flex-col gap-1 pt-2">
            {example ? (
              <p className="truncate text-xs text-subtle">
                Example: <span className="text-muted">{example.title}</span>
                {example.ownerUsername ? <> by @{example.ownerUsername}</> : null}
              </p>
            ) : null}
            <Link
              href={startWithFrameHref(entry.template)}
              className="inline-flex items-center gap-1 self-start rounded-sm text-sm font-medium text-primary-bright hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
            >
              Start with this frame
              <span className="sr-only">: {entry.fullName}</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        </div>
      </article>
    </li>
  );
}
