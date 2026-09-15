"use client";

// ---------------------------------------------------------------------------
// DeckOwnerTools — everything the owner needs, on the deck page itself
// (there is no separate edit page any more):
//
//   Edit details   → dialog with the deck form (title, description, format,
//                    visibility, cover + focal point)
//   Import         → the decklist import dialog (auto-opens with ?import=1)
//   Add with AI    → dialog with the AI panel in add mode
//   Remix with AI  → dialog with the AI panel in remix mode
//   Delete         → the existing confirm dialog
//
// Pencil icons elsewhere on the page open the same dialogs by dispatching
// `pipglyph:deck-tool` with { tool } — see DeckToolButton below.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { FileText, Pencil, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DeckCreatorForm } from "@/components/decks/deck-creator-form";
import { ImportDecklistDialog } from "@/components/decks/import-decklist-dialog";
import { DeleteDeckDialog } from "@/components/decks/delete-deck-dialog";
import { AiDeckPanel } from "@/components/decks/ai-deck-panel";
import { cn } from "@/lib/utils";
import type { Deck } from "@/types/deck";

export type DeckTool = "details" | "add" | "remix";
const EVENT = "pipglyph:deck-tool";

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
      onClick={() => window.dispatchEvent(new CustomEvent(EVENT, { detail: { tool } }))}
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
  aiConfigured,
  maxCards,
  aiSeed,
  openImport = false,
}: {
  deck: Deck;
  userId: string;
  aiConfigured: boolean;
  maxCards: number;
  aiSeed: { theme: string | null; style: string | null } | null;
  openImport?: boolean;
}) {
  const [open, setOpen] = useState<DeckTool | null>(null);

  useEffect(() => {
    const onTool = (event: Event) => {
      const detail = (event as CustomEvent<{ tool: DeckTool }>).detail;
      if (detail?.tool) setOpen(detail.tool);
    };
    window.addEventListener(EVENT, onTool);
    return () => window.removeEventListener(EVENT, onTool);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" onClick={() => setOpen("details")}>
        <Pencil className="h-4 w-4" aria-hidden /> Edit details
      </Button>
      <ImportDecklistDialog deckId={deck.id} defaultOpen={openImport} />
      {aiConfigured ? (
        <>
          <Button type="button" variant="outline" onClick={() => setOpen("add")}>
            <Sparkles className="h-4 w-4" aria-hidden /> Add with AI
          </Button>
          <Button type="button" variant="outline" onClick={() => setOpen("remix")}>
            <Wand2 className="h-4 w-4" aria-hidden /> Remix with AI
          </Button>
        </>
      ) : null}
      <DeleteDeckDialog deckId={deck.id} deckTitle={deck.title} triggerVariant="ghost" />

      <Dialog open={open === "details"} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-accent" aria-hidden />
              Deck details
            </DialogTitle>
            <DialogDescription>Name, description, format, visibility and cover.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <DeckCreatorForm mode="edit" userId={userId} deck={deck} embedded onSaved={() => setOpen(null)} />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "add"} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" aria-hidden />
              Add cards with AI
            </DialogTitle>
            <DialogDescription>
              The AI reads what&apos;s already here and designs cards that fit — same colours, mechanics and art style.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <AiDeckPanel
              mode="add"
              aiConfigured={aiConfigured}
              maxCards={maxCards}
              deckId={deck.id}
              initialTheme={aiSeed?.theme}
              initialStyle={aiSeed?.style}
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "remix"} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-accent" aria-hidden />
              Remix this deck with AI
            </DialogTitle>
            <DialogDescription>
              A new public copy where every card keeps its rules but gets fresh AI names, art and a cover in your style.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <AiDeckPanel mode="remix" aiConfigured={aiConfigured} maxCards={maxCards} deckId={deck.id} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
