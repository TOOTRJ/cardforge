"use client";

// ---------------------------------------------------------------------------
// DeckOwnerTools — everything the owner needs, on the deck page itself
// (there is no separate edit page any more), in the owner's bar under the
// deck's hero (TODO DK5.1):
//
//   Import decklist   → the decklist import dialog (auto-opens with ?import=1)
//   Add from my cards → one of the owner's own cards into the deck
//                       (TODO DK4.4, add-from-my-cards-dialog.tsx)
//   Edit details      → dialog with the deck form (title, description,
//                       format, visibility, cover + focal point)
//   Add with AI       → "Coming soon" while deck AI is paused (TODO DK1,
//   Restyle with AI     lib/ai/deck-ai-pause.ts): greyed, no dialog, with the
//                       one visible line that says why. "Restyle" is the deck
//                       remix (job kind `deck_remix`) in the UI's words since
//                       TODO DK2.3 — "Remix" now means a card started from
//                       another PipGlyph card
//   Delete            → the existing confirm dialog
//
// Controls elsewhere on the page — the hero's pencils, the empty deck's
// three doors, the commander slot — open the same dialogs by dispatching
// `pipglyph:deck-tool` with { tool, opener } (openDeckTool / DeckToolButton
// below). Such a dialog has no Dialog.Trigger of its own to go back to, so
// closing it hands the focus back to the control that opened it (DK5.12) —
// or, when that control is gone (the empty deck's door, once a card is in),
// to the Cards heading — never to <body>.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { FileText, LibraryBig, Pencil, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DeckCreatorForm } from "@/components/decks/deck-creator-form";
import { ImportDecklistDialog, type ImportMode } from "@/components/decks/import-decklist-dialog";
import { AddFromMyCardsDialog } from "@/components/decks/add-from-my-cards-dialog";
import { DeleteDeckDialog } from "@/components/decks/delete-deck-dialog";
import { DeckAiComingSoonButton, DeckAiPausedNote } from "@/components/decks/deck-ai-coming-soon";
import { DECK_CARDS_HEADING_ID } from "@/lib/decks/deck-view";
import { cn } from "@/lib/utils";
import type { Deck } from "@/types/deck";
import type { CardCapacity } from "@/lib/billing/capacity-copy";

/** What a page control can open: the details dialog, the import dialog in
 *  one of its modes, or "Add from my cards" (for the commander zone too). */
export type DeckTool = "details" | ImportMode | "my-cards" | "my-cards-commander";
const EVENT = "pipglyph:deck-tool";
/** The visible "AI deck building is paused" line the greyed tools point at. */
const PAUSED_NOTE_ID = "deck-ai-paused-note";

const IMPORT_MODES: ReadonlySet<string> = new Set<ImportMode>(["paste", "names", "commander"]);

type ToolDetail = { tool: DeckTool; opener: HTMLElement | null };

/** Opens one of the owner's dialogs from anywhere on the page; closing it
 *  returns the focus to `opener` (a click's own control — Safari doesn't
 *  focus a clicked button, so it is passed, never read from the document). */
export function openDeckTool(tool: DeckTool, opener: HTMLElement | null = null) {
  window.dispatchEvent(new CustomEvent<ToolDetail>(EVENT, { detail: { tool, opener } }));
}

/** The focus was handed back to `from`, and the refresh that follows the
 *  dialog's change may take `from` away (the empty deck's door once a card
 *  is in, the commander slot once there is one): the focus then goes to the
 *  Cards heading instead of <body>. Only while it is still on `from` — a
 *  focus the reader moved on is left alone — and for a few seconds. */
function keepFocusOnPage(from: HTMLElement) {
  const observer = new MutationObserver(() => {
    if (from.isConnected) return;
    stop();
    const active = document.activeElement;
    if (!active || active === document.body) document.getElementById(DECK_CARDS_HEADING_ID)?.focus();
  });
  const onMove = (event: FocusEvent) => {
    if (event.target !== from) stop();
  };
  const timer = window.setTimeout(() => stop(), 15_000);
  function stop() {
    observer.disconnect();
    document.removeEventListener("focusin", onMove);
    window.clearTimeout(timer);
  }
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("focusin", onMove);
}

/** A small pencil (or any child) that opens one of the owner dialogs. */
export function DeckToolButton({
  tool,
  label,
  className,
  children,
}: {
  tool: DeckTool;
  label: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => openDeckTool(tool, event.currentTarget)}
      className={cn(
        "inline-flex items-center gap-1 rounded-md text-subtle transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60",
        className,
      )}
    >
      {children ?? <Pencil className="h-4 w-4" aria-hidden />}
    </button>
  );
}

export function DeckOwnerTools({
  deck,
  userId,
  capacity = null,
  defaultCoverSrc = null,
  openImport = false,
}: {
  deck: Deck;
  userId: string;
  /** The default background the deck shows while it has no upload
   *  (deckCoverOf) — the cover field previews it. */
  defaultCoverSrc?: string | null;
  /** Saved-card slots: the import's forecast (D2 — customizing an imported
   *  card is what takes one). */
  capacity?: CardCapacity | null;
  openImport?: boolean;
}) {
  const [details, setDetails] = useState(false);
  const [importRequest, setImportRequest] = useState<{ nonce: number; mode: ImportMode } | null>(null);
  // The board is kept while the dialog closes, so its title doesn't change
  // on the way out.
  const [myCards, setMyCards] = useState<{ open: boolean; board: "main" | "commander" }>({ open: false, board: "main" });
  // The control that opened the dialog that is open now (null: its own
  // trigger, which Radix returns to by itself).
  const opener = useRef<HTMLElement | null>(null);
  const returnFocus = (event: Event) => {
    const from = opener.current;
    opener.current = null;
    if (!from) return;
    event.preventDefault();
    if (!from.isConnected) {
      document.getElementById(DECK_CARDS_HEADING_ID)?.focus();
      return;
    }
    from.focus();
    keepFocusOnPage(from);
  };
  const openFrom = (element: HTMLElement | null) => {
    opener.current = element;
  };

  useEffect(() => {
    const onTool = (event: Event) => {
      const detail = (event as CustomEvent<ToolDetail>).detail;
      const tool = detail?.tool;
      opener.current = detail?.opener ?? null;
      if (tool === "details") setDetails(true);
      else if (tool === "my-cards") setMyCards({ open: true, board: "main" });
      else if (tool === "my-cards-commander") setMyCards({ open: true, board: "commander" });
      else if (tool && IMPORT_MODES.has(tool)) {
        setImportRequest((prev) => ({ nonce: (prev?.nonce ?? 0) + 1, mode: tool as ImportMode }));
      }
    };
    window.addEventListener(EVENT, onTool);
    return () => window.removeEventListener(EVENT, onTool);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ImportDecklistDialog
        deckId={deck.id}
        defaultOpen={openImport}
        request={importRequest}
        onCloseAutoFocus={returnFocus}
        cardCapacity={capacity}
      />
      <Button
        type="button"
        variant="outline"
        onClick={(event) => {
          openFrom(event.currentTarget);
          setMyCards({ open: true, board: "main" });
        }}
      >
        <LibraryBig className="h-4 w-4" aria-hidden /> Add from my cards
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={(event) => {
          openFrom(event.currentTarget);
          setDetails(true);
        }}
      >
        <Pencil className="h-4 w-4" aria-hidden /> Edit details
      </Button>
      <DeleteDeckDialog deckId={deck.id} deckTitle={deck.title} triggerVariant="ghost" />
      {/* The greyed AI tools and the one line that says why, kept together
          on their own row (TODO DK1). */}
      <div className="flex basis-full flex-wrap items-center gap-2 2xl:basis-auto">
        <DeckAiComingSoonButton
          label="Add with AI"
          icon={<Sparkles className="h-4 w-4" aria-hidden />}
          describedBy={PAUSED_NOTE_ID}
        />
        <DeckAiComingSoonButton
          label="Restyle with AI"
          icon={<Wand2 className="h-4 w-4" aria-hidden />}
          describedBy={PAUSED_NOTE_ID}
        />
        <DeckAiPausedNote id={PAUSED_NOTE_ID} className="basis-full sm:basis-auto" />
      </div>

      <AddFromMyCardsDialog
        deckId={deck.id}
        open={myCards.open}
        board={myCards.board}
        onOpenChange={(next) => !next && setMyCards((prev) => ({ ...prev, open: false }))}
        onCloseAutoFocus={returnFocus}
      />

      <Dialog open={details} onOpenChange={(next) => !next && setDetails(false)}>
        <DialogContent size="lg" onCloseAutoFocus={returnFocus}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-accent" aria-hidden />
              Deck details
            </DialogTitle>
            <DialogDescription>Name, description, format, visibility and cover.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <DeckCreatorForm
              mode="edit"
              userId={userId}
              deck={deck}
              defaultCoverSrc={defaultCoverSrc}
              embedded
              onSaved={() => setDetails(false)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
