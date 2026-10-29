"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DeckMembershipPicker,
  DeckMembershipStatusLine,
  DeckQuickCreate,
} from "@/components/decks/deck-membership-picker";
import { useDeckMembership } from "@/components/decks/use-deck-membership";
import type { DeckCreateSurface } from "@/lib/decks/actions";

// ---------------------------------------------------------------------------
// "Add to deck…" for saved cards (TODO DK9.2 / DK9.4): the shared picker in
// a dialog, for one card (its board and copies too) or a My Cards
// selection. Every tick writes at once — there is no Save — and the dialog
// says what each did. Closing it after a change asks the page behind to read
// its chips again (`onChanged`).
//
// DeckMembershipPanel is the dialog's body on its own: the creator's box on
// an edit shows it inline (owner decision D13).
// ---------------------------------------------------------------------------

export type DeckMembership = ReturnType<typeof useDeckMembership>;

export function DeckMembershipPanel({
  membership,
  cardCount,
  surface,
  signInPath,
}: {
  membership: DeckMembership;
  cardCount: number;
  surface: DeckCreateSurface;
  /** Where "Sign in" comes back to, for a session that ended meanwhile. */
  signInPath?: string;
}) {
  if (membership.state === "loading") {
    return (
      <p className="flex items-center gap-2 text-xs text-muted" role="status">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Loading your decks…
      </p>
    );
  }
  if (membership.state === "error") {
    return (
      // Polite, never an alert: on the creator's edit a save's refusal is
      // the form's ONE alert (CLAUDE.md, the creator's fields).
      <p className="text-xs leading-5 text-danger" role="status">
        {membership.loadError?.message}{" "}
        {membership.loadError?.signedOut && signInPath ? (
          <Link
            href={`/login?redirectTo=${encodeURIComponent(signInPath)}`}
            className="font-semibold text-primary-bright underline-offset-2 hover:underline"
          >
            Sign in
          </Link>
        ) : null}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <DeckMembershipPicker
        decks={membership.decks}
        rows={membership.rows}
        cardCount={cardCount}
        pending={membership.pending}
        onToggle={(deckId, next) => void membership.toggle(deckId, next)}
        // A row's board and copies are one card's one entry.
        onEntryChange={
          cardCount === 1
            ? (deckId, entry, patch) => void membership.updateEntry(deckId, entry, patch)
            : undefined
        }
        emptyText="You have no decks yet — make one below."
        newDeck={
          <DeckQuickCreate
            surface={surface}
            onCreated={(deck) => membership.addCreatedDeck(deck)}
          />
        }
      />
      <DeckMembershipStatusLine status={membership.status} />
    </div>
  );
}

export function AddToDeckDialog({
  open,
  onOpenChange,
  cards,
  surface,
  onChanged,
  signInPath,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cards: ReadonlyArray<{ id: string; title: string }>;
  surface: DeckCreateSurface;
  /** The dialog closed after a write: the page behind reads again. */
  onChanged?: () => void;
  signInPath?: string;
}) {
  const membership = useDeckMembership(
    cards.map((card) => card.id),
    { enabled: open },
  );
  const single = cards.length === 1 ? cards[0]! : null;
  // What opened the dialog (a tile's chip, the bulk bar, the card page's
  // button) gets the focus back when it closes: Radix hands it to a
  // DialogTrigger, and these openers are plain buttons.
  const [opener] = useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null),
  );
  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next && membership.changed) onChanged?.();
  };
  // The decks arrive after the dialog opens: the focus waits on its title
  // (read first), then moves to the first deck — or "＋ New deck" when there
  // is none — once they are there. Never onto Done, the first control at
  // open (and never off a control the reader has moved to meanwhile).
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const ready = membership.state === "ready";
  useEffect(() => {
    if (!ready || document.activeElement !== titleRef.current) return;
    bodyRef.current?.querySelector<HTMLElement>('input[type="checkbox"], button')?.focus();
  }, [ready]);
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        size="md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (!opener?.isConnected || opener === document.body) return;
          event.preventDefault();
          opener.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle ref={titleRef} tabIndex={-1} className="focus-visible:outline-none">
            {single ? `Add “${single.title}” to a deck` : `Add ${cards.length} cards to a deck`}
          </DialogTitle>
          <DialogDescription>
            {single
              ? "Tick a deck to add the card, untick it to take the card out. Each change is saved at once."
              : "Tick a deck to add every selected card, untick it to take them out. New entries go on the main board, one copy each. Each change is saved at once."}
          </DialogDescription>
        </DialogHeader>
        <div ref={bodyRef} className="px-5 py-4">
          <DeckMembershipPanel
            membership={membership}
            cardCount={cards.length}
            surface={surface}
            signInPath={signInPath}
          />
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => close(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
