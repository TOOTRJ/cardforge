"use client";

// ---------------------------------------------------------------------------
// DeckOwnerTools — everything the owner needs, on the deck page itself
// (there is no separate edit page any more):
//
//   Edit details   → dialog with the deck form (title, description, format,
//                    visibility, cover + focal point)
//   Import         → the decklist import dialog (auto-opens with ?import=1)
//   Add with AI    → "Coming soon" while deck AI is paused (TODO DK1,
//   Remix with AI     lib/ai/deck-ai-pause.ts): greyed, no dialog
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
import { DeckAiComingSoonButton } from "@/components/decks/deck-ai-coming-soon";
import { cn } from "@/lib/utils";
import type { Deck } from "@/types/deck";
import type { CardCapacity } from "@/lib/billing/capacity-copy";

export type DeckTool = "details";
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
  openImport = false,
}: {
  deck: Deck;
  userId: string;
  // The deck AI's inputs (the AI panel's, before the pause). Still passed by
  // the deck page and unread while deck AI is paused (TODO DK1).
  aiConfigured: boolean;
  maxCards: number;
  capacity: CardCapacity | null;
  remixableCount: number;
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
      <DeckAiComingSoonButton label="Add with AI" icon={<Sparkles className="h-4 w-4" aria-hidden />} />
      <DeckAiComingSoonButton label="Remix with AI" icon={<Wand2 className="h-4 w-4" aria-hidden />} />
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
    </div>
  );
}
