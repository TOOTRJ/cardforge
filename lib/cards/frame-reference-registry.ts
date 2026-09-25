import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";
import { basicLandNameForColorKey } from "@/lib/cards/watermark";
import referencesData from "@/lib/cards/frame-references.json";

// ---------------------------------------------------------------------------
// Frame reference registry — real printed cards per (template, colour)
// combination, used by the admin frame-compare tool to verify that every
// frame the site ships renders like the real thing.
//
// The DATA lives in lib/cards/frame-references.json (one entry per
// template: an optional note, a `confirm` flag for families Scryfall can't
// tell apart, and per colour an ORDERED list of printings or null when no
// real printing exists — mono-colour split cards, 1993 tokens…). The first
// printing is the default the checklist and the score use; the rest are
// alternates the compare view can switch to (short vs long text, another
// set), because one reference can't exercise every fit rule.
//
// Provenance: the M15-era defaults were researched by hand against the live
// API (2026-07-01, `highres_scan` prints); everything else was found by
// scripts/find-frame-references.mjs (2026-09-25) with a quality TIER:
// absent = highres non-foil non-promo, 1 = only a low-res scan exists,
// 2 = foil-only or promo print (scans of foils distort). Rerun the script to
// refresh candidates; edit the JSON to curate.
// ---------------------------------------------------------------------------

export type FrameReference = {
  /** Card name as printed. */
  name: string;
  /** Scryfall set code of the exact printing. */
  set: string;
  /** Scryfall id of the exact printing. */
  scryfallId: string;
  /** Scan quality caveat (see header); absent = ideal. */
  tier?: 1 | 2;
  /** Hand-researched default (2026-07-01) rather than a script candidate. */
  curated?: true;
};

export const FRAME_COLOR_KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;

export type FrameColorKey = (typeof FRAME_COLOR_KEYS)[number];

type ReferenceRow = Record<FrameColorKey, FrameReference | null>;

type TemplateReferences = {
  note?: string;
  confirm?: boolean;
  colors: Record<string, FrameReference[] | null>;
};

const DATA = referencesData as Record<string, TemplateReferences>;

/** Every candidate printing for a combo, default first; empty when no real
 *  printing exists. */
export function frameReferenceOptions(
  template: string,
  colorKey: string,
): FrameReference[] {
  return DATA[template]?.colors[colorKey] ?? [];
}

/** The registry default (first option) per template × colour. */
export const FRAME_REFERENCES: Record<FrameTemplate, ReferenceRow> =
  Object.fromEntries(
    FRAME_TEMPLATE_VALUES.map((template) => [
      template,
      Object.fromEntries(
        FRAME_COLOR_KEYS.map((key) => [
          key,
          frameReferenceOptions(template, key)[0] ?? null,
        ]),
      ) as ReferenceRow,
    ]),
  ) as Record<FrameTemplate, ReferenceRow>;

/** Curator notes for a template and whether its family needs a human eye
 *  on the thumbnail before trusting the reference. */
export function frameReferenceNote(template: string): {
  note: string | null;
  confirm: boolean;
} {
  const entry = DATA[template];
  return { note: entry?.note ?? null, confirm: entry?.confirm === true };
}

/** A registry option by id — the validation behind `?ref=` so the compare
 *  page only ever renders printings the registry lists for that combo. */
export function findFrameReference(
  template: string,
  colorKey: string,
  scryfallId: string | null | undefined,
): FrameReference | null {
  if (!scryfallId) return null;
  return (
    frameReferenceOptions(template, colorKey).find(
      (ref) => ref.scryfallId === scryfallId,
    ) ?? null
  );
}

/** Human caveat for a reference's scan quality, or null when ideal. */
export function referenceTierLabel(ref: FrameReference | null | undefined): string | null {
  if (!ref?.tier) return null;
  return ref.tier === 1
    ? "only a low-resolution scan exists for this printing"
    : "foil-only or promo printing — scans of foils distort";
}

/** Thumbnail URL for a reference — Scryfall's CDN shards by the id's first
 *  two characters, so the URL is constructible without an API call. The CDN
 *  has no rate limits. */
export function referenceThumbUrl(ref: FrameReference): string {
  return `https://cards.scryfall.io/normal/front/${ref.scryfallId[0]}/${ref.scryfallId[1]}/${ref.scryfallId}.jpg`;
}

/** Stable key for a (template, color) combination — used by the review
 *  table, the availability set, and the compare tool's URLs. */
export function frameComboKey(template: string, colorKey: string): string {
  return `${template}/${colorKey}`;
}

// ---------------------------------------------------------------------------
// Sample content for combos with NO real printing (mono-color splits,
// colorless adventures, …): the compare tool still renders our frame with
// era-plausible placeholder content so geometry can be eyeballed.
// ---------------------------------------------------------------------------

const SAMPLE_COLOR_IDENTITY: Record<FrameColorKey, string[]> = {
  w: ["white"],
  u: ["blue"],
  b: ["black"],
  r: ["red"],
  g: ["green"],
  c: ["colorless"],
  m: ["white", "blue"],
};

const SAMPLE_COST: Record<FrameColorKey, string> = {
  w: "{2}{W}",
  u: "{2}{U}",
  b: "{2}{B}",
  r: "{2}{R}",
  g: "{2}{G}",
  c: "{3}",
  m: "{1}{W}{U}",
};

/** Placeholder second-face content for the frames that paint one inline —
 *  without it the compare view shows an empty adventure page / bottom half,
 *  which is exactly the geometry those frames exist to verify. */
function sampleBackFace(template: FrameTemplate, colorKey: FrameColorKey) {
  switch (template) {
    case "adventure":
      return {
        title: "Sample Adventure",
        cost: SAMPLE_COST[colorKey],
        card_type: "instant",
        subtypes: ["Adventure"],
        rules_text: "Sample adventure text on the storybook page.",
      };
    case "flip":
      return {
        title: "Sample, Flipped",
        card_type: "creature",
        subtypes: ["Sample"],
        rules_text: "Sample text for the flipped half.",
        power: "4",
        toughness: "4",
      };
    case "split":
      return {
        title: "Sample Half",
        cost: SAMPLE_COST[colorKey],
        card_type: "instant",
        rules_text: "Sample text for the right half.",
      };
    case "aftermath":
      return {
        title: "Sample Half",
        cost: SAMPLE_COST[colorKey],
        card_type: "sorcery",
        rules_text: "Sample text for the sideways half.",
      };
    default:
      return null;
  }
}

/** Placeholder CardPreviewData-shaped content for a (template, color) combo
 *  without a real reference. Kept schema-free (plain object) so this module
 *  stays client-safe; the page casts it where CardPreviewData is expected. */
// The reference scans for the land templates are BASIC lands (big centered
// mana symbol, no rules text) — the sample must match or the compare reads
// as broken. Multicolor land references are nonbasic (Command Tower), so
// "m" keeps sample rules text.

export function sampleFramePreview(template: FrameTemplate, colorKey: FrameColorKey) {
  const isLand = template.endsWith("land");
  const isToken = template.includes("token");
  const isPw = template === "m15pw";
  const isBattle = template === "battle";
  // Split/aftermath halves are spells — a 3/3 creature front would hide the
  // very geometry (no P/T, spell type line) the frame is verified for.
  const isSpellHalf = template === "split" || template === "aftermath";
  const basicName = isLand ? basicLandNameForColorKey(colorKey) : null;
  if (isLand && basicName) {
    return {
      title: basicName,
      cost: null,
      cardType: "land",
      supertype: "Basic",
      subtypes: [basicName],
      rarity: "common",
      colorIdentity: SAMPLE_COLOR_IDENTITY[colorKey],
      rulesText: null,
      flavorText: null,
      power: null,
      toughness: null,
      loyalty: null,
      defense: null,
      artistCredit: "Sample Artist",
      artUrl: null,
      frameStyle: { template },
    };
  }
  return {
    title: "Sample Card",
    cost: isLand ? null : SAMPLE_COST[colorKey],
    cardType: isLand
      ? "land"
      : isToken
        ? "token"
        : isPw
          ? "planeswalker"
          : isBattle
            ? "battle"
            : template === "aftermath"
              ? "sorcery"
              : isSpellHalf
                ? "instant"
                : "creature",
    supertype: null,
    subtypes: isLand || isPw || isSpellHalf ? [] : ["Sample"],
    rarity: "rare",
    colorIdentity: SAMPLE_COLOR_IDENTITY[colorKey],
    rulesText: isPw
      ? "+1: Draw a card.\n-2: Sample text for the middle row.\n-7: A longer emblem line to fill the last row."
      : "Sample ability text sized to fill the rules box.\nSecond line for spacing.",
    flavorText: isLand || isPw || isBattle ? null : "Placeholder flavor line.",
    power: !isLand && !isPw && !isBattle && !isSpellHalf ? "3" : null,
    toughness: !isLand && !isPw && !isBattle && !isSpellHalf ? "3" : null,
    loyalty: isPw ? "4" : null,
    defense: isBattle ? "5" : null,
    artistCredit: "Sample Artist",
    artUrl: null,
    frameStyle: { template },
    backFace: sampleBackFace(template, colorKey),
  };
}
