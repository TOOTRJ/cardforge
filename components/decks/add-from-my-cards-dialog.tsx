"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MyCardPicker } from "@/components/decks/deck-card-modal";
import { updateDeckCardAction } from "@/lib/decks/card-actions";
import { changeDeckMembershipAction } from "@/lib/decks/membership-actions";

// ---------------------------------------------------------------------------
// "Add from my cards" (TODO DK4.4) — the owner's own cards, newest first,
// with a filter; a pick adds that card ×1 through the ONE membership writer
// (changeDeckMembershipAction, lib/decks/membership-actions.ts: the RPC,
// the D3 and frame-preview refusals, the full deck in words, one
// revalidation) and the dialog stays open for the next one. From the
// commander slot the pick becomes the deck's commander — its mainboard
// entry, new or already there, moves to the zone (updateDeckCardAction) —
// and the dialog closes. A Radix dialog (focus trap, Escape, the focus back
// where it came from — DK5.12). Opened by DeckOwnerTools on the page's
// `pipglyph:deck-tool` event. The picker lists the 200 most recently
// edited cards; the DK5.2 add box (one search) replaces it.
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

  const pick = (cardId: string, title: string) => {
    startTransition(async () => {
      const result = await changeDeckMembershipAction({ deckId, add: [cardId] });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const same = (id: string) => id.toLowerCase() === cardId.toLowerCase();
      const outcome = result.results.find((row) => same(row.cardId));
      if (!outcome || (outcome.status !== "added" && outcome.status !== "already")) {
        toast.error(outcome?.error ?? `Couldn't add ${title}.`);
        return;
      }

      if (board === "commander") {
        // Its mainboard entry — just added, or already there — moves to the
        // commander zone. A card that already is the commander stays; one
        // only on another board is left where the owner put it.
        const entries = result.entries.filter((entry) => same(entry.cardId));
        const onMain = entries.find((entry) => entry.board === "main");
        if (onMain) {
          const moved = await updateDeckCardAction(onMain.entryId, { board: "commander" });
          if (!moved.ok) {
            toast.error(`Couldn't make ${title} the commander: ${moved.error}`);
            router.refresh();
            return;
          }
        }
        if (onMain || entries.some((entry) => entry.board === "commander")) {
          toast.success(`${title} is your commander.`);
          onOpenChange(false);
          router.refresh();
          return;
        }
      }

      if (outcome.status === "already") {
        toast(`${title} is already in this deck.`);
        return;
      }
      toast.success(`Added ${title}.`);
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
