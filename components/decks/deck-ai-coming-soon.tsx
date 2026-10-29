import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DECK_AI_PAUSED_MESSAGE } from "@/lib/ai/deck-ai-pause";

// ---------------------------------------------------------------------------
// The ONE "Coming soon" look for deck AI while it is paused (TODO DK1.1,
// lib/ai/deck-ai-pause.ts), in the style of the deck wizard's old Creativity
// row: the control greyed, its name, the gold "Coming soon" badge.
//
// A greyed control is `aria-disabled`, never `disabled`: it stays in the tab
// order, its reason is part of its accessible name, and it has NO click
// handler (CLAUDE.md's chip rule — `aria-disabled` alone stops nothing).
// ---------------------------------------------------------------------------

/** The badge itself, for a control that draws its own frame (a build tile). */
export function ComingSoonBadge({ className }: { className?: string }) {
  return (
    <Badge variant="gold" className={cn("shrink-0", className)} aria-hidden>
      Coming soon
    </Badge>
  );
}

/** The reason a screen reader hears as part of the control's name. */
export function DeckAiPausedReason() {
  return <span className="sr-only">, coming soon: {DECK_AI_PAUSED_MESSAGE}</span>;
}

/** A deck AI button, greyed: its label, the badge, and the reason in its name. */
export function DeckAiComingSoonButton({
  label,
  icon,
  size,
  className,
}: {
  label: string;
  icon?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-disabled="true"
      className={cn(
        buttonVariants({ variant: "outline", size }),
        "cursor-not-allowed text-muted opacity-70 hover:border-border hover:bg-transparent",
        className,
      )}
    >
      {icon}
      {label}
      <ComingSoonBadge className="px-2 py-0 text-[10px]" />
      <DeckAiPausedReason />
    </button>
  );
}
