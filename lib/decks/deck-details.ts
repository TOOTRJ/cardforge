import type { DeckCoverPosition, DeckFormat } from "@/types/deck";
import type { Visibility } from "@/types/card";

// ---------------------------------------------------------------------------
// The deck details dialog's save (TODO DK5.14, components/decks/
// deck-creator-form.tsx): what an edit SENDS. An edit never changes a field
// its maker did not touch (CLAUDE.md), so the patch holds only the fields
// whose value differs from the deck as the dialog OPENED it — an untouched
// deck type the list no longer knows, a bracket on a deck whose format has
// none, a cover kept as it was: none of them travels. Pure, client-safe.
// ---------------------------------------------------------------------------

/** The formats that have a power bracket: Commander alone (the five official
 *  Commander brackets, lib/decks/deck-types.ts COMMANDER_BRACKETS) — the
 *  hero's chip, the tiles and the AI wizard read the same rule. */
export function formatHasBracket(format: string): boolean {
  return format === "commander";
}

/** The deck as the dialog opened it (the stored row's columns). */
export type DeckDetailsOpened = {
  title: string;
  description: string | null;
  cover_url: string | null;
  cover_position: DeckCoverPosition | null;
  format: DeckFormat;
  visibility: Visibility;
  deck_type: string | null;
  bracket: number | null;
};

/** The form's values: text inputs as strings, "" = none. */
export type DeckDetailsValues = {
  title: string;
  description: string;
  cover_url: string;
  cover_position: DeckCoverPosition | null;
  format: DeckFormat;
  visibility: Visibility;
  /** A DECK_TYPES key, or "" for none. */
  deck_type: string;
  /** "1"–"5", or "" for none. */
  bracket: string;
};

export type DeckDetailsPatch = Partial<{
  title: string;
  description: string | null;
  cover_url: string | null;
  cover_position: DeckCoverPosition | null;
  format: DeckFormat;
  visibility: Visibility;
  deck_type: string | null;
  bracket: number | null;
}>;

/** The form's values for a stored deck. */
export function deckDetailsValuesOf(deck: DeckDetailsOpened): DeckDetailsValues {
  return {
    title: deck.title,
    description: deck.description ?? "",
    cover_url: deck.cover_url ?? "",
    cover_position: deck.cover_position ?? null,
    format: deck.format,
    visibility: deck.visibility,
    deck_type: deck.deck_type ?? "",
    bracket: deck.bracket == null ? "" : String(deck.bracket),
  };
}

function samePosition(a: DeckCoverPosition | null, b: DeckCoverPosition | null): boolean {
  if (a === null || b === null) return a === b;
  return a.focalX === b.focalX && a.focalY === b.focalY;
}

/** The fields the save sends: only those whose value differs from the deck
 *  as it opened. The bracket travels only while the format being saved has
 *  one (a bracket picked, then the format changed away, is not sent — the
 *  stored one stays, unseen, as it is on the deck's page). */
export function deckDetailsPatch(opened: DeckDetailsOpened, values: DeckDetailsValues): DeckDetailsPatch {
  const patch: DeckDetailsPatch = {};

  const title = values.title.trim();
  if (title !== opened.title) patch.title = title;

  const description = values.description.trim() || null;
  if (description !== (opened.description ?? null)) patch.description = description;

  const cover = values.cover_url.trim() || null;
  if (cover !== (opened.cover_url ?? null)) patch.cover_url = cover;
  // A focal point only means something on a cover; none clears it.
  const position = cover ? values.cover_position : null;
  if (!samePosition(position, opened.cover_position ?? null)) patch.cover_position = position;

  if (values.format !== opened.format) patch.format = values.format;
  if (values.visibility !== opened.visibility) patch.visibility = values.visibility;

  const deckType = values.deck_type.trim() || null;
  if (deckType !== (opened.deck_type ?? null)) patch.deck_type = deckType;

  const bracket = values.bracket === "" ? null : Number(values.bracket);
  if (formatHasBracket(values.format) && bracket !== (opened.bracket ?? null)) patch.bracket = bracket;

  return patch;
}
