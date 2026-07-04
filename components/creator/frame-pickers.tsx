"use client";

// Shared building blocks for the creator's Kind + Frame steps: the numbered
// sub-step label, the frame thumbnail chip art, and the "Soon" pill for
// verification-gated combos. The era/showcase pickers that used to live here
// were replaced by the kind-first FrameGalleryPanel
// (components/creator/panels/frame-gallery-panel.tsx).

import { type FrameTemplate } from "@/types/card";
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

// A numbered sub-step heading for the pickers: a small index badge, a title,
// an optional muted context line, and a right-aligned count.
export function PickerStepLabel({
  n,
  title,
  aside,
  count,
}: {
  n: number;
  title: string;
  aside?: string;
  count?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wider text-subtle">
        <span
          aria-hidden
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-elevated/60 text-[10px] text-foreground"
        >
          {n}
        </span>
        <span className="shrink-0">{title}</span>
        {aside ? (
          <span className="truncate font-normal normal-case tracking-normal text-muted">
            · {aside}
          </span>
        ) : null}
      </span>
      {count ? (
        <span className="shrink-0 text-[11px] text-muted">{count}</span>
      ) : null}
    </div>
  );
}

export function FrameThumb({
  template,
  colorKey = "u",
}: {
  template: FrameTemplate;
  /** Frame color variant to preview. Defaults to blue (representative) for the
   *  static module-level chips; the in-step pickers pass the card's live color
   *  so the thumbnails match what the user will get. */
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
      style={{ backgroundImage: `url(/frames/${template}/${colorKey}.png)` }}
    />
  );
}
