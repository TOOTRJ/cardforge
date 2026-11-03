// A custom pip was saved or removed (CustomPipsManager). A page hears it
// through router.refresh() — its server props carry the new overrides — but
// a creator that holds its own copy of them (the deck's edit drawer, TODO
// DK5.18, which reads them once a visit) listens here and reads them again.

const PIPS_CHANGED_EVENT = "pipglyph:custom-pips-changed";

export function announcePipsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PIPS_CHANGED_EVENT));
}

/** Subscribes; returns the unsubscribe. */
export function onPipsChanged(listener: () => void): () => void {
  window.addEventListener(PIPS_CHANGED_EVENT, listener);
  return () => window.removeEventListener(PIPS_CHANGED_EVENT, listener);
}
