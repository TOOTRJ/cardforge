"use client";

import { useEffect, useMemo, useState } from "react";
import {
  changeDeckMembershipAction,
  getDeckPickerDataAction,
} from "@/lib/decks/membership-actions";
import { updateDeckCardAction } from "@/lib/decks/card-actions";
import {
  MAX_MEMBERSHIP_BATCH,
  deckShowsPrivateCards,
  describeMembershipResults,
  type MembershipCardResult,
} from "@/lib/decks/membership-copy";
import {
  deckRowStates,
  withMembershipChange,
  type DeckMembershipEntry,
  type DeckMemberships,
  type PickerDeck,
} from "@/lib/decks/membership-state";
import type { DeckEntryPatch } from "@/components/decks/deck-membership-picker";

// ---------------------------------------------------------------------------
// The picker's data and writes for saved cards (TODO DK9): read when it opens
// (getDeckPickerDataAction — the owner's decks, and which of them hold
// these cards), then every tick is a write of its own
// (changeDeckMembershipAction, in calls of MAX_MEMBERSHIP_BATCH) and every
// board / count change one entry's (updateDeckCardAction). What happened is
// ONE polite status line (`status`), never a toast as well.
//
// Used by My Cards and the gallery (AddToDeckDialog) and by the creator's
// box on an edit (owner decision D13: it acts right away, apart from Save —
// and never touches the form).
// ---------------------------------------------------------------------------

export type DeckMembershipStatus = { tone: "success" | "error" | "info"; message: string };

/** The caller's own private cards a tick asked into a deck others can open
 *  (TODO DK0.13): nothing of them was written — the picker asks "Make it
 *  public" / "Add as private" (PrivateCardOfferDialog). */
export type PrivateCardOffer = {
  deck: PickerDeck;
  cards: Array<{ cardId: string; blockedReason?: string }>;
};

/** The maker's answer: publish then add, add as private, or neither. */
export type PrivateCardChoice = "publish" | "keep" | "cancel";

type Loaded = { decks: PickerDeck[]; memberships: DeckMemberships };

/** Everything known for ONE set of cards (`key`): an answer for cards no
 *  longer asked about is never shown. */
type Snapshot = {
  key: string;
  loaded: Loaded | null;
  error: { message: string; signedOut: boolean } | null;
  status: DeckMembershipStatus | null;
};

const NETWORK_ERROR = "Couldn't reach the server. Try again.";

export function useDeckMembership(cardIds: readonly string[], { enabled = true }: { enabled?: boolean } = {}) {
  const key = cardIds.join(",");
  const ids = useMemo(() => (key ? key.split(",") : []), [key]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  // Something was written: a list behind the picker (My Cards' chips) is
  // out of date until it is read again.
  const [changed, setChanged] = useState(false);
  const [offer, setOffer] = useState<(PrivateCardOffer & { key: string }) | null>(null);

  useEffect(() => {
    if (!enabled || !key) return;
    let live = true;
    const settle = (next: Omit<Snapshot, "key" | "status">) => {
      if (live) setSnapshot({ key, status: null, ...next });
    };
    getDeckPickerDataAction(key.split(","))
      .then((result) =>
        settle(
          result.ok
            ? { loaded: { decks: result.decks, memberships: result.memberships }, error: null }
            : { loaded: null, error: { message: result.error, signedOut: Boolean(result.signedOut) } },
        ),
      )
      .catch(() => settle({ loaded: null, error: { message: "Couldn't read your decks.", signedOut: false } }));
    return () => {
      live = false;
    };
  }, [enabled, key]);

  const current = snapshot?.key === key ? snapshot : null;
  const loaded = current?.loaded ?? null;
  const rows = useMemo(() => (loaded ? deckRowStates(loaded.decks, loaded.memberships, ids) : {}), [loaded, ids]);

  /** A change to the snapshot of THESE cards (dropped if they changed). */
  const update = (askedFor: string, change: (prev: Snapshot) => Snapshot) =>
    setSnapshot((prev) => (prev && prev.key === askedFor ? change(prev) : prev));
  const setBusy = (deckId: string, busy: boolean) =>
    setPending((prev) => {
      const next = new Set(prev);
      if (busy) next.add(deckId);
      else next.delete(deckId);
      return next;
    });

  /** `cards` into (or out of) `deck`, in calls of MAX_MEMBERSHIP_BATCH; the
   *  memberships follow each answer. An add into a deck others can open
   *  ASKS about the caller's private cards (the server decides which they
   *  are) unless `choice` answers it: "publish" makes `publish` public
   *  first, "keep" adds them as they are. */
  const write = async (
    deck: PickerDeck,
    cards: readonly string[],
    adding: boolean,
    choice?: { publish: readonly string[] } | "keep",
  ) => {
    const askedFor = key;
    setBusy(deck.id, true);
    const results: MembershipCardResult[] = [];
    let error: string | null = null;
    // The deck's visibility as the picker read it: a private deck never
    // asks (the server checks the deck's own row all the same).
    const ask = adding && choice === undefined && deckShowsPrivateCards(deck.visibility);
    for (let i = 0; i < cards.length; i += MAX_MEMBERSHIP_BATCH) {
      const chunk = cards.slice(i, i + MAX_MEMBERSHIP_BATCH);
      let result: Awaited<ReturnType<typeof changeDeckMembershipAction>>;
      try {
        const publish =
          choice && choice !== "keep"
            ? chunk.filter((cardId) => choice.publish.some((id) => id.toLowerCase() === cardId.toLowerCase()))
            : [];
        result = await changeDeckMembershipAction(
          !adding
            ? { deckId: deck.id, remove: chunk }
            : ask
              ? { deckId: deck.id, add: chunk, privateCards: "ask" }
              : publish.length > 0
                ? { deckId: deck.id, add: chunk, publish }
                : { deckId: deck.id, add: chunk },
        );
      } catch {
        result = { ok: false, error: NETWORK_ERROR };
      }
      if (!result.ok) {
        error = result.error;
        break;
      }
      results.push(...result.results);
      const { entries } = result;
      const removedCardIds = result.results.filter((r) => r.status === "removed").map((r) => r.cardId);
      update(askedFor, (prev) =>
        prev.loaded
          ? {
              ...prev,
              loaded: {
                ...prev.loaded,
                memberships: withMembershipChange(prev.loaded.memberships, deck.id, {
                  readCardIds: adding ? chunk : [],
                  entries,
                  removedCardIds,
                }),
              },
            }
          : prev,
      );
      // The deck is full: the rest would only be refused one by one.
      if (result.results.some((r) => r.status === "deck_full")) break;
    }
    setBusy(deck.id, false);
    if (results.some((r) => r.status === "added" || r.status === "removed" || r.published)) setChanged(true);
    const asked = results.filter((r) => r.status === "private_card");
    const said = results.filter((r) => r.status !== "private_card");
    if (asked.length > 0) {
      setOffer({
        key: askedFor,
        deck,
        cards: asked.map((r) => ({ cardId: r.cardId, ...(r.blockedReason ? { blockedReason: r.blockedReason } : {}) })),
      });
    }
    // What the rest did; the asked cards wait on the offer (said nothing
    // yet — never "not added" while the question is open).
    const status = error
      ? { tone: "error" as const, message: error }
      : said.length > 0
        ? describeMembershipResults(said, deck.title, adding)
        : null;
    update(askedFor, (prev) => ({ ...prev, status: status ?? (asked.length > 0 ? null : prev.status) }));
  };

  /** The maker's answer to the private-card offer. */
  const resolveOffer = async (choice: PrivateCardChoice) => {
    const current = offer;
    setOffer(null);
    if (!current || current.key !== key) return;
    const ids = current.cards.map((card) => card.cardId);
    if (choice === "cancel") {
      update(current.key, (prev) => ({
        ...prev,
        status: { tone: "info", message: ids.length === 1 ? "Not added." : `${ids.length} cards not added.` },
      }));
      return;
    }
    await write(
      current.deck,
      ids,
      true,
      choice === "keep"
        ? "keep"
        : { publish: current.cards.filter((card) => !card.blockedReason).map((card) => card.cardId) },
    );
  };

  /** Tick (add every card not in it yet) or untick (remove every card in it). */
  const toggle = async (deckId: string, next: boolean) => {
    const deck = loaded?.decks.find((d) => d.id === deckId);
    if (!loaded || !deck) return;
    const inDeck = (cardId: string) => (loaded.memberships[cardId] ?? []).some((e) => e.deckId === deckId);
    const cards = ids.filter((cardId) => (next ? !inDeck(cardId) : inDeck(cardId)));
    if (cards.length > 0) await write(deck, cards, next);
  };

  /** One entry's board or count (a one-card picker's row). */
  const updateEntry = async (deckId: string, entry: DeckMembershipEntry, patch: DeckEntryPatch) => {
    const askedFor = key;
    const deck = loaded?.decks.find((d) => d.id === deckId);
    setBusy(deckId, true);
    let result: Awaited<ReturnType<typeof updateDeckCardAction>>;
    try {
      result = await updateDeckCardAction(entry.entryId, patch);
    } catch {
      result = { ok: false, error: NETWORK_ERROR };
    }
    setBusy(deckId, false);
    if (!result.ok) {
      const message = result.error;
      update(askedFor, (prev) => ({ ...prev, status: { tone: "error", message } }));
      return;
    }
    setChanged(true);
    update(askedFor, (prev) => {
      if (!prev.loaded) return prev;
      const memberships: DeckMemberships = {};
      for (const [cardId, entries] of Object.entries(prev.loaded.memberships)) {
        memberships[cardId] = entries.map((e) => (e.entryId === entry.entryId ? { ...e, ...patch } : e));
      }
      return {
        ...prev,
        loaded: { ...prev.loaded, memberships },
        status: { tone: "success", message: `Saved in “${deck?.title ?? "the deck"}”.` },
      };
    });
  };

  /** A deck made from the picker: listed first, and every card goes in. */
  const addCreatedDeck = async (deck: PickerDeck) => {
    update(key, (prev) =>
      prev.loaded && !prev.loaded.decks.some((d) => d.id === deck.id)
        ? { ...prev, loaded: { ...prev.loaded, decks: [deck, ...prev.loaded.decks] } }
        : prev,
    );
    setChanged(true);
    await write(deck, ids, true);
  };

  return {
    state: current?.error ? ("error" as const) : loaded ? ("ready" as const) : ("loading" as const),
    loadError: current?.error ?? null,
    decks: loaded?.decks ?? [],
    memberships: loaded?.memberships ?? {},
    rows,
    pending,
    status: current?.status ?? null,
    changed,
    /** The private-card question waiting on the maker (TODO DK0.13). */
    offer: offer && offer.key === key ? { deck: offer.deck, cards: offer.cards } : null,
    resolveOffer,
    toggle,
    updateEntry,
    addCreatedDeck,
  };
}
