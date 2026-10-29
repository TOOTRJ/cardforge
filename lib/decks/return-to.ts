import { safeRedirectPath } from "@/lib/auth/safe-redirect";

// ---------------------------------------------------------------------------
// "Edit any card, then come back" (TODO DK5.5). Every entry on the owner's
// deck page has an Edit: an imported card or a placeholder opens the
// creator on the entry (`/create?deckCard=`), the owner's own card its
// editor, another creator's card (D3) a remix of it into the owner's
// account that takes the entry's place — and each carries a `returnTo`
// that brings the owner back to that card on the deck page: its anchor
// (`#entry-<id>`) scrolls to it and puts the focus on it.
//
// "Edit next" is the walk through the unchanged imports: its `returnTo`
// anchor is `#next-<id>` — back on the deck, the card just made is marked
// and the focus goes to "Edit next", which by then names the next one.
//
// `returnTo` arrives in a URL, so the creator follows it only through
// `deckReturnPath`: a same-origin path (safeRedirectPath) that is a deck
// page and nothing more — `/deck/<slug>`, an optional anchor of ours. A
// query, another route, a protocol-relative or encoded trick is refused (the
// creator then goes where it always went). Pure and client-safe.
// ---------------------------------------------------------------------------

export const RETURN_TO_PARAM = "returnTo";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** A deck slug (lib/validation/deck.ts SLUG_PATTERN's shape, ≤ 80). */
const SLUG = "[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?";
const DECK_RETURN = new RegExp(`^/deck/(${SLUG})(?:#(?:entry|next)-${UUID})?$`);
const ANCHOR = new RegExp(`^#(entry|next)-(${UUID})$`, "i");

/** `value` when it is a deck page we send people back to — and, given
 *  `deckSlug`, THAT deck's page — else null. */
export function deckReturnPath(value: unknown, deckSlug?: string | null): string | null {
  const path = safeRedirectPath(value, "");
  if (!path) return null;
  const match = DECK_RETURN.exec(path);
  if (!match) return null;
  if (deckSlug && match[1] !== deckSlug) return null;
  return path;
}

/** The deck page's anchor for an entry — the card the owner comes back to
 *  (`entry`), or the card a walk just made (`next`). */
export function deckEntryAnchor(entryId: string, kind: "entry" | "next" = "entry"): string {
  return `#${kind}-${entryId.toLowerCase()}`;
}

/** The anchor read back off `location.hash`, or null. */
export function parseDeckEntryAnchor(hash: string): { kind: "entry" | "next"; entryId: string } | null {
  const match = ANCHOR.exec(hash);
  if (!match) return null;
  return { kind: match[1]!.toLowerCase() as "entry" | "next", entryId: match[2]!.toLowerCase() };
}

/** `/deck/<slug>#entry-<id>` (or `#next-<id>` for the walk). */
export function deckEntryReturnTo(deckSlug: string, entryId: string, kind: "entry" | "next" = "entry"): string {
  return `/deck/${deckSlug}${deckEntryAnchor(entryId, kind)}`;
}

/** What an entry's Edit opens. */
export type EntryEditTarget = {
  href: string;
  /** The words on the control ("Edit card", "Customize"…). */
  label: string;
};

type EditableEntry = { id: string; scryfall_id: string | null; card_id: string | null };
type EditableCard = { id: string; slug: string };

/**
 * The entry's Edit, with its way back. In order:
 *   the owner's own card          → its editor
 *   another creator's card (D3)   → a remix of it, linked into the entry
 *   a printing with no card       → Customize: the creator on the entry
 *   anything else (a placeholder, a card that's gone) → the creator on the
 *                                   entry, from its name
 */
export function entryEditTarget(
  item: { entry: EditableEntry; card: EditableCard | null; cardOwner?: unknown },
  deckSlug: string,
  kind: "entry" | "next" = "entry",
): EntryEditTarget {
  const back = `${RETURN_TO_PARAM}=${encodeURIComponent(deckEntryReturnTo(deckSlug, item.entry.id, kind))}`;
  const { entry, card } = item;
  if (card && !item.cardOwner) return { href: `/card/${card.slug}/edit?${back}`, label: "Edit card" };
  if (card) return { href: `/create?deckCard=${entry.id}&remix=${card.id}&${back}`, label: "Remix" };
  if (entry.scryfall_id && !entry.card_id) return { href: `/create?deckCard=${entry.id}&${back}`, label: "Customize" };
  return { href: `/create?deckCard=${entry.id}&${back}`, label: "Make your own version" };
}
