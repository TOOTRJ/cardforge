import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The word a creator page says when the verified frame list couldn't be read
// (lib/cards/frame-reviews.ts readVerifiedFrameKeys — a PostgREST or pooler
// hiccup). The page still opens, but its frames show as "Soon" and a save
// would be refused: without this the maker saw a creator with nothing
// published and no reason why. A plain box rendered with the page — never a
// live region (it is there on arrival, not an update to announce).
// ---------------------------------------------------------------------------

export function FrameListUnavailableNotice({
  className,
  /** The ISR guest creator is cached for a while: "reload" may not help at
   *  once there, so it says "later". */
  cached = false,
  /** The card editor: an edit that leaves the frame and colour alone reads
   *  no list (updateCardAction) and still saves. */
  editing = false,
}: {
  className?: string;
  cached?: boolean;
  editing?: boolean;
}) {
  return (
    <div
      data-testid="frame-list-unavailable"
      className={cn(
        "flex items-start gap-3 rounded-lg border border-gold/50 bg-gold/10 px-4 py-3 text-sm text-foreground",
        className,
      )}
    >
      <AlertTriangle className="mt-1 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 leading-6">
        <p className="font-semibold">We couldn&rsquo;t load the frame list just now</p>
        <p>
          {editing
            ? "Frames may show as “Soon”, and a new frame or colour can’t be saved until it loads."
            : "Frames may show as “Soon”, and saving won’t work until it loads."}{" "}
          {cached ? "Please try again in a little while." : "Reload the page in a minute to try again."}
        </p>
      </div>
    </div>
  );
}
