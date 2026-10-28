import type { CardCornerFills, CornerFill } from "@/lib/cards/card-corner";

// ---------------------------------------------------------------------------
// The SQUARE output's corners (TODO 3.26 / 6.18; owner decision 2026-09-27:
// print corners in the border colour). What a square PNG, the PDF card and
// sheets and the Pro deck PDF + ZIP show OUTSIDE the one card corner's arc
// (lib/cards/card-corner.ts), per template and corner:
//
//   "border" — the border black #000: every master whose border runs black
//              to the corner (the Card Conjurer family — split and battle
//              with it since TODO 4.21b — the MSE masters Phase B
//              normalised, Alpha, nyx, adventure …). The default.
//   "root"   — the card root's #101015: a master whose EDGE BAND is
//              transparent at that corner, so the card's border there IS the
//              root's backdrop — the rings (none today: bloomanime left
//              with TODO 4.11 / 4.35's layout v70, its art to every corner
//              and its footer drawn into the bottom ones; avatar with
//              its footer painted, TODO 4.11 layout v69;
//              lotrscroll and tarkirdragon left with TODO 4.11, their Card
//              Conjurer border black, and tarkirghostfire with its painted
//              ring, layout v68; the bottom corners of bloomburrow left with
//              its coloured footer, layout v69 — lotr's
//              and tarkirdraconic's left with TODO 4.11: a Card Conjurer
//              bottom, and the border painted under the draconic's MSE
//              masters, are border black), and expeditionland b/g. A #000 cap in a #101015 band was a seam
//              (3.26 review).
//   "frame"  — what the render drew stays: design that runs into the corner
//              (Bloomburrow's pale top corners, the LOTR ring's frame field,
//              Tarkir draconic's ornament) and — from the profile's art slot, never listed —
//              the art of an art-to-edge frame.
//
// At a border or root corner the fill REPLACES everything outside the arc
// (lib/cards/card-corner.ts squareCardCorners), so a frame's own pixels
// there — Alpha's 60 px cut — never print, and
// a free Square (the stored round bake squared with the same fills) is the
// paid live Square's twin. A template with a "frame" corner renders its
// free Square live instead (the round bake's downscale no longer carries
// those pixels).
//
// tests/unit/frames/square-corners.test.ts holds this table to the masters
// (git, and the frames bucket where a local build is present).
// ---------------------------------------------------------------------------

export type CornerName = "tl" | "tr" | "bl" | "br";
/** The order of a CardCornerFills tuple. */
export const CORNER_NAMES: readonly CornerName[] = ["tl", "tr", "bl", "br"];

export type SquareCornerKind = "border" | "root" | "frame";

/** The border black (owner decision 2026-09-27). */
export const BORDER_BLACK_RGB = [0, 0, 0] as const;
/** The card root's backdrop, #101015 (lib/render/card-image.tsx). */
export const ROOT_BACKDROP_RGB = [16, 16, 21] as const;

type Kinds = SquareCornerKind | Readonly<Partial<Record<CornerName, SquareCornerKind>>>;

/** Every template × corner that is not "border"; `keys` limits an entry to
 *  some colour masters. */
export const SQUARE_CORNERS: Readonly<Record<string, { kinds: Kinds; keys?: readonly string[] }>> = {
  // The Bloomburrow woodland since TODO 4.11 (layout v69): its leafy top
  // band in the top corners, its footer in the colour's own tone in the
  // bottom ones — design all round, what the render drew.
  bloomburrow: { kinds: "frame" },
  // Card Conjurer's 'Ring' pack since TODO 4.11: the frame field runs into
  // the top corners (the importer keeps them square); the bottom is the
  // border black, cut at the one card corner.
  lotr: { kinds: { tl: "frame", tr: "frame" } },
  // The Enchanting Tales showcase (TODO 4.11 wave 2, Card Conjurer's pack):
  // borderless — its swirled field in the top corners, its footer in the
  // colour's own tone in the bottom ones; the importer keeps all four.
  enchantingtales: { kinds: "frame" },
  // The Tarkir draconic since TODO 4.11 (layout v68): the dragons' heads
  // run into the top corners (design); the bottom is the border black
  // painted under the MSE masters, cut at the one card corner.
  tarkirdraconic: { kinds: { tl: "frame", tr: "frame" } },
};

/** What `template`'s master `key` shows outside the arc at `corner` in a
 *  square output (the art slot aside — squareCornerFills adds that). */
export function squareCornerKind(
  template: string,
  key: string,
  corner: CornerName,
  table: Readonly<Record<string, { kinds: Kinds; keys?: readonly string[] }>> = SQUARE_CORNERS,
): SquareCornerKind {
  const entry = table[template];
  if (!entry || (entry.keys && !entry.keys.includes(key))) return "border";
  return typeof entry.kinds === "string" ? entry.kinds : (entry.kinds[corner] ?? "border");
}

/** A rectangle in card percent (a profile's artSlot). */
export type ArtRect = { topPct: number; leftPct: number; widthPct: number; heightPct: number };

/** True when the art window reaches both card edges that meet at `corner`
 *  — the art fills that corner (an art-to-edge frame). */
export function artCoversCorner(art: ArtRect, corner: CornerName): boolean {
  const top = art.topPct <= 0;
  const bottom = art.topPct + art.heightPct >= 100;
  const left = art.leftPct <= 0;
  const right = art.leftPct + art.widthPct >= 100;
  switch (corner) {
    case "tl":
      return top && left;
    case "tr":
      return top && right;
    case "bl":
      return bottom && left;
    case "br":
      return bottom && right;
  }
}

/**
 * The fill for each corner of a square output (tl, tr, bl, br): the border
 * black, the root's #101015, or null — keep what the render drew (a
 * "frame" corner, or one the art covers). `keys` are the masters painted on
 * the card's left and right halves (the same key unless a two-colour split).
 */
export function squareCornerFills(
  template: string,
  art: ArtRect | null | undefined,
  keys: { left: string; right: string },
  /** The table (SQUARE_CORNERS; a test passes its own — no "root" entry is
   *  left since the Bloomburrow anime's layout v70). */
  table: Readonly<Record<string, { kinds: Kinds; keys?: readonly string[] }>> = SQUARE_CORNERS,
): CardCornerFills {
  const fill = (corner: CornerName): CornerFill => {
    if (art && artCoversCorner(art, corner)) return null;
    const kind = squareCornerKind(template, corner === "tl" || corner === "bl" ? keys.left : keys.right, corner, table);
    return kind === "frame" ? null : kind === "root" ? ROOT_BACKDROP_RGB : BORDER_BLACK_RGB;
  };
  return [fill("tl"), fill("tr"), fill("bl"), fill("br")];
}
