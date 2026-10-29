"use client";

import { useId, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Layers } from "lucide-react";
import {
  DeckChoice,
  DeckMembershipStatusLine,
  DeckQuickCreate,
} from "@/components/decks/deck-membership-picker";
import { DeckMembershipPanel } from "@/components/decks/add-to-deck-dialog";
import { useDeckMembership } from "@/components/decks/use-deck-membership";
import type { DeckOption } from "@/components/creator/panels/publish-panel";
import type { PickerDeck } from "@/lib/decks/membership-state";
import type { FormValues } from "@/lib/creator/form-types";
import type { DeckRemixContext } from "@/types/deck";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The creator's "Add to a deck" box (TODO DK9.3): under the live preview on
// every step — it used to be a select on the Publish step. Signed-in makers
// only (the guest creator never renders it), and never for an admin's frame
// preview (a test card never joins a deck).
//
//   new card / remix  ONE deck or none, the form's `deck_id`: the save
//                     carries it exactly as before (createCardAction adds a
//                     main-board entry ×1), so the save's payload is the one
//                     main has always sent — pinned by
//                     creator-face-tabs-payload.test.tsx and friends. Picking
//                     a deck marks the form dirty, as the Publish select did.
//   deck flow         /create?deckCard=… links the card into its own entry
//                     on save (#645: never a deck_id as well) — the box only
//                     says where saving goes.
//   edit              the card's decks, ticked: each change is written AT
//                     ONCE through the membership action (owner decision
//                     D13), apart from Save — the form is never touched, so
//                     an edit's payload can't change either.
// ---------------------------------------------------------------------------

type BoxProps = {
  mode: "create" | "edit" | "remix";
  /** The stored card (edit). */
  cardId?: string | null;
  myDecks: DeckOption[] | null;
  deckRemix: DeckRemixContext | null;
  className?: string;
};

export function CreatorDeckBox({ mode, cardId = null, myDecks, deckRemix, className }: BoxProps) {
  const headingId = useId();
  let body: React.ReactNode;
  if (deckRemix) {
    body = (
      <p className="text-xs leading-5 text-muted" data-testid="creator-deck-return">
        Saving returns you to <span className="font-medium text-foreground">&ldquo;{deckRemix.deckTitle}&rdquo;</span>.
      </p>
    );
  } else if (mode === "edit") {
    if (!cardId) return null;
    body = <EditDecks cardId={cardId} />;
  } else {
    // The create page always lists the maker's decks; without the list
    // there is nothing to offer.
    if (myDecks === null) return null;
    body = <NewCardDeck myDecks={myDecks} />;
  }
  return (
    <section
      aria-labelledby={headingId}
      data-testid="creator-deck-box"
      className={cn("flex flex-col gap-3 rounded-lg border border-border/60 bg-elevated/30 p-4", className)}
    >
      <h2
        id={headingId}
        className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-subtle"
      >
        <Layers className="h-3.5 w-3.5" aria-hidden />
        Add to a deck
      </h2>
      {body}
    </section>
  );
}

/** A new card (or a remix): one deck for the save's `deck_id`. */
function NewCardDeck({ myDecks }: { myDecks: DeckOption[] }) {
  const { control, setValue } = useFormContext<FormValues>();
  const deckId = useWatch({ control, name: "deck_id" }) ?? "";
  const noteId = useId();
  // A deck made here joins the list at once (the page's list is the
  // server's, read before it existed).
  const [created, setCreated] = useState<PickerDeck[]>([]);
  const [status, setStatus] = useState<{ tone: "success"; message: string } | null>(null);
  const decks: PickerDeck[] = [
    ...created.filter((deck) => !myDecks.some((own) => own.id === deck.id)),
    ...myDecks.map(({ id, title, format, slug }) => ({ id, title, format, slug })),
  ];
  return (
    <>
      <DeckChoice
        decks={decks}
        value={deckId}
        onChange={(next) => setValue("deck_id", next, { shouldDirty: true })}
        describedBy={noteId}
        label="Deck for this card"
        newDeck={
          <DeckQuickCreate
            surface="creator"
            onCreated={(deck) => {
              setCreated((prev) => [deck, ...prev]);
              setValue("deck_id", deck.id, { shouldDirty: true });
              setStatus({ tone: "success", message: `Made “${deck.title}” — the card goes in it when you save.` });
            }}
          />
        }
      />
      <p id={noteId} className="text-xs leading-5 text-muted">
        {decks.length === 0
          ? "You have no decks yet. Make one, and the card goes in it when you save."
          : "Added to the main deck, one copy, when you save."}
      </p>
      <DeckMembershipStatusLine status={status} />
    </>
  );
}

/** A stored card: its decks, each tick written at once (D13). */
function EditDecks({ cardId }: { cardId: string }) {
  const membership = useDeckMembership([cardId]);
  return (
    <>
      <p className="text-xs leading-5 text-muted">
        Changes here are saved at once — Save is for the card itself.
      </p>
      <DeckMembershipPanel membership={membership} cardCount={1} surface="creator" />
    </>
  );
}
