"use client";

import { useEffect, useRef, useTransition, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { NEW_DECK_PARAM } from "@/lib/decks/new-deck-paths";

// ---------------------------------------------------------------------------
// A deck the New deck dialog just made, empty, opens as `/deck/<slug>?new=1`
// (TODO DK4.1): the page focuses its first way to add cards and the flag
// leaves the address bar, so a reload or a shared link doesn't do it again.
//
// The first way to add cards: the element `prefer` names when the page drew
// one (the empty deck's "Paste a decklist" door, DeckStartDoors — the
// owner's empty deck shows its three doors), else the control this hook's
// `target` ref is put on (the owner bar's Import decklist).
//
// CLAUDE.md's rule for a navigation a component makes by itself: ONE
// router.replace (a ref — StrictMode runs effects twice), never a bare
// history.replaceState (on a hard load this effect runs before the app
// router's own, which would put the flag back), and `clearing` is true while
// it is on its way, so the server actions beside it wait for it (the import
// dialog's Preview import: Next 16's router queue loses an action dispatched
// while a navigation that pre-empted another is pending).
// ---------------------------------------------------------------------------

/** The attribute the empty deck's first door carries, for `prefer`. */
export const NEW_DECK_FIRST_ADD_ATTRIBUTE = "data-new-deck-first-add";
export const NEW_DECK_FIRST_ADD = `[${NEW_DECK_FIRST_ADD_ATTRIBUTE}]`;

export function useFocusAddOnNewDeck<T extends HTMLElement>(
  prefer?: string,
): {
  target: RefObject<T | null>;
  clearing: boolean;
} {
  const router = useRouter();
  const target = useRef<T | null>(null);
  const handled = useRef(false);
  const [clearing, startClearing] = useTransition();
  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const url = new URL(window.location.href);
    if (url.searchParams.get(NEW_DECK_PARAM) !== "1") return;
    const preferred = prefer ? document.querySelector<HTMLElement>(prefer) : null;
    (preferred ?? target.current)?.focus();
    url.searchParams.delete(NEW_DECK_PARAM);
    startClearing(() => {
      router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on the mount that arrived
  }, []);
  return { target, clearing };
}
