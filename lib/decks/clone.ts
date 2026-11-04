import { slugify } from "@/lib/validation/card";
import { bringsCard } from "@/lib/decks/entry-status";
import { hidesEntryName } from "@/lib/decks/private-card-name";

// ---------------------------------------------------------------------------
// Clone a deck (TODO DK5.16) — the pure half of cloneDeckAction
// (lib/decks/clone-actions.ts): the copy's name and link, the database's
// answer read safely, and the words a clone's maker is told. What comes
// along is migration 0164's clone_deck(): the caller's own cards and public
// ones keep their link, a printing keeps its printing, an entry with no
// printing whose card can't come along is left out — never a private card's
// name — ≤ 500 rows, no card made (saved-card capacity untouched). A kept
// printing whose name or type line the source page masks for the caller
// (strong language, publicDeckItems) is copied as "Private card": the app
// names those entries (`maskedCloneEntryIds`) — SQL can't run the detector.
// ---------------------------------------------------------------------------

type CloneEntryLike = {
  card_id: string | null;
  scryfall_id?: string | null;
  source?: string | null;
};

type CloneCardLike = { owner_id?: string | null; visibility?: string | null } | null | undefined;

/** clone_deck()'s rule for one entry, as the page reads it (`card` is what
 *  the viewer's read handed back — null for a card they can't read): a
 *  printing, a card that comes along (public, or the viewer's own — the
 *  SQL's keep_card; another owner's unlisted card the viewer can READ still
 *  stays behind), or a plain line (no card, a source that brings none). */
export function entryComesAlong(entry: CloneEntryLike, card: CloneCardLike, viewerId: string | null): boolean {
  if (entry.scryfall_id) return true;
  if (entry.card_id) {
    return Boolean(card && (card.visibility === "public" || (viewerId !== null && card.owner_id === viewerId)));
  }
  return !bringsCard(entry.source);
}

/** How many of the page's entries a copy would hold — "Copy deck" is
 *  offered only above 0 (never an empty copy). */
export function cloneableEntryCount(
  items: ReadonlyArray<{ entry: CloneEntryLike; card: CloneCardLike }>,
  viewerId: string | null,
): number {
  return items.filter((item) => entryComesAlong(item.entry, item.card, viewerId)).length;
}

export type CloneSourceRow = CloneEntryLike & { id: string; name: string; type_line?: string | null };
export type CloneSourceCard = { id: string; owner_id: string; visibility: string };

/** The source's entries the copy writes as "Private card" for this caller:
 *  a kept printing whose card can't come along (another user's card that
 *  isn't public, or one the caller can't read) and whose name or type line
 *  holds strong language — exactly what publicDeckItems masks for them. The
 *  deck's owner sees every stored name (none). `cards`: the linked cards
 *  the caller's read handed back. */
export function maskedCloneEntryIds(
  rows: readonly CloneSourceRow[],
  cards: readonly CloneSourceCard[],
  callerId: string,
  deckOwnerId: string,
): string[] {
  if (callerId === deckOwnerId) return [];
  const byId = new Map(cards.map((card) => [card.id, card]));
  return rows
    .filter((row) => {
      if (!row.scryfall_id || !row.card_id) return false;
      const card = byId.get(row.card_id);
      const comesAlong = Boolean(card && (card.visibility === "public" || card.owner_id === callerId));
      return !comesAlong && hidesEntryName(row, null, false);
    })
    .map((row) => row.id);
}

/** What a copy's title ends in. */
export const CLONE_TITLE_SUFFIX = " (remix)";
/** decks_title_length (0055). */
const TITLE_MAX = 120;

/** The copy's title: the source's, once "(remix)" (a copy of a copy is not
 *  "(remix) (remix)"), inside the 120 characters. */
export function cloneTitleOf(sourceTitle: string): string {
  const base = sourceTitle.trim().replace(/\s*\(remix\)\s*$/i, "").trim() || "Deck";
  return `${base.slice(0, TITLE_MAX - CLONE_TITLE_SUFFIX.length).trimEnd()}${CLONE_TITLE_SUFFIX}`;
}

/** The copy's slug: its title's, as createDeckAction makes one (the
 *  database suffixes it while taken). */
export function cloneSlugOf(title: string): string {
  return slugify(title, 80, "deck").slice(0, 80) || "deck";
}

export type CloneResult = { deckId: string; slug: string; copied: number; skipped: number };

/** clone_deck()'s jsonb answer, or null when it isn't one. */
export function parseCloneResult(data: unknown): CloneResult | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (typeof row.deckId !== "string" || typeof row.slug !== "string") return null;
  const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);
  return { deckId: row.deckId, slug: row.slug, copied: count(row.copied), skipped: count(row.skipped) };
}

/** A refused clone in plain words (never the database's). */
export function cloneErrorMessage(error: { code?: string | null; message?: string | null } | null | undefined): string {
  const message = error?.message ?? "";
  if (message.includes("deck_entry_limit")) {
    return "This deck has more than 500 entries — more than a deck can hold — so it can't be copied.";
  }
  if (message.includes("deck_not_found") || error?.code === "P0002") return "This deck can't be copied — it may have been made private or deleted.";
  if (message.includes("not_authenticated")) return "Sign in to copy this deck.";
  if (message.includes("deck_slug_taken") || error?.code === "23505") {
    return "Too many decks already use this name's link — rename the deck you're copying from, or try again.";
  }
  return "The deck couldn't be copied. Please try again.";
}

/** What the maker is told once the copy exists. Both counts are ENTRIES
 *  (deck lines — one may be several copies of a card), and an entry is left
 *  out only for clone_deck()'s reasons: its card is someone else's private
 *  or unlisted card, or it is no longer available. */
export function cloneNotice(result: Pick<CloneResult, "copied" | "skipped">): string {
  const entries = (n: number) => `${n} entr${n === 1 ? "y" : "ies"}`;
  const copied = `${entries(result.copied)} copied`;
  if (result.skipped === 0) return `${copied}. Your copy is private until you publish it.`;
  return `${copied}; ${entries(result.skipped)} left out (someone else's private or unlisted card, or no longer available). Your copy is private until you publish it.`;
}
