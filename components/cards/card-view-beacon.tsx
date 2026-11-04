"use client";

import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// The card page's view ping (TODO CP4): ONE POST to /api/cards/[id]/view
// when the page shows a card — not on a re-render (a like, a comment, a
// router refresh keep this mounted), and once even under StrictMode's double
// effect. The server decides whether it counts (lib/cards/views.ts). Draws
// nothing.
// ---------------------------------------------------------------------------

export function CardViewBeacon({ cardId }: { cardId: string }) {
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (sent.current === cardId) return;
    sent.current = cardId;
    const url = `/api/cards/${cardId}/view`;
    try {
      if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url)) return;
      void fetch(url, { method: "POST", keepalive: true, credentials: "same-origin" }).catch(() => {});
    } catch {
      // best-effort
    }
  }, [cardId]);
  return null;
}
