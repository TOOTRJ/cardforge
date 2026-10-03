// ---------------------------------------------------------------------------
// The collector line's CONTENT (TODO 4.9b, design 2026-09-29 §2.2): what the
// two lines in the bottom border say for a card, in the two printed styles.
// Pure — the card's own data and the printed language table, nothing else
// — so the preview, the bake, the creator and the card page read ONE set of
// rules. lib/cards/collector-layout.ts places what this returns.
//
// The prints (scans 2026-09-29/30, the 4.9 design's §1.1):
//   • "2015" style, M15 (2014-07) → the last printings of 2023-03-21:
//     line 1 is the number padded to three, "/" the set size where the set
//     prints one, both padded ("107/281", "001/016"), then the rarity letter
//     in a COLUMN above line 2's brush (DMU #107 "107/281   M", ONC #114
//     "114   R", TDOM #1 "001/016   T");
//   • "2023" style, from 2023-03-26 (SLD #1242) on: the letter first, then
//     the number padded to four, no set size ("R 1242", "M 0001", "L 0280",
//     "E 0024");
//   • line 2 on both: the printed set code, a separator (• — or ★ on a
//     foil-only printing: KLD #265 "KLD★EN", ONC #29 etched "ONC★EN"), the
//     printed language code, then the brush and the artist.
// The letter: T on a token (whatever rarity is stored — owner 2026-09-29),
// E on an emblem, L on a BASIC land, else C / U / R / M by rarity. Empty
// fields are left out, never invented, and no "Wizards", ™ or licensor line
// is ever printed.
// ---------------------------------------------------------------------------

import { printedLangCode } from "@/lib/cards/collector-fields";

/** The two printed styles of the line. */
export const COLLECTOR_STYLES = ["2015", "2023"] as const;
export type CollectorStyle = (typeof COLLECTOR_STYLES)[number];

/** What `frame_style.collector` holds: a style (the line is drawn) or an
 *  explicit "off" (the owner's choice, which shows no hint). Absent is a
 *  stored card from before the line shipped: today's look, with the hint. */
export const COLLECTOR_SWITCH_VALUES = ["2015", "2023", "off"] as const;
export type CollectorSwitch = (typeof COLLECTOR_SWITCH_VALUES)[number];

export function isCollectorStyle(value: unknown): value is CollectorStyle {
  return value === "2015" || value === "2023";
}

export function isCollectorSwitch(value: unknown): value is CollectorSwitch {
  return isCollectorStyle(value) || value === "off";
}

/** The style the switch draws, or null for "off" / absent / anything else. */
export function collectorStyleOf(value: unknown): CollectorStyle | null {
  return isCollectorStyle(value) ? value : null;
}

/** The style an EXISTING card gets when its owner switches the line on
 *  (design 2026-09-29 §4.1): "2015" when its stored number carries a set
 *  size ("107/281" — a 2015-era import), else "2023". */
export function collectorStyleForNumber(stored: string | null | undefined): CollectorStyle {
  return /^\d+\/\d+$/.test((stored ?? "").trim()) ? "2015" : "2023";
}

/** The templates whose PROFILES entry carries a collector slot (wave 1,
 *  TODO 4.9b): the black-bordered M15 family, the 2014–19 token frames (and
 *  their text-box twins), the planeswalker and the emblem — every one
 *  through M15's slot. tests/unit/cards/collector-profiles.test.ts holds the
 *  profiles to this list; lib/cards/frame-reference-registry.ts reads it
 *  for the walkthrough's sample. Never a base another profile spreads. */
export const COLLECTOR_TEMPLATES = [
  "m15",
  "m15land",
  "m15snowland",
  "m15artifact",
  "m15snow",
  "m15devoid",
  "m15pw",
  "m15token",
  "m15tokenartifact",
  "m15tokentext",
  "m15tokenartifacttext",
  "emblem",
  // The transform bodies (TODO 5.1a): both faces print the card's ONE
  // collector line through M15's slot (design D8; the © slot follows each
  // face's own drawn plate).
  "m15dfcfront",
  "m15dfcback",
  "m15dfcbackleft",
  "m15dfclandfront",
  "m15dfclandback",
] as const;

export type CollectorLetter = "T" | "E" | "L" | "C" | "U" | "R" | "M";

const RARITY_LETTER: Readonly<Record<string, CollectorLetter>> = {
  common: "C",
  uncommon: "U",
  rare: "R",
  mythic: "M",
};

function hasWord(text: string | null | undefined, word: string): boolean {
  return (text ?? "").split(/\s+/).some((part) => part.toLowerCase() === word.toLowerCase());
}

/** The facts the letter reads. */
export type CollectorLetterFacts = {
  cardType?: string | null;
  supertype?: string | null;
  rarity?: string | null;
};

/**
 * The rarity letter, in order: T on a token (a stored token rarity is
 * ignored), E on an emblem, L on a basic land (the word Basic in the
 * supertype of a land), else the rarity's C / U / R / M — or null when the
 * card has none of these (an unrated card prints no letter).
 */
export function collectorLetter(card: CollectorLetterFacts): CollectorLetter | null {
  if (card.cardType === "token") return "T";
  if (card.cardType === "emblem") return "E";
  if (card.cardType === "land" && hasWord(card.supertype, "Basic")) return "L";
  return RARITY_LETTER[(card.rarity ?? "").toLowerCase()] ?? null;
}

/** A piece of a number: text in the collector face, or the ★ path (a ★
 *  stored in a number — Scryfall's "265★"). */
export type CollectorNumberRun = { kind: "text"; text: string } | { kind: "star" };

function splitStars(text: string): CollectorNumberRun[] {
  const out: CollectorNumberRun[] = [];
  text.split("★").forEach((part, i) => {
    if (i > 0) out.push({ kind: "star" });
    if (part) out.push({ kind: "text", text: part });
  });
  return out;
}

const NUMERIC = /^(\d+)(?:\/(\d+))?$/;

/**
 * The number as the style prints it. "2015": the digits and any stored set
 * size each padded to three ("1/16" → "001/016", "107/281" as it is).
 * "2023": the digits padded to four, with any "/size" dropped ("9" →
 * "0009", "107/281" → "0107"). A non-numeric number ("237a", "H13",
 * "XLN-117") prints as stored, in either style; a ★ in it becomes the ★
 * run, a † the font's glyph. Nothing for an empty number.
 */
export function collectorNumberRuns(stored: string | null | undefined, style: CollectorStyle): CollectorNumberRun[] {
  const number = (stored ?? "").trim();
  if (!number) return [];
  const m = NUMERIC.exec(number);
  if (!m) return splitStars(number);
  const [, digits, size] = m;
  if (style === "2023") return [{ kind: "text", text: digits.padStart(4, "0") }];
  return [{ kind: "text", text: size ? `${digits.padStart(3, "0")}/${size.padStart(3, "0")}` : digits.padStart(3, "0") }];
}

/** The facts the two lines read. */
export type CollectorContentFacts = CollectorLetterFacts & {
  setCode?: string | null;
  collectorNumber?: string | null;
  lang?: string | null;
  artistCredit?: string | null;
  /** The card's finish: a foil or etched card prints the ★ separator
   *  (owner 2026-10-02: etched is a foil treatment, every etched print
   *  carries the ★). */
  finish?: string | null;
  /** FrameStyle.star — the foil-printing flag (owner 2026-09-29: a separate
   *  ★ with no sheen, free for every plan). */
  star?: boolean | null;
};

export type CollectorLine1 = {
  style: CollectorStyle;
  letter: CollectorLetter | null;
  number: CollectorNumberRun[];
};

export type CollectorLine2 = {
  /** The printed set code, upper case, or null. */
  setCode: string | null;
  /** The printed language code (EN, SP, KR …), or null for a language no
   *  scan has verified a printed code for — never invented. */
  language: string | null;
  /** The separator between set code and language: the ★ for a foil or
   *  etched card or the ★ flag, else the •. Drawn only between two present
   *  pieces. */
  separator: "star" | "dot";
  /** The artist, as stored (the brush precedes it); null prints no brush. */
  artist: string | null;
};

export type CollectorContent = { line1: CollectorLine1; line2: CollectorLine2 };

/** What the two lines say for `card` in `style`. */
export function collectorContent(card: CollectorContentFacts, style: CollectorStyle): CollectorContent {
  const setCode = (card.setCode ?? "").trim().toUpperCase() || null;
  const artist = (card.artistCredit ?? "").trim() || null;
  return {
    line1: { style, letter: collectorLetter(card), number: collectorNumberRuns(card.collectorNumber, style) },
    line2: {
      setCode,
      language: printedLangCode(card.lang),
      separator: card.star === true || card.finish === "foil" || card.finish === "etched" ? "star" : "dot",
      artist,
    },
  };
}

/** Line 1's text in the "2023" style: the letter, a space, the number — or
 *  whichever of the two the card has. Null when it has neither. */
export function collectorLine1Text2023(line1: CollectorLine1): string | null {
  const number = line1.number.map((run) => (run.kind === "text" ? run.text : "★")).join("");
  const parts = [line1.letter, number].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(" ") : null;
}

// ---------------------------------------------------------------------------
// The two glyphs no card font has — our own flat paths, drawn identically by
// both renderers (the ROSE_STAR_PATH pattern): the ★ separator and the
// brush before the artist.
// ---------------------------------------------------------------------------

/** The ★ (a five-point star, points at r 10 and waist at r 4 on a 20 × 20
 *  box, apex up). */
export const COLLECTOR_STAR_VIEWBOX = "0 0 20 20";
export const COLLECTOR_STAR_PATH =
  "M10 0 L12.35 6.76 L19.51 6.91 L13.8 11.24 L15.88 18.09 L10 14 L4.12 18.09 L6.2 11.24 L0.49 6.91 L7.65 6.76 Z";

/** The brush before the artist (the prints' paintbrush glyph: a leaf-shaped
 *  bristle body pointing right, a notched tail on the left, a slit along
 *  its back — DMU #107 at 10×), on a 40 × 24 box. The slit is a hole:
 *  draw with fill-rule evenodd (both renderers do; Satori keeps it). */
export const COLLECTOR_BRUSH_VIEWBOX = "0 0 40 24";
export const COLLECTOR_BRUSH_PATH =
  "M0 5 C10 0.5 26 2 40 12.5 C26 23 10 23.5 0 19 L6 12 Z M7 11 C14 6.5 22 5 30 6 C22 6.6 14 8.4 7.8 12.4 Z";
