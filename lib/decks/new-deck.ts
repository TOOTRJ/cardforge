import { safeRedirectPath } from "@/lib/auth/safe-redirect";
import { MAX_DECKLIST_CHARS } from "@/lib/decks/parse-decklist";
import { isDeckFormat, isDeckVisibility, type DeckFormat } from "@/types/deck";
import type { Visibility } from "@/types/card";
import type { CardCapacity } from "@/lib/billing/capacity-copy";

// ---------------------------------------------------------------------------
// The New deck dialog's data (TODO DK4): what it reads from GET /api/me when
// it opens, the `?new=1` its deck page reads, and the signed-out round trip.
// Client-safe: no server imports.
// ---------------------------------------------------------------------------

/** Who is asking, and their saved-card slots — the pasted list's forecast
 *  (owner decision D2: an imported card uses none until it is customized).
 *  Advisory only. Decks themselves are unlimited on every plan. */
export type NewDeckContext = {
  signedIn: boolean;
  cardCapacity: CardCapacity | null;
};

/** The header's per-visitor data source; it answers `{ user, cardCapacity }`. */
export const NEW_DECK_CONTEXT_PATH = "/api/me";

/** /api/me's answer as the dialog reads it. */
export function newDeckContextOf(body: unknown): NewDeckContext {
  const value = (body ?? {}) as { user?: unknown; cardCapacity?: unknown };
  const capacity = value.cardCapacity as Partial<CardCapacity> | null | undefined;
  const cardCapacity =
    capacity && typeof capacity.used === "number" && typeof capacity.cap === "number" && typeof capacity.tier === "string"
      ? (capacity as CardCapacity)
      : null;
  return { signedIn: Boolean(value.user), cardCapacity: value.user ? cardCapacity : null };
}

/** `/deck/<slug>?new=1` — a deck the dialog just made, empty: the deck page
 *  focuses its first way to add cards and drops the flag
 *  (useFocusAddOnNewDeck). */
export const NEW_DECK_PARAM = "new";

export function newDeckPageHref(slug: string, empty: boolean): string {
  return empty ? `/deck/${slug}?${NEW_DECK_PARAM}=1` : `/deck/${slug}`;
}

// ---------------------------------------------------------------------------
// The signed-out round trip (TODO DK4.3). A visitor who
// fills the dialog and presses Create is asked to sign up or sign in; what
// they typed waits in THIS tab's sessionStorage, and the auth pages send
// them back to /dashboard/decks/new, which opens the dialog with it again.
//
//   * The decklist never travels in a URL: only the format does (the page
//     preselects it even when the draft is gone — another tab, an email
//     link opened elsewhere, storage blocked).
//   * Every storage call is wrapped: a private window, a full quota or
//     blocked site data means no draft, never a broken dialog.
//   * The return path goes through safeRedirectPath, like every post-auth
//     redirect (CLAUDE.md "Auth").
// ---------------------------------------------------------------------------

const STORAGE_KEY = "pipglyph:new-deck-draft";

/** A draft older than this is dropped: the visitor has moved on. */
export const NEW_DECK_DRAFT_TTL_MS = 6 * 60 * 60 * 1000;

/** The route that opens the dialog — the header's "New deck" and the auth
 *  round trip's way back. */
export const NEW_DECK_PATH = "/dashboard/decks/new";

export type NewDeckDraft = {
  title: string;
  format: DeckFormat;
  visibility: Visibility;
  decklist: string;
  /** The card the deck was started around (openNewDeck's `cardId`). */
  cardId: string | null;
};

type StoredDraft = NewDeckDraft & { savedAt: number };

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Keep the dialog's input for the trip through sign-up / sign-in. False
 *  when it couldn't be kept (the dialog still sends the visitor on). */
export function saveNewDeckDraft(draft: NewDeckDraft, now: number = Date.now()): boolean {
  const store = storage();
  if (!store) return false;
  const stored: StoredDraft = { ...draft, decklist: draft.decklist.slice(0, MAX_DECKLIST_CHARS), savedAt: now };
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}

/** The kept input, or null: none, too old, or not one we wrote. */
export function readNewDeckDraft(now: number = Date.now()): NewDeckDraft | null {
  const store = storage();
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let value: Partial<StoredDraft>;
  try {
    value = JSON.parse(raw) as Partial<StoredDraft>;
  } catch {
    clearNewDeckDraft();
    return null;
  }
  const fresh = typeof value.savedAt === "number" && now - value.savedAt >= 0 && now - value.savedAt < NEW_DECK_DRAFT_TTL_MS;
  if (
    !fresh ||
    typeof value.title !== "string" ||
    !isDeckFormat(value.format) ||
    !isDeckVisibility(value.visibility) ||
    typeof value.decklist !== "string"
  ) {
    clearNewDeckDraft();
    return null;
  }
  return {
    title: value.title.slice(0, 120),
    format: value.format,
    visibility: value.visibility,
    decklist: value.decklist.slice(0, MAX_DECKLIST_CHARS),
    cardId: typeof value.cardId === "string" ? value.cardId : null,
  };
}

export function clearNewDeckDraft(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear where storage is blocked.
  }
}

/** /dashboard/decks/new, with the format the page preselects. */
export function newDeckReturnPath(format?: DeckFormat | null): string {
  const path = format ? `${NEW_DECK_PATH}?format=${format}` : NEW_DECK_PATH;
  return safeRedirectPath(path, NEW_DECK_PATH);
}

/** Sign up / sign in, then back to the dialog. */
export function newDeckAuthHref(kind: "signup" | "login", format?: DeckFormat | null): string {
  return `/${kind}?redirectTo=${encodeURIComponent(newDeckReturnPath(format))}`;
}
