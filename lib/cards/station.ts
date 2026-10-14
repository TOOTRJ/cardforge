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
  /** The see-through text box of OUR masters, inside the pinline: pixels
   *  110..1390 × 1314..1937 (the recipe's cut, scripts/lib/station-2025.mjs;
   *  the prints' reads 112..1388 × 1312..1935 at half our size). Written as
   *  the box the bands are DRAWN in, every edge EVEN so it is a whole px at
   *  the 750 px target too: `right` is 1392, one px into the pinline's
   *  antialiased edge, rather than a half px short of it. */
  box: { left: 110, right: 1392, top: 1314, bottom: 1938 },
  /** PRINT'S BAND RULE (the independent check of #543, 2026-10-13; fitted
   *  again on the real bake for PR 2): every band of a card — the top band
   *  and each tier — has the SAME air above and below its text, whatever
   *  the box has left once the text is set; a tier is never shorter than
   *  its floor (168 px, a one-line upper tier; 180 px, a one-line last
   *  tier), and under a STAMPED last tier print leaves `stampAirPx` more —
   *  the holofoil stamp's arch — and centres the tier's text, badge and
   *  plate on what is above it. A size is taken while the air is at least
   *  `minAirPx`. Rule 0 is print's; rule 1 is what the bands give up — their
   *  floor, never print's air — before any text clips on a card fuller than
   *  any print (three tiers under a whole reminder; EOC #14, the fullest
   *  print): a badge (120 px) still fits its band. Rule 2 is the last step before a clip, at the two smallest sizes
   *  only: a band may be shorter than a badge, which is then drawn smaller
   *  (as the saga's rail gives up its badge stacks before its text). Past
   *  rule 2 at the smallest size the bands share the box by their text
   *  (stationBands): the box is the box, never a band over the type bar.
   *  Tier heights are EVEN px. */
  bandRules: [
    { tierFloorPx: 168, lastFloorPx: 180, stampAirPx: 22, minAirPx: 14 },
    { tierFloorPx: 124, lastFloorPx: 124, stampAirPx: 22, minAirPx: 14 },
    { tierFloorPx: 84, lastFloorPx: 84, stampAirPx: 22, minAirPx: 8 },
  ],
  /** With no top text the tiers do not stretch over the whole box: their air
   *  stops here (print's roomiest band has 45 px) and the top band is the
   *  rest, empty. */
  maxAirNoTopPx: 44,
  /** A band shorter than a piece + this draws the piece smaller (rule 2
   *  only: the badge and the plate shrink before any text clips). */
  pieceAirPx: 4,
  /** The fit's order (lib/cards/station-layout.ts): [band rule, the smallest
   *  size it is tried at] — print's rule down to 50 px, then the tight one
   *  from the top (EOC #14, the fullest print, sets a one-line upper tier in
   *  126 px rather than its text under 50). */
  fitOrder: [
    [0, 50, 999],
    [1, 42, 999],
    [2, 42, 46],
  ],
  /** The top band's text column is the profile's own rules slot (M15's: ink
   *  from 132 px; prints 130–131). A tier's starts past the badge, at 180. */
  tierTextLeft: 180,
  /** Badge: a dark disc in a ring of the pinline's colour, centred on the
   *  box's left pinline and on its band (31 read: x 99.5–101, r 49.4–50.9).
   *  Numeral: white, cap height 42 px — Beleren at 58 px; a two-digit
   *  numeral ("12+", "20+") prints as tall, so the ink's span is nearly the
   *  whole face (92 of 100 px). Print's ink sits 2–3 px right of the disc's
   *  centre (`valueDxEm`; the plate's digits 2 px, its own `valueDxEm`). */
  badge: { cx: 100, rFill: 50, rRing: 60, numeralPx: 58, inkHalfWidth: 46, valueDxEm: 0.04 },
  /** Plate: outer 230 × 112 (x 1190–1420 on 21 prints, centre 1305.5) with
   *  a 14 px rim, its two ends arcs; y its band's centre. WHITE digits,
   *  52 px tall (255 on 21 of 21) — Beleren at 70 px; a wider value shrinks
   *  to the face (lib/cards/stat-fit.ts: "20/20" prints 47 px tall — the
   *  digits' span is the plate less `digitInset` px a side, 162 px). The
   *  tier's lines break short of the plate, `airLeft` px before it. */
  plate: { x0: 1190, x1: 1420, outerW: 230, outerH: 112, rim: 14, endSagitta: 15, digitPx: 70, digitInset: 34, valueDxEm: 0.03, airLeft: 12, airY: 6 },
  /** The tier wash over the master's see-through box: the key's colour at
   *  these opacities (tier 1 and 2 fitted on prints; tier 3 extrapolated —
   *  no print has one; owner round 54, decisions 2 and 4). */
  tierOpacity: [0.25, 0.57, 0.78],
} as const;

export type StationBandRule = { tierFloorPx: number; lastFloorPx: number; stampAirPx: number; minAirPx: number };

export type StationKey = "w" | "u" | "b" | "r" | "g" | "m" | "c";

/** Per colour key: the tier wash's colour and the badge ring's / plate
 *  rim's. `rim` is the tone the pieces are drawn in: the MEDIAN of the
 *  printed rings (the independent check of #543 read 36 of them — print's
 *  ring is one flat tone, about 35 levels under the pinline's brightest
 *  read that PR 1 drew it in; owner round 55, decision 1). */
export const STATION_COLOURS: Readonly<Record<StationKey, { tier: readonly [number, number, number]; rim: readonly [number, number, number] }>> = {
  w: { tier: [87, 99, 100], rim: [204, 199, 196] },
  u: { tier: [0, 127, 198], rim: [18, 103, 150] },
  b: { tier: [45, 45, 40], rim: [89, 83, 81] },
  r: { tier: [255, 47, 31], rim: [195, 67, 56] },
  g: { tier: [0, 111, 38], rim: [18, 98, 68] },
  m: { tier: [142, 132, 16], rim: [194, 177, 101] },
  c: { tier: [110, 147, 165], rim: [189, 189, 191] },
};

/** A band's rows. `cy` is its centre — the badge's and the plate's.
 *  `textY1` is where its text's column ends: `y1`, or higher under the
 *  stamp — the text is centred in y0..textY1, i.e. moved up just far enough
 *  to leave the stamp's air and the card's own air under it (print: a full
 *  stamped tier's text sits 10–24 px above its band's centre, a one-line
 *  tier's on it, the badge on the band's centre either way). */
export type StationBand = { y0: number; y1: number; textY1: number; cy: number };
export type StationBands = { top: StationBand; tiers: StationBand[]; fits: boolean; airPx: number };

const evenRound = (px: number) => 2 * Math.round(px / 2);

/**
 * Band rows (HD px) for block heights measured at ONE text size — print's
 * rule (STATION.bandRules): the same air round every band's text, a tier
 * never under its floor, `stampAirPx` more under a stamped last tier. The
 * air is what solves `sum of the bands = the box`; `fits` = it is at least
 * the rule's `minAirPx`. Where even NO air fits the bands share the box in
 * proportion to their text (never a band outside the box) and `fits` is
 * false. Every tier edge is EVEN (a whole px at the 750 px target); the top
 * band is what is left. A card with no top text gives the tiers the whole
 * box. The station layout (lib/cards/station-layout.ts) measures the
 * heights with the ONE rules layout and picks the size and the rule.
 */
export function stationBands(
  topTextH: number,
  tierTextH: readonly number[],
  rule: StationBandRule = STATION.bandRules[0],
  stamped = false,
): StationBands {
  const { box } = STATION;
  const H = box.bottom - box.top;
  const n = tierTextH.length;
  const last = n - 1;
  const stampAir = stamped && n > 0 ? rule.stampAirPx : 0;
  const hasTop = topTextH > 0;
  const text = tierTextH.map((h, i) => Math.ceil(h) + (i === last ? stampAir : 0));
  const floor = (i: number) => (i === last ? rule.lastFloorPx : rule.tierFloorPx);
  const tierAt = (air: number) => text.map((h, i) => Math.max(floor(i), h + 2 * air));
  const total = (air: number) => tierAt(air).reduce((sum, h) => sum + h, 0) + (hasTop ? Math.ceil(topTextH) + 2 * air : 0);

  let heights: number[];
  let airPx: number;
  if (total(0) > H) {
    // Not even with no air: the bands share the box by their text.
    const all = text.reduce((sum, h) => sum + h, 0) + (hasTop ? Math.ceil(topTextH) : 0);
    heights = text.map((h) => (H * h) / Math.max(all, 1));
    airPx = 0;
  } else {
    let lo = 0;
    let hi = H;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (total(mid) > H) hi = mid;
      else lo = mid;
    }
    airPx = hasTop || n === 0 ? lo : Math.min(lo, STATION.maxAirNoTopPx);
    heights = tierAt(airPx);
  }
  const fits = total(0) <= H && airPx >= rule.minAirPx;
  let y: number = box.bottom;
  const tiers: StationBand[] = [];
  for (let i = last; i >= 0; i--) {
    // Never past the box's top, whatever the rounding.
    const h = Math.min(evenRound(heights[i]!), y - box.top);
    // Under the stamp: the text up by what it lacks of air + stamp air.
    const lift = i === last && stampAir > 0 ? Math.min(evenRound(stampAir / 2), Math.max(0, evenRound(Math.ceil(tierTextH[i]!) / 2 + Math.min(airPx, 2 * rule.minAirPx) + stampAir - h / 2))) : 0;
    tiers.unshift({ y0: y - h, y1: y, textY1: Math.max(y - h + 2, y - 2 * lift), cy: y - h / 2 });
    y -= h;
  }
  return { top: { y0: box.top, y1: y, textY1: y, cy: (box.top + y) / 2 }, tiers, fits, airPx };
}
