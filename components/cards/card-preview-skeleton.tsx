import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// CardPreviewSkeleton — shape-matches CardPreview so a Suspense fallback
// shimmer doesn't shift the layout when real content streams in. The
// structure mirrors CardPreview's outer frame → inner panel → 5 sections.
// ---------------------------------------------------------------------------

type CardPreviewSkeletonProps = {
  className?: string;
};

export function CardPreviewSkeleton({ className }: CardPreviewSkeletonProps) {
  return (
    <div
      className={cn(
        // Outer frame — matches CardPreview's wrapper sizing/radius so the
        // grid layout stays identical between fallback and real content.
        "relative aspect-[5/7] w-full overflow-hidden rounded-frame border border-border bg-elevated/40 p-3",
        className,
      )}
      aria-hidden
      role="status"
      aria-label="Loading card"
    >
      <div className="flex h-full flex-col gap-2 rounded-card border border-border/60 bg-background/40 p-2">
        {/* Title bar */}
        <div className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-surface/80 px-3 py-1.5">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-10" />
        </div>

        {/* Art well — flex-grows to fill the visible card area */}
        <Skeleton className="flex-1 rounded-md" />

        {/* Type line */}
        <div className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-surface/80 px-3 py-1.5">
          <Skeleton className="h-2.5 w-1/2" />
          <Skeleton shape="circle" className="h-3 w-3" />
        </div>

        {/* Rules + flavor section */}
        <div className="flex flex-1 flex-col gap-1.5 rounded-md border border-border/40 bg-surface/60 px-3 py-2">
          <Skeleton className="h-2.5 w-full" />
          <Skeleton className="h-2.5 w-11/12" />
          <Skeleton className="h-2.5 w-3/4" />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-2 w-1/3" />
          <Skeleton className="h-2 w-12" />
        </div>
      </div>
    </div>
  );
}
