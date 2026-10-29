import { safeRedirectPath } from "@/lib/auth/safe-redirect";
import type { DeckFormat } from "@/types/deck";

// ---------------------------------------------------------------------------
// The New deck dialog's addresses (TODO DK4) — kept apart from its data
// (lib/decks/new-deck.ts, which pulls in the decklist parser) so the deck
// page and the root layout's provider load only these few lines.
// ---------------------------------------------------------------------------

/** The route that opens the dialog — the header's "New deck" and the
 *  signed-out round trip's way back. */
export const NEW_DECK_PATH = "/dashboard/decks/new";

/** `/deck/<slug>?new=1` — a deck the dialog just made, empty: the deck page
 *  focuses its first way to add cards and drops the flag
 *  (useFocusAddOnNewDeck). */
export const NEW_DECK_PARAM = "new";

export function newDeckPageHref(slug: string, empty: boolean): string {
  return empty ? `/deck/${slug}?${NEW_DECK_PARAM}=1` : `/deck/${slug}`;
}

/** /dashboard/decks/new, with the format the page preselects. */
export function newDeckReturnPath(format?: DeckFormat | null): string {
  const path = format ? `${NEW_DECK_PATH}?format=${format}` : NEW_DECK_PATH;
  return safeRedirectPath(path, NEW_DECK_PATH);
}

/**
 * Sign up / sign in, then back to the dialog. A NEW account goes through
 * /onboarding first (the (app) layout sends it there and can't know where
 * it was headed), so the sign-up link asks onboarding itself to end on the
 * dialog: `/onboarding?next=…` — the page and its wizard already honour a
 * `next` through safeRedirectPath. Signing in returns straight to it.
 */
export function newDeckAuthHref(kind: "signup" | "login", format?: DeckFormat | null): string {
  const back = newDeckReturnPath(format);
  const target =
    kind === "signup" ? safeRedirectPath(`/onboarding?next=${encodeURIComponent(back)}`, back) : back;
  return `/${kind}?redirectTo=${encodeURIComponent(target)}`;
}
