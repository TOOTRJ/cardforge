"use client";

import { forwardRef, useState, type ComponentPropsWithoutRef } from "react";
import { Minus, MoreHorizontal, Plus } from "lucide-react";
import type { MenuItem } from "@/components/decks/deck-entry-menu";
// The menu loads with the owner's other parts (the pop-up's stepper, which
// a visitor never sees either, shares this file).
import { EntryMenu } from "@/components/decks/deck-owner-parts";
import { useDeckEditor } from "@/components/decks/use-deck-editor";
import { MAX_ENTRY_QUANTITY } from "@/lib/decks/parse-decklist";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The owner's controls on a deck entry (TODO DK5.4) — the quantity stepper
// and the "⋯" menu, beside a List or Table row's opener and in the preview
// pane and the bottom sheet. Every change goes through the page's editor
// (components/decks/use-deck-editor.tsx): drawn at once, saved in the
// background, rolled back and said if it fails.
//
// The stepper is a named group ("Copies of Sol Ring") of − and + around the
// count; − at one copy and + at 250 are aria-disabled with their reason in
// their name (reachable, and never acting — CLAUDE.md: aria-disabled stops
// nothing by itself, the handler does). Its buttons are 32 px (44 px under
// a coarse pointer).
// ---------------------------------------------------------------------------

const STEP_CLASS =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:border-border aria-disabled:hover:text-muted pointer-coarse:h-11 pointer-coarse:w-11";

export function EntryStepper({
  entryId,
  name,
  quantity,
  saving = false,
  size = "sm",
  className,
}: {
  entryId: string;
  /** The card's name as the row shows it. */
  name: string;
  quantity: number;
  saving?: boolean;
  /** "md": the pane's and the sheet's bigger count. */
  size?: "sm" | "md";
  className?: string;
}) {
  const editor = useDeckEditor();
  if (!editor) return null;
  const atLeast = quantity <= 1;
  const atMost = quantity >= MAX_ENTRY_QUANTITY;
  return (
    <div role="group" aria-label={`Copies of ${name}`} aria-busy={saving || undefined} className={cn("flex shrink-0 items-center gap-1", className)}>
      <button
        type="button"
        aria-label={atLeast ? "One fewer — one copy is the fewest; remove it from its menu" : "One fewer"}
        aria-disabled={atLeast || undefined}
        onClick={() => {
          if (!atLeast) editor.step([entryId], -1);
        }}
        className={STEP_CLASS}
      >
        <Minus className="h-3.5 w-3.5" aria-hidden />
      </button>
      <span
        className={cn(
          "min-w-6 text-center font-mono tabular-nums text-foreground",
          size === "md" ? "text-base font-semibold" : "text-xs",
          saving && "text-primary-bright",
        )}
      >
        <span className="sr-only">{quantity === 1 ? "1 copy" : `${quantity} copies`}</span>
        <span aria-hidden>{quantity}</span>
      </span>
      <button
        type="button"
        aria-label={atMost ? `One more — ${MAX_ENTRY_QUANTITY} copies is the most` : "One more"}
        aria-disabled={atMost || undefined}
        onClick={() => {
          if (!atMost) editor.step([entryId], 1);
        }}
        className={STEP_CLASS}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

/** The "⋯" trigger — a plain button the menu wraps (forwarded for Radix). */
export const MenuTrigger = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<"button"> & { label: string }>(
  function MenuTrigger({ label, className, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        {...rest}
        className={cn(STEP_CLASS, "border-transparent bg-transparent", className)}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>
    );
  },
);

/** A row's "⋯" and its menu. `items` is built by the card area (the
 *  boards, Edit, Select, Remove); `onRemoved` hands the focus on when the
 *  row it sat on is gone. */
export function EntryMenuButton({
  name,
  items,
  onCloseAutoFocus,
  className,
}: {
  name: string;
  items: MenuItem[];
  onCloseAutoFocus?: (event: Event) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <EntryMenu
      label={`${name}: actions`}
      items={items}
      open={open}
      onOpenChange={setOpen}
      onCloseAutoFocus={onCloseAutoFocus}
      trigger={<MenuTrigger label={`More for ${name}`} className={className} />}
    />
  );
}
