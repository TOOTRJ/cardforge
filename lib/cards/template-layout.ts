// ---------------------------------------------------------------------------
// Per-frame layout profile — the single source of truth for WHERE every piece
// of a card is drawn, shared by the live preview (card-preview.tsx) and the
// Satori bake (card-image.tsx). Both renderers position every region from the
// same numbers, so the editor preview and the exported PNG are identical by
// construction instead of two hand-tuned approximations that drift apart.
//
// THE MODEL
// ---------
// Every MSE-derived frame PNG (public/frames/<template>/<color>.png, 1500×2100)
// paints its own title plate, type bar, text box, and (sometimes) a P/T plate.
// The art window is a transparent cut-out, so the user's art renders on a layer
// BELOW the frame and the painted slot border sits on top — exactly like a real
// printed card.
//
// We therefore DON'T draw any plates of our own. We only drop text and stat
// values onto the frame at measured, card-relative coordinates. Every region is
// a `Rect` in PERCENT of the full card (0–100, origin top-left) — the same
// coordinate space the frame PNG fills — and every font size is a fraction of
// the card WIDTH so it scales identically in the responsive preview (via `cqw`
// container units) and the fixed-size bake (via `px = sizePct × cardWidth`).
//
// ---------------------------------------------------------------------------
// HOW TO ADD A NEW MSE FRAME (the whole point of this file)
// ---------------------------------------------------------------------------
//   1. Drop the 7 color PNGs at public/frames/<name>/{w,u,b,r,g,c,m}.png
//      (1500×2100, art window cut out to alpha=0). Optional painted P/T plate
//      set at public/frames/<name>/pt/{color}.png.
//   2. Add "<name>" to FRAME_TEMPLATE_VALUES + a label in FRAME_TEMPLATE_LABELS
//      (types/card.ts).
//   3. Add one entry to PROFILES below. Measure the bands by eye or with a
//      column scan (transparent run = art window; cream/painted runs = the
//      title / type / text bands). Tune in the live preview.
// No renderer code changes — both consume this profile generically.
//
// TUNING happens in the admin visual editor (/admin/frame-compare → Edit
// layout): adjustments save to the frame_profile_overrides table and merge
// over these values at render time (lib/cards/profile-override.ts — extend
// its zod schema when adding new numeric fields here). Fold-back workflow:
// once a template's override is stable, use the editor's "Copy as TS",
// merge the values into the profile below, and delete the DB row so code
// stays the single source of truth. docs/mse-profile-report.md holds the
// original MSE baselines for comparison.
// ---------------------------------------------------------------------------

import type { FrameColorKey, FrameMasterKey } from "@/lib/cards/frame-reference-registry";
import type { FrameTemplate } from "@/types/card";
import { ptToPct } from "@/lib/cards/typography";

/** A rectangle in card-relative percent (0–100), origin top-left. The card's
 *  full outer rect (corner to corner, the area the frame PNG fills) is the
 *  reference box. */
export type Rect = {
  topPct: number;
  leftPct: number;
  widthPct: number;
  heightPct: number;
};

export type SlotAlign = "start" | "center" | "end";

/** A text region painted onto the frame. */
export type TextSlot = {
  rect: Rect;
  /** Font size as a fraction of card WIDTH (e.g. 0.05 = 5% of card width). */
  sizePct: number;
  colorHex: string;
  /** Horizontal alignment of the text within the rect. Default "start". */
  align?: SlotAlign;
  /** Vertical alignment within the rect. Default "center". */
  vAlign?: SlotAlign;
  weight?: number;
  italic?: boolean;
  uppercase?: boolean;
  letterSpacingEm?: number;
  lineHeight?: number;
  /** "display" → heading font (title/type); "body" → MTG body font (rules). */
  font?: "display" | "body";
  /** CSS text-shadow for text sitting directly on the frame (e.g. agclassic
   *  P/T, planeswalker loyalty). */
  shadowCss?: string;
  /** Per-frame-master ink — see InkByColorKey. Honoured on the footer
   *  (footerInk), the stat slots (slotInk) and the title and type bands
   *  (bandTextStyle), identically in both renderers. */
  inkByColorKey?: InkByColorKey;
  /** Translucent fill drawn behind the text — used when a frame's text region
   *  is a transparent cut-out over the art (M15 planeswalker abilities) so the
   *  words stay legible regardless of the artwork underneath. */
  backdropHex?: string;
};

/** A stat value (P/T, loyalty, defense) drawn onto the frame, optionally with a
 *  color-keyed plate PNG or a drawn badge behind it. */
export type StatSlot = {
  rect: Rect;
  sizePct: number;
  colorHex: string;
  weight?: number;
  /** Plate PNG template, {color} → frame color key. Renders behind the value
   *  (M15 P/T plate). */
  plateAssetPathTemplate?: string;
  /** Drawn rounded badge behind the value when there's no plate PNG (the
   *  Battle frame's defense disc). */
  badgeColorHex?: string;
  shadowCss?: string;
  /** Per-frame-master ink — see InkByColorKey (resolved by slotInk). */
  inkByColorKey?: InkByColorKey;
  /** Vertical nudge of the value text within the plate, in em (negative = up).
   *  Corrects the display font's baseline asymmetry — digits sit low in their
   *  line box, so a geometrically-centered value reads too close to the bottom.
   *  Applied to the TEXT only, so the plate PNG stays aligned to the frame. */
  valueDyEm?: number;
  /** Horizontal nudge of the value text within the plate, in em (positive =
   *  right). Text-only, like valueDyEm. */
  valueDxEm?: number;
  /** The plate's own box when it differs from the value's (TODO 4.18): Card
   *  Conjurer measures the M15 P/T plate {75.73, 88.48, 18.8 × 7.33} and the
   *  digits' box separately {79.28, 90.2, 13.67 × 3.72}. Without it the plate
   *  fills `rect`. */
  plateRect?: Rect;
  /** The x-range (card %) the value's INK may cover — the face the frame
   *  draws for it, measured on the digits' rows: a plate's light interior up
   *  to its bevel, a strip up to its pinstripe. It may be wider or narrower
   *  than `rect` (the value stays centred in `rect` and never wraps), and
   *  lopsided about the value's centre. A value whose ink would run past it
   *  shrinks (lib/cards/stat-fit.ts). Without it the ink may fill `rect`
   *  (or a drawn badge). */
  inkSpanPct?: { leftPct: number; rightPct: number };
};

/** A frame colour key — the {color} of every frame asset
 *  (pickFrameColorKey: one colour → its letter, none → "c", several → "m"). */
export type { FrameColorKey };

/** A frame MASTER key — the file a render paints, public/frames/{template}/
 *  {key}.png (FRAME_MASTER_KEYS). Every colour key is one; "a" is the Alpha
 *  frame's colourless ARTIFACT card, which a profile paints instead of "c"
 *  for an artifact (FrameProfile.artifactMasterKeys, resolved by
 *  frameMasterKey in components/cards/frame-layer.tsx). Not a colour: the
 *  colour picker, the frame_reviews gate and the stat plates stay on the
 *  colour key. */
export type { FrameMasterKey };

/** The ink of text printed straight onto the frame. */
export type SlotInk = { colorHex: string; shadowCss?: string };

/** Ink per frame master, for a slot whose masters differ in tone: printed
 *  Alpha cards letter the P/T and "Illus." line in dark ink on the white
 *  frame but in embossed silver on every other colour. A key that is missing
 *  keeps the slot's own colorHex (and, on stat slots, shadowCss); an entry
 *  replaces both — except on the title and type bands, where an entry
 *  without a shadowCss keeps the band's own shadowCss (the text span
 *  inherits it; see bandTextStyle). Keyed by the MASTER the text sits on
 *  (frameMasterKey), so the Alpha artifact card ("a") and the grey
 *  colourless card ("c") can differ. */
export type InkByColorKey = Partial<Record<FrameMasterKey, SlotInk>>;

/** The ink a stat slot (P/T, loyalty, defense) prints in on master `masterKey`. */
export function slotInk(
  slot: { colorHex: string; shadowCss?: string; inkByColorKey?: InkByColorKey },
  masterKey: string,
): SlotInk {
  const entry = slot.inkByColorKey?.[masterKey as FrameMasterKey];
  return entry
    ? { colorHex: entry.colorHex, shadowCss: entry.shadowCss }
    : { colorHex: slot.colorHex, shadowCss: slot.shadowCss };
}

/** The footer's ink on master `masterKey`. Like slotInk, except that the
 *  footer has never drawn its own `shadowCss` (FULLARTLAND declares one;
 *  drawing it now would change those bakes) — only an inkByColorKey entry
 *  brings a shadow. */
export function footerInk(footer: TextSlot, masterKey: string): SlotInk {
  return slotInk({ colorHex: footer.colorHex, inkByColorKey: footer.inkByColorKey }, masterKey);
}

/** The style a title or type band's TEXT (the name, the type line) adds on
 *  master `masterKey`: an inkByColorKey entry's colour and shadow, or
 *  nothing — the band keeps its own colorHex / shadowCss, as on every frame
 *  without an entry. An entry without a shadowCss sets only the colour, so
 *  the text keeps the band's own shadowCss (inherited from the band) rather
 *  than dropping it as slotInk would. Only the text span takes it: the mana
 *  pips and set symbol beside it keep their own discs and ink, and a
 *  band-level text-shadow would emboss the pip glyphs too (the browser and
 *  Satori both inherit it). */
export function bandTextStyle(slot: TextSlot, masterKey: string): { color?: string; textShadow?: string } {
  const entry = slot.inkByColorKey?.[masterKey as FrameMasterKey];
  if (!entry) return {};
  return entry.shadowCss ? { color: entry.colorHex, textShadow: entry.shadowCss } : { color: entry.colorHex };
}

/** Art drawn UNDER the whole frame for see-through frames (TODO 4.17): CC's
 *  colourless "Eldrazi" frame, every devoid frame and the colourless token
 *  let the art show through their bars, borders and text box, like the
 *  printed cards. The art window keeps its exact crop (artSlot); this second
 *  layer covers `rect` with the same art (object-fit cover at the card's
 *  focal point) beneath it, and the frame's opaque window border hides the
 *  seam. `colors` limits it to some frame MASTER keys (M15's "c" only) —
 *  underFrameArtRect is given the master the card paints (frameMasterKey), so
 *  a profile that also dresses a colour by type (artifactMasterKeys) lists
 *  the dressed master too if that one is see-through as well. */
export type UnderFrameArt = {
  rect: Rect;
  colors?: readonly string[];
};

/** A frame drawn in two halves for a two-colour card — see
 *  FrameProfile.twoColorSplit. */
export type TwoColorSplit = {
  /** The seam, as % of the card's width: the first colour's frame is drawn
   *  left of it, the second colour's right of it. */
  atPct: number;
};

export type FrameProfile = {
  label: string;
  /** Two-colour cards draw the frame SPLIT down a hard vertical seam — the
   *  first colour's PNG left of `atPct`, the second's right of it, in printed
   *  pair order (twoColorFrameKeys: WU WB UB UR BR BG RG RW GW GU) — instead
   *  of the gold "m" PNG. Mono, colourless, 3+ colour and "multicolor"
   *  identities are unaffected, and stat plates keep the "m" key. Code-owned:
   *  not part of the override schema. Both renderers draw it
   *  (FrameLayer's two clip-path halves; the bake's two overflow:hidden
   *  FrameSlice boxes), and the etched sheen
   *  masks with both halves. */
  twoColorSplit?: TwoColorSplit;
  /** Masters dressed by the card's TYPE as well as its colour: colour key →
   *  the master an ARTIFACT of that colour paints instead (isArtifactFrameType:
   *  the Artifact card type, or "Artifact" in the supertype). Alpha:
   *  { c: "a" } — a colourless artifact prints on the brown artifact card
   *  (agclassic/a.png), any other colourless card on the grey one (c.png).
   *  frameMasterKey (components/cards/frame-layer.tsx) resolves it for both
   *  renderers, the foil/etched masks, the bake's preload and the creator's
   *  frame tiles; the ink maps are keyed by the master. The colour key stays
   *  the card's colour everywhere else: the frame_reviews gate (verifying
   *  agclassic/c publishes both of its masters), the stat plates and the
   *  watermark tint. Code-owned: not part of the override schema. A profile
   *  that spreads one carrying this must decide whether it keeps it. */
  artifactMasterKeys?: Partial<Record<FrameColorKey, FrameMasterKey>>;
  /** Transparent art cut-out — the user's art renders here, below the frame. */
  artSlot: Rect;
  /** Art under the whole frame for see-through frames — see UnderFrameArt. */
  underFrameArt?: UnderFrameArt;
  /** Title band. Name renders left-aligned; mana cost right-aligned in the
   *  same band. */
  title: TextSlot;
  /** Type band. Type line left; rarity set-symbol right. */
  type: TextSlot;
  /** Rules + flavor text box. Its `sizePct` is the printed standard from
   *  lib/cards/typography.ts (9 pt on a full box, 7.5–8 pt on half boxes);
   *  the fit ladder shrinks from there. `lineHeight` is left unset so the
   *  standard leading applies. */
  rules: TextSlot;
  /** Draw the M15-family hairline between rules and flavor text. Pre-M15
   *  frames (1997 retro, 2003 modern, Alpha-era) separate them with a gap
   *  only. Default true. */
  flavorDivider?: boolean;
  /** Bottom info line (artist credit + brand). */
  footer?: TextSlot;
  pt?: StatSlot;
  loyalty?: StatSlot;
  defense?: StatSlot;
  /** When set, the mana cost renders absolutely inside THIS rect
   *  (right-aligned, vertically centered) instead of inline at the title
   *  band's right edge — lets the pips move independently of the name.
   *  Front face only; editable via the admin layout editor ("cost"). */
  costRect?: Rect;
  /** Mana-cost pip size — the visual DISC DIAMETER as a fraction of card
   *  width (MSE m15 spec: 15px on a 375px card = 0.04), right-aligned in the
   *  title band. Defaults to `title.sizePct`. Both renderers treat this as the
   *  disc size: the preview divides by mana-font's 1.3em disc ratio, the bake
   *  draws the disc at exactly this size. */
  costSizePct?: number;
  /** Vertical nudge of the mana cost, as a fraction of card WIDTH (the unit
   *  of costSizePct; negative = up). Moves the pips without moving the name
   *  (inline or in costRect) and keeps the name's ellipsis against the pips.
   *  Front face only. */
  costDy?: number;
  /** When set, the rarity set-symbol renders absolutely inside THIS rect
   *  (right-aligned, vertically centered) instead of inline at the type
   *  band's right edge — lets the symbol move independently of the type
   *  line. Front face only; editable via the layout editor ("set symbol"). */
  symbolRect?: Rect;
  /** Set-symbol size (fraction of card width), right-aligned in the type band.
   *  Defaults to `type.sizePct`. */
  symbolSizePct?: number;
  /** When true, never render the mana cost (tokens/emblems have none, and the
   *  frame's title bar has no cost area). */
  hideCost?: boolean;
  /** Card aspect. "portrait" (default) is the 5:7 every normal frame uses;
   *  "landscape" is the 7:5 rotated card used by Battle frames — it flips the
   *  preview container's aspect ratio and the bake's render dimensions. All
   *  rect/sizePct values are then relative to the landscape card. */
  orientation?: "portrait" | "landscape";
  /** Planeswalker ability rows. When set and the card is a planeswalker, the
   *  rules box renders as per-ability rows — a loyalty-cost badge rail on the
   *  left (+1 / -3 / 0) with alternating translucent row shading, exactly like
   *  printed M15 planeswalkers — instead of the plain text body. Lines without
   *  a leading loyalty cost (static abilities) render unbadged. */
  loyaltyRows?: {
    badgeTextHex: string;
    /** Alternating row backdrops (odd/even), translucent over the art. */
    stripeAHex: string;
    stripeBHex: string;
  };
  /** Saga chapter rail. When set, the card's rules text is parsed into chapters
   *  (parseChapters in lib/cards/card-display) and rendered as stacked rows — a
   *  Roman-numeral marker badge + ability text — inside this rect, REPLACING the
   *  normal rules box. The Saga's art is a separate right-column artSlot. */
  chapters?: {
    rect: Rect;
    /** Ability-text size, as a fraction of card width. */
    sizePct: number;
    textColorHex: string;
    /** Chapter-number badge fill + text colors. */
    markerFillHex: string;
    markerTextHex: string;
    /** Row divider line color. */
    dividerHex: string;
  };
  /** Adventure (Eldraine) sub-panel. When set, the frame is a creature whose
   *  lower text area is an open storybook: this LEFT page holds an "adventure"
   *  spell — a second name / type / cost / rules block sourced from the card's
   *  BACK-FACE content — while the creature's own `rules` box is the RIGHT page.
   *  Both show at once (the renderers suppress the DFC flip for adventure
   *  frames). The adventure name + type sit on the panel's colored bars, so
   *  they're light ink; the adventure rules sit on the cream page, so dark. */
  adventure?: {
    title: TextSlot;
    type: TextSlot;
    rules: TextSlot;
    /** Adventure mana-cost size (fraction of card width). Defaults to the
     *  adventure title's sizePct. */
    costSizePct?: number;
  };
  /** A second face/half drawn from the card's BACK-FACE content, optionally
   *  ROTATED — the multi-panel frames where two cards share one piece of
   *  cardboard. Each slot is positioned in normal card coordinates and then
   *  rotated `rotation`° in place (matching MSE's per-element `angle`):
   *    • Flip (180°): the upside-down bottom creature; shares the front art.
   *    • Aftermath (90°): the sideways bottom spell.
   *    • Split (0°, landscape): the right half; brings its own `artSlot`.
   *  Both renderers draw it inline (the DFC flip is suppressed). */
  secondFace?: {
    rotation: 0 | 90 | 180 | 270;
    title: TextSlot;
    type: TextSlot;
    rules: TextSlot;
    /** Mana-cost size (fraction of card width); when set, the title band
     *  renders name + cost (split/aftermath). Omit for flip (no second cost). */
    costSizePct?: number;
    /** P/T for a creature second face (flip). */
    pt?: StatSlot;
    /** A second art window (split); omit when the face shares the front art. */
    artSlot?: Rect;
  };
  /** Where the pipglyph.com brand mark sits, for frames whose bottom black
   *  border is thinner than M15's (Alpha, 1997, 2003, extended art, battle,
   *  split) — the default straddles their coloured frame edge. Values centre
   *  the mark's ink in the frame's own border. Omit for the default
   *  (BRAND_MARK_PLACEMENT). Code-owned: not part of the override schema. */
  brandMark?: BrandMarkPlacement;
};

/** The brand mark's box offsets from the card's right and bottom edges, as %
 *  of the card's width and height (the same CSS `right` / `bottom` both
 *  renderers set). */
export type BrandMarkPlacement = { rightPct: number; bottomPct: number };

/** Default placement: inside the M15 black border (≈73 px of black above the
 *  ink on a 1500×2100 card, 34 px below). */
export const BRAND_MARK_PLACEMENT: BrandMarkPlacement = { rightPct: 3.5, bottomPct: 1.8 };

/** Brand-mark placement + size scale for a profile. The mark is sized off
 *  the card's SHORT side — 2.6% of a portrait card's width — so a landscape
 *  card (battle, split) prints it at the same physical size instead of 1.4×
 *  larger. Both renderers read this, so preview and bake can't drift. */
export function brandMarkLayout(
  profile: FrameProfile,
): BrandMarkPlacement & { scale: number } {
  return {
    ...(profile.brandMark ?? BRAND_MARK_PLACEMENT),
    scale: profile.orientation === "landscape" ? 5 / 7 : 1,
  };
}

/** Resolve a per-color asset path from a template like "/frames/m15/pt/{color}.png". */
export function resolveColorAsset(pathTemplate: string, colorKey: string): string {
  return pathTemplate.replace("{color}", colorKey);
}

// ---------------------------------------------------------------------------
// Shared ink colors. Painted MSE plates are warm cream/tan, so card text is
// near-black; values that sit directly on the frame (footer on a dark border,
// loyalty on a drawn badge) flip to a warm white.
// ---------------------------------------------------------------------------
// Printed-MTG loyalty badges — the real MSE mainframe-planeswalker shield
// assets (public/frames/m15pw/loyalty*.png, silver rim + black fill), shared
// by the live preview and the Satori bake so both draw identical icons.
// +N = peaked top, -N = pointed bottom, 0/static = flat hexagon.
const LOYALTY_BADGE_ASSETS = {
  up: "/frames/m15pw/loyaltyup.png",
  down: "/frames/m15pw/loyaltydown.png",
  zero: "/frames/m15pw/loyaltynaught.png",
} as const;

export function loyaltyBadgeShapeFor(
  cost: string,
): keyof typeof LOYALTY_BADGE_ASSETS {
  if (cost.startsWith("+")) return "up";
  if (cost.startsWith("-") || cost.startsWith("\u2212")) return "down";
  return "zero";
}

/** The badge PNG for a loyalty cost ("+1" → the peaked-top shield). */
export function loyaltyBadgeAssetFor(cost: string): string {
  return LOYALTY_BADGE_ASSETS[loyaltyBadgeShapeFor(cost)];
}

export const SAGA_MARKER_POINTS = "0,0 100,0 100,62 50,100 0,62";

const INK_DARK = "#17120c";
const INK_DARK_SOFT = "#2a2118";
const INK_LIGHT = "#f4eee2";
const OUTLINE_SHADOW =
  "1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000";

// Printed Alpha/Beta lettering on the frame — the P/T and the "Illus." line:
// dark ink on the white frame, an embossed silver-grey on every other colour
// (a dark lower-right edge, no highlight). Measured on 19 LEA/LEB scans (the
// brightest 0.7 % of the stroke cores after a 1 px blur; shadow = darkest):
//   u #b4c2c2 · b #969c9f–#a6aeae · r #939792–#9c9e98 · g #7a8585–#99a09f ·
//   artifact #76807f–#7e8c8e · shadow ≈ black at 75 % over the frame.
// Alpha printed no gold cards, so m takes the colours' median. The artifact
// master ("a", MSE's artifact card: dark warm brown like the print,
// scripts/build-alpha-frames.mjs) takes the print's artifact grey. Our grey
// colourless master ("c", a colourless NON-artifact, which Alpha never
// printed) is a mid-grey (strip ≈ 113) where the printed artifact frame is
// dark brown (≈ 79), so c keeps the print's CONTRAST (≈ 2.3 : 1) rather than
// its grey, which would all but vanish. The shadow is in em, so the preview
// and the bake draw it at the same size at every scale.
const ALPHA_EMBOSS = "0.035em 0.035em 0 rgba(0,0,0,0.75)";
/** Silver for a mid-tone frame (our grey colourless, the brown land). */
const ALPHA_SILVER_MID = "#b0b4b4";
const ALPHA_INK: InkByColorKey = {
  u: { colorHex: "#b4c0c2", shadowCss: ALPHA_EMBOSS },
  b: { colorHex: "#9da4a6", shadowCss: ALPHA_EMBOSS },
  r: { colorHex: "#989b96", shadowCss: ALPHA_EMBOSS },
  g: { colorHex: "#858c8c", shadowCss: ALPHA_EMBOSS },
  c: { colorHex: ALPHA_SILVER_MID, shadowCss: ALPHA_EMBOSS },
  a: { colorHex: "#7e888c", shadowCss: ALPHA_EMBOSS },
  m: { colorHex: "#989c9a", shadowCss: ALPHA_EMBOSS },
};
// The name and type line (bandTextStyle) print in the same silver only where
// the dark ink all but vanishes: the black frame's marble (title band: dark
// 1.15 : 1, silver 6.4 : 1) and the brown artifact card's (dark 1.44 : 1,
// silver 3.57 : 1). The print letters them silver on every colour, but on
// our blue the silver reads worse than the dark ink (2.4 : 1 against 4.1),
// and on red and green it changes little (2.4 vs 2.8, 2.3 vs 2.4), so those,
// white, gold and the grey colourless card keep the dark name and type line
// (owner decision 2026-09-25).
const ALPHA_BAND_INK: InkByColorKey = {
  b: ALPHA_INK.b,
  a: ALPHA_INK.a,
};

// ---------------------------------------------------------------------------
// Profiles. Coordinates measured from the 1500×2100 white frame PNGs by
// scanning the center column for transparent (art) and painted (plate) runs;
// every color variant shares the same slots (same MSE template).
// ---------------------------------------------------------------------------

// M15 — the Magic 2015 modern frame. Painted title plate (5–10%), art window
// (11–55%), type bar (56–61%), text box (63–93%), dark bottom border, and a
// painted P/T plate via the pt/ asset set.
const M15: FrameProfile = {
  label: "M15",
  // Pip disc measured on a real DOM Serra Angel scan (frame-compare tool,
  // 745px PNG): ~34px ≈ 4.6% of card width; 0.0485 lands our disc there.
  costSizePct: 0.0485,
  artSlot: { topPct: 11.4, leftPct: 7.8, widthPct: 84.4, heightPct: 44.0 },
  title: {
    // 7-card scan sweep: title ink starts at 8.3–8.9% of card width (avg
    // 8.55). Cost pips end at 92.2%W — the dark cluster at ~94% that an
    // earlier pass took for the pip edge is the name bar's right bevel
    // shading (identical in every card's title AND type band).
    rect: { topPct: 4.8, leftPct: 8.5, widthPct: 83.7, heightPct: 6.0 },
    sizePct: 0.05,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
    letterSpacingEm: 0.01,
  },
  type: {
    // Measured on the scan: type ink center sits at 59.13% of card height and
    // its cap height is ~86% of the title's — real M15 type lines are much
    // larger than the old 0.034. Long lines shrink via fitSingleLineSizePct
    // instead of ellipsizing. Shared by snow/devoid.
    // Right edge 92.2%W: the real set symbol's ink ends at ~92%W (685px on
    // the 745px scans), well left of the bar's bevel shading.
    rect: { topPct: 56.5, leftPct: 8.5, widthPct: 83.7, heightPct: 5.2 },
    sizePct: 0.0435,
    colorHex: INK_DARK_SOFT,
    weight: 600,
    font: "display",
  },
  rules: {
    // Top 63.6 centers the block at 77.6% of card height — the measured
    // block center across all seven reference scans (77.2–78.0 regardless
    // of text length).
    rect: { topPct: 63.6, leftPct: 8.5, widthPct: 83, heightPct: 28.0 },
    sizePct: ptToPct(9),
    colorHex: INK_DARK,
    // Real M15 cards vertically center the rules block when it doesn't fill
    // the box (see any short-text printing, e.g. DOM Serra Angel) — full
    // boxes render identically either way.
    vAlign: "center",
    font: "body",
  },
  footer: {
    // The real artist line's ink centers at ~96.2% of card height and its
    // bright text starts at ~6.4% of width (7-card sweep); ours sat a full
    // 1% higher and 1.6% right.
    rect: { topPct: 94.6, leftPct: 6.5, widthPct: 87, heightPct: 3.2 },
    sizePct: 0.019,
    colorHex: INK_LIGHT,
    uppercase: true,
    letterSpacingEm: 0.06,
    font: "display",
  },
  pt: {
    // Card Conjurer's measured M15 geometry (TODO 4.18, frames swap 4.4):
    // the plate is its own box at its native 2.04 aspect — the old single
    // rect (23 × 5.8 %) stretched it ~40 % too wide — and the digits centre
    // in CC's text box, which lands them on the printed (86.1 %W, 91.9 %H).
    rect: { topPct: 90.2, leftPct: 79.28, widthPct: 13.67, heightPct: 3.72 },
    plateRect: { topPct: 88.48, leftPct: 75.73, widthPct: 18.8, heightPct: 7.33 },
    // The plate's face on the digits' rows: from 1185 px (past the lit
    // bevel) to the shaded bevel, whose half-way line bows from 1392.5 to
    // 1396.4 px and averages 1395.4 — the same on every colour and on the
    // artifact / snow / devoid plates.
    inkSpanPct: { leftPct: 79, rightPct: 93.027 },
    sizePct: 0.05,
    colorHex: INK_DARK,
    weight: 700,
    plateAssetPathTemplate: "/frames/m15/pt/{color}.png",
    valueDyEm: -0.04,
  },
};

// M15 Land — M15 card geometry (art window, type bar, text box, dark bottom
// border, P/T plate) with the stone land texture. Two land-specific tweaks:
//   • hideCost — the MSE land frame paints no cost box, so suppress the cost for
//     ANY card type on this frame (matches ALPHALAND; lands have no cost anyway).
//     Without this, a non-land card placed on the land frame would still paint a
//     cost into dead space.
//   • title inset — the MSE land frame once painted a color-indicator orb at
//     the left of the title bar, which pushed the name to 14%. The orb was
//     removed from the PNGs (f15273e) and the name moved back to 8.4% — a DB
//     override on production since 2026-07-08, folded into code 2026-09-25
//     (migration 0114). The band keeps its 77.5% width; keep the right edge
//     with M15 (14 + 77.5 = 91.5 ≈ 8.5 + 83).
const M15LAND: FrameProfile = {
  ...M15,
  label: "M15 Land",
  hideCost: true,
  title: {
    ...M15.title,
    rect: { ...M15.title.rect, leftPct: 8.4, widthPct: 77.5 },
  },
};

// Snow land — the frosted land skin. Its title bar starts a touch further
// right than the plain land's (measured in the compare tool; production
// override since 2026-07-08, folded 2026-09-25).
const M15SNOWLAND: FrameProfile = {
  ...M15LAND,
  label: "M15 Snow Land",
  title: {
    ...M15LAND.title,
    rect: { ...M15LAND.title.rect, leftPct: 9.1 },
  },
};

// AgClassic — the 1993 Alpha/Beta frame. MSE's magic-agclassic art, re-cut
// to the printed card's proportions and lines (scripts/build-alpha-frames.mjs;
// HD px on 1500 × 2100, measured on 19 LEA/LEB scans): black border 80 px at
// the sides, 89 above and 100 below the frame (its pinstripe = the outer
// ~10 px, one dark line); title band 100–198; art opening 178–1319 ×
// 219–1138; type band 1164–1247; text box 186–1318 × 1247–1855 (one outline,
// then a bevel to the textured area 201–1300 × 1265–1835); P/T strip
// 1855–1991. Rules are dark ink; the "Illus." line and the P/T share one line
// in the strip, silver on every frame colour but white (ALPHA_INK); the name
// and type line are dark but on the black frame and the artifact card
// (ALPHA_BAND_INK). A colourless ARTIFACT paints the brown artifact card
// (a.png, from MSE's acard.jpg) — every colourless card Alpha printed is one
// (Sol Ring, Juggernaut) — and any other colourless card the grey c.png
// (ccard.jpg).
const AGCLASSIC: FrameProfile = {
  flavorDivider: false,
  label: "Alpha (1993)",
  artifactMasterKeys: { c: "a" },
  // The mark's ink centred in the 100 px black band below the frame.
  brandMark: { rightPct: 3.5, bottomPct: 1.5 },
  // Owner review, round 4: name and pips 15 % smaller than round 3 (54 px
  // discs, were 63; the print's are ~69 px but pale and thin-lined).
  costSizePct: 0.0357,
  // Pip discs centred on the name's caps (~140 px; 2 px above the rect's
  // middle at HD).
  costDy: -0.0013,
  // Covers the 178–1319 × 219–1138 opening with ~6 px under the bevel.
  artSlot: { topPct: 10.15, leftPct: 11.45, widthPct: 76.9, heightPct: 44.3 },
  // Round 4 (owner's pick "B2"): the name starts on the type line's left
  // margin, the art window's edge (~178 px; it started at ~114), with Beleren
  // caps ~41 px (were 48; the print's lighter face has ~57 px caps but a
  // ~34 px x-height, ours ~30). Caps centred at ~141 px. The rect still ends
  // where the cost pips end (~1362 px, 90.8 %W), so a long name ellipsises
  // before them.
  title: {
    rect: { topPct: 4.36, leftPct: 11.87, widthPct: 78.93, heightPct: 4.8 },
    sizePct: 0.0391,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
    // Embossed silver where the dark ink all but vanishes (the black frame,
    // the artifact card).
    inkByColorKey: ALPHA_BAND_INK,
  },
  // Starts on the name's left margin (~178 px, the art window's edge — the
  // owner moved it in from the print's ~157) with caps centred at ~1198 px
  // (the type band's middle); the set symbol ends ~4 px inside the text
  // box's outline (1314 vs 1318).
  type: {
    rect: { topPct: 55.1, leftPct: 11.87, widthPct: 75.73, heightPct: 4.0 },
    sizePct: 0.03,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
    inkByColorKey: ALPHA_BAND_INK,
  },
  // Inside the textured area with ~30 px at the sides, ~20 above, ~12 below.
  rules: {
    rect: { topPct: 61.2, leftPct: 15.4, widthPct: 69.2, heightPct: 25.6 },
    sizePct: ptToPct(9),
    colorHex: INK_DARK,
    vAlign: "start",
    font: "body",
  },
  // Artist line and P/T share one line in the strip under the text box, like
  // the printed "Illus. ©" line: caps centred at ~1920 px, starting ~157 px.
  footer: {
    rect: { topPct: 89.9, leftPct: 10.4, widthPct: 52, heightPct: 3.0 },
    sizePct: 0.016,
    colorHex: INK_DARK,
    uppercase: true,
    letterSpacingEm: 0.05,
    font: "display",
    inkByColorKey: ALPHA_INK,
  },
  // Official 1993 cards print P/T on the frame strip BELOW the text box, not
  // on a plate: digits centred at ~1921 px (0.45 of the 1855–2000 strip,
  // pinstripe included) and ~88 %W, under the text box's right corner.
  // The rect runs on to 1432 px, past the pinstripe's dark line (~1405 on
  // alphaland, ~1410 here), so a long value (`*+1/*+1`) shrinks to the
  // 1236–1404 px it can use centred on 1320 (TODO 4.31); `90/90` fits.
  pt: {
    rect: { topPct: 88.74, leftPct: 80.5, widthPct: 15, heightPct: 5.6 },
    inkSpanPct: { leftPct: 82.4, rightPct: 93.6 },
    sizePct: 0.04,
    colorHex: INK_DARK,
    weight: 700,
    inkByColorKey: ALPHA_INK,
  },
};

// M15 Planeswalker — title plate (3.5–8.5%), upper art window (10–55%), type
// bar (56–61%), and a LOWER cut-out (63–91%) that is also transparent: the art
// fills both windows and the abilities text floats over the art, so its rules
// slot gets a translucent cream backdrop for legibility. The loyalty shield is
// the frame's own, redrawn above that backdrop (see `loyalty`).
const M15PW: FrameProfile = {
  label: "M15 Planeswalker",
  // MSE m15-planeswalker spec: name 23–46px, image 52–479.5, type 296–316,
  // text 330–478 (indented past the loyalty badge rail), loyalty 462+.
  artSlot: { topPct: 9.9, leftPct: 6.7, widthPct: 86.4, heightPct: 81.7 },
  // Title/type tops, the detached cost box and the set-symbol box were tuned
  // in the compare tool (production override 2026-07-09, folded 2026-09-25).
  costRect: { topPct: 3.8, leftPct: 51.2, widthPct: 40, heightPct: 4.4 },
  // That box was tuned on the MSE frame. Card Conjurer's planeswalker title
  // bar (frames swap 4.4) runs ~9 px lower at HD (plate 77–192 px vs
  // 73–183 on eight printed M15 planeswalkers, 1500 × 2100), so the pips —
  // centred at 126 px — sat high in it (owner review, round 3). Printed pips
  // centre 48.0 % of the way down the plate (47.3–48.8 %); 6 px down puts
  // ours there (132 px).
  costDy: 0.004,
  symbolRect: { topPct: 56.9, leftPct: 79, widthPct: 12, heightPct: 3.8 },
  title: {
    // The name sat just as high: caps centre 125.5 px = 42 % of the plate,
    // level with the old pips. Printed names centre 49–51 % down (126.8–129.2
    // px on eleven M15 walkers), about 2 px below their pips. 3.8 → 4.18
    // (8 px lower at HD) puts ours at 133.5 px = 49 %, 2 px below the pips,
    // the print's relation.
    rect: { topPct: 4.18, leftPct: 8.5, widthPct: 80, heightPct: 4.4 },
    sizePct: 0.0427,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
    letterSpacingEm: 0.01,
  },
  type: {
    rect: { topPct: 56.8, leftPct: 8.8, widthPct: 79, heightPct: 3.8 },
    sizePct: 0.0347,
    colorHex: INK_DARK_SOFT,
    weight: 600,
    font: "display",
  },
  rules: {
    rect: { topPct: 63.1, leftPct: 8.5, widthPct: 83.5, heightPct: 28.3 },
    sizePct: ptToPct(8),
    colorHex: INK_DARK,
    vAlign: "start",
    font: "body",
    backdropHex: "rgba(244,238,226,0.72)",
  },
  // Printed planeswalkers stripe each ability row and badge its loyalty cost
  // in the left rail; parseLoyaltyAbilities supplies the rows.
  loyaltyRows: {
    badgeTextHex: "#f5f0e4",
    stripeAHex: "rgba(244,238,226,0.78)",
    stripeBHex: "rgba(229,221,202,0.78)",
  },
  footer: {
    rect: { topPct: 93.4, leftPct: 9, widthPct: 70, heightPct: 3.0 },
    sizePct: 0.016,
    colorHex: INK_LIGHT,
    uppercase: true,
    letterSpacingEm: 0.05,
    font: "display",
  },
  loyalty: {
    // Card Conjurer's loyalty box (packPlaneswalkerRegular.js: x .806,
    // y .902, 14 × 3.72 %; digits 0.0372 of the card HEIGHT = 0.052 of the
    // width). CC draws the ability stripes BEFORE the frame, so the shield
    // painted into its masters sits on top of them; ours are an overlay
    // above the frame and washed the shield out (owner review 2026-09-25).
    // The importer cuts each master's shield out (SHIELD_BOX in
    // scripts/lib/cc-frames.mjs — plateRect is that box in percent) and it
    // is drawn again here, above the stripes, pixel-for-pixel on the frame's.
    rect: { topPct: 90.2, leftPct: 80.6, widthPct: 14, heightPct: 3.72 },
    // The shield's dark face is 1233–1395 px wide on the digits' upper rows
    // and tapers to its point below them, so the ink keeps to 1239–1389 px
    // (three digits fit) instead of printing over the silver rim.
    inkSpanPct: { leftPct: 82.6, rightPct: 92.6 },
    plateRect: { topPct: 87.667, leftPct: 79.6, widthPct: 16, heightPct: 7.333 },
    plateAssetPathTemplate: "/frames/m15pw/loyalty/{color}.png",
    sizePct: 0.052,
    colorHex: "#ffffff",
    weight: 700,
    shadowCss: OUTLINE_SHADOW,
  },
};

// M15 Token — art-forward token frame. A dark title bar (light, centered name,
// no cost), a large arched art window (12–81%), a cream type pill at the bottom
// (centered), and P/T over the art (no plate). Token abilities render over the
// lower art on a dark scrim. The arched top of the window is covered by the
// frame; the artSlot is the bounding box.
const M15TOKEN: FrameProfile = {
  label: "M15 Token",
  hideCost: true,
  artSlot: { topPct: 12.0, leftPct: 6.5, widthPct: 87, heightPct: 69.0 },
  title: {
    rect: { topPct: 4.6, leftPct: 9, widthPct: 82, heightPct: 6.4 },
    sizePct: 0.05,
    colorHex: INK_LIGHT,
    weight: 600,
    align: "center",
    font: "display",
    letterSpacingEm: 0.01,
  },
  // Measured: the cream type pill spans 82.2–87.0% (was rendered at 87.5+,
  // a band too low); MSE token type font is 14/375.
  type: {
    rect: { topPct: 82.6, leftPct: 11, widthPct: 78, heightPct: 4.2 },
    sizePct: 0.034,
    colorHex: INK_DARK,
    weight: 600,
    align: "center",
    font: "display",
  },
  rules: {
    rect: { topPct: 60.5, leftPct: 12, widthPct: 76, heightPct: 12 },
    sizePct: ptToPct(8),
    colorHex: INK_LIGHT,
    vAlign: "center",
    font: "body",
    backdropHex: "rgba(10,8,6,0.5)",
  },
  footer: {
    rect: { topPct: 94.0, leftPct: 10, widthPct: 80, heightPct: 3.0 },
    sizePct: 0.016,
    colorHex: INK_LIGHT,
    uppercase: true,
    letterSpacingEm: 0.05,
    font: "display",
  },
  // MSE pt sits at 286,469 (76.3%, 89.7%) on the light lower band — dark ink
  // at the card bottom, exactly like printed full-art tokens.
  pt: {
    rect: { topPct: 88.6, leftPct: 73.5, widthPct: 20, heightPct: 6.2 },
    sizePct: 0.0427,
    colorHex: INK_DARK,
    weight: 700,
  },
};

// M15 Snow (Kaldheim/Coldsnap frosty frame) and M15 Devoid (Eldrazi washed-out
// colorless frame) share the M15 geometry exactly — same title/art/type/text
// regions and the same painted P/T plate — so they're straight clones with a
// different frame PNG. Their plates are light (silver/pale), so the dark M15
// ink reads on them unchanged.
//
// Card Conjurer's M15 title bar (frames swap 4.4) ends higher, with a darker
// bottom bevel, than the MSE bar the band was tuned on: pips centred in the
// band (7.8 %H) sat 0.5–0.7 % of the card height below six real printings
// (owner review 2026-09-25). Lift them 0.55 %H on the CC-framed profiles —
// NOT on M15 itself, whose geometry the older MSE-framed families spread.
const CC_M15_COST_DY = -0.0077;
const M15ARTIFACT: FrameProfile = {
  ...M15,
  label: "M15 Artifact",
  costDy: CC_M15_COST_DY,
  pt: { ...M15.pt!, plateAssetPathTemplate: "/frames/m15artifact/pt/{color}.png" },
};
const M15SNOW: FrameProfile = {
  ...M15,
  label: "M15 Snow",
  costDy: CC_M15_COST_DY,
  pt: { ...M15.pt!, plateAssetPathTemplate: "/frames/m15snow/pt/{color}.png" },
};

/** Inside the black border — where the art runs under see-through frames. */
const UNDER_FRAME_RECT = { topPct: 4, leftPct: 4, widthPct: 92, heightPct: 92 };
// Devoid re-dresses the M15 frame; the Eldrazi type bar sits 0.1% higher
// than the plain frame's and the set symbol lives in its own box
// (production override 2026-07-14, folded 2026-09-25).
const M15DEVOID: FrameProfile = {
  ...M15,
  label: "M15 Devoid (Eldrazi)",
  costDy: CC_M15_COST_DY,
  // Every devoid frame is see-through (CC text box alpha ~179): the art
  // runs under the whole frame like printed devoid cards (4.17).
  underFrameArt: { rect: UNDER_FRAME_RECT },
  pt: { ...M15.pt!, plateAssetPathTemplate: "/frames/m15devoid/pt/{color}.png" },
  type: { ...M15.type, rect: { ...M15.type.rect, topPct: 56.4 } },
  symbolRect: { topPct: 56.2, leftPct: 80.2, widthPct: 12, heightPct: 5.2 },
};

// Alpha Land — the 1993 frame's land variant ({color}lcard from
// magic-agclassic.mse-style, re-cut by the same build-alpha-frames.mjs):
// agclassic's opening and text layout, a land treatment and no cost. Its
// lines follow the land print (7 LEA/LEB basics): pinstripe, art-box border
// and text-box ring are dark · colour · dark in the land's colour, the art
// border OUTSIDE the non-land outline (art box 145–1356.5 × 189.5–1172; type
// band 1172–1249; text box 187–1318 × 1249–1854.5, ring 12–17 px; strip
// 1854.5–1984.5). Its frame is the same brown land texture on every colour
// key (strip ≈ #7e6657), so the "Illus." line and a P/T print in the one
// silver on all seven. The name and "Land" keep the dark ink: the land print
// letters them silver too, but on our brown the silver reads no better
// (≈ 2.8 : 1 against the dark ink's 3.1), so like red and green they stay
// dark (owner decision 2026-09-25: silver name and type line on the black
// frame only).
const ALPHA_LAND_INK: InkByColorKey = Object.fromEntries(
  (["w", "u", "b", "r", "g", "c", "m"] as const).map((k) => [
    k,
    { colorHex: ALPHA_SILVER_MID, shadowCss: ALPHA_EMBOSS },
  ]),
);
const ALPHALAND: FrameProfile = {
  ...AGCLASSIC,
  label: "Alpha Land",
  hideCost: true,
  // One brown land frame for every colour: no artifact card (Alpha printed
  // no artifact land, and MSE has no artifact land card).
  artifactMasterKeys: undefined,
  // The land's brown is neither the black frame nor the artifact card.
  title: { ...AGCLASSIC.title, inkByColorKey: undefined },
  // 5 px lower than agclassic's, clear of the wider art border (caps centred
  // at ~1204 px, as "Land" prints on the basics).
  type: {
    ...AGCLASSIC.type,
    rect: { ...AGCLASSIC.type.rect, topPct: 55.35 },
    inkByColorKey: undefined,
  },
  footer: { ...AGCLASSIC.footer!, inkByColorKey: ALPHA_LAND_INK },
  pt: { ...AGCLASSIC.pt!, inkByColorKey: ALPHA_LAND_INK },
};

// Alpha Token — the 1993 token frame (magic-agclassic-token.mse-style). Silver
// stone border, a large white art window (cut to transparent), and a green
// panel with a tan type box at the bottom. No title plate (the name sits in the
// dark top border in light ink) and no cost. P/T is white text over the tan box
// bottom-right; token abilities render over the lower art on a dark scrim.
const ALPHATOKEN: FrameProfile = {
  flavorDivider: false,
  label: "Alpha Token",
  brandMark: { rightPct: 3.5, bottomPct: 0.55 },
  hideCost: true,
  artSlot: { topPct: 9.0, leftPct: 10, widthPct: 80, heightPct: 52.5 },
  title: {
    rect: { topPct: 3.2, leftPct: 12, widthPct: 76, heightPct: 5.2 },
    sizePct: 0.044,
    colorHex: INK_LIGHT,
    weight: 600,
    align: "center",
    font: "display",
    shadowCss: OUTLINE_SHADOW,
  },
  type: {
    rect: { topPct: 70.5, leftPct: 18, widthPct: 64, heightPct: 7 },
    sizePct: 0.03,
    colorHex: INK_DARK,
    weight: 600,
    align: "center",
    font: "display",
  },
  rules: {
    rect: { topPct: 49.0, leftPct: 12, widthPct: 76, heightPct: 11 },
    sizePct: ptToPct(7.5),
    colorHex: INK_LIGHT,
    vAlign: "center",
    font: "body",
    backdropHex: "rgba(10,8,6,0.5)",
  },
  footer: {
    rect: { topPct: 96.5, leftPct: 10, widthPct: 80, heightPct: 3 },
    sizePct: 0.015,
    colorHex: INK_LIGHT,
    uppercase: true,
    letterSpacingEm: 0.05,
    font: "display",
  },
  pt: {
    rect: { topPct: 82.5, leftPct: 75, widthPct: 19, heightPct: 6.5 },
    sizePct: 0.04,
    colorHex: "#ffffff",
    weight: 700,
    shadowCss: OUTLINE_SHADOW,
  },
};

// ---------------------------------------------------------------------------
// Retro (1997, magic-old.mse-style) — the pre-8th-Edition "old border": a tan
// marble frame with the name + type printed directly on the border (no plates),
// a white art window (cut to transparent), a cream text box, and dark-ink P/T
// at the bottom-right. Structurally like AGCLASSIC but with the MSE magic-old
// geometry. All text is dark ink on the light frame.
// MSE magic-old spec (375×523): name 42,24 (23h); image 45,51 286×233;
// type 39,291 (20h); text 43,318 289×143; pt 295,470 47×27.
// ---------------------------------------------------------------------------
const RETRO: FrameProfile = {
  flavorDivider: false,
  label: "Retro (1997)",
  // Frame edge at 96.38%H: the default mark touched it.
  brandMark: { rightPct: 3.5, bottomPct: 0.95 },
  costSizePct: 0.04,
  artSlot: { topPct: 9.6, leftPct: 11.7, widthPct: 76.6, heightPct: 44.8 },
  title: {
    rect: { topPct: 4.2, leftPct: 11, widthPct: 78, heightPct: 4.6 },
    sizePct: 0.044,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  type: {
    rect: { topPct: 55.4, leftPct: 10.4, widthPct: 74, heightPct: 3.9 },
    sizePct: 0.03,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  rules: {
    rect: { topPct: 60.6, leftPct: 11.5, widthPct: 77, heightPct: 27.2 },
    sizePct: ptToPct(9),
    colorHex: INK_DARK,
    vAlign: "center",
    font: "body",
  },
  footer: {
    rect: { topPct: 95.3, leftPct: 11, widthPct: 78, heightPct: 2.6 },
    sizePct: 0.015,
    colorHex: "#efe9dd",
    uppercase: true,
    letterSpacingEm: 0.04,
    font: "display",
  },
  // Real Mirage-era cards print P/T in dark ink on the tan strip (the MSE
  // "white" note is its own outline treatment) — match the printed card.
  // The strip is free on both sides of the value up to the frame's bevel
  // shading at ~1410 px, so the ink may run 1125–1410 px (`100/100` fits).
  pt: {
    rect: { topPct: 89.5, leftPct: 77.5, widthPct: 14, heightPct: 5.6 },
    inkSpanPct: { leftPct: 75, rightPct: 94 },
    sizePct: 0.042,
    colorHex: INK_DARK,
    weight: 700,
  },
};

// Retro land — the 1997 nonbasic land frame (magic-old-unland): same geometry,
// no mana cost.
const RETROLAND: FrameProfile = {
  ...RETRO,
  label: "Retro Land",
  hideCost: true,
};

// ---------------------------------------------------------------------------
// Modern border (2003, magic-new.mse-style) — the 8th-Edition–M14 frame: a
// light beveled border with a title bar, a type bar, and a separate beveled
// P/T box bottom-right (a real plate PNG, like M15). Names/type use the squared
// display face (Beleren stands in for Matrix, which it was designed to evoke).
// MSE magic-new spec (375×523): name 30 (23h); image 32,62 311×228;
// type 298 (20h); text 31,328 311×142; pt box 284,466 60×28 (+plate overlay).
// ---------------------------------------------------------------------------
const MODERN: FrameProfile = {
  flavorDivider: false,
  label: "Modern border (2003)",
  // Frame edge at 96.71%H (10E / RAV scans: 96.6%): the default mark
  // straddled it; 0.8 centres the ink in the black border (owner review).
  brandMark: { rightPct: 3.5, bottomPct: 0.8 },
  costSizePct: 0.04,
  // Title, footer and P/T positions plus the detached cost / set-symbol
  // boxes were tuned in the compare tool against the M12 Serra Angel scan
  // (production override 2026-07-27, folded 2026-09-25).
  costRect: { topPct: 5.6, leftPct: 52.3, widthPct: 39, heightPct: 4.4 },
  symbolRect: { topPct: 56.95, leftPct: 78.2, widthPct: 12, heightPct: 3.9 },
  artSlot: { topPct: 11.6, leftPct: 8.3, widthPct: 83.2, heightPct: 43.8 },
  title: {
    rect: { topPct: 6, leftPct: 8.9, widthPct: 78, heightPct: 4.4 },
    sizePct: 0.044,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  type: {
    // Nudged down ~2px (center 58.55% → 58.9%) to true-center on the 2003
    // type bar — it read high.
    rect: { topPct: 56.95, leftPct: 9, widthPct: 74, heightPct: 3.9 },
    sizePct: 0.0347,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  rules: {
    rect: { topPct: 62.5, leftPct: 8.3, widthPct: 83, heightPct: 27 },
    sizePct: ptToPct(9),
    colorHex: INK_DARK,
    vAlign: "center",
    font: "body",
  },
  footer: {
    rect: { topPct: 92.2, leftPct: 15.5, widthPct: 58, heightPct: 2.6 },
    sizePct: 0.015,
    colorHex: INK_DARK,
    uppercase: true,
    letterSpacingEm: 0.04,
    font: "display",
  },
  // The 2003 P/T box is a separate beveled plate (magic-new {color}pt.jpg),
  // upscaled to /frames/modern/pt/{color}.png. Drawn behind the dark value.
  // The plate fills the rect, but its light face on the digits' rows is
  // 1143–1373 px on every colour: a longer value shrinks to that rather than
  // print over the bevel.
  pt: {
    rect: { topPct: 88.4, leftPct: 73.3, widthPct: 21, heightPct: 6.8 },
    inkSpanPct: { leftPct: 76.2, rightPct: 91.53 },
    sizePct: 0.044,
    colorHex: INK_DARK,
    weight: 700,
    plateAssetPathTemplate: "/frames/modern/pt/{color}.png",
  },
};

// Modern land — the 2003 nonbasic land frame (magic-new land variants): same
// geometry, no mana cost.
const MODERNLAND: FrameProfile = {
  ...MODERN,
  label: "Modern Land",
  hideCost: true,
};

// Battle — the M15 Siege frame, the only LANDSCAPE frame (7:5). Full-bleed art
// with a title pill (top), a type pill, and a text box overlaid; the frame
// paints no defense shield, so the defense value renders on a drawn dark badge
// in the bottom-right corner. All rects are % of the landscape card. Battles
// are often DFCs (battle front / normal back) — the existing back-face flip
// carries the back. Source: magic-modules.mse-include/cards/375 m15 battle.
const BATTLE: FrameProfile = {
  label: "Battle (Siege)",
  // Text box edge at 96.07%H; right 11% clears the defense badge
  // (89.9–97.9%W), which the default mark was drawn over.
  brandMark: { rightPct: 11, bottomPct: 0.8 },
  orientation: "landscape",
  // Measured: title pill 5.0–12.0, art window 13.6–57.2, type bar 58.2–65.0,
  // text box 67.2–96.2; MSE text 252→356 at left 63/523, defense at 480,336.
  artSlot: { topPct: 13.6, leftPct: 4, widthPct: 92, heightPct: 43.6 },
  title: {
    // inset past the rounded red end-nubs of the title pill
    rect: { topPct: 5.2, leftPct: 12.8, widthPct: 74, heightPct: 6.4 },
    sizePct: 0.034,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  type: {
    rect: { topPct: 58.4, leftPct: 12.8, widthPct: 74, heightPct: 6.2 },
    sizePct: 0.025,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  rules: {
    rect: { topPct: 67.5, leftPct: 12.1, widthPct: 78.4, heightPct: 27 },
    sizePct: ptToPct(8, "landscape"),
    colorHex: INK_DARK,
    vAlign: "start",
    font: "body",
  },
  defense: {
    rect: { topPct: 87.3, leftPct: 89.9, widthPct: 8, heightPct: 11 },
    sizePct: 0.034,
    colorHex: "#ffffff",
    weight: 700,
    badgeColorHex: "#141008",
    shadowCss: OUTLINE_SHADOW,
  },
};

// Saga — the M15 Saga frame: a cream chapter rail on the LEFT (the parsed
// chapters replace the normal rules box) and a tall art column on the RIGHT,
// with a title bar (name + cost) on top and a type bar at the bottom. Source:
// magic-modules.mse-include/cards/375 m15 saga cut.
const SAGA: FrameProfile = {
  label: "Saga",
  costSizePct: 0.04,
  // MSE m15-saga spec: image 188,59 → 345,438; rail text from 60 to 437
  // (badges at left 30, text indented to 45); type at 444.
  artSlot: { topPct: 11.3, leftPct: 50.1, widthPct: 41.9, heightPct: 72.5 },
  title: {
    rect: { topPct: 5.4, leftPct: 8.5, widthPct: 83, heightPct: 4.8 },
    sizePct: 0.0427,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  type: {
    // 85.1, not the MSE 84.9: production override 2026-07-08, folded 2026-09-25.
    rect: { topPct: 85.1, leftPct: 8.8, widthPct: 82, heightPct: 3.9 },
    sizePct: 0.0347,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  // Required by the type, but the chapter rail replaces it (rendered only when
  // a frame has no `chapters`).
  rules: {
    rect: { topPct: 11.5, leftPct: 8, widthPct: 41, heightPct: 72 },
    sizePct: ptToPct(7.5),
    colorHex: INK_DARK,
    font: "body",
  },
  chapters: {
    rect: { topPct: 11.5, leftPct: 8, widthPct: 41, heightPct: 72 },
    sizePct: 0.029,
    textColorHex: INK_DARK,
    markerFillHex: "#1c1712",
    markerTextHex: "#f4eee2",
    dividerHex: "rgba(40,32,22,0.35)",
  },
  // Standard M15-family bottom border — same artist line as M15.
  footer: {
    rect: { topPct: 94.6, leftPct: 6.5, widthPct: 87, heightPct: 3.2 },
    sizePct: 0.019,
    colorHex: INK_LIGHT,
    uppercase: true,
    letterSpacingEm: 0.06,
    font: "display",
  },
};

// Adventure — the M15 Eldraine frame. The creature uses the M15 title + type
// bars and art window unchanged, but the lower text area is an open storybook:
// the adventure spell (name/type/cost/rules from the card's back-face) fills the
// LEFT page, and the creature's own rules move to the narrow RIGHT page. The
// adventure name + type sit on the page's colored bars (light ink + a soft
// shadow so they read on any color); the rules sit on the cream page (dark ink).
// Frame composited by scripts/build-adventure-frame.mjs (m15 base + double_page
// + null_page). Geometry is the MSE 375×523 spec (magic-m15-adventure.mse-style)
// in percent. P/T plate reuses M15's (it sits over the right creature page).
const ADV_SHADOW = "0 1px 2px rgba(0,0,0,0.6), 0 0 2px rgba(0,0,0,0.5)";
const ADVENTURE: FrameProfile = {
  ...M15,
  label: "Adventure",
  // Creature rules → RIGHT page (MSE text left 190, top 332, width 143 → 481).
  rules: {
    rect: { topPct: 63.5, leftPct: 50.7, widthPct: 38.2, heightPct: 28.5 },
    sizePct: ptToPct(8),
    colorHex: INK_DARK,
    vAlign: "start",
    font: "body",
  },
  adventure: {
    // Adventure name (+ its cost) — MSE name 2 (left 32, top ~330, → cost 180).
    title: {
      rect: { topPct: 62.7, leftPct: 8.5, widthPct: 39.5, heightPct: 4.0 },
      sizePct: 0.032,
      colorHex: INK_LIGHT,
      weight: 700,
      font: "display",
      shadowCss: ADV_SHADOW,
    },
    // Adventure type line — MSE type 2 (left 32, top ~353, width 155).
    type: {
      rect: { topPct: 67.0, leftPct: 8.5, widthPct: 41.3, heightPct: 3.7 },
      sizePct: 0.0255,
      colorHex: INK_LIGHT,
      weight: 600,
      font: "display",
      shadowCss: ADV_SHADOW,
    },
    // Adventure rules — MSE text 2 (left 27, top 375, width 143 → 481).
    rules: {
      rect: { topPct: 71.6, leftPct: 7.2, widthPct: 38.1, heightPct: 20.3 },
      sizePct: ptToPct(7.5),
      colorHex: INK_DARK,
      vAlign: "start",
      font: "body",
    },
    costSizePct: 0.03,
  },
};

// Flip — the M15 Kamigawa flip frame. ONE card, two creatures: the top reads
// normally (name → small text box → type bar) and the bottom is printed
// UPSIDE-DOWN — its name / type / rules / P-T come from the back-face content
// and render rotated 180° in place (matching MSE's per-element `angle: 180`).
// They share the single middle art window. No painted P/T plate (the value sits
// on the cream type bar → dark ink). Convert via scripts/build-flip-frame.mjs.
// Geometry is the MSE 375×523 spec / measured plates, in percent.
const FLIP: FrameProfile = {
  label: "Flip",
  costSizePct: 0.04,
  artSlot: { topPct: 31.0, leftPct: 7.7, widthPct: 84.3, heightPct: 35.2 },
  title: {
    rect: { topPct: 5.7, leftPct: 8.5, widthPct: 82, heightPct: 4.4 },
    sizePct: 0.0427,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  type: {
    rect: { topPct: 25.0, leftPct: 8.5, widthPct: 68, heightPct: 4.2 },
    sizePct: 0.0347,
    colorHex: INK_DARK_SOFT,
    weight: 600,
    font: "display",
  },
  rules: {
    rect: { topPct: 11.3, leftPct: 7.7, widthPct: 84, heightPct: 12.5 },
    sizePct: ptToPct(7.5),
    colorHex: INK_DARK,
    vAlign: "center",
    font: "body",
  },
  // The cream band ends in a rounded cap at ~1403 px on the value's rows
  // (the type line owns its left part): the ink keeps to 1235–1403 px.
  pt: {
    rect: { topPct: 24.5, leftPct: 82.1, widthPct: 11.7, heightPct: 5.4 },
    inkSpanPct: { leftPct: 82.36, rightPct: 93.5333 },
    sizePct: 0.0347,
    colorHex: INK_DARK,
    weight: 700,
  },
  // Bottom half measured from the frame PNG: type bar 67.6–72.4, text box
  // 72.6–86.0, title plate 87.2–92.4.
  secondFace: {
    rotation: 180,
    title: {
      rect: { topPct: 87.8, leftPct: 9.5, widthPct: 82, heightPct: 4.4 },
      sizePct: 0.0427,
      colorHex: INK_DARK,
      weight: 600,
      font: "display",
    },
    type: {
      rect: { topPct: 68.0, leftPct: 23.5, widthPct: 68, heightPct: 4.2 },
      sizePct: 0.0347,
      colorHex: INK_DARK_SOFT,
      weight: 600,
      font: "display",
    },
    rules: {
      rect: { topPct: 73.4, leftPct: 8.3, widthPct: 84, heightPct: 11.8 },
      sizePct: ptToPct(7.5),
      colorHex: INK_DARK,
      vAlign: "center",
      font: "body",
    },
    // Upside down, the band's cap is on the left at ~104 px: 104–257 px.
    pt: {
      rect: { topPct: 68.2, leftPct: 6.2, widthPct: 11.7, heightPct: 5.4 },
      inkSpanPct: { leftPct: 6.9333, rightPct: 17.1667 },
      sizePct: 0.0347,
      colorHex: INK_DARK,
      weight: 700,
    },
  },
};

// Split — the M15 split frame (LANDSCAPE). Read sideways: two upright half-cards
// side by side, each a full mini-card (name/cost → art → type → rules). The LEFT
// half is the front content; the RIGHT half is the back-face content — a second
// face with rotation 0 and its OWN art window. Both halves share the card's
// color (the app has one color identity, so a two-color split renders multicolor
// on both halves). Frame composited from two MSE half-frames by
// scripts/build-split-frame.mjs. Geometry is the MSE 523×375 spec in percent.
const SPLIT: FrameProfile = {
  label: "Split",
  orientation: "landscape",
  // Text boxes end at 96.0%H: the default mark straddled them.
  brandMark: { rightPct: 3.5, bottomPct: 0.8 },
  artSlot: { topPct: 14.7, leftPct: 4.8, widthPct: 41.9, heightPct: 40.8 },
  // MSE planeshifted-split: cost symbols 18/523 — larger than the name.
  costSizePct: 0.0344,
  title: {
    rect: { topPct: 7.4, leftPct: 5.2, widthPct: 41.4, heightPct: 5.5 },
    sizePct: 0.0287,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  type: {
    rect: { topPct: 56.3, leftPct: 5.2, widthPct: 40, heightPct: 4.2 },
    sizePct: 0.02,
    colorHex: INK_DARK_SOFT,
    weight: 600,
    font: "display",
  },
  rules: {
    rect: { topPct: 62.4, leftPct: 4.8, widthPct: 41.9, heightPct: 28.5 },
    sizePct: ptToPct(8, "landscape"),
    colorHex: INK_DARK,
    vAlign: "start",
    font: "body",
  },
  secondFace: {
    rotation: 0,
    costSizePct: 0.0344,
    artSlot: { topPct: 14.7, leftPct: 53.2, widthPct: 41.9, heightPct: 40.8 },
    title: {
      rect: { topPct: 7.4, leftPct: 53.5, widthPct: 41.4, heightPct: 5.5 },
      sizePct: 0.0287,
      colorHex: INK_DARK,
      weight: 600,
      font: "display",
    },
    type: {
      rect: { topPct: 56.3, leftPct: 53.5, widthPct: 40, heightPct: 4.2 },
      sizePct: 0.02,
      colorHex: INK_DARK_SOFT,
      weight: 600,
      font: "display",
    },
    rules: {
      rect: { topPct: 62.4, leftPct: 53.2, widthPct: 41.9, heightPct: 28.5 },
      sizePct: ptToPct(8, "landscape"),
      colorHex: INK_DARK,
      vAlign: "start",
      font: "body",
    },
  },
};

// Aftermath — the M15 Aftermath frame. A normal TOP half (cast from hand) over a
// BOTTOM half rotated 90° (cast from the graveyard). The top half is a standard
// spell layout (name/cost → small art → type → rules); the bottom half is the
// back-face content rendered ROTATED 90° CLOCKWISE (read by turning the card
// anticlockwise), like the printed Cut // Ribbons and Card Conjurer: the name
// reads top → bottom with its cost at the bottom. (MSE measures its
// `angle: 270` anticlockwise — the same quarter turn — but CSS rotate() turns
// clockwise, so copying it as rotate(270°) turned the half the wrong way,
// TODO 0.22.) The bottom slots are WIDE boxes centered on the rotated bars —
// rotate(90°) around each center lands it on the vertical bar (the box may
// extend off-card before rotation, which is fine). Frame stacked by
// scripts/build-aftermath-frame.mjs.
const AFTERMATH: FrameProfile = {
  label: "Aftermath",
  artSlot: { topPct: 11.3, leftPct: 7.7, widthPct: 84.5, heightPct: 22.4 },
  costSizePct: 0.04,
  title: {
    rect: { topPct: 5.7, leftPct: 8.5, widthPct: 82, heightPct: 4.4 },
    sizePct: 0.04,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  type: {
    rect: { topPct: 35.4, leftPct: 8, widthPct: 82.7, heightPct: 3.8 },
    sizePct: 0.0347,
    colorHex: INK_DARK_SOFT,
    weight: 600,
    font: "display",
  },
  rules: {
    rect: { topPct: 40.9, leftPct: 7.5, widthPct: 84.5, heightPct: 13.0 },
    sizePct: ptToPct(9),
    colorHex: INK_DARK,
    vAlign: "start",
    font: "body",
  },
  secondFace: {
    rotation: 90,
    costSizePct: 0.034,
    // The bottom half's art window (MSE image 2): x 54.9–83.7%, y 56.4–91.4%
    // in card space. Like the text slots this is the PRE-rotation wide box
    // centered on the window — rotate(90°) in place lands exactly on it and
    // the art reads upright when the card is turned.
    artSlot: { topPct: 63.6, leftPct: 44.8, widthPct: 49.0, heightPct: 20.6 },
    // Wide boxes centered on each rotated bar (rotate 90° → vertical bar).
    // Turned, the name and the type line both start at y 56.5% and the cost
    // ends at 90.8% (Card Conjurer's title2, and the print); the type box is
    // centred on its bar (x 46.4–54.8%).
    title: {
      rect: { topPct: 70.125, leftPct: 64.5, widthPct: 48, heightPct: 7 },
      sizePct: 0.038,
      colorHex: INK_DARK,
      weight: 600,
      font: "display",
    },
    type: {
      rect: { topPct: 70.125, leftPct: 26.6, widthPct: 48, heightPct: 7 },
      sizePct: 0.028,
      colorHex: INK_DARK_SOFT,
      weight: 600,
      font: "display",
    },
    // Card Conjurer's rotated rules box: x 6.94–44.94%, y 57.0–90.57% once
    // turned. Its long side is the line length (47% W = 705 px), its short
    // side the stack of lines (27.15% H = 570 px), so wide text stays inside
    // the white box instead of running into the type bar and off the card.
    rules: {
      rect: { topPct: 60.21, leftPct: 2.44, widthPct: 47, heightPct: 27.15 },
      sizePct: ptToPct(7.5),
      colorHex: INK_DARK,
      vAlign: "center",
      font: "body",
    },
  },
};

// ---------------------------------------------------------------------------
// Showcase set families — per-set "showcase" frame treatments from popular
// recent sets. The MSE pieces ship with their art window already transparent
// (built by scripts/build-showcase-frames.mjs), so these are layout-only
// profiles. Several share an "art-forward" layout (art bleeds to the top; a
// name bar ~57%; type + textbox below), captured by a factory.
// ---------------------------------------------------------------------------
const SHOWCASE_SHADOW = "0 1px 2px rgba(0,0,0,0.65), 0 0 2px rgba(0,0,0,0.5)";

function artForwardShowcase(
  label: string,
  nameHex: string,
  nameShadow = true,
): FrameProfile {
  return {
    label,
    artSlot: { topPct: 2.5, leftPct: 6, widthPct: 88, heightPct: 54 },
    costSizePct: 0.034,
    title: {
      rect: { topPct: 56.4, leftPct: 11, widthPct: 78, heightPct: 6 },
      sizePct: 0.042,
      colorHex: nameHex,
      weight: 600,
      font: "display",
      ...(nameShadow ? { shadowCss: SHOWCASE_SHADOW } : {}),
    },
    type: {
      rect: { topPct: 63.4, leftPct: 11, widthPct: 78, heightPct: 4 },
      sizePct: 0.026,
      colorHex: INK_DARK,
      weight: 600,
      font: "display",
    },
    rules: {
      rect: { topPct: 67.6, leftPct: 8, widthPct: 84, heightPct: 24.5 },
      sizePct: ptToPct(8),
      colorHex: INK_DARK,
      vAlign: "start",
      font: "body",
    },
    pt: {
      rect: { topPct: 87.2, leftPct: 71.5, widthPct: 23, heightPct: 7 },
      sizePct: 0.04,
      colorHex: "#ffffff",
      weight: 700,
      shadowCss: OUTLINE_SHADOW,
    },
  };
}

// Art-forward showcases (art bleeds to the top; name bar lower-middle).
const AVATAR = artForwardShowcase("Avatar", INK_LIGHT);
const BLOOMBURROW = artForwardShowcase("Bloomburrow", INK_LIGHT);

// Tarkir card showcases — m15-style (name top, art, type, textbox). Each slot
// gets its own ink because the frames invert per band: Draconic's title sits
// over dark art (light ink + shadow) while its type + parchment textbox take
// dark ink. Dragon Wing overrides the geometry below.
function tarkirCard(
  label: string,
  inks: { title: string; type: string; rules: string },
): FrameProfile {
  const slotInk = (hex: string) => ({
    colorHex: hex,
    ...(hex === INK_LIGHT ? { shadowCss: SHOWCASE_SHADOW } : {}),
  });
  return {
    label,
    costSizePct: 0.038,
    artSlot: { topPct: 12, leftPct: 9, widthPct: 82, heightPct: 46 },
    title: {
      rect: { topPct: 4.6, leftPct: 11, widthPct: 78, heightPct: 6 },
      sizePct: 0.044,
      weight: 600,
      font: "display",
      ...slotInk(inks.title),
    },
    // Measured: the painted type band spans ~56.3–61.5% on both frames.
    type: {
      rect: { topPct: 56.6, leftPct: 11, widthPct: 78, heightPct: 4.8 },
      sizePct: 0.03,
      weight: 600,
      font: "display",
      ...slotInk(inks.type),
    },
    rules: {
      rect: { topPct: 66, leftPct: 9, widthPct: 82, heightPct: 26 },
      sizePct: ptToPct(8),
      colorHex: inks.rules,
      vAlign: "start",
      font: "body",
    },
    pt: {
      rect: { topPct: 87, leftPct: 71, widthPct: 23, heightPct: 7.5 },
      sizePct: 0.043,
      colorHex: "#ffffff",
      weight: 700,
      shadowCss: OUTLINE_SHADOW,
    },
  };
}
// Dragon Wing is the Multiverse Legends (MOM, 2023) Tarkir frame — printed on
// MUL #1 Anafenza (W) and #60 Taigam (W/U) only; it is not a Tarkir:
// Dragonstorm frame (those are Draconic, Ghostfire and the borderless clan
// frame). It is SILVER with colour-keyed dragon wings; there is no gold
// version anywhere (MSE and Card Conjurer ship the same art), so a gold (3+
// colour) card shows gold wings on silver and a two-colour card splits its
// wings (twoColorSplit below). Its name and type bars are LIGHT silver
// (median 200,200,200) and take black ink — MSE's own swap_fonts: name, type
// and P/T black, rules white on the dark text box. Measured on the two MUL
// scans and this PNG's window (owner review 2026-09-25: the old light title
// read at 1.46:1, the art stopped 19 px short of the window, no P/T plate).
const TARKIRDRAGON: FrameProfile = {
  ...tarkirCard("Dragon Wing", { title: INK_DARK, type: INK_DARK, rules: INK_LIGHT }),
  // Two-colour cards split the wings like the one printed two-colour card,
  // MUL #60 Taigam (W/U): white wings left, blue right, gold P/T plate (owner
  // decision 2026-09-25). It is MSE's own recipe for this style —
  // `masked_blend(mask: "special_blend_card.png", dark: template(colors.0),
  // light: template(colors.1))`, and that mask is a HARD vertical split. The
  // w/u/b/r/g PNGs differ in the 35–65 %W band only by texture noise (at
  // most ~18/255, none above 24/255), and the seam step at 50 % is at most
  // 11/255, within the frame's own column-to-column variation (up to 17), so
  // a hard seam at 50 % reads the same as MSE's mask, which flips at
  // x=378/646 (58.5 %). 3+ colours
  // keep the gold "m" wings — a look that was never printed.
  twoColorSplit: { atPct: 50 },
  // Pips: Ø 67 px and right edge 92.3 %W on the scans.
  costSizePct: 0.0445,
  // The PNG's transparent window is 8.8–91.1 %W × 11.1–55.3 %H.
  artSlot: { topPct: 10.9, leftPct: 8.6, widthPct: 82.8, heightPct: 44.5 },
  title: {
    rect: { topPct: 4.55, leftPct: 8.3, widthPct: 84, heightPct: 6.0 },
    sizePct: 0.053,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  type: {
    rect: { topPct: 56.3, leftPct: 8.55, widthPct: 83.7, heightPct: 5.0 },
    sizePct: 0.045,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  // MSE's text box (52,566)–(594,823) on 646×902 less its padding, centred
  // like MSE; 9 pt, the platform rules base.
  rules: {
    rect: { topPct: 62.75, leftPct: 8.7, widthPct: 82.6, heightPct: 28.5 },
    sizePct: ptToPct(9),
    colorHex: INK_LIGHT,
    vAlign: "center",
    font: "body",
  },
  // MSE's pt field (516,810 80×36 on 646×902) and its plate — MSE pt/<c>pt.png
  // cropped by scripts/build-showcase-frames.mjs to 1156,1850 271×149 on the
  // 1500×2100 card. Written out, not spread from M15.pt: that one follows the
  // Card Conjurer M15 plate and its own layout versions.
  // The plate's light face runs 1193–1388 px on the digits' rows, inside
  // its black outline — wider than MSE's field, so 10/10–18/18 print at
  // full size on it and 20/20, which reaches the outline, shrinks.
  pt: {
    rect: { topPct: 89.8, leftPct: 79.88, widthPct: 12.38, heightPct: 3.99 },
    inkSpanPct: { leftPct: 79.5333, rightPct: 92.5333 },
    plateRect: { topPct: 88.095, leftPct: 77.067, widthPct: 18.067, heightPct: 7.095 },
    plateAssetPathTemplate: "/frames/tarkirdragon/pt/{color}.png",
    sizePct: 0.05,
    colorHex: INK_DARK,
    weight: 700,
  },
};
// Draconic is the gold Tarkir: Dragonstorm dragon frame (TDM #292–323). Its
// P/T prints in black on a light box ringed by serpents (TDM #321 Ureni
// "10/10", #301 Magmatic Hellkite): MSE's pt/<c>pt.png, cropped by
// scripts/build-showcase-frames.mjs to 1132,1813 368×188 on the 1500×2100
// card (it runs to the card's right edge). Without it the P/T was white on
// the light parchment and could not be read (owner review 2026-09-25).
const TARKIRDRACONIC: FrameProfile = {
  ...tarkirCard("Draconic", { title: INK_DARK, type: INK_DARK, rules: INK_DARK }),
  // MSE's pt field (516,811 82×34 on 646×902) centres the value at
  // 1293 × 1928 px, where both scans print it (86.0 %W, 91.7 %H); the ink
  // may use the box's light face inside the serpents, 1187–1398 px, so
  // `10/10` and `20/20` print at full size like Ureni's.
  pt: {
    rect: { topPct: 89.911, leftPct: 79.876, widthPct: 12.693, heightPct: 3.769 },
    inkSpanPct: { leftPct: 79.1333, rightPct: 93.2 },
    plateRect: { topPct: 86.3333, leftPct: 75.4667, widthPct: 24.5333, heightPct: 8.9524 },
    plateAssetPathTemplate: "/frames/tarkirdraconic/pt/{color}.png",
    sizePct: 0.05,
    colorHex: INK_DARK,
    weight: 700,
  },
};

// LOTR — title bar (top), CIRCULAR art window (the One Ring), type bar, textbox.
// The artSlot is the circle's bounding box; the frame's opaque corners hide the
// rectangular art outside the circle.
const LOTR: FrameProfile = {
  label: "Ring",
  costSizePct: 0.038,
  artSlot: { topPct: 13, leftPct: 14, widthPct: 72, heightPct: 45 },
  title: {
    rect: { topPct: 4.5, leftPct: 9, widthPct: 82, heightPct: 6 },
    sizePct: 0.044,
    colorHex: INK_LIGHT,
    weight: 600,
    font: "display",
    shadowCss: SHOWCASE_SHADOW,
  },
  type: {
    rect: { topPct: 59, leftPct: 9, widthPct: 82, heightPct: 5 },
    sizePct: 0.028,
    colorHex: INK_LIGHT,
    weight: 600,
    font: "display",
    shadowCss: SHOWCASE_SHADOW,
  },
  rules: {
    rect: { topPct: 66, leftPct: 8.5, widthPct: 83, heightPct: 26 },
    sizePct: ptToPct(8),
    colorHex: INK_DARK,
    vAlign: "start",
    font: "body",
  },
  pt: {
    rect: { topPct: 86.5, leftPct: 71, widthPct: 23, heightPct: 7.5 },
    sizePct: 0.043,
    colorHex: "#ffffff",
    weight: 700,
    shadowCss: OUTLINE_SHADOW,
  },
};

// LOTR Scroll — m15-ish (title top, rectangular art, type, textbox) on a scroll.
// The scroll's ribbon + type band are light parchment in every color variant,
// so both take dark ink (the official LTC scrolls print dark).
const LOTRSCROLL: FrameProfile = {
  ...LOTR,
  label: "Scroll",
  artSlot: { topPct: 11.5, leftPct: 8, widthPct: 84, heightPct: 45 },
  rules: {
    ...LOTR.rules,
    rect: { topPct: 65.5, leftPct: 8.5, widthPct: 83, heightPct: 21 },
  },
  title: {
    rect: { topPct: 4.5, leftPct: 9, widthPct: 82, heightPct: 6 },
    sizePct: 0.044,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  type: {
    rect: { topPct: 59, leftPct: 9, widthPct: 82, heightPct: 5 },
    sizePct: 0.028,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
};

// Borderless showcases — art fills nearly the whole card; the name + rules sit
// on translucent panels over the art (scrim for legibility).
function borderlessShowcase(
  label: string,
  opts: { typeInk?: string; ptInk?: string } = {},
): FrameProfile {
  const typeInk = opts.typeInk ?? INK_LIGHT;
  const ptInk = opts.ptInk ?? "#ffffff";
  return {
    label,
    artSlot: { topPct: 2.5, leftPct: 3.5, widthPct: 93, heightPct: 92 },
    costSizePct: 0.034,
    title: {
      rect: { topPct: 5, leftPct: 8, widthPct: 84, heightPct: 6 },
      sizePct: 0.044,
      colorHex: INK_LIGHT,
      weight: 600,
      font: "display",
      shadowCss: OUTLINE_SHADOW,
    },
    type: {
      rect: { topPct: 56, leftPct: 8, widthPct: 84, heightPct: 4.5 },
      sizePct: 0.026,
      colorHex: typeInk,
      weight: 600,
      font: "display",
      ...(typeInk === INK_LIGHT ? { shadowCss: OUTLINE_SHADOW } : {}),
    },
    rules: {
      rect: { topPct: 62, leftPct: 7, widthPct: 86, heightPct: 28 },
      sizePct: ptToPct(8),
      colorHex: INK_LIGHT,
      vAlign: "center",
      font: "body",
      backdropHex: "rgba(8,8,12,0.55)",
    },
    pt: {
      rect: { topPct: 89, leftPct: 73, widthPct: 21, heightPct: 7 },
      sizePct: 0.04,
      colorHex: ptInk,
      weight: 700,
      ...(ptInk === "#ffffff" ? { shadowCss: OUTLINE_SHADOW } : {}),
    },
  };
}
const BLOOMANIME = borderlessShowcase("Anime");

// Ghostfire — the Tarkir: Dragonstorm borderless ghostfire showcase (TDM
// #399–418). MSE's style (magic-m15-showcase-tarkir-ghostfire) draws its
// namebox / typebox / textbox in teal (#03586b) at 60 % opacity UNDER the
// pale-cyan outline, puts a teal ribbon under the P/T, and sets every font
// white. scripts/build-showcase-frames.mjs bakes the three boxes into the
// PNGs and crops the ribbon to pt/<c>.png, so the bars are dark translucent
// teal and take white ink (owner review 2026-09-25: the old outline-only
// PNG left "Enchantment" in dark ink on the type band's lower rim, over the
// art). Geometry measured on the new c.png's bands (name 5.05–10.43 %H,
// type 51.38–56.86, text box 57.3–87.4) and on the real TDM #400 scan.
// MSE's swap_fonts are all "white" and the scan's ink is (255,255,255) —
// pure white, not the house cream (INK_LIGHT).
const GHOSTFIRE_INK = "#ffffff";
const TARKIRGHOSTFIRE: FrameProfile = {
  label: "Ghostfire",
  artSlot: { topPct: 2.5, leftPct: 3.5, widthPct: 93, heightPct: 92 },
  // Pips: Ø 70 px, 82.5–92.4 %W, centred at 7.52 %H on the scan. The pips
  // centre in the title rect, which sits 0.09 %H above the name band's
  // centre so name and pips each land within 2 px of the scan (no costDy:
  // that nudge is kept for the Card Conjurer frames).
  costSizePct: 0.0465,
  // Title and type sizes land the scan's ink widths ("Clarion Conqueror"
  // 659 px, "Creature — Dragon" 561 px at 1500 wide).
  title: {
    rect: { topPct: 4.96, leftPct: 8.55, widthPct: 83.85, heightPct: 5.38 },
    sizePct: 0.0535,
    colorHex: GHOSTFIRE_INK,
    weight: 600,
    font: "display",
    shadowCss: OUTLINE_SHADOW,
  },
  type: {
    rect: { topPct: 51.38, leftPct: 8.5, widthPct: 83.5, heightPct: 5.48 },
    sizePct: 0.0445,
    colorHex: GHOSTFIRE_INK,
    weight: 600,
    font: "display",
    shadowCss: OUTLINE_SHADOW,
  },
  // MSE's text field (66,610)–(678,905) on 744 × 1039, widened so the ink
  // starts at the scan's 9.0 %W past our box padding. 9 pt, the platform
  // rules base (the scan's short text prints larger). No scrim: the baked
  // textbox is the backdrop now.
  rules: {
    rect: { topPct: 58.71, leftPct: 8.3, widthPct: 83.4, heightPct: 28.39 },
    sizePct: ptToPct(9),
    colorHex: GHOSTFIRE_INK,
    vAlign: "center",
    font: "body",
  },
  // MSE's pt field (590,917 99 × 46 on 744 × 1039) on the ribbon, which the
  // build crops at 1093,1768 385 × 208 on the 1500 × 2100 card. The white
  // ink may use the ribbon from its pale left flare (1153 px) to its cyan rim
  // (1404 px, where it curves in lowest on the digits' rows).
  pt: {
    rect: { topPct: 88.26, leftPct: 79.3, widthPct: 13.31, heightPct: 4.43 },
    inkSpanPct: { leftPct: 76.8667, rightPct: 93.6 },
    plateRect: { topPct: 84.1905, leftPct: 72.8667, widthPct: 25.6667, heightPct: 9.9048 },
    plateAssetPathTemplate: "/frames/tarkirghostfire/pt/{color}.png",
    sizePct: 0.05,
    colorHex: "#ffffff",
    weight: 700,
    shadowCss: OUTLINE_SHADOW,
  },
};

// ---------------------------------------------------------------------------
// 2026-07 variation frames (scripts/build-variation-frames.mjs). Geometry
// from the MSE style specs (375×523 / 750×1046 → percent); fine-tune in the
// admin layout editor before verifying — all five start unpublished.
// ---------------------------------------------------------------------------

// Extended Art — M15 skeleton; the art window is tall and the frame has no
// side borders, so art bleeds to the card edges beside the white text box.
const EXTENDEDART: FrameProfile = {
  ...M15,
  label: "Extended Art",
  // Frame edge at 96.76%H (lower than M15's 92.86%).
  brandMark: { rightPct: 3.5, bottomPct: 0.8 },
  artSlot: { topPct: 11.9, leftPct: 4, widthPct: 92, heightPct: 48.4 },
  rules: {
    ...M15.rules,
    rect: { topPct: 60.5, leftPct: 9.1, widthPct: 82.9, heightPct: 29 },
  },
};

// Zendikar Expedition land — dark stone frame, art fills the upper 2/3,
// translucent dark text box over the art (MSE text 29,315 314×112).
const EXPEDITIONLAND: FrameProfile = {
  ...M15,
  label: "Expedition Land",
  hideCost: true,
  artSlot: { topPct: 11.5, leftPct: 4, widthPct: 92, heightPct: 70 },
  title: {
    ...M15.title,
    colorHex: INK_LIGHT,
    shadowCss: SHOWCASE_SHADOW,
  },
  type: {
    ...M15.type,
    colorHex: INK_LIGHT,
    shadowCss: SHOWCASE_SHADOW,
  },
  rules: {
    rect: { topPct: 60.5, leftPct: 8, widthPct: 83.5, heightPct: 21 },
    sizePct: ptToPct(9),
    colorHex: INK_LIGHT,
    vAlign: "start",
    font: "body",
    backdropHex: "rgba(8,8,10,0.72)",
  },
  footer: { ...M15.footer!, colorHex: INK_LIGHT },
};

// Nyx constellation — M15 layout at 750×1046 with a starfield border and a
// baked-in translucent dark text box (light ink).
const NYX: FrameProfile = {
  ...M15,
  label: "Nyx Constellation",
  artSlot: { topPct: 11.2, leftPct: 6, widthPct: 88, heightPct: 70 },
  title: { ...M15.title, colorHex: INK_LIGHT, shadowCss: SHOWCASE_SHADOW },
  type: { ...M15.type, colorHex: INK_LIGHT, shadowCss: SHOWCASE_SHADOW },
  rules: { ...M15.rules, colorHex: INK_LIGHT },
  footer: { ...M15.footer!, colorHex: INK_LIGHT },
};

// Full art (Zendikar hedron) — edge-to-edge art, floating title bar, and a
// baked-in translucent text box in the bottom quarter.
const FULLART: FrameProfile = {
  ...M15,
  label: "Full Art",
  artSlot: { topPct: 2.9, leftPct: 4, widthPct: 92, heightPct: 88.3 },
  title: {
    ...M15.title,
    rect: { topPct: 5.4, leftPct: 8.5, widthPct: 83, heightPct: 5 },
  },
  type: {
    rect: { topPct: 73.6, leftPct: 8.5, widthPct: 83, heightPct: 4.2 },
    sizePct: 0.0347,
    colorHex: INK_LIGHT,
    weight: 600,
    font: "display",
    shadowCss: SHOWCASE_SHADOW,
  },
  rules: {
    rect: { topPct: 78.6, leftPct: 8, widthPct: 84, heightPct: 13.5 },
    sizePct: ptToPct(8),
    colorHex: INK_LIGHT,
    vAlign: "start",
    font: "body",
  },
  footer: { ...M15.footer!, colorHex: INK_LIGHT },
};

// Full-art basic land — floating name + type bars over edge-to-edge art; the
// big mana symbol comes from the basic-land watermark (deliberately not
// baked into the frame, so it stays tintable and overridable).
const FULLARTLAND: FrameProfile = {
  ...M15,
  label: "Full-Art Basic Land",
  hideCost: true,
  artSlot: { topPct: 0, leftPct: 0, widthPct: 100, heightPct: 100 },
  title: {
    ...M15.title,
    rect: { topPct: 5.6, leftPct: 9, widthPct: 80, heightPct: 4.6 },
  },
  type: {
    ...M15.type,
    rect: { topPct: 85.4, leftPct: 18, widthPct: 66, heightPct: 4.2 },
  },
  rules: {
    rect: { topPct: 16, leftPct: 15, widthPct: 70, heightPct: 62 },
    sizePct: ptToPct(9),
    colorHex: INK_LIGHT,
    font: "body",
  },
  footer: {
    ...M15.footer!,
    rect: { topPct: 93.2, leftPct: 6.5, widthPct: 87, heightPct: 3 },
    colorHex: INK_LIGHT,
    shadowCss: OUTLINE_SHADOW,
  },
};

// M15 Textless — the plain M15 border with an edge-to-edge art window (no type
// plate, no text box painted). Shares FULLART's over-art ink treatment (light
// type + scrim-backed rules so any text the user adds stays legible), but the
// art window is inset to the M15 border rather than bleeding to the card edge.
const M15TEXTLESS: FrameProfile = {
  ...FULLART,
  label: "M15 Textless",
  artSlot: { topPct: 11.3, leftPct: 7.7, widthPct: 84.0, heightPct: 80.7 },
};

const M15TEXTLESSLAND: FrameProfile = {
  ...M15TEXTLESS,
  label: "M15 Textless Land",
  hideCost: true,
};

const PROFILES: Record<FrameTemplate, FrameProfile> = {
  // Colourless M15 is CC's see-through "Eldrazi" frame: art under the frame
  // for "c" only (4.17). Set here, not on M15, so the many profiles that
  // spread M15 don't inherit it.
  m15: { ...M15, costDy: CC_M15_COST_DY, underFrameArt: { rect: UNDER_FRAME_RECT, colors: ["c"] } },
  m15land: M15LAND,
  m15snowland: M15SNOWLAND,
  // Colourless creature tokens print a see-through frame (BFZ, MH1, WAR).
  m15token: { ...M15TOKEN, underFrameArt: { rect: UNDER_FRAME_RECT, colors: ["c"] } },
  m15tokenartifact: { ...M15TOKEN, label: "M15 Artifact Token" },
  m15artifact: M15ARTIFACT,
  m15snow: M15SNOW,
  m15devoid: M15DEVOID,
  m15pw: M15PW,
  agclassic: AGCLASSIC,
  alphaland: ALPHALAND,
  alphatoken: ALPHATOKEN,
  battle: BATTLE,
  saga: SAGA,
  adventure: ADVENTURE,
  flip: FLIP,
  split: SPLIT,
  aftermath: AFTERMATH,
  avatar: AVATAR,
  bloomburrow: BLOOMBURROW,
  bloomanime: BLOOMANIME,
  lotr: LOTR,
  lotrscroll: LOTRSCROLL,
  tarkirdragon: TARKIRDRAGON,
  tarkirdraconic: TARKIRDRACONIC,
  tarkirghostfire: TARKIRGHOSTFIRE,
  extendedart: EXTENDEDART,
  fullart: FULLART,
  fullartland: FULLARTLAND,
  m15textless: M15TEXTLESS,
  m15textlessland: M15TEXTLESSLAND,
  expeditionland: EXPEDITIONLAND,
  nyx: NYX,
  retro: RETRO,
  retroland: RETROLAND,
  modern: MODERN,
  modernland: MODERNLAND,
};

/** Resolve a frame profile, defaulting to M15 for unknown/legacy templates
 *  (e.g. the retired "regular" placeholder on older saved cards). */
export function getFrameProfile(
  template: FrameTemplate | string | undefined,
): FrameProfile {
  // The registry's m15 entry, not the bare M15 base: legacy templates draw
  // the m15 frame, so they need its CC cost lift and see-through colourless.
  if (!template) return PROFILES.m15;
  return PROFILES[template as FrameTemplate] ?? PROFILES.m15;
}

/** The under-frame art rect for a profile + frame colour key, or null. */
export function underFrameArtRect(profile: FrameProfile, colorKey: string): Rect | null {
  const u = profile.underFrameArt;
  if (!u) return null;
  if (u.colors && !u.colors.includes(colorKey)) return null;
  return u.rect;
}
