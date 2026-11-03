"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { CardCreatorForm } from "@/components/creator/card-creator-form";
import type { CreatorHost, CreatorHostSaved } from "@/components/creator/creator-host";
import { DeckEditDrawerLoading } from "@/components/decks/deck-edit-drawer";
import { Button } from "@/components/ui/button";
import { revalidateDeckAfterInlineSaveAction } from "@/lib/decks/inline-editor-actions";
import {
  DECK_EDIT_NEW,
  type DeckEditContextResponse,
  type DeckEditShared,
  type DeckEditTarget,
} from "@/lib/decks/inline-editor-shared";

// ---------------------------------------------------------------------------
// The deck's edit drawer, its BODY (TODO DK5.18): the chunk that holds the
// card creator — loaded on the drawer's first open (and fetched ahead on an
// Edit's hover or focus), never with the deck page. It reads what the entry
// opens on from GET /api/decks/<id>/edit-context (the owner's deck, the
// switch on) and mounts the SAME CardCreatorForm /create and /card/…/edit
// mount, with the props those pages pass for that mode, plus the host seam
// (components/creator/creator-host.ts). After a save it stays on the card:
// the deck is revalidated (its rows come back with the action's answer) and
// the card is read again — an edit's keyed reset, a remix or a customize
// turning into an edit of the new card, a new card into its entry.
// ---------------------------------------------------------------------------

export type DeckEditDrawerBodyProps = {
  deckId: string;
  /** An entry id, or "new". */
  target: string;
  bindLeave: CreatorHost["bindLeave"];
  scrollRoot: HTMLElement | null;
  wide: boolean | null;
  saveAndNext: CreatorHost["saveAndNext"];
  fullPageHref: string;
  /** Close, asking first with changes (the creator's own leave dialog). */
  onRequestClose: () => void;
  /** Close now — nothing to ask (a delete, a card that left the deck). */
  onCloseNow: () => void;
  /** A new card was saved into the deck: the drawer is on its entry now. */
  onRetarget: (entryId: string) => void;
};

type Loaded = { target: string; value: DeckEditTarget; shared: DeckEditShared };

async function readEditContext(
  deckId: string,
  target: string,
  options: { card?: string; shared: boolean; signal?: AbortSignal },
): Promise<{ target: DeckEditTarget; shared?: DeckEditShared }> {
  const params = new URLSearchParams({ edit: target });
  if (options.card) params.set("card", options.card);
  if (options.shared) params.set("shared", "1");
  const response = await fetch(`/api/decks/${encodeURIComponent(deckId)}/edit-context?${params.toString()}`, {
    signal: options.signal,
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  const body = (await response.json().catch(() => null)) as DeckEditContextResponse | null;
  if (!body) throw new Error("The editor couldn't open. Try again, or open the full page.");
  if (!body.ok) throw new Error(body.error);
  return body;
}

export default function DeckEditDrawerBody({
  deckId,
  target,
  bindLeave,
  scrollRoot,
  wide,
  saveAndNext,
  fullPageHref,
  onRequestClose,
  onCloseNow,
  onRetarget,
}: DeckEditDrawerBodyProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<{ target: string; message: string } | null>(null);
  const targetRef = useRef(target);
  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  // Each open reads the entry AND the page-wide props (decks, capacity,
  // verified frames…): as fresh as the full page's, every time.
  useEffect(() => {
    if (loaded?.target === target) return;
    const controller = new AbortController();
    readEditContext(deckId, target, { shared: true, signal: controller.signal })
      .then((body) => {
        if (controller.signal.aborted || !body.shared) return;
        setLoaded({ target, value: body.target, shared: body.shared });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError({ target, message: cause instanceof Error ? cause.message : "The editor couldn't open." });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a target already read (a new card's entry) is not read again
  }, [deckId, target]);

  const shown = loaded && loaded.target === target ? loaded : null;

  // The latest callbacks, for the host the form keeps.
  const live = useRef({ onRequestClose, onCloseNow, onRetarget, shown });
  useEffect(() => {
    live.current = { onRequestClose, onCloseNow, onRetarget, shown };
  });

  const host = useMemo<CreatorHost>(
    () => ({
      bindLeave,
      wide,
      scrollRoot,
      saveAndNext,
      onCancel: () => live.current.onRequestClose(),
      onDeleted: () => {
        void revalidateDeckAfterInlineSaveAction(deckId).catch(() => undefined);
        live.current.onCloseNow();
      },
      onSaved: (saved: CreatorHostSaved) => {
        const at = targetRef.current;
        const current = live.current.shown;
        // The deck's rows come back with this action's answer.
        void revalidateDeckAfterInlineSaveAction(deckId).catch(() => undefined);
        const madeNew = at === DECK_EDIT_NEW;
        readEditContext(deckId, at, { card: madeNew ? saved.cardId : undefined, shared: false })
          .then((body) => {
            if (targetRef.current !== at || !current) return; // "Save & next" moved on
            if (madeNew) {
              if (!body.target.entryId) {
                // Saved with the deck box unticked: the card isn't this deck's.
                toast.message("Saved. The card isn't in this deck — find it in My Cards.");
                live.current.onCloseNow();
                return;
              }
              setLoaded({ target: body.target.entryId, value: body.target, shared: current.shared });
              live.current.onRetarget(body.target.entryId);
              return;
            }
            setLoaded({ target: at, value: body.target, shared: current.shared });
          })
          .catch(() => undefined); // The form keeps the saved card; the rows refresh anyway.
      },
    }),
    [deckId, bindLeave, wide, scrollRoot, saveAndNext],
  );

  if (error && error.target === target) {
    return (
      <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
        <AlertTriangle className="h-6 w-6 text-gold-strong" aria-hidden />
        <p className="text-sm text-foreground">{error.message}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onRequestClose}>
            Back to the deck
          </Button>
          <Button asChild size="sm">
            <Link href={fullPageHref}>
              Open full page
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </Button>
        </div>
      </div>
    );
  }
  if (!shown) return <DeckEditDrawerLoading />;

  const { value, shared } = shown;
  const common = {
    userId: shared.userId,
    ownerUsername: shared.ownerUsername,
    gameSystems: shared.gameSystems,
    canDesignForDeck: shared.canDesignForDeck,
    aiConfigured: shared.aiConfigured,
    pipOverrides: shared.pipOverrides,
    verifiedFrameKeys: shared.verifiedFrameKeys,
    profileOverrides: shared.profileOverrides,
    activeChallenge: shared.activeChallenge,
    isPaid: shared.isPaid,
    defaultFooterText: shared.defaultFooterText,
    host,
  };
  if (value.mode === "edit" && value.card) {
    // As /card/…/edit mounts it: the AI's decks, no deck box list.
    return <CardCreatorForm key={`edit:${value.card.id}`} mode="edit" card={value.card} aiDecks={shared.myDecks} {...common} />;
  }
  // As /create mounts it: a remix, a deck entry's proxy or a new card.
  return (
    <CardCreatorForm
      key={`${value.mode}:${value.entryId ?? "new"}:${value.card?.id ?? ""}`}
      mode={value.mode === "remix" ? "remix" : "create"}
      card={value.mode === "remix" ? value.card : null}
      myDecks={shared.myDecks}
      deckRemix={value.deckRemix}
      initialDeckId={value.initialDeckId}
      capacity={shared.capacity}
      defaultArtistCredit={shared.defaultArtistCredit}
      {...common}
    />
  );
}
