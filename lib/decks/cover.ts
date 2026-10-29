import { drawableMediaUrl } from "@/lib/media/media-urls";
import { coverObjectPosition } from "@/types/deck";

// ---------------------------------------------------------------------------
// A deck's cover — ONE answer for every surface that draws it (TODO DK6.2):
// the deck page's hero, the deck tiles (/decks, the format hubs, My decks),
// the share image and the Pro export's cover file. Each is a 16:9 box with
// `object-cover`, so one picture crops the same everywhere.
//
//   * the owner's UPLOAD, when it is one a surface may draw (migration 0127,
//     lib/media/media-urls.ts) — normalised to 1600×900 WebP when stored
//     (lib/decks/cover-normalize.ts), drawn at its focal point;
//   * else one of the 16 DEFAULT backgrounds (owner decision D12,
//     public/defaults/deck-covers, scripts/build-deck-covers.mjs): two per
//     colour identity plus two neutrals, the pair picked by the deck's
//     colours (`deckCoverColors`) and the one by a stable hash of its id —
//     the same picture on every visit and every surface. Nothing is stored:
//     a deck with no upload has no cover row to write (no migration).
//
// The colours come from the deck's ENTRIES and only from what every viewer
// can read, so the owner and a visitor are shown the same default: an
// entry's own WUBRG letters (a printing's colour identity), else its linked
// card's colours when that card is not private. A commander deck is its
// commander's colours, as the format defines a deck's colour identity.
//
// Shuffling to another default needs the choice stored, and the only cover
// column can't hold it: 0127's `media_url_allowed('deck-cover', …)` takes
// the owner's own storage objects alone (profiles' columns take their
// built-in paths, decks' do not), so a site-relative default is refused
// until a migration lists the pattern. `deckCoverOf` already draws a stored
// default when it is one of DEFAULT_DECK_COVERS (`isDefaultDeckCover`, the
// twin of isDefaultProfileMedia) — the read side of that later change.
//
// Client-safe: no server imports (the cover editor shows the default).
// ---------------------------------------------------------------------------

/** Every deck-cover surface is a 16:9 box; uploads are stored at this size. */
export const DECK_COVER_WIDTH = 1600;
export const DECK_COVER_HEIGHT = 900;

/** The deck hero's picture box, about (components/decks/deck-hero.tsx): a
 *  wide band on a desktop (1214 × 416 px at 1280+) and a tall column on a
 *  phone (358 × ~470 px at 390). The cover editor draws these two crops of
 *  the 16:9 picture, so its focal-point drag shows what it moves. */
export const HERO_CROP_ASPECTS = { wide: 2.9, phone: 0.76 } as const;

/** Where a crop of `aspect` (width / height) sits in the 16:9 picture at a
 *  focal point, as fractions of the picture — CSS object-fit: cover with
 *  object-position at the focal point (coverObjectPosition). Null = centred. */
export function heroCropWindow(
  aspect: number,
  focal: { focalX: number; focalY: number } | null,
): { left: number; top: number; width: number; height: number } {
  const picture = DECK_COVER_WIDTH / DECK_COVER_HEIGHT;
  const fx = focal?.focalX ?? 0.5;
  const fy = focal?.focalY ?? 0.5;
  if (aspect >= picture) {
    const height = picture / aspect;
    return { left: 0, top: (1 - height) * fy, width: 1, height };
  }
  const width = aspect / picture;
  return { left: (1 - width) * fx, top: 0, width, height: 1 };
}

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

const DEFAULTS_PER_IDENTITY = 2;
const DEFAULT_COVER_FOLDER = "/defaults/deck-covers";

/** Site-relative path of a built-in cover (1-based index). */
function defaultCoverPath(identity: DeckCoverIdentity, index: number): string {
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

/** WUBRG letters, plus "M" for a card saved as "multicolor" without naming
 *  its colours (it is gold, whatever they are). */
export type DeckCoverColor = "W" | "U" | "B" | "R" | "G" | "M";

const WUBRG = new Set(["W", "U", "B", "R", "G"]);
const WORD_LETTER: Record<string, DeckCoverColor> = {
  white: "W",
  blue: "U",
  black: "B",
  red: "R",
  green: "G",
  multicolor: "M",
};

type CoverColorEntry = {
  board: string;
  color_identity: readonly string[] | null;
  scryfall_id: string | null;
  card_id: string | null;
};
type CoverColorCard = { color_identity: readonly string[] | null; visibility: string } | null;

/** One entry's colours, or null when the viewer-independent data says
 *  nothing: a placeholder, or a linked card that is private or gone. */
function entryCoverColors(entry: CoverColorEntry, card: CoverColorCard): DeckCoverColor[] | null {
  const own = (entry.color_identity ?? []).filter((c): c is DeckCoverColor => WUBRG.has(c));
  if (own.length > 0) return own;
  if (entry.card_id) {
    if (!card || card.visibility === "private") return null;
    return (card.color_identity ?? []).flatMap((word) => (WORD_LETTER[word] ? [WORD_LETTER[word]] : []));
  }
  // A printing whose colour identity is empty is colourless; a name with
  // no printing (an import placeholder) tells nothing.
  return entry.scryfall_id ? [] : null;
}

function unionOf(items: readonly { entry: CoverColorEntry; card: CoverColorCard }[]): DeckCoverColor[] | null {
  let known = false;
  const out = new Set<DeckCoverColor>();
  for (const { entry, card } of items) {
    const colors = entryCoverColors(entry, card);
    if (!colors) continue;
    known = true;
    for (const color of colors) out.add(color);
  }
  return known ? [...out] : null;
}

/**
 * The colours a deck's default cover is picked by: its commanders' when the
 * commander board says anything, else every playable board's (the
 * maybeboard is not the deck). Null when nothing is known. Pure; the deck
 * page, the share image and the export read it from their own rows, the
 * tiles from `listDeckCoverColors` (lib/decks/cover-colors.ts), which reads
 * the same rows.
 */
export function deckCoverColors(
  items: readonly { entry: CoverColorEntry; card: CoverColorCard }[],
): DeckCoverColor[] | null {
  const playable = items.filter((item) => item.entry.board !== "maybe");
  return unionOf(playable.filter((item) => item.entry.board === "commander")) ?? unionOf(playable);
}

/** The identity whose pair a deck's default comes from. */
export function deckCoverIdentity(colors: readonly string[] | null | undefined): DeckCoverIdentity {
  if (!colors) return "neutral";
  const letters = new Set(colors.filter((c) => WUBRG.has(c) || c === "M"));
  if (letters.has("M") || letters.size > 1) return "multicolor";
  if (letters.size === 0) return "colorless";
  const [only] = letters;
  return (["white", "blue", "black", "red", "green"] as const)[["W", "U", "B", "R", "G"].indexOf(only)];
}

/** A stable 32-bit hash of a deck id — the same pick on every render (the
 *  hash defaultMediaFor uses for a profile's built-in images). */
export function stableDeckHash(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash;
}

/** The built-in cover for a deck: its identity's pair, one by the id. */
export function defaultDeckCoverFor(deckId: string, colors: readonly string[] | null | undefined): string {
  return defaultCoverPath(deckCoverIdentity(colors), (stableDeckHash(deckId) % DEFAULTS_PER_IDENTITY) + 1);
}

export type DeckCover = {
  /** An upload's public URL, or a site-relative default path. */
  src: string;
  /** "upload" = the owner's own picture (drawn at its focal point, with an
   *  extra darkening layer behind the hero's cards); "default" = built in. */
  kind: "upload" | "default";
  /** CSS object-position for an upload's focal point; undefined = centred. */
  objectPosition: string | undefined;
};

type CoverDeck = {
  id: string;
  owner_id: string;
  cover_url: string | null;
  cover_position?: unknown;
};

/** The cover every surface draws for this deck (see the header). */
export function deckCoverOf(deck: CoverDeck, colors: readonly string[] | null | undefined): DeckCover {
  const upload = drawableMediaUrl("deck-cover", deck.cover_url, deck.owner_id);
  if (upload) {
    return { src: upload, kind: "upload", objectPosition: coverObjectPosition(deck.cover_position) };
  }
  if (isDefaultDeckCover(deck.cover_url)) {
    return { src: deck.cover_url, kind: "default", objectPosition: undefined };
  }
  return { src: defaultDeckCoverFor(deck.id, colors), kind: "default", objectPosition: undefined };
}
