"use client";

import { useState } from "react";
import { ArrowRightLeft, CheckSquare, Minus, Plus, Trash2, X } from "lucide-react";
import { EntryMenu, type MenuItem } from "@/components/decks/deck-entry-menu";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The owner's selection bar (TODO DK5.4 / DK5.10) — shown while cards are
// being selected (the toolbar's or the phone bar's Select, a row menu's
// Select, Shift + click, or a long press on touch): how many are picked,
// Select all, and what to do with them — Move to, one copy more or fewer
// each, Remove (with the removal's Undo) — and Done. Each is ONE batch write
// (lib/decks/card-actions.ts: one call, one revalidation) through the
// page's editor. It takes the summary bar's place at the bottom of the
// cards, so it is always in reach; a region named for what it holds.
// ---------------------------------------------------------------------------

const BUTTON =
  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm text-foreground transition-colors hover:border-border-strong hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 pointer-coarse:h-11";

export function DeckBulkBar({
  count,
  cards,
  total,
  moveItems,
  onSelectAll,
  onStep,
  onRemove,
  onDone,
  className,
}: {
  /** Entries picked. */
  count: number;
  /** Cards they hold (quantities summed). */
  cards: number;
  /** Entries on show (what Select all picks). */
  total: number;
  /** The Move to menu's boards for the selection. */
  moveItems: MenuItem[];
  onSelectAll: () => void;
  onStep: (by: number) => void;
  onRemove: () => void;
  onDone: () => void;
  className?: string;
}) {
  const [moveOpen, setMoveOpen] = useState(false);
  const none = count === 0;
  const guard = (run: () => void) => () => {
    if (!none) run();
  };
  return (
    <section
      aria-label="Selected cards"
      className={cn(
        "sticky bottom-2 z-30 flex flex-wrap items-center gap-2 rounded-frame border border-primary/40 bg-surface/95 px-3 py-2 shadow-[0_-12px_40px_-24px_rgba(0,0,0,0.7)] backdrop-blur supports-[backdrop-filter]:bg-surface/85 sm:bottom-3 sm:px-4",
        className,
      )}
    >
      <p className="mr-auto flex min-w-0 items-center gap-2 text-sm text-foreground" aria-live="polite">
        <CheckSquare className="h-4 w-4 shrink-0 text-primary-bright" aria-hidden />
        {none ? (
          <span className="text-muted">Pick cards to change them together.</span>
        ) : (
          <span>
            <span className="font-semibold tabular-nums">{count}</span> selected
            <span className="text-muted"> · {cards} card{cards === 1 ? "" : "s"}</span>
          </span>
        )}
      </p>
      <button type="button" onClick={() => count < total && onSelectAll()} aria-disabled={count >= total || undefined} className={BUTTON}>
        Select all <span className="tabular-nums text-muted">({total})</span>
      </button>
      <EntryMenu
        label="Move the selected cards"
        items={moveItems}
        open={moveOpen && !none}
        onOpenChange={(open) => setMoveOpen(open && !none)}
        side="top"
        trigger={
          <button type="button" aria-disabled={none || undefined} aria-haspopup="menu" className={BUTTON}>
            <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden />
            Move to…
          </button>
        }
      />
      <div role="group" aria-label="Copies of each selected card" className="flex items-center gap-1">
        <button type="button" aria-label="One fewer of each" aria-disabled={none || undefined} onClick={guard(() => onStep(-1))} className={cn(BUTTON, "w-9 justify-center px-0 pointer-coarse:w-11")}>
          <Minus className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button type="button" aria-label="One more of each" aria-disabled={none || undefined} onClick={guard(() => onStep(1))} className={cn(BUTTON, "w-9 justify-center px-0 pointer-coarse:w-11")}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <button
        type="button"
        aria-disabled={none || undefined}
        onClick={guard(onRemove)}
        className={cn(BUTTON, "text-danger hover:text-danger")}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
        Remove
      </button>
      <button type="button" onClick={onDone} className={cn(BUTTON, "border-primary/50 text-primary-bright")}>
        <X className="h-3.5 w-3.5" aria-hidden />
        Done
      </button>
    </section>
  );
}
