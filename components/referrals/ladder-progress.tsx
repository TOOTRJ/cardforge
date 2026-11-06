import { ladderProgressFraction, ladderProgressLine, type LadderProgress } from "@/lib/referrals/ladder-progress";
import { cn } from "@/lib/utils";

// The ladder's progress bar (TODO SG4): how many referrals were rewarded
// against the ladder's length, and what the next one earns — the one
// sentence `ladderProgressLine` says, as the bar's accessible name. Server
// component (no state): the page and the share dialog pass the numbers.

export function LadderProgressBar({ progress, className }: { progress: LadderProgress; className?: string }) {
  const line = ladderProgressLine(progress);
  const fraction = ladderProgressFraction(progress);
  const now = Math.min(progress.rewardsEarned, progress.ladderLength);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div
        role="progressbar"
        aria-label={line}
        aria-valuemin={0}
        aria-valuemax={progress.ladderLength}
        aria-valuenow={now}
        className="h-2 w-full overflow-hidden rounded-full bg-surface"
      >
        <div
          className="h-full rounded-full bg-linear-to-r from-gold-strong to-primary-bright transition-[width] duration-500"
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
      </div>
      <p className="text-sm text-muted" aria-hidden>
        {line}
      </p>
    </div>
  );
}
