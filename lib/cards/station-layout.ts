import {
  blockHeightPx,
  layoutRulesAt,
  rulesLadderPx,
  type RulesLayout,
  type RulesLayoutInput,
} from "@/lib/cards/rules-layout";
import { STATION, stationBands, type StationBandRule, type StationBands, type StationText } from "@/lib/cards/station";
import { stationBadgeArt, stationBandArt, stationPlateArt, type StationArtStyle } from "@/lib/cards/station-art";
import type { FrameProfile, Rect, StatSlot } from "@/lib/cards/template-layout";
import type { SymbolStyle } from "@/lib/cards/symbol-style";
import { RULES_HD_WIDTH } from "@/lib/cards/typography";

// ---------------------------------------------------------------------------
// The station frame's TIERS layout (TODO 4.27a) — the `tiers` anatomy of the
// ONE rules layout. A station card's text box is a top band (rules + the
// Station reminder + any flavour) over 0–3 tier bands; this module decides,
// ONCE for the whole box and for both bake targets:
//
//   the size    — one rung of the rules ladder for every band of the card;
//   the bands   — each tier its text + padding (never under its floor), the
//                 top band the rest (lib/cards/station.ts stationBands);
//   the lines   — every band's text is a box of lib/cards/rules-layout.ts
//                 (layoutRulesAt: MPlantin's real advances, both targets),
//                 centred in its band; a tier's column starts past its badge;
//   the plate   — on the ONE plated tier, at its band's centre: a FLOAT the
//                 tier's lines break short of, and a glyph-level keep-out;
//   the stamp   — the holofoil stamp's arch, a keep-out of the last band.
//
// The fit: for each ladder size, largest first, the band rules in order
// (roomy → tight); the first (size, rule) at which every band holds its text
// at both targets wins. Print does the same in a full box — a larger size
// with less air (findings 2026-10-13). Nothing fits → the floor's layout at
// the tightest rule, `clipped`.
//
// Both renderers only DRAW the result (stationDrawing): the bands, badge
// discs and plate are frame pieces — <img>s of lib/cards/station-art.ts'
// inline SVGs, right after the frame and under both finishes, which mask
// with them (the saga rail's pattern); the numerals and digits are ink, set
// by the stat fit in slots built here; the text is RulesBox / RulesBoxBake.
// Every piece's box is EVEN in HD px: a whole px at the 750 px target.
//
// Pure and isomorphic. No renderer import.
// ---------------------------------------------------------------------------

const HD_W = RULES_HD_WIDTH.portrait;
const HD_H = 2100;
const ASPECT = 7 / 5;

const pct = (x0: number, y0: number, x1: number, y1: number): Rect => ({
  leftPct: (x0 / HD_W) * 100,
  topPct: (y0 / HD_H) * 100,
  widthPct: ((x1 - x0) / HD_W) * 100,
  heightPct: ((y1 - y0) / HD_H) * 100,
});
const even = (px: number) => 2 * Math.round(px / 2);

export type StationLayoutInput = {
  /** The frame's profile: its rules slot gives the top band's column, size
   *  ceiling, line height and padding. */
  profile: Pick<FrameProfile, "rules" | "tiers" | "symbolStyle">;
  /** The top band and the tiers (lib/cards/station.ts resolveStationTiers). */
  text: StationText;
  flavorText?: string | null;
  /** The P/T the plate prints ("4/4"), or null when the card prints none —
   *  then no tier is plated whatever the rows say. */
  ptValue: string | null;
  /** The holofoil stamp's keep-out while the stamp is drawn. */
  stamp?: Rect | null;
};

export type StationPlate = { x0: number; y0: number; x1: number; y1: number; value: string };

export type StationLayout = {
  sizePx: number;
  /** Index into STATION.bandRules the fit settled on. */
  rule: number;
  /** HD px. */
  bands: StationBands;
  /** The top band's text (null when it has none). */
  top: RulesLayout | null;
  /** Per tier: its threshold and its text (null when empty). */
  tiers: { threshold: number; text: RulesLayout | null }[];
  plate: StationPlate | null;
  /** True when no size holds every band's text (the floor is drawn). */
  clipped: boolean;
};

function plateBox(cy: number, value: string): StationPlate {
  const { plate } = STATION;
  const y0 = even(cy - plate.outerH / 2);
  return { x0: plate.x0, y0, x1: plate.x1, y1: y0 + plate.outerH, value };
}

/** What the plated tier's lines keep clear of: the plate and its air. */
function plateKeepOut(p: Pick<StationPlate, "x0" | "y0" | "x1" | "y1">): Rect {
  const { plate } = STATION;
  return pct(p.x0 - plate.airLeft, p.y0 - plate.airY, p.x1, p.y1 + plate.airY);
}

function layAt(input: StationLayoutInput, sizePx: number, rule: StationBandRule, ruleIndex: number): StationLayout {
  const slot = input.profile.rules;
  const slotLeft = (slot.rect.leftPct / 100) * HD_W;
  const slotRight = ((slot.rect.leftPct + slot.rect.widthPct) / 100) * HD_W;
  const pad = slot.padPx ?? { x: 4, y: 0 };
  const padLeft = typeof pad === "function" ? 4 : "x" in pad ? pad.x : pad.left;
  const base = (rulesText: string, flavorText: string | null, x0: number, y0: number, y1: number): RulesLayoutInput => ({
    rulesText,
    flavorText,
    rect: pct(x0, y0, slotRight, y1),
    aspect: ASPECT,
    sizePct: slot.sizePct,
    ...(slot.lineHeight ? { lineHeight: slot.lineHeight } : {}),
    padPx: { x: padLeft, y: 0 },
    vAlign: "center",
    divider: true,
    ...(input.profile.symbolStyle ? { symbolStyle: input.profile.symbolStyle as SymbolStyle } : {}),
  });
  const tierLeft = STATION.tierTextLeft - padLeft;
  const { text } = input;
  const flavor = input.flavorText?.trim() ? input.flavorText : null;
  const hasTop = text.intro !== "" || flavor !== null;
  const plated = input.ptValue ? text.tiers.findIndex((t) => t.pt) : -1;

  // Heights first, each block in a box tall enough never to clip (the plated
  // tier with the plate floated at a provisional centre: its lines break
  // short of the plate's column wherever the band lands), then the bands.
  const tall = (layoutInput: RulesLayoutInput) => blockHeightPx(layoutRulesAt(layoutInput, sizePx), "hd");
  const topH = hasTop ? tall(base(text.intro, flavor, slotLeft, 0, HD_H)) : 0;
  const tierH = text.tiers.map((tier, i) => {
    if (tier.text === "") return 0;
    const probe = i === plated ? [plateKeepOut(plateBox(HD_H / 2, ""))] : [];
    return tall({ ...base(tier.text, null, tierLeft, 0, HD_H), ...(probe.length ? { floats: probe } : {}) });
  });
  const bands = stationBands(topH, tierH, rule);

  const stamp = input.stamp ? [input.stamp] : [];
  const lastBand = text.tiers.length - 1;
  const top = hasTop
    ? layoutRulesAt({ ...base(text.intro, flavor, slotLeft, bands.top.y0, bands.top.y1), ...(lastBand < 0 && stamp.length ? { keepOuts: stamp } : {}) }, sizePx)
    : null;
  let plate: StationPlate | null = null;
  const tiers = text.tiers.map((tier, i) => {
    const band = bands.tiers[i]!;
    const floats: Rect[] = [];
    if (i === plated) {
      plate = plateBox(band.cy, input.ptValue!);
      floats.push(plateKeepOut(plate));
    }
    const keepOuts = i === lastBand ? stamp : [];
    const layout =
      tier.text === ""
        ? null
        : layoutRulesAt(
            { ...base(tier.text, null, tierLeft, band.y0, band.y1), ...(keepOuts.length ? { keepOuts } : {}), ...(floats.length ? { floats } : {}) },
            sizePx,
          );
    return { threshold: tier.threshold, text: layout };
  });
  const clipped = !bands.fits || Boolean(top?.clipped) || tiers.some((t) => t.text?.clipped);
  return { sizePx, rule: ruleIndex, bands, top, tiers, plate, clipped };
}

export type StationFitOrder = readonly (readonly [rule: number, minSizePx: number])[];

/** The station box laid out: band rule by band rule (STATION.fitOrder —
 *  roomy first), each at the largest size down to that rule's smallest, the
 *  first at which every band holds its text at both targets. */
export function stationLayout(
  input: StationLayoutInput,
  order: StationFitOrder = STATION.fitOrder,
  rules: readonly StationBandRule[] = STATION.bandRules,
): StationLayout {
  const ladder = rulesLadderPx(input.profile.rules.sizePct, "portrait");
  let last: StationLayout | null = null;
  for (const [r, minSizePx] of order) {
    for (const sizePx of ladder) {
      if (sizePx < minSizePx) break;
      last = layAt(input, sizePx, rules[r]!, r);
      if (!last.clipped) return last;
    }
  }
  return last!;
}

// ---------------------------------------------------------------------------
// What a renderer draws
// ---------------------------------------------------------------------------

/** A frame piece: an <img> of `href` stretched over `rect` — right after the
 *  frame, under both finishes (and in their masks). */
export type StationPiece = { kind: "band" | "badge" | "plate"; href: string; rect: Rect };
/** A value set by the stat fit in `slot` (StatBake / StatOverlay). */
export type StationValue = { slot: StatSlot; value: string };

export type StationDrawing = {
  pieces: StationPiece[];
  /** The badge numerals ("7+") and the plate's digits: ink over the pieces. */
  values: StationValue[];
  /** Every band's text, top band first. */
  texts: RulesLayout[];
  textColorHex: string;
};

const BADGE_VALUE_DY_EM = -0.06;
const PLATE_VALUE_DY_EM = -0.05;

/** The pieces, values and text boxes of a laid-out station box, in card
 *  percents (every box even HD px), for the frame master `masterKey`. */
export function stationDrawing(
  layout: StationLayout,
  profile: Pick<FrameProfile, "tiers">,
  masterKey: string,
  style: StationArtStyle = "bevel",
): StationDrawing {
  const { box, badge, plate: P } = STATION;
  const inks = profile.tiers ?? { textColorHex: "#000000", digitColorHex: "#ffffff" };
  const pieces: StationPiece[] = [];
  const values: StationValue[] = [];
  layout.bands.tiers.forEach((band, i) => {
    pieces.push({ kind: "band", href: stationBandArt(masterKey, i), rect: pct(box.left, band.y0, box.right, band.y1) });
  });
  layout.bands.tiers.forEach((band, i) => {
    const top = even(band.cy - badge.rRing);
    const rect = pct(badge.cx - badge.rRing, top, badge.cx + badge.rRing, top + 2 * badge.rRing);
    pieces.push({ kind: "badge", href: stationBadgeArt(masterKey, style), rect });
    values.push({
      value: `${layout.tiers[i]!.threshold}+`,
      slot: {
        rect,
        sizePct: badge.numeralPx / HD_W,
        colorHex: inks.digitColorHex,
        weight: 700,
        valueDyEm: BADGE_VALUE_DY_EM,
        inkSpanPct: { leftPct: ((badge.cx - badge.inkHalfWidth) / HD_W) * 100, rightPct: ((badge.cx + badge.inkHalfWidth) / HD_W) * 100 },
      },
    });
  });
  if (layout.plate) {
    const p = layout.plate;
    const rect = pct(p.x0, p.y0, p.x1, p.y1);
    pieces.push({ kind: "plate", href: stationPlateArt(masterKey, style), rect });
    values.push({
      value: p.value,
      slot: {
        rect,
        sizePct: P.digitPx / HD_W,
        colorHex: inks.digitColorHex,
        weight: 700,
        valueDyEm: PLATE_VALUE_DY_EM,
        inkSpanPct: { leftPct: ((p.x0 + P.rim + 8) / HD_W) * 100, rightPct: ((p.x1 - P.rim - 8) / HD_W) * 100 },
      },
    });
  }
  const texts = [layout.top, ...layout.tiers.map((t) => t.text)].filter((t): t is RulesLayout => t !== null);
  return { pieces, values, texts, textColorHex: inks.textColorHex };
}

/** The station box of a card on `profile` — null on every other frame. What
 *  BOTH renderers call. */
export function profileStationLayout(profile: Pick<FrameProfile, "rules" | "tiers" | "symbolStyle">, input: Omit<StationLayoutInput, "profile">): StationLayout | null {
  return profile.tiers ? stationLayout({ ...input, profile }) : null;
}
