import { frameImageUrl } from "@/components/cards/frame-layer";
import { cardCornersClass } from "@/lib/cards/card-orientation";
import { artLayersFor, getFrameProfile, type Rect } from "@/lib/cards/template-layout";
import { cn } from "@/lib/utils";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// The empty frame a /frames tile shows while no public card wears it: the
// frame's own master in one verified colour, from the frames bucket through
// frameUrl() (frameImageUrl: the browser's WebP, the URL the picker and the
// preview paint), with the picker's sample art (FrameThumb's, a built-in
// profile banner — no WotC art) where a card's art would be: the art layers
// both renderers draw for that master (artLayersFor — the window's slot,
// and a see-through master's layer under the frame), and a second part's own
// window (secondFace.artSlot). An empty art window on the card's #101015
// read as a black hole in a grid of finished cards; an art-first master
// (borderless, the full-art basics) read as a black tile.
//
// Never a card render: no name, no text, no stored bake — nothing a viewer
// could take for someone's card — and "No example yet" over the window.
// Lazy, like every tile picture below the fold.
// ---------------------------------------------------------------------------

/** The picker's sample art (its frame tiles' constant in
 *  components/creator/frame-pickers.tsx — a client module, so a server page
 *  can't read the value from it). tests/unit/frames/frame-gallery.test.ts
 *  holds the two together, and the picker's "no card surface draws the
 *  sample" guard names this file as the one other reader: an empty frame
 *  here is a picker-style tile, never a card. */
export const FRAME_PLACEHOLDER_SAMPLE_ART = "/defaults/banners/banner-05.webp";

function rectStyle(rect: Rect) {
  return {
    top: `${rect.topPct}%`,
    left: `${rect.leftPct}%`,
    width: `${rect.widthPct}%`,
    height: `${rect.heightPct}%`,
  };
}

function SampleArt({ rect, rotation = 0 }: { rect: Rect; rotation?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={FRAME_PLACEHOLDER_SAMPLE_ART}
      alt=""
      loading="lazy"
      decoding="async"
      className="absolute object-cover"
      style={{ ...rectStyle(rect), ...(rotation ? { transform: `rotate(${rotation}deg)` } : {}) }}
    />
  );
}

export function FrameMasterPlaceholder({
  template,
  colorKey,
  label,
}: {
  template: FrameTemplate;
  colorKey: string;
  /** The words over the art window ("No example yet"). */
  label: string;
}) {
  const profile = getFrameProfile(template);
  const landscape = profile.orientation === "landscape";
  const { slot, under } = artLayersFor(profile, colorKey, true);
  return (
    // The tile is 5:7 like every gallery tile; a landscape frame sits
    // centred in it, as BakedCardThumbnail letterboxes a battle.
    <div className="flex aspect-[5/7] w-full items-center">
      <div
        className={cn(
          "relative w-full overflow-hidden bg-[#101015]",
          landscape ? "aspect-[7/5]" : "aspect-[5/7]",
          cardCornersClass(landscape),
        )}
        data-frame-placeholder={template}
      >
        {under ? <SampleArt rect={under} /> : null}
        <SampleArt rect={slot} />
        {/* A second part's own window (split's right half, aftermath's
            sideways one), turned with its part as the preview turns it. */}
        {profile.secondFace?.artSlot ? (
          <SampleArt rect={profile.secondFace.artSlot} rotation={profile.secondFace.rotation} />
        ) : null}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={frameImageUrl(template, colorKey)}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full"
        />
        <div className="absolute flex items-center justify-center p-2" style={rectStyle(slot)}>
          <span className="rounded-full border border-white/20 bg-black/70 px-2.5 py-1 text-center text-[11px] font-medium leading-tight text-white backdrop-blur-sm">
            {label}
          </span>
        </div>
      </div>
    </div>
  );
}
