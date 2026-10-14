// ---------------------------------------------------------------------------
// A Spacecraft / Planet whose text does not fit its bands (TODO 4.27a, PR 3;
// owner round 58, decision 2: "a note when a Spacecraft's text does not fit —
// add before the ticks") — what the tier editor's note reads. A READER of
// the station layout (lib/cards/station-layout.ts), never a second one: no
// renderer changes, nothing is blocked.
//
// What counts: text that is really CUT. The layout's own `clipped` flag is
// wider than that — it is also set when no size leaves every band its
// minimum AIR (`bands.fits`, under 8 px at the tightest rule), a card that
// is drawn whole with its lines close to the band's edges (the independent
// check of #549). The note reads the bands' TEXTS instead: a band is cut
// when the ONE rules layout says its lines overflow its rows at either bake
// target (`RulesLayout.clipped` — the flag tests/unit/render/
// rules-no-clip.test.tsx holds real bakes to).
//
// Read from the card as the creator shows it: the frame's profile, the text
// and the tier the P/T is on (the plate is a float of that tier), the
// flavour text (it sits in the top band), the holofoil stamp when the card
// draws one (its arch is a keep-out of the last band).
// Pure: no form, no React (tests/unit/creator/station-fit.test.ts).
// ---------------------------------------------------------------------------

import { resolveHoloStamp, type FrameAnatomyStyle } from "@/lib/cards/anatomy";
import { normalizeFrameTemplate, printsPowerToughness } from "@/lib/cards/card-display";
import { ptValue } from "@/lib/cards/stat-fit";
import { STATION_ROW_MAX_CHARS, parseStationText, platedTierIndex } from "@/lib/cards/station";
import { stationLayout, type StationLayout } from "@/lib/cards/station-layout";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { pickFrameColorKey } from "@/components/cards/frame-layer";
import { stationPlatedTier } from "@/lib/creator/station-rows";
import type { CardType, ColorIdentity } from "@/types/card";

/** The bands whose text is cut: the top band, and tiers by index. */
export type StationCut = { top: boolean; tiers: number[] };

/** The bands of a laid-out station box whose text is really cut — null when
 *  none is (whatever `layout.clipped` says: see above). */
export function stationCutBands(layout: Pick<StationLayout, "top" | "tiers"> | null | undefined): StationCut | null {
  if (!layout) return null;
  const top = Boolean(layout.top?.clipped);
  const tiers = layout.tiers.flatMap((tier, i) => (tier.text?.clipped ? [i] : []));
  return top || tiers.length > 0 ? { top, tiers } : null;
}

export type StationFitCard = {
  template: string | null | undefined;
  /** The form's frame_style (the stamp's switch is read from it). */
  frameStyle?: FrameAnatomyStyle | null;
  cardType: CardType | string | null | undefined;
  supertype?: string | null;
  subtypes?: readonly string[] | null;
  colorIdentity?: readonly ColorIdentity[] | null;
  cost?: string | null;
  rarity?: string | null;
  rulesText: string | null | undefined;
  flavorText?: string | null;
  power?: string | null;
  toughness?: string | null;
  /** The form's `station_pt_tier` (null = as the text says). */
  ptTier?: number | null;
};

/** The station box of the card the creator shows, laid out — null off the
 *  station frames. The same inputs both renderers give the layout. */
export function stationFitLayout(card: StationFitCard): StationLayout | null {
  const profile = getFrameProfile(normalizeFrameTemplate(card.template));
  if (!profile.tiers || profile.textless) return null;
  const face = {
    cardType: (card.cardType || null) as CardType | null,
    supertype: card.supertype,
    subtypes: card.subtypes,
    power: card.power,
    toughness: card.toughness,
  };
  const hasPt = printsPowerToughness(face);
  const text = parseStationText(card.rulesText);
  const plated = hasPt ? stationPlatedTier(card.rulesText, card.ptTier) : -1;
  const colors = [...(card.colorIdentity ?? [])];
  const stamp = resolveHoloStamp(profile, card.frameStyle ?? null, {
    colors,
    cost: card.cost,
    cardType: card.cardType,
    supertype: card.supertype,
    dfc: null,
    rarity: card.rarity,
    colorKey: pickFrameColorKey(colors),
  });
  return stationLayout({
    profile,
    text: { intro: text.intro, tiers: text.tiers.map((tier, i) => ({ ...tier, pt: i === plated })) },
    flavorText: card.flavorText,
    ptValue: hasPt ? ptValue(card.power, card.toughness) : null,
    stamp: stamp?.keepOut ?? null,
  });
}

/** The bands of the creator's card whose text is cut, or null. */
export function stationCutOf(card: StationFitCard): StationCut | null {
  return stationCutBands(stationFitLayout(card));
}

const listOf = (parts: string[]) => (parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

/** The note under the tiers: which bands are cut, and what helps. A card
 *  with more text than its whole box holds shares the box between its bands
 *  — each one's end is cut — so it is said once, not band by band. */
export function stationCutNote(cut: StationCut, thresholds: readonly number[]): string {
  if (cut.top && thresholds.length > 0 && cut.tiers.length === thresholds.length) {
    return "This text doesn't fit: the card has more text than its box holds, so the end of every band is cut off. Shorten the text.";
  }
  const bands = [...(cut.top ? ["the top band"] : []), ...cut.tiers.map((i) => `tier ${i + 1} (${thresholds[i] ?? "?"}+)`)];
  const what = listOf(bands);
  return `This text doesn't fit: the card cuts off the end of ${what}. Shorten ${bands.length > 1 ? "them" : "it"}, or move text to another band.`;
}

// ---------------------------------------------------------------------------
// The row limit (the independent check of #549: a silent drop). A band over
// STATION_ROW_MAX_CHARS is more than `face_content` stores, so the save
// writes the card's tiers as lines of text — which draw the same bands —
// and the one thing only the rows can say is lost: a power / toughness on
// another tier than the text plates. The limit stays (it is the walker's
// and the saga's); the editor says so before the save.
// ---------------------------------------------------------------------------

export type StationOverLimit = {
  /** The bands over the limit, as the note names them. */
  bands: string[];
  /** The maker's P/T tier is not the one the text plates: the save puts the
   *  plate on `textTier` (an index) instead of `choice`. Null when the two
   *  agree (nothing is lost) or the card shows no P/T. */
  moves: { choice: number; textTier: number } | null;
};

/** The bands of `rulesText` over the row limit — null when none is, or the
 *  text has no tier (it then saves as plain text anyway, with no rows). */
export function stationOverLimit(rulesText: string | null | undefined, ptTier: number | null | undefined, showsPt: boolean): StationOverLimit | null {
  const parsed = parseStationText(rulesText);
  if (parsed.tiers.length === 0) return null;
  const bands = [
    ...(parsed.intro.length > STATION_ROW_MAX_CHARS ? ["The top band"] : []),
    ...parsed.tiers.flatMap((tier, i) => (tier.text.length > STATION_ROW_MAX_CHARS ? [`Tier ${i + 1} (${tier.threshold}+)`] : [])),
  ];
  if (bands.length === 0) return null;
  const choice = showsPt ? stationPlatedTier(rulesText, ptTier) : -1;
  const textTier = platedTierIndex(parsed.intro, parsed.tiers);
  return { bands, moves: choice >= 0 && choice !== textTier ? { choice, textTier } : null };
}

/** The note for a band over the limit. */
export function stationOverLimitNote(over: StationOverLimit, thresholds: readonly number[]): string {
  const subject = listOf(over.bands);
  const head = `${subject} ${over.bands.length > 1 ? "are" : "is"} over ${STATION_ROW_MAX_CHARS} characters: this card saves its tiers as lines of text. It prints the same bands`;
  if (!over.moves) return `${head}.`;
  const to = `tier ${over.moves.textTier + 1} (${thresholds[over.moves.textTier] ?? "?"}+)`;
  return `${head} — but the power / toughness goes back to ${to}, the tier the text names, not the one picked here. Shorten the text to keep your pick.`;
}
