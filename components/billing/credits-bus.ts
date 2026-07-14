"use client";

import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Credits bus — a tiny window-event channel that keeps every mounted credit
// display in sync with the balance the server just reported. Generation is
// the only client flow that changes the balance mid-session (spends as steps
// complete, refunds as steps fail), and its runner lives in the ROOT layout
// while the meters live in dialogs/panels — so a broadcast beats threading
// state through half the tree.
//
// Publishers send the AUTHORITATIVE balance from a server response (never a
// client-side guess), except for the explicitly-optimistic projection the
// runner emits when a job starts; every subsequent step response overwrites
// it with the real number.
// ---------------------------------------------------------------------------

const CREDITS_EVENT = "pipglyph:credits-changed";

export function publishCredits(balance: number): void {
  if (typeof window === "undefined") return;
  if (!Number.isFinite(balance)) return;
  window.dispatchEvent(
    new CustomEvent<number>(CREDITS_EVENT, { detail: Math.max(0, balance) }),
  );
}

export function subscribeCredits(
  onChange: (balance: number) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<number>).detail;
    if (typeof detail === "number" && Number.isFinite(detail)) {
      onChange(detail);
    }
  };
  window.addEventListener(CREDITS_EVENT, handler);
  return () => window.removeEventListener(CREDITS_EVENT, handler);
}

/** The server-provided balance, kept live by bus broadcasts. Pass the value
 *  the surface rendered with (from /api/me or a server component). */
export function useLiveCredits(initial: number): number {
  const [balance, setBalance] = useState(initial);
  const [lastInitial, setLastInitial] = useState(initial);
  // A fresh server value (e.g. the auth island refetching /api/me) wins over
  // any older broadcast — adjust during render, not in an effect.
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setBalance(initial);
  }
  useEffect(() => subscribeCredits(setBalance), []);
  return balance;
}
