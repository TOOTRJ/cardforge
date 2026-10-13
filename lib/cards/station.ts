import type { FaceContent, StationTierContent } from "@/types/card";

// ---------------------------------------------------------------------------
// The station frame's TIERS (TODO 4.27a, step 1 — Edge of Eternities'
// Spacecraft and Planets). Pure and isomorphic: the data shape's text
// grammar, the measured constants and the band arithmetic. No imports from
// the renderers, no scan and no master is read by anything here.
//
// DATA. A station card's text is a TOP BAND (ordinary abilities and the
// Station reminder) and 0–3 TIERS, each a charge threshold "N+" and its
// text; at most ONE tier carries the card's power / toughness (the tier
// that makes it a creature — any tier, never the top band; owner round 54,
// decisions 4–6). Structured rows live in `face_content.station`, beside
// the walker's rows and the saga's chapters, and are read BEFORE
// `rules_text` (resolveStationTiers) — exactly as theirs are.
//
// GRAMMAR. The same card as plain text is Scryfall's own oracle shape:
//
//     <top band, any number of lines>
//     N+ | <first paragraph of tier N>
//     <further paragraphs of that tier, one per line>
//     M+ | <first paragraph of the next tier>
//
// A line opens a tier when it starts with 1–2 digits, "+", optional spaces,
// "|" (TIER_LINE). Every later line belongs to the open tier until the next
// tier line; every line before the first tier line is the top band. A card
// stored as plain text therefore draws its tiers; a text with no tier line
// is a top band alone (a Spacecraft with no tier, decision 5).
//
// Which tier is plated, read from plain text: the tier whose threshold the
// reminder names ("It's an artifact creature at 12+."), else the LAST tier —
// only on a card that prints a P/T at all. Rows can say more than the text
// (a plate on another tier): the dual write is skipped there, as it is for
// a saga row the text can't spell (lib/creator/structured-rules.ts).
// ---------------------------------------------------------------------------

/** A custom card may have up to three tiers (prints have one or two). */
export const STATION_MAX_TIERS = 3;
/** Thresholds printed: 1+ … 20+. Two digits fit the badge. */
export const STATION_MAX_THRESHOLD = 99;

const TIER_LINE = /^(\d{1,2})\+\s*\|\s?(.*)$/;
const CREATURE_AT = /creature at (\d{1,2})\+/i;

export type StationTier = {
  threshold: number;
  text: string;
  /** This tier prints the card's power / toughness on the plate. */
  pt: boolean;
};

export type StationText = {
  /** The top band's text ("" when the card starts with a tier). */
  intro: string;
  tiers: StationTier[];
};

/** Plain rules text → the top band and the tiers (the grammar above).
 *  `hasPt`: the card prints a power / toughness — without one no tier is
 *  plated. More than STATION_MAX_TIERS tier lines: the extra lines stay in
 *  the last tier's text as typed (nothing is dropped, nothing is drawn as a
 *  fourth band). */
export function parseStationText(rulesText: string | null | undefined, hasPt = false): StationText {
  const intro: string[] = [];
  const tiers: StationTier[] = [];
  for (const line of (rulesText ?? "").split("\n")) {
    const match = TIER_LINE.exec(line);
    const threshold = match ? Number(match[1]) : 0;
    if (match && threshold >= 1 && tiers.length < STATION_MAX_TIERS) {
      tiers.push({ threshold, text: match[2] ?? "", pt: false });
    } else if (tiers.length > 0) {
      const open = tiers[tiers.length - 1]!;
      open.text = open.text === "" ? line : `${open.text}\n${line}`;
    } else {
      intro.push(line);
    }
  }
  const text: StationText = { intro: intro.join("\n").trim(), tiers: tiers.map((t) => ({ ...t, text: t.text.trim() })) };
  if (hasPt && text.tiers.length > 0) text.tiers[platedTierIndex(text.intro, text.tiers)]!.pt = true;
  return text;
}

/** The tier a plain text plates: the one its reminder names, else the last. */
export function platedTierIndex(intro: string, tiers: readonly Pick<StationTier, "threshold">[]): number {
  const named = CREATURE_AT.exec(intro)?.[1];
  const at = named ? tiers.findIndex((t) => t.threshold === Number(named)) : -1;
  return at >= 0 ? at : tiers.length - 1;
}

/** The top band and the tiers → canonical rules text (Scryfall's shape). */
export function serializeStation(intro: string | null | undefined, tiers: readonly Pick<StationTier, "threshold" | "text">[]): string {
  return [intro?.trim() || null, ...tiers.map((t) => `${t.threshold}+ | ${t.text.trim()}`)].filter((part) => part !== null).join("\n");
}

/** True when plain text can say everything the rows do: the plated tier is
 *  the one the text would plate anyway (or none is plated). False = the
 *  rows are the only record of the plate's tier; never rewrite rules_text
 *  from them and expect the drawing to survive without face_content. */
export function stationTextSaysRows(intro: string, tiers: readonly StationTier[]): boolean {
  const plated = tiers.findIndex((t) => t.pt);
  return plated < 0 || plated === platedTierIndex(intro, tiers);
}

/** Rows for the editor / the dual write from a legacy plain text. */
export function stationFromRulesText(rulesText: string | null | undefined, hasPt = false): { intro: string | null; tiers: StationTierContent[] } {
  const parsed = parseStationText(rulesText, hasPt);
  return {
    intro: parsed.intro === "" ? null : parsed.intro,
    tiers: parsed.tiers.map((t) => ({ threshold: t.threshold, text: t.text, ...(t.pt ? { pt: true as const } : {}) })),
  };
}

/** What BOTH renderers call: the structured rows first, the plain text's
 *  grammar otherwise. A plate is only ever on a card that prints a P/T. */
export function resolveStationTiers(
  faceContent: FaceContent | null | undefined,
  rulesText: string | null | undefined,
  hasPt: boolean,
): StationText {
  const rows = faceContent?.station;
  if (!rows) return parseStationText(rulesText, hasPt);
  const tiers = rows.tiers.slice(0, STATION_MAX_TIERS).map((t) => ({ threshold: t.threshold, text: t.text, pt: hasPt && t.pt === true }));
  // More than one row marked (the schema refuses it; a hand-edited row): the first wins.
  const first = tiers.findIndex((t) => t.pt);
  return { intro: rows.intro?.trim() ?? "", tiers: tiers.map((t, i) => ({ ...t, pt: i === first })) };
}

// ---------------------------------------------------------------------------
// Measured constants (HD px, a 1500 × 2100 card) — proof 1, 2026-10-13: 30
// bordered station printings against 16 M15 controls of the same set. The
// numbers and their spreads: scripts/lib/station-2025.mjs.
// ---------------------------------------------------------------------------

export const STATION = {
  /** The text box inside its pinline (M15's own box). */
  box: { left: 112, right: 1388, top: 1313, bottom: 1936 },
  /** A tier band = its text + 2 × padY, never under minPx (prints: 168 for
   *  a one-line upper tier, 176–178 for a one-line last tier); the top band
   *  takes the rest. `compact`: what the bands give up — floor and air —
   *  before any text clips on a card fuller than print's (three tiers under
   *  a whole reminder). A badge (120 px) still fits its band. */
  band: { minPx: 168, lastExtraPx: 8, padY: 36, topPadY: 20 },
  compactBand: { minPx: 124, lastExtraPx: 4, padY: 14, topPadY: 6 },
  /** Tier text starts past the badge; the top band's at M15's own start. */
  tierTextLeft: 180,
  /** Badge: a dark disc in a ring of the pinline's colour, centred on the
   *  box's left pinline and on its band (31 read: x 99.5–101, r 49.4–50.9). */
  badge: { cx: 100, rFill: 50, rRing: 60, capPx: 42 },
  /** Plate: outer 231 × 112 with a 14 px rim, its two ends arcs; centre
   *  x 1305.5 (21 read: 1305.5–1306.5), y its band's centre. WHITE digits,
   *  52 px tall (255 on 21 of 21). */
  plate: { cx: 1305.5, outerW: 231, outerH: 112, rim: 14, endSagitta: 15, digitPx: 52 },
  /** The tier wash over the master's see-through box: the key's colour at
   *  these opacities (tier 1 and 2 fitted on prints; tier 3 extrapolated —
   *  no print has one; owner round 54, decisions 2 and 4). */
  tierOpacity: [0.25, 0.57, 0.78],
} as const;

export type StationKey = "w" | "u" | "b" | "r" | "g" | "m" | "c";

/** Per colour key: the tier wash's colour and the pinline's (the badge ring
 *  and the plate rim) — fitted / median RGB on the prints. */
export const STATION_COLOURS: Readonly<Record<StationKey, { tier: readonly [number, number, number]; rim: readonly [number, number, number] }>> = {
  w: { tier: [87, 99, 100], rim: [243, 243, 237] },
  u: { tier: [0, 127, 198], rim: [8, 118, 176] },
  b: { tier: [45, 45, 40], rim: [70, 66, 64] },
  r: { tier: [255, 47, 31], rim: [226, 76, 58] },
  g: { tier: [0, 111, 38], rim: [15, 116, 69] },
  m: { tier: [142, 132, 16], rim: [230, 211, 122] },
  c: { tier: [110, 147, 165], rim: [222, 224, 227] },
};

export type StationBand = { y0: number; y1: number; cy: number };
export type StationBands = { top: StationBand; tiers: StationBand[]; fits: boolean };

/**
 * Band rows (HD px) for block heights measured at ONE text size: the tiers
 * from the box's bottom up, each its text + padding (never under the floor),
 * the top band what is left. `fits` = the top band still holds its text.
 * The rules layout (lib/cards/rules-layout.ts) measures the heights and picks
 * the size; this is only the arithmetic both renderers' layout shares.
 */
export function stationBands(topTextH: number, tierTextH: readonly number[], compact = false): StationBands {
  const { box } = STATION;
  const rule = compact ? STATION.compactBand : STATION.band;
  let y: number = box.bottom;
  const tiers: StationBand[] = [];
  for (let i = tierTextH.length - 1; i >= 0; i--) {
    const floor = rule.minPx + (i === tierTextH.length - 1 ? rule.lastExtraPx : 0);
    const h = Math.max(floor, Math.ceil(tierTextH[i]!) + 2 * rule.padY);
    tiers.unshift({ y0: y - h, y1: y, cy: y - h / 2 });
    y -= h;
  }
  const fits = y - box.top >= (topTextH > 0 ? topTextH + 2 * rule.topPadY : 0);
  return { top: { y0: box.top, y1: y, cy: (box.top + y) / 2 }, tiers, fits };
}
