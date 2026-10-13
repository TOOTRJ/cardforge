import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The small "2 faces" text mark (TODO 5.15, owner 2026-10-12) for places
// where a card's picture is too small to turn — the deck list's rows, My
// Cards' list view, the pinned-cards picker. Shown for exactly the cards a
// tile gives its "2 faces" button (lib/cards/tile-faces.ts hasBackPicture);
// never a control: the row it sits in opens the card, where both faces are.
// ---------------------------------------------------------------------------

export function TwoFacesMark({ className }: { className?: string }) {
  return (
    <span
      data-testid="two-faces-mark"
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-border bg-elevated px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted",
        className,
      )}
    >
      2 faces
    </span>
  );
}
