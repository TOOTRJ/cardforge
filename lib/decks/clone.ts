import { slugify } from "@/lib/validation/card";

// ---------------------------------------------------------------------------
// Clone a deck (TODO DK5.16) — the pure half of cloneDeckAction
// (lib/decks/clone-actions.ts): the copy's name and link, the database's
// answer read safely, and the words a clone's maker is told. What comes
// along is migration 0164's clone_deck(): the caller's own cards and public
// ones keep their link, a printing keeps its printing, an entry with no
// printing whose card can't come along is left out — never a private card's
// name — ≤ 500 rows, no card made (saved-card capacity untouched).
// ---------------------------------------------------------------------------

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

/** What the maker is told once the copy exists. */
export function cloneNotice(result: Pick<CloneResult, "copied" | "skipped">): string {
  const copied = `${result.copied} entr${result.copied === 1 ? "y" : "ies"} copied`;
  if (result.skipped === 0) return `${copied}. Your copy is private until you publish it.`;
  return `${copied}; ${result.skipped} card${result.skipped === 1 ? " was" : "s were"} left out (private or no longer available). Your copy is private until you publish it.`;
}
