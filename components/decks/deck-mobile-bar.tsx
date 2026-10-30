"use client";

import { useState, type ReactNode } from "react";
import { Eye, MoreHorizontal, Plus, Undo2 } from "lucide-react";
import { EntryMenu, type MenuItem } from "@/components/decks/deck-entry-menu";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The owner's bar on a phone (TODO DK5.10): Add · View · Undo · More, fixed
// to the bottom under 768 px, where a thumb reaches — the research's pick
// over a page of drawers (Archidekt's redesign is the cautionary tale).
//
//   Add    the add box (scrolled to, focused, its results open);
//   View   the view and every group folded or unfolded, as a menu;
//   Undo   the last change back (aria-disabled with nothing to undo: it
//          stays reachable and says so);
//   More   Select cards (the long press's non-gesture twin, WCAG 2.5.7),
//          Import a decklist, Deck details.
//
// It is a navigation landmark of four buttons, each 56 px tall; the page
// leaves room under its last card for it (and the toasts rise above it —
// app/globals.css). Hidden from 768 px, where the toolbar and the bars in
// the page say all of it.
// ---------------------------------------------------------------------------

const ITEM =
  "flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-md text-[11px] font-medium text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 aria-disabled:opacity-45 aria-disabled:hover:text-muted";

export function DeckMobileBar({
  onAdd,
  viewItems,
  undoLabel,
  onUndo,
  moreItems,
}: {
  onAdd: () => void;
  viewItems: MenuItem[];
  /** What Undo undoes, in words; null: nothing to undo. */
  undoLabel: string | null;
  onUndo: () => void;
  moreItems: MenuItem[];
}) {
  const [menu, setMenu] = useState<"view" | "more" | null>(null);
  const button = (icon: ReactNode, label: string) => (
    <button type="button" aria-haspopup="menu" className={ITEM}>
      {icon}
      {label}
    </button>
  );
  return (
    <nav
      aria-label="Deck editing"
      data-deck-mobile-bar=""
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_40px_-24px_rgba(0,0,0,0.7)] backdrop-blur supports-[backdrop-filter]:bg-surface/85 md:hidden"
    >
      <div className="mx-auto flex max-w-md items-stretch gap-1">
        <button type="button" onClick={onAdd} className={cn(ITEM, "text-primary-bright hover:text-primary-bright")}>
          <Plus className="h-5 w-5" aria-hidden />
          Add
        </button>
        <EntryMenu
          label="View"
          items={viewItems}
          open={menu === "view"}
          onOpenChange={(open) => setMenu(open ? "view" : null)}
          side="top"
          align="center"
          trigger={button(<Eye className="h-5 w-5" aria-hidden />, "View")}
        />
        <button
          type="button"
          aria-disabled={undoLabel ? undefined : true}
          aria-label={undoLabel ?? "Undo — nothing to undo yet"}
          onClick={() => {
            if (undoLabel) onUndo();
          }}
          className={ITEM}
        >
          <Undo2 className="h-5 w-5" aria-hidden />
          Undo
        </button>
        <EntryMenu
          label="More"
          items={moreItems}
          open={menu === "more"}
          onOpenChange={(open) => setMenu(open ? "more" : null)}
          side="top"
          trigger={button(<MoreHorizontal className="h-5 w-5" aria-hidden />, "More")}
        />
      </div>
    </nav>
  );
}
