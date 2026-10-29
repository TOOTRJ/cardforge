"use client";

import { useEffect, useRef, useTransition, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { NEW_DECK_PARAM } from "@/lib/decks/new-deck-paths";

// ---------------------------------------------------------------------------
// A deck the New deck dialog just made, empty, opens as `/deck/<slug>?new=1`
// (TODO DK4.1): the page focuses its first way to add cards — the control
// this hook's ref is put on — and the flag leaves the address bar, so a
// reload or a shared link doesn't do it again.
//
// CLAUDE.md's rule for a navigation a component makes by itself: ONE
// router.replace (a ref — StrictMode runs effects twice), never a bare
// history.replaceState (on a hard load this effect runs before the app
// router's own, which would put the flag back), and `clearing` is true while
// it is on its way, so the control's server actions wait for it (the import
// dialog's Preview import: Next 16's router queue loses an action dispatched
// while a navigation that pre-empted another is pending).
// ---------------------------------------------------------------------------

export function useFocusAddOnNewDeck<T extends HTMLElement>(): {
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
    target.current?.focus();
    url.searchParams.delete(NEW_DECK_PARAM);
    startClearing(() => {
      router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on the mount that arrived
  }, []);
  return { target, clearing };
}
