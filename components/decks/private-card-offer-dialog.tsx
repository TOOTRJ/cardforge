"use client";

import { useRef } from "react";
import { Globe, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { privateCardsOffer } from "@/lib/decks/membership-copy";

// ---------------------------------------------------------------------------
// "This card is private" (TODO DK0.13, owner 2026-10-29): one of the maker's
// PRIVATE cards was asked into a deck others can open (public or unlisted),
// where visitors would see a "Private card" tile in its place (D11). Two
// answers:
//   Make it public  the site's own visibility change, with every gate it has
//                   (the server does it: changeDeckMembershipAction's
//                   `publish`), then the add;
//   Add as private  today's behaviour.
// A card its text keeps private (owner policy 2026-10-28) shows the reason
// instead of "Make it public" — Add as private stays. Escape, the corner X
// and a click outside are Cancel: nothing is added.
//
// The opener (a deck's checkbox, the add box's button) gets the focus back
// on close — Radix would hand it to a DialogTrigger, and these openers are
// not one. Every add path shows THIS dialog: the shared picker
// (DeckMembershipPanel — My Cards, the gallery and card page, the creator's
// box on an edit) and the deck page's add box.
// ---------------------------------------------------------------------------

export type PrivateOfferCard = {
  cardId: string;
  /** Shown in a list of several; the one card's name in the title. */
  title?: string | null;
  /** Why it can't be made public (its text). */
  blockedReason?: string;
};

export function PrivateCardOfferDialog({
  open,
  deckTitle,
  cards,
  onChoose,
  fallbackFocus,
}: {
  open: boolean;
  deckTitle: string;
  cards: readonly PrivateOfferCard[];
  onChoose: (choice: "publish" | "keep" | "cancel") => void;
  /** Where the focus goes when the opener is gone (a results list that
   *  closed): never <body>. */
  fallbackFocus?: () => HTMLElement | null;
}) {
  const openerRef = useRef<HTMLElement | null>(null);
  const firstActionRef = useRef<HTMLButtonElement | null>(null);
  const single = cards.length === 1 ? cards[0]! : null;
  const blocked = cards.filter((card) => card.blockedReason);
  const publishable = cards.length - blocked.length;
  const named = (card: PrivateOfferCard) => (card.title?.trim() ? `“${card.title.trim()}”` : "This card");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onChoose("cancel");
      }}
    >
      <DialogContent
        size="sm"
        data-testid="private-card-offer"
        onOpenAutoFocus={(event) => {
          // Radix has not moved the focus yet: what holds it opened us.
          const active = document.activeElement;
          openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
          event.preventDefault();
          firstActionRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          const saved = openerRef.current;
          openerRef.current = null;
          const opener = saved?.isConnected ? saved : (fallbackFocus?.() ?? null);
          if (!opener?.isConnected) return;
          event.preventDefault();
          opener.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6">
            <Lock className="h-4 w-4 shrink-0 text-gold" aria-hidden />
            {single
              ? single.title?.trim()
                ? `Add “${single.title.trim()}” to “${deckTitle}”?`
                : `Add a private card to “${deckTitle}”?`
              : `Add ${cards.length} private cards to “${deckTitle}”?`}
          </DialogTitle>
          <DialogDescription className="text-sm leading-6">{privateCardsOffer(cards.length)}</DialogDescription>
        </DialogHeader>
        {blocked.length > 0 ? (
          <div className="flex flex-col gap-2 px-5 py-4" data-testid="private-card-offer-reasons">
            {single ? (
              <p className="text-sm leading-6 text-foreground">{single.blockedReason}</p>
            ) : (
              <>
                <p className="text-sm leading-6 text-foreground">
                  {blocked.length === 1 ? "One stays private:" : `${blocked.length} stay private:`}
                </p>
                <ul className="flex flex-col gap-1.5 text-sm leading-6 text-muted">
                  {blocked.map((card) => (
                    <li key={card.cardId}>
                      <span className="font-medium text-foreground">{named(card)}</span> — {card.blockedReason}
                    </li>
                  ))}
                </ul>
                {publishable > 0 ? (
                  <p className="text-xs leading-5 text-muted">
                    “Make {publishable === 1 ? "1" : publishable} public” adds {blocked.length === 1 ? "it" : "them"} as
                    private.
                  </p>
                ) : null}
              </>
            )}
          </div>
        ) : null}
        <DialogFooter>
          <Button
            ref={publishable === 0 ? firstActionRef : undefined}
            type="button"
            variant={publishable === 0 ? "primary" : "outline"}
            onClick={() => onChoose("keep")}
          >
            <Lock className="h-3.5 w-3.5" aria-hidden />
            Add as private
          </Button>
          {publishable > 0 ? (
            <Button ref={firstActionRef} type="button" onClick={() => onChoose("publish")}>
              <Globe className="h-3.5 w-3.5" aria-hidden />
              {single ? "Make it public" : publishable === cards.length ? "Make them public" : `Make ${publishable} public`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
