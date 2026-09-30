"use client";

// Shared building blocks for the creator's Card step: the frame thumbnail
// chip art and the "Soon" pill for verification-gated combos. The
// era/showcase pickers that used to live here were replaced by the
// kind-first CardSetupPanel (components/creator/panels/card-setup-panel.tsx).

import { type ColorIdentity, type FrameTemplate } from "@/types/card";
import type { FrameAnatomyStyle } from "@/lib/cards/anatomy";
import {
  frameBackgroundImage,
  frameMasterKey,
  frameMasterKeyForColor,
  frameSplitClipPaths,
  frameSplitFor,
  pickFrameColorKey,
  type FrameTypeInfo,
} from "@/components/cards/frame-layer";
import { artFillsCard, getFrameProfile, type Rect } from "@/lib/cards/template-layout";
import { cn } from "@/lib/utils";

/** The sample art drawn under an art-first frame's tile (TODO 4.45): one of
 *  the app's own built-in profile banners (lib/profile/default-media.ts,
 *  painted by scripts/generate-default-profile-media.mjs — no WotC art, and
 *  already served, so no new asset). A misty valley: the centre slice a tile
 *  shows is a bright, low-chroma landscape that reads in both themes and
 *  leaves the colour to the frame's own bars. Only a tile that draws it (an
 *  art-first frame, or a profile with pickerSampleArt) loads it; cards,
 *  previews and bakes never draw it. */
export const FRAME_THUMB_SAMPLE_ART = "/defaults/banners/banner-05.webp";

function rectStyle(r: Rect) {
  return { top: `${r.topPct}%`, left: `${r.leftPct}%`, width: `${r.widthPct}%`, height: `${r.heightPct}%` };
}

// Small "Soon" pill for frames/layouts whose (template, color) combo hasn't
// been verified/published yet (/admin/frame-compare).
export function SoonBadge() {
  return (
    <span className="rounded-full border border-border/70 bg-elevated px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-subtle">
      Soon
    </span>
  );
}

export function FrameThumb({
  template,
  colorKey = "u",
  colorIdentity,
  type = null,
  anatomy = null,
}: {
  template: FrameTemplate;
  /** Frame color variant to preview — callers pass the card's live color so
   *  the thumbnails match what the user will get. */
  colorKey?: string;
  /** The card's own identity, when `colorKey` is the card's own colour. A
   *  two-colour identity on a split-frame template (Dragon Wing) then shows
   *  the split wings the card itself renders, not the gold "m" frame. (The
   *  colour picker is single-select; two-colour identities come from older
   *  cards and AI generation.) */
  colorIdentity?: readonly ColorIdentity[];
  /** The card's type (card type + supertype): a frame that dresses a colour
   *  by type shows the master the card would paint in it — Alpha's
   *  colourless tile is the brown artifact card for an artifact
   *  (frameMasterKeyForColor, the renderers' rule). */
  type?: FrameTypeInfo | null;
  /** The card's anatomy switches (FrameStyle.twoColor, TODO 4.6b), with the
   *  card's own identity and `type.cost`: a stored pair with the two-colour
   *  frame on shows the pair master the card paints on a frame that has one
   *  (frameMasterKey, the renderers' rule), not the gold "m". */
  anatomy?: FrameAnatomyStyle | null;
}) {
  const profile = getFrameProfile(template);
  const landscape = profile.orientation === "landscape";
  const own = Boolean(colorIdentity) && pickFrameColorKey(colorIdentity) === colorKey;
  const split = own ? frameSplitFor(profile, colorIdentity) : null;
  const clips = split ? frameSplitClipPaths(split) : null;
  const masterKey = own
    ? frameMasterKey(profile, colorIdentity, type, anatomy)
    : frameMasterKeyForColor(profile, colorKey, type);
  // An art-first master (artFillsCard: borderless, full-art basics) is
  // see-through almost everywhere, so on the tile's dark ground it read as
  // a black tile (4.45): the sample art goes in the profile's art slot and
  // the frame on a layer above it. Six tall-window frames that read nearly
  // as dark opt in by name (pickerSampleArt: Anime, Ghostfire, the ZNR
  // hedron, both textless frames, Nyx — this tile is its only reader).
  // Every other tile paints its frame as the tile's own background, as
  // before.
  const sampleArt = artFillsCard(profile) || profile.pickerSampleArt === true;
  return (
    <span
      aria-hidden
      className={cn(
        "relative block shrink-0 overflow-hidden rounded-[3px] border border-border/60 bg-[#101015] bg-cover bg-center",
        landscape ? "h-7 w-10" : "h-10 w-[29px]",
      )}
      data-frame-key={split ? undefined : masterKey}
      style={
        split || sampleArt
          ? undefined
          : { backgroundImage: frameBackgroundImage(template, masterKey) }
      }
    >
      {sampleArt ? (
        <span
          data-frame-sample-art
          className="absolute bg-cover bg-center"
          style={{ ...rectStyle(profile.artSlot), backgroundImage: `url("${FRAME_THUMB_SAMPLE_ART}")` }}
        />
      ) : null}
      {sampleArt && !split ? (
        <span
          data-frame-layer
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: frameBackgroundImage(template, masterKey) }}
        />
      ) : null}
      {split && clips ? (
        <>
          <span
            data-frame-split="left"
            data-frame-key={split.leftKey}
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: frameBackgroundImage(template, split.leftKey),
              clipPath: clips.left,
            }}
          />
          <span
            data-frame-split="right"
            data-frame-key={split.rightKey}
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: frameBackgroundImage(template, split.rightKey),
              clipPath: clips.right,
            }}
          />
        </>
      ) : null}
    </span>
  );
}
