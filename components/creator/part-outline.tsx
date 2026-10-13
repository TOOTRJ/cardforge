"use client";

// The outline on the part being edited (TODO 5.14, Face tabs part 2).
//
// A split, aftermath, adventure or flip card is ONE picture with both parts
// on it, so the creator keeps its single live preview and marks the part
// the selected tab edits: a ring in the app's own colour over that part's
// box (lib/creator/part-outline.ts — the frame profile's own rects), and a
// line above the preview that says it in words ("Editing: Right half").
//
// It is the CREATOR's chrome, drawn beside the preview — a sibling of
// CardPreview inside the creator's `relative` box, never a child of the
// card: nothing of it exists in CardPreview, the bake (lib/render), the OG
// image or the parity harness (app/dev/parity mounts CardPreview alone).
// It takes no pointer events and is hidden from assistive tech (the tab
// and the line above say which part is selected). The ring moves between
// the parts with a short ease; with reduced motion it jumps.

import type { CardFaceId } from "@/lib/creator/face-tabs";
import type { PartRects } from "@/lib/creator/part-outline";
import { cn } from "@/lib/utils";

/** The ring over the selected part. Place it inside the `relative` box
 *  that holds the CardPreview (the box IS the card's outline). */
export function PartOutline({ rects, face }: { rects: PartRects; face: CardFaceId }) {
  const rect = rects[face];
  return (
    <div
      aria-hidden
      data-testid="part-outline"
      data-face={face}
      className={cn(
        "pointer-events-none absolute z-[5] rounded-[3%/2.2%] border-2 border-dashed border-primary-bright",
        // A dark and a light hairline either side of the ring: it reads on
        // any artwork and on every frame colour, and never as a printed line.
        "shadow-[0_0_0_1px_rgba(0,0,0,0.65),inset_0_0_0_1px_rgba(0,0,0,0.45),0_0_14px_2px_rgba(168,85,247,0.45)]",
        "transition-[top,left,width,height] duration-300 ease-out motion-reduce:transition-none",
      )}
      style={{
        top: `${rect.topPct}%`,
        left: `${rect.leftPct}%`,
        width: `${rect.widthPct}%`,
        height: `${rect.heightPct}%`,
      }}
    />
  );
}

/** "Editing: Right half" — the words for the ring, above the preview. */
export function PartEditingLabel({ label, className }: { label: string; className?: string }) {
  return (
    <p
      data-testid="part-editing-label"
      className={cn(
        "inline-flex max-w-full items-center self-start rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground",
        className,
      )}
    >
      Editing: {label}
      <span className="sr-only"> — outlined on the preview</span>
    </p>
  );
}
