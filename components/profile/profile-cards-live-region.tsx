"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// The profile's card results, announced. The results render inside a
// Suspense boundary KEYED on the filters, so a live region in there is a NEW
// element on every search — and a screen reader announces changes to a
// live region it already knows, never one that arrives with its text. So
// the region lives HERE, outside that boundary, mounted once with the
// section; the results hand it their line (`AnnounceProfileCards`) each
// time they mount, with the filters they answer. The page as it loaded is
// not announced (nor a re-run of the same filters — StrictMode's double
// effect); a repeated line for NEW filters ("3 cards match" twice) is.
// ---------------------------------------------------------------------------

const AnnounceContext = createContext<(text: string, filterKey: string) => void>(() => {});

export function ProfileCardsLiveRegion({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState({ text: "", n: 0 });
  const lastKey = useRef<string | null>(null);
  const announce = useCallback((text: string, filterKey: string) => {
    const first = lastKey.current === null;
    if (filterKey === lastKey.current) return;
    lastKey.current = filterKey;
    if (first) return;
    // A no-break space on every other repeat: the same words are new text.
    setMessage((prev) => ({ text, n: prev.n + 1 }));
  }, []);
  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="profile-cards-status">
        {message.text ? `${message.text}${message.n % 2 === 0 ? " " : ""}` : ""}
      </p>
    </AnnounceContext.Provider>
  );
}

/** Hands the persistent region the results' line when they mount. */
export function AnnounceProfileCards({ text, filterKey }: { text: string; filterKey: string }) {
  const announce = useContext(AnnounceContext);
  useEffect(() => {
    announce(text, filterKey);
  }, [announce, text, filterKey]);
  return null;
}
