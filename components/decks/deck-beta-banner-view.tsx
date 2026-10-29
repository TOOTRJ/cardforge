"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MessageSquare, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeckFeedbackDialog } from "@/components/feedback/deck-feedback-dialog";
import { cn } from "@/lib/utils";
import { DECK_BETA_BANNER_ENDS_AT, DECK_BETA_BANNER_STORAGE_KEY } from "@/lib/decks/beta-banner";

// ---------------------------------------------------------------------------
// The deck builder's beta banner (TODO DK10.2), the browser half: its button
// opens the deck feedback dialog; its X hides it for this viewer
// (localStorage, every access in try/catch: blocked storage just shows it
// again next visit). Whether it is still LIVE is decided on the server
// (`DeckBetaBanner`, deck-beta-banner.tsx) — never a clock read here, which
// could disagree with the server's at the end date and mismatch hydration.
//
// The server (and hydration) snapshot is "not dismissed", as the updates
// ribbon's: the banner is in the HTML and never pops in late; a viewer who
// dismissed it sees it go right after hydration instead.
// ---------------------------------------------------------------------------

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(DECK_BETA_BANNER_STORAGE_KEY);
  } catch {
    return null;
  }
}

function subscribeStorage(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export type DeckBetaBannerProps = {
  /** The deck page's deck (the dialog attaches it); null on My Decks. */
  deckId?: string | null;
  signedIn: boolean;
  className?: string;
};

export function DeckBetaBannerView({ deckId = null, signedIn, className }: DeckBetaBannerProps) {
  const stored = useSyncExternalStore(subscribeStorage, readDismissed, () => null);
  const [dismissedNow, setDismissedNow] = useState(false);
  const leftRef = useRef<HTMLSpanElement>(null);

  // The X removes itself: the focus moves to the note left in its place, so
  // a keyboard carries on from here (never <body>) and hears it went.
  useEffect(() => {
    if (dismissedNow) leftRef.current?.focus();
  }, [dismissedNow]);

  if (dismissedNow) {
    return (
      <span ref={leftRef} tabIndex={-1} className="sr-only">
        Banner dismissed.
      </span>
    );
  }
  if (stored === DECK_BETA_BANNER_ENDS_AT) return null;

  const dismiss = () => {
    setDismissedNow(true);
    try {
      window.localStorage.setItem(DECK_BETA_BANNER_STORAGE_KEY, DECK_BETA_BANNER_ENDS_AT);
    } catch {
      // storage blocked — the banner just shows again next visit
    }
  };

  return (
    <section
      aria-label="Deck builder beta"
      className={cn(
        "relative flex flex-col gap-3 rounded-frame border border-gold/40 bg-gold/5 py-3 pl-4 pr-12 sm:flex-row sm:items-center sm:gap-4",
        className,
      )}
    >
      <p className="flex flex-wrap items-center gap-2 text-sm text-foreground">
        <Badge variant="gold" className="shrink-0">
          Beta
        </Badge>
        <span>New deck builder: tell us what’s missing.</span>
      </p>
      <DeckFeedbackDialog
        deckId={deckId}
        signedIn={signedIn}
        trigger={
          <Button type="button" variant="outline" size="sm" className="self-start sm:ml-auto sm:self-auto">
            <MessageSquare className="h-4 w-4" aria-hidden />
            Send feedback
          </Button>
        }
      />
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss the deck builder banner"
        className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full text-subtle transition-colors hover:bg-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 sm:top-1/2 sm:-translate-y-1/2"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </section>
  );
}
