import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DECK_AI_PAUSED_MESSAGE } from "@/lib/ai/deck-ai-pause";

// ---------------------------------------------------------------------------
// The ONE "Coming soon" look for deck AI while it is paused (TODO DK1.1,
// lib/ai/deck-ai-pause.ts), in the style of the deck wizard's old Creativity
// row: the control greyed, its name, the gold "Coming soon" badge — and ONE
// visible line saying why (`DeckAiPausedNote`) beside the controls it
// explains.
//
// A greyed control is `aria-disabled`, never `disabled`: it stays in the tab
// order and has NO click handler (CLAUDE.md's chip rule — `aria-disabled`
// alone stops nothing). Its name is short ("Add with AI — coming soon") and
// its description is the visible line (`aria-describedby`), so the reason is
// read once per control, never folded into every name.
// ---------------------------------------------------------------------------

/** The visible badge (a screen reader hears "coming soon" in the name). */
export function ComingSoonBadge({ className }: { className?: string }) {
  return (
    <Badge variant="gold" className={cn("shrink-0", className)} aria-hidden>
      Coming soon
    </Badge>
  );
}

/** What a screen reader hears after a greyed control's own label. */
export function ComingSoonSuffix() {
  return <span className="sr-only"> — coming soon</span>;
}

/** The one visible line that says why; greyed controls point at its `id`. */
export function DeckAiPausedNote({ id, className }: { id: string; className?: string }) {
  return (
    <p id={id} className={cn("text-xs leading-5 text-muted", className)}>
      {DECK_AI_PAUSED_MESSAGE}
    </p>
  );
}

/** A deck AI button, greyed: its label, the badge, described by the note. */
export function DeckAiComingSoonButton({
  label,
  icon,
  describedBy,
  size,
  className,
}: {
  label: string;
  icon?: React.ReactNode;
  /** The `id` of the `DeckAiPausedNote` beside it. */
  describedBy: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-disabled="true"
      aria-describedby={describedBy}
      className={cn(
        buttonVariants({ variant: "outline", size }),
        "cursor-not-allowed text-muted opacity-70 hover:border-border hover:bg-transparent",
        className,
      )}
    >
      {icon}
      {label}
      <ComingSoonSuffix />
      <ComingSoonBadge className="px-2 py-0 text-[10px]" />
    </button>
  );
}
