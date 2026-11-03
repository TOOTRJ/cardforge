// The deck's inline card editor (TODO DK5.18, owner decision 2026-11-02):
// a card's Edit / Customize / Remix on the deck page opens the creator in a
// drawer over the deck instead of leaving for /create or /card/…/edit and
// coming back (DK5.5). Behind an admin switch — site_settings
// `deck_inline_editor` — so admins test it before everyone gets it (the
// creator lab's pattern, lib/creator/lab-shared.ts). "everyone" IS the
// release; while a viewer isn't allowed, the deck page behaves exactly as
// on main (DK5.5's navigation). Pure + client-safe.

import type { CardCapacity } from "@/lib/billing/capacity-copy";
import type { FrameProfileOverridesMap } from "@/lib/cards/profile-override";
import type { Challenge } from "@/lib/challenges/shared";
import type { PipOverrides } from "@/lib/pips/override";
import type { DeckOption } from "@/components/creator/panels/publish-panel";
import type { Card, GameSystem } from "@/types/card";
import type { DeckRemixContext } from "@/types/deck";

export const DECK_INLINE_EDITOR_MODES = ["off", "admins", "everyone"] as const;
export type DeckInlineEditorMode = (typeof DECK_INLINE_EDITOR_MODES)[number];

export const DECK_INLINE_EDITOR_MODE_LABELS: Record<DeckInlineEditorMode, string> = {
  off: "Off — nobody sees it",
  admins: "Admins only — preview and test",
  everyone: "Everyone — every deck owner edits in the drawer",
};

export const DEFAULT_DECK_INLINE_EDITOR_MODE: DeckInlineEditorMode = "off";

/** The site_settings key (matches `^[a-z][a-z0-9_]{1,63}$`). */
export const DECK_INLINE_EDITOR_SETTING_KEY = "deck_inline_editor";

export function isDeckInlineEditorMode(value: unknown): value is DeckInlineEditorMode {
  return (DECK_INLINE_EDITOR_MODES as readonly unknown[]).includes(value);
}

/** Whether this viewer edits a deck's cards in the drawer. */
export function canUseDeckInlineEditor(mode: DeckInlineEditorMode, isAdmin: boolean): boolean {
  if (mode === "everyone") return true;
  if (mode === "admins") return isAdmin;
  return false;
}

// ---------------------------------------------------------------------------
// What the drawer opens on: the `?edit=` value (an entry id, or "new") and
// the props the creator gets — everything /create and /card/…/edit hand it,
// read by GET /api/decks/<deck id>/edit-context (owner only, the switch on).
// ---------------------------------------------------------------------------

/** The `?edit=` query parameter the drawer pushes (Back closes it). */
export const DECK_EDIT_PARAM = "edit";
/** `?edit=new`: a new card into this deck ("＋ Create new card"). */
export const DECK_EDIT_NEW = "new";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `?edit=` value read off a URL: an entry id (lower case) or "new";
 *  anything else is no drawer. */
export function parseDeckEditParam(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value === DECK_EDIT_NEW) return DECK_EDIT_NEW;
  return UUID.test(value) ? value.toLowerCase() : null;
}

/** The deck page's URL with `?edit=<target>` set (null: removed), every
 *  other parameter and the hash kept. */
export function withDeckEditParam(href: string, target: string | null): string {
  const url = new URL(href, "http://x.invalid");
  if (target) url.searchParams.set(DECK_EDIT_PARAM, target);
  else url.searchParams.delete(DECK_EDIT_PARAM);
  const search = url.searchParams.toString();
  return `${url.pathname}${search ? `?${search}` : ""}${url.hash}`;
}

/** The props of the creator every open needs (the page-wide part: read once
 *  per page visit, kept by the drawer). */
export type DeckEditShared = {
  userId: string;
  ownerUsername: string | null;
  gameSystems: GameSystem[];
  myDecks: DeckOption[];
  canDesignForDeck: boolean;
  aiConfigured: boolean;
  pipOverrides: PipOverrides;
  verifiedFrameKeys: string[];
  profileOverrides: FrameProfileOverridesMap | null;
  activeChallenge: Challenge | null;
  capacity: CardCapacity | null;
  defaultArtistCredit: string;
  isPaid: boolean;
  defaultFooterText: string | null;
};

/** What one open edits: an entry's card (the owner's own → its editor;
 *  another creator's → a remix that takes the entry's place, D3; none → a
 *  new card from the entry's printing or name), or a new card. */
export type DeckEditTarget = {
  mode: "create" | "edit" | "remix";
  /** The card edited (edit) or remixed from (remix). */
  card: Card | null;
  deckRemix: DeckRemixContext | null;
  /** The entry it stands for (null: "＋ Create new card"). */
  entryId: string | null;
  /** A new card's deck (the deck box starts on it). */
  initialDeckId: string | null;
  /** The drawer's title: the card's or the entry's name. */
  title: string;
  /** DK5.5's page for the same edit ("Open full page ↗"). */
  fullPageHref: string;
};

export type DeckEditContextResponse =
  | ({ ok: true; target: DeckEditTarget } & { shared?: DeckEditShared })
  | { ok: false; error: string };
