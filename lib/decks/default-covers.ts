// ---------------------------------------------------------------------------
// The sixteen built-in deck backgrounds (owner decision D12,
// public/defaults/deck-covers, scripts/build-deck-covers.mjs): two per colour
// identity plus two neutrals — the twin of lib/profile/default-media.ts for
// a deck's cover. lib/decks/cover.ts picks one by a deck's colours when it
// has no cover of its own; since migration 0150 an owner may also STORE one
// ("Shuffle", or a pick in the cover editor), and the database takes exactly
// these sixteen site-relative paths (media_url_allowed('deck-cover', …): the
// same list as a pattern, held to this one by
// tests/unit/db/deck-cover-picks-migration.test.ts).
//
// Its own file, with no imports, so lib/media/media-urls.ts can accept a
// stored default without importing the cover module (which imports it).
// Client-safe.
// ---------------------------------------------------------------------------

/** The colour identities a default is picked by, in WUBRG order, then the
 *  two that aren't one colour. `neutral` = nothing known about the colours
 *  (an empty deck, a list of placeholders). */
export const DECK_COVER_IDENTITIES = [
  "white",
  "blue",
  "black",
  "red",
  "green",
  "multicolor",
  "colorless",
  "neutral",
] as const;
export type DeckCoverIdentity = (typeof DECK_COVER_IDENTITIES)[number];

export const DEFAULTS_PER_IDENTITY = 2;
const DEFAULT_COVER_FOLDER = "/defaults/deck-covers";

/** Site-relative path of a built-in cover (1-based index). */
export function defaultCoverPath(identity: DeckCoverIdentity, index: number): string {
  return `${DEFAULT_COVER_FOLDER}/${identity}-${index}.webp`;
}

/** All sixteen built-in covers, in identity order. */
export const DEFAULT_DECK_COVERS: readonly string[] = DECK_COVER_IDENTITIES.flatMap((identity) =>
  Array.from({ length: DEFAULTS_PER_IDENTITY }, (_, i) => defaultCoverPath(identity, i + 1)),
);

const DEFAULT_COVER_SET = new Set(DEFAULT_DECK_COVERS);

/** True only for a path this module mints — never a lookalike, a query
 *  string, another folder or an index past the set. */
export function isDefaultDeckCover(url: string | null | undefined): url is string {
  return typeof url === "string" && DEFAULT_COVER_SET.has(url);
}

/** The identity and the 1-based index of a built-in cover — "Red · 2" in
 *  the cover editor's picker. */
export function defaultCoverParts(path: string): { identity: DeckCoverIdentity; index: number } | null {
  if (!isDefaultDeckCover(path)) return null;
  const [, identity, index] = /\/([a-z]+)-(\d)\.webp$/.exec(path)!;
  return { identity: identity as DeckCoverIdentity, index: Number(index) };
}

/** "Shuffle": another built-in cover than the one shown, at random — any of
 *  the other fifteen (`random` is Math.random in the editor, seeded in the
 *  tests). */
export function shuffleDeckCover(current: string | null | undefined, random: () => number = Math.random): string {
  const others = DEFAULT_DECK_COVERS.filter((path) => path !== current);
  return others[Math.min(others.length - 1, Math.floor(random() * others.length))];
}
