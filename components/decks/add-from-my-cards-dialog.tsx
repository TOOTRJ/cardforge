"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MyCardPicker } from "@/components/decks/deck-card-modal";
import { addMyCardToDeckAction } from "@/lib/decks/add-card-action";

// ---------------------------------------------------------------------------
// "Add from my cards" (TODO DK4.4) — the owner's own cards, newest first,
// with a filter; a pick adds that card ×1 (lib/decks/add-card-action.ts)
// and the dialog stays open for the next one. From the commander slot the
// pick becomes the deck's commander, and the dialog closes. A Radix dialog
// (focus trap, Escape, the focus back where it came from — DK5.12).
// Opened by DeckOwnerTools on the page's `pipglyph:deck-tool` event.
// ---------------------------------------------------------------------------

export function AddFromMyCardsDialog({
  deckId,
  open,
  board,
  onOpenChange,
  onCloseAutoFocus,
}: {
  deckId: string;
  open: boolean;
  /** "commander": the commander slot's pick. */
  board: "main" | "commander";
  onOpenChange: (open: boolean) => void;
  /** Where the focus goes on close (the dialog has no trigger of its own). */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Remount the picker on each open (a fresh list and an empty filter).
  const [opens, setOpens] = useState(0);
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setOpens((n) => n + 1);
  }

  const pick = (cardId: string) => {
    startTransition(async () => {
      const result = await addMyCardToDeckAction(deckId, cardId, board);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // A commander pick: the card is the commander now, new or moved from
      // the mainboard (else it already was, or sits on another board).
      if (board === "commander" && result.commander) {
        toast.success(`${result.title} is your commander.`);
        onOpenChange(false);
        router.refresh();
        return;
      }
      if (!result.added) {
        toast(`${result.title} is already in this deck.`);
        return;
      }
      toast.success(`Added ${result.title}.`);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{board === "commander" ? "Choose your commander" : "Add from my cards"}</DialogTitle>
          <DialogDescription>
            {board === "commander"
              ? "Pick one of your cards to lead this deck."
              : "Pick a card to add one copy — keep picking to add more."}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <MyCardPicker
            key={opens}
            onPick={pick}
            disabled={isPending}
            emptyText="You haven’t made any cards yet — start one in the creator, or add real cards by name."
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
