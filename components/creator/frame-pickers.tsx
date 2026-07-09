"use client";

// Shared building blocks for the creator's Card step: the frame thumbnail
// chip art and the "Soon" pill for verification-gated combos. The
// era/showcase pickers that used to live here were replaced by the
// kind-first CardSetupPanel (components/creator/panels/card-setup-panel.tsx).

import { type FrameTemplate } from "@/types/card";
import { frameBackgroundImage } from "@/components/cards/frame-layer";
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
}: {
  template: FrameTemplate;
  /** Frame color variant to preview — callers pass the card's live color so
   *  the thumbnails match what the user will get. */
  colorKey?: string;
}) {
  const landscape = getFrameProfile(template).orientation === "landscape";
  return (
    <span
      aria-hidden
      className={cn(
        "block shrink-0 overflow-hidden rounded-[3px] border border-border/60 bg-[#101015] bg-cover bg-center",
        landscape ? "h-7 w-10" : "h-10 w-[29px]",
      )}
      style={{ backgroundImage: frameBackgroundImage(template, colorKey) }}
    />
  );
}
