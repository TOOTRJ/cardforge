"use client";

// Shared building blocks for the creator's Card step: the frame thumbnail
// chip art and the "Soon" pill for verification-gated combos. The
// era/showcase pickers that used to live here were replaced by the
// kind-first CardSetupPanel (components/creator/panels/card-setup-panel.tsx).

import { type ColorIdentity, type FrameTemplate } from "@/types/card";
import {
  frameBackgroundImage,
  frameMasterKeyForColor,
  frameSplitClipPaths,
  frameSplitFor,
  pickFrameColorKey,
  type FrameTypeInfo,
} from "@/components/cards/frame-layer";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { cn } from "@/lib/utils";

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
}) {
  const profile = getFrameProfile(template);
  const landscape = profile.orientation === "landscape";
  const split =
    colorIdentity && pickFrameColorKey(colorIdentity) === colorKey
      ? frameSplitFor(profile, colorIdentity)
      : null;
  const clips = split ? frameSplitClipPaths(split) : null;
  const masterKey = frameMasterKeyForColor(profile, colorKey, type);
  return (
    <span
      aria-hidden
      className={cn(
        "relative block shrink-0 overflow-hidden rounded-[3px] border border-border/60 bg-[#101015] bg-cover bg-center",
        landscape ? "h-7 w-10" : "h-10 w-[29px]",
      )}
      data-frame-key={split ? undefined : masterKey}
      style={
        split ? undefined : { backgroundImage: frameBackgroundImage(template, masterKey) }
      }
    >
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
