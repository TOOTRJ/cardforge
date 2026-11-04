"use client";

import { History, Redo2, Undo2 } from "lucide-react";
import { useDeckEditor } from "@/components/decks/use-deck-editor";
import { openDeckTool } from "@/components/decks/deck-tool-event";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The deck toolbar's Undo · Redo · History (TODO DK5.13) — the owner's, on
// the editor's ONE stack (use-deck-editor.tsx, lib/decks/undo-history.ts):
// the same steps as ⌘Z / ⇧⌘Z, a removal's toast and the phone bar's Undo.
//
//   * Undo / Redo are named by what they do ("Undo: add Sol Ring"); with
//     nothing to do they stay reachable, aria-disabled, and say so — never
//     `disabled`, which would drop the focus out of the toolbar the moment
//     the last step is spent;
//   * their keys are announced (aria-keyshortcuts) and shown on hover;
//   * History opens the change history (DeckHistoryDialog, by the deck-tool
//     event, so the phone bar's More menu opens the same dialog); closed,
//     the focus comes back here.
// ---------------------------------------------------------------------------

const BUTTON =
  "inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-xs text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 pointer-coarse:h-11 aria-disabled:opacity-45 aria-disabled:hover:border-border aria-disabled:hover:text-muted";

export function DeckHistoryControls({ className }: { className?: string }) {
  const editor = useDeckEditor();
  if (!editor) return null;
  const { undoLabel, redoLabel } = editor;
  return (
    <div role="group" aria-label="Undo and history" className={cn("flex flex-wrap items-center gap-2", className)}>
      <button
        type="button"
        className={BUTTON}
        aria-disabled={undoLabel ? undefined : true}
        aria-label={undoLabel ?? "Undo — nothing to undo yet"}
        aria-keyshortcuts="Meta+Z Control+Z"
        title={undoLabel ? `${undoLabel} (⌘Z / Ctrl+Z)` : "Nothing to undo yet"}
        onClick={() => {
          if (undoLabel) editor.undo();
        }}
      >
        <Undo2 className="h-3.5 w-3.5" aria-hidden />
        Undo
      </button>
      <button
        type="button"
        className={BUTTON}
        aria-disabled={redoLabel ? undefined : true}
        aria-label={redoLabel ?? "Redo — nothing to redo"}
        aria-keyshortcuts="Shift+Meta+Z Shift+Control+Z Control+Y"
        title={redoLabel ? `${redoLabel} (⇧⌘Z / Ctrl+Y)` : "Nothing to redo"}
        onClick={() => {
          if (redoLabel) editor.redo();
        }}
      >
        <Redo2 className="h-3.5 w-3.5" aria-hidden />
        Redo
      </button>
      <button
        type="button"
        className={BUTTON}
        aria-haspopup="dialog"
        onClick={(event) => openDeckTool("history", event.currentTarget)}
      >
        <History className="h-3.5 w-3.5" aria-hidden />
        History
      </button>
    </div>
  );
}
