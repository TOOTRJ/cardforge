"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { NEW_DECK_PARAM } from "@/lib/decks/new-deck";

// ---------------------------------------------------------------------------
// A deck the New deck dialog just made, empty, opens as `/deck/<slug>?new=1`
// (TODO DK4.1): the page focuses its first way to add cards — the control
// this hook's ref is put on — and the flag leaves the address bar, so a
// reload or a shared link doesn't do it again.
//
// ONE router.replace, never a bare history.replaceState (on a hard load this
// effect runs before the app router's own, which would put the flag back),
// and a ref so StrictMode's second effect run doesn't send a second one: a
// navigation that pre-empts another loses a server action dispatched while
// it is pending (the import dialog's "Preview import" — the #664 fix in
// import-decklist-dialog.tsx).
// ---------------------------------------------------------------------------

export function useFocusAddOnNewDeck<T extends HTMLElement>() {
  const router = useRouter();
  const target = useRef<T | null>(null);
  const handled = useRef(false);
  const [, startClearing] = useTransition();
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
  return target;
}
