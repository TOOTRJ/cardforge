"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { CardCreatorForm } from "@/components/creator/card-creator-form";
import type { CreatorHost, CreatorHostSaved } from "@/components/creator/creator-host";
import { DeckEditDrawerLoading, type DeckEditSharedCache } from "@/components/decks/deck-edit-drawer";
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
//
// A NEW card's save (a create, a remix, a customize) never leaves the form
// armed in create mode: until the card is read back as an edit of itself
// the drawer shows "Opening the saved card…", and if it can't be (its link
// into the entry failed, the read failed) it says so with the saved card's
// own link — a second Save would have made a second card.
//
// The page-wide props (decks, capacity, verified frames…) are read with the
// first open and kept for the visit (`sharedCache`, the drawer's); a new
// card's save reads them again (capacity, decks).
// ---------------------------------------------------------------------------

export type DeckEditDrawerBodyProps = {
  deckId: string;
  /** An entry id, or "new". */
  target: string;
  bindLeave: CreatorHost["bindLeave"];
  /** "Keep editing": the focus back inside the drawer. */
  focusHome: () => void;
  /** The form was swapped (a card read back after its save): the drawer
   *  checks the focus didn't fall out with it. */
  onSettled: () => void;
  sharedCache: DeckEditSharedCache;
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

/** After a NEW card's save: on its way back as an edit, or saved but not
 *  readable here (`away`: the form is gone, the card has its own link). */
type AfterCreate = { target: string; kind: "settling" } | { target: string; kind: "away"; slug: string; message: string };

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
  focusHome,
  onSettled,
  sharedCache,
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
  const [after, setAfter] = useState<AfterCreate | null>(null);
  const targetRef = useRef(target);
  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  // Each open reads the entry; the page-wide props only when the drawer
  // holds none yet (the first open of the visit, or after a new card).
  useEffect(() => {
    if (loaded?.target === target) return;
    const controller = new AbortController();
    const cached = sharedCache.get();
    readEditContext(deckId, target, { shared: !cached, signal: controller.signal })
      .then((body) => {
        if (controller.signal.aborted) return;
        const shared = body.shared ?? cached;
        if (!shared) throw new Error("The editor couldn't open. Try again, or open the full page.");
        if (body.shared) sharedCache.set(body.shared);
        setLoaded({ target, value: body.target, shared });
        // Walked back to an entry left mid-settle: it opens as it is now.
        setAfter((prev) => (prev && prev.target === target ? null : prev));
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError({ target, message: cause instanceof Error ? cause.message : "The editor couldn't open." });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a target already read (a new card's entry) is not read again
  }, [deckId, target]);

  const shown = loaded && loaded.target === target ? loaded : null;
  const afterShown = after && after.target === target ? after : null;

  // A form swapped for another (read back after its save) takes the focus
  // with it: the drawer puts it on its heading.
  const shownValue = shown?.value;
  useEffect(() => {
    if (shownValue) onSettled();
  }, [shownValue, onSettled]);

  // The latest callbacks, for the host the form keeps.
  const live = useRef({ onRequestClose, onCloseNow, onRetarget, shown });
  useEffect(() => {
    live.current = { onRequestClose, onCloseNow, onRetarget, shown };
  });

  const host = useMemo<CreatorHost>(
    () => ({
      bindLeave,
      focusHome,
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
        const created = saved.mode !== "edit";
        const awayFrom = (message: string) => setAfter({ target: at, kind: "away", slug: saved.slug, message });
        if (created) {
          // A new card: capacity and decks changed — read them again.
          sharedCache.set(null);
          // Never leave the create form armed: a second Save would make a
          // second card. Until it is read back as an edit, a loading state.
          setAfter({ target: at, kind: "settling" });
          if (current?.value.deckRemix && !saved.linked) {
            // Saved, but its link into the entry failed (the form said so):
            // the entry is still the old card, so the drawer can't show it.
            awayFrom("Your card is saved, but it couldn't be put into this deck's entry.");
            return;
          }
        }
        readEditContext(deckId, at, { card: madeNew ? saved.cardId : undefined, shared: created })
          .then((body) => {
            if (targetRef.current !== at || !current) return; // "Save & next" moved on
            if (body.shared) sharedCache.set(body.shared);
            const shared = body.shared ?? current.shared;
            if (madeNew) {
              if (!body.target.entryId) {
                // Saved with the deck box unticked: the card isn't this deck's.
                toast.message("Saved. The card isn't in this deck — find it in My Cards.");
                setAfter(null);
                live.current.onCloseNow();
                return;
              }
              setLoaded({ target: body.target.entryId, value: body.target, shared });
              setAfter(null);
              live.current.onRetarget(body.target.entryId);
              return;
            }
            if (created && (body.target.mode !== "edit" || body.target.card?.id !== saved.cardId)) {
              awayFrom("Your card is saved, but this entry doesn't show it.");
              return;
            }
            setLoaded({ target: at, value: body.target, shared });
            setAfter(null);
          })
          .catch(() => {
            if (targetRef.current !== at) return;
            // An edit keeps its form (a second Save updates the same card);
            // a new card's never stays armed.
            if (created) awayFrom("Your card is saved, but the editor couldn't open it again here.");
          });
      },
    }),
    [deckId, bindLeave, focusHome, sharedCache, wide, scrollRoot, saveAndNext],
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
  if (afterShown?.kind === "away") {
    return (
      <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center" data-deck-edit-saved-away="">
        <AlertTriangle className="h-6 w-6 text-gold-strong" aria-hidden />
        <p className="text-sm text-foreground">{afterShown.message}</p>
        <p className="text-xs text-muted">Open it on its own page to keep working on it, or go back to the deck.</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCloseNow}>
            Back to the deck
          </Button>
          <Button asChild size="sm">
            <Link href={`/card/${encodeURIComponent(afterShown.slug)}/edit`}>
              Open the saved card
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </Button>
        </div>
      </div>
    );
  }
  if (!shown || afterShown?.kind === "settling") return <DeckEditDrawerLoading />;

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
