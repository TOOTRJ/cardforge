import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// "Frame preview" on an admin's walked preview card (TODO 2.3, migration
// 0121) wherever My Cards shows it — grid, compact and list — so the admin
// can spot the test cards among their own and delete them (owner,
// 2026-09-28). A label only: nothing else about the tile changes.
// ---------------------------------------------------------------------------

/** An admin's frame preview. The column is absent until migration 0121
 *  lands, so anything but `true` is an ordinary card. */
export function isFramePreviewCard(card: { frame_preview?: boolean | null }): boolean {
  return card.frame_preview === true;
}

export function FramePreviewCardBadge({ className }: { className?: string }) {
  return (
    <span
      data-testid="frame-preview-card-badge"
      title="A frame preview saved while walking the stepper (admin frame verification). It always stays private — delete it once the frame is signed off."
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-sky-400/50 bg-sky-400/10 px-2 py-0.5 text-[11px] font-medium leading-4 text-foreground",
        className,
      )}
    >
      <FlaskConical className="h-3 w-3 text-sky-400" aria-hidden />
      Frame preview
    </span>
  );
}
