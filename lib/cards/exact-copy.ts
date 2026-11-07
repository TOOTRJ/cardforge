import {
  importEditStateOf,
  type FingerprintCard,
  type ImportProvenanceColumns,
} from "@/lib/cards/import-fingerprint";

// ---------------------------------------------------------------------------
// Exact copies of real cards (owner 2026-11-06, "a slot is something you
// designed"): a card that still prints exactly what a Scryfall import gave
// it is the REAL card, not a PipGlyph card.
//
//   * The creator never saves a NEW one: it says so above Save and offers
//     to put the real card in a deck instead (a deck's printing entry uses
//     no card slot). createCardAction refuses one too — on the creator's
//     `import_unchanged` claim, `EXACT_COPY_CODE`. The claim is the
//     creator's own (lib/creator/import-baseline.ts): where it can't make
//     it — the import's baseline lost to a reload, a guest's restored card,
//     the Source field emptied — the card saves with no fingerprint and
//     counts as customised, as the deck pages' "Edited" does. The server
//     can't judge it alone (the fingerprint is the creator's form after
//     the import's automatic steps).
//   * The PUBLIC gallery shows only customised cards: an exact copy may be
//     unlisted or private, never public. An edit that leaves a stored one
//     still exact is saved at most unlisted (updateCardAction's
//     `exactCopyUnlisted`), My Cards' bulk publish leaves it as it was
//     (`skippedExactCopy`, read by `readExactCopyIds`), and the
//     hourly sweep (`lib/cards/exact-copy-sweep.ts`) moves any public one to
//     unlisted and tells its owner once. Its page and links keep working, as
//     an unlisted card's do; every list, hub, trending row and the sitemap
//     already leave unlisted cards out.
//
// "Still exactly the import" is the deck pages' "Imported" — ONE answer,
// `importEditStateOf` (lib/cards/import-fingerprint.ts): a card with a stored
// fingerprint whose columns still hash to it. A card saved before 0144, or
// changed before its first save, has no fingerprint and is never one.
// ---------------------------------------------------------------------------

export const EXACT_COPY_CODE = "EXACT_COPY";

export const EXACT_COPY_MESSAGE =
  "This is still exactly the real card, so it isn't saved as a PipGlyph card. Change something — the art, the frame, the text — to make it yours, or add the real card to a deck.";

/** Above Save in the creator, while the import is untouched. */
export const EXACT_COPY_SAVE_REASON =
  "This is still exactly the real card. Change anything — the art, the frame, a word — to save it as your own, or add the real card to a deck.";

/** The edit's notice, when a save asked for public and got unlisted. */
export const EXACT_COPY_UNLISTED_MESSAGE =
  "Saved as unlisted: it's still exactly the real card, and only customised cards go public. Change anything on it and you can publish it.";

export type ExactCopyCard = FingerprintCard & ImportProvenanceColumns;

/** Does this card (a stored row, or a row with an edit applied) still print
 *  exactly what its import gave it? */
export function isExactCopyOfImport(card: ExactCopyCard): boolean {
  return importEditStateOf(card) === "unchanged";
}
