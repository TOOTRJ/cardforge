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
// ---------------------------------------------------------------------------

import type { FrameTemplate } from "@/types/card";

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
  /** Drawn rounded badge behind the value when there's no plate PNG (M15
   *  planeswalker loyalty, which has no painted shield). */
  badgeColorHex?: string;
  shadowCss?: string;
  /** Vertical nudge of the value text within the plate, in em (negative = up).
   *  Corrects the display font's baseline asymmetry — digits sit low in their
   *  line box, so a geometrically-centered value reads too close to the bottom.
   *  Applied to the TEXT only, so the plate PNG stays aligned to the frame. */
  valueDyEm?: number;
  /** Horizontal nudge of the value text within the plate, in em (positive =
   *  right). Text-only, like valueDyEm. */
  valueDxEm?: number;
};

export type FrameProfile = {
  label: string;
  /** Transparent art cut-out — the user's art renders here, below the frame. */
  artSlot: Rect;
  /** Title band. Name renders left-aligned; mana cost right-aligned in the
   *  same band. */
  title: TextSlot;
  /** Type band. Type line left; rarity set-symbol right. */
  type: TextSlot;
  /** Rules + flavor text box. */
  rules: TextSlot;
  /** Bottom info line (artist credit + brand). */
  footer?: TextSlot;
  pt?: StatSlot;
  loyalty?: StatSlot;
  defense?: StatSlot;
  /** Mana-cost pip size — the visual DISC DIAMETER as a fraction of card
   *  width (MSE m15 spec: 15px on a 375px card = 0.04), right-aligned in the
   *  title band. Defaults to `title.sizePct`. Both renderers treat this as the
   *  disc size: the preview divides by mana-font's 1.3em disc ratio, the bake
   *  draws the disc at exactly this size. */
  costSizePct?: number;
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
    badgeFillHex: string;
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
};

/** Resolve a per-color asset path from a template like "/frames/m15/pt/{color}.png". */
export function resolveColorAsset(pathTemplate: string, colorKey: string): string {
  return pathTemplate.replace("{color}", colorKey);
}

// ---------------------------------------------------------------------------
// Shared ink colors. Painted MSE plates are warm cream/tan, so card text is
// near-black; values that sit directly on the frame (footer on a dark border,
// loyalty on a drawn badge) flip to a warm white.
// ---------------------------------------------------------------------------
const INK_DARK = "#17120c";
const INK_DARK_SOFT = "#2a2118";
const INK_LIGHT = "#f4eee2";
const OUTLINE_SHADOW =
  "1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000";

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
  // MSE m15 spec: cost symbols 15px / text 14px on the 375px-wide card.
  costSizePct: 0.04,
  artSlot: { topPct: 11.4, leftPct: 7.8, widthPct: 84.4, heightPct: 44.0 },
  title: {
    // topPct nudged 4.6 → 4.8 (~1px down) to sit true-center on the name bar.
    rect: { topPct: 4.8, leftPct: 8.5, widthPct: 83, heightPct: 6.0 },
    sizePct: 0.05,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
    letterSpacingEm: 0.01,
  },
  type: {
    // Nudged down ~1px (center 58.8% → 58.95%) to sit true-center on the M15
    // type bar — 56.2 read a hair high, 56.5 a hair low. Shared by snow/devoid.
    rect: { topPct: 56.35, leftPct: 8.5, widthPct: 83, heightPct: 5.2 },
    sizePct: 0.034,
    colorHex: INK_DARK_SOFT,
    weight: 600,
    font: "display",
  },
  rules: {
    rect: { topPct: 63.4, leftPct: 8.5, widthPct: 83, heightPct: 28.0 },
    sizePct: 0.0373,
    colorHex: INK_DARK,
    vAlign: "start",
    font: "body",
    lineHeight: 1.32,
  },
  footer: {
    rect: { topPct: 93.6, leftPct: 8, widthPct: 84, heightPct: 3.2 },
    sizePct: 0.017,
    colorHex: INK_LIGHT,
    uppercase: true,
    letterSpacingEm: 0.06,
    font: "display",
  },
  pt: {
    rect: { topPct: 85.6, leftPct: 70.5, widthPct: 23.5, heightPct: 8.4 },
    sizePct: 0.043,
    colorHex: INK_DARK,
    weight: 700,
    plateAssetPathTemplate: "/frames/m15/pt/{color}.png",
    // Digits read low in the plate (font baseline sits below the line-box
    // center) — lift the value ~2px so it sits true-center on the plate.
    valueDyEm: -0.11,
    // Nudge right to true-center horizontally on the plate.
    valueDxEm: 0.18,
  },
};

// M15 Land — M15 card geometry (art window, type bar, text box, dark bottom
// border, P/T plate) with the stone land texture. Two land-specific tweaks:
//   • hideCost — the MSE land frame paints no cost box, so suppress the cost for
//     ANY card type on this frame (matches ALPHALAND; lands have no cost anyway).
//     Without this, a non-land card placed on the land frame would still paint a
//     cost into dead space.
//   • title inset — the land frame paints a large color-indicator orb at the
//     left of the title bar (≈0–13% of the card width). M15's title starts at
//     8.5%, which renders the name ON TOP of the orb. Start the name at 14% so
//     it sits in the cream plate to the orb's right; keep the right edge aligned
//     with M15 (14 + 77.5 = 91.5 ≈ 8.5 + 83).
const M15LAND: FrameProfile = {
  ...M15,
  label: "M15 Land",
  hideCost: true,
  title: {
    ...M15.title,
    rect: { ...M15.title.rect, leftPct: 14, widthPct: 77.5 },
  },
};

// AgClassic — the 1993 Alpha/Beta frame. Thin tan top border for the name
// (4–8%), art window (9.5–54%), tan divider for the type (56–60%), cream text
// box (61–89%), bottom tan border. No painted P/T plate, so P/T is white text
// with a black outline in the bottom-right.
const AGCLASSIC: FrameProfile = {
  label: "Alpha (1993)",
  costSizePct: 0.042,
  artSlot: { topPct: 9.5, leftPct: 10.6, widthPct: 78.8, heightPct: 44.8 },
  title: {
    rect: { topPct: 3.6, leftPct: 12, widthPct: 76, heightPct: 4.8 },
    sizePct: 0.046,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  type: {
    rect: { topPct: 55.8, leftPct: 12, widthPct: 76, heightPct: 4.4 },
    sizePct: 0.03,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  rules: {
    rect: { topPct: 61.6, leftPct: 12.5, widthPct: 75, heightPct: 26.5 },
    sizePct: 0.036,
    colorHex: INK_DARK,
    vAlign: "start",
    font: "body",
    lineHeight: 1.3,
  },
  footer: {
    rect: { topPct: 91.0, leftPct: 12, widthPct: 52, heightPct: 3.0 },
    sizePct: 0.016,
    colorHex: INK_DARK,
    uppercase: true,
    letterSpacingEm: 0.05,
    font: "display",
  },
  // Official 1993 cards print P/T in dark ink on the tan frame strip — not
  // the white-with-outline treatment modern over-art stats use.
  pt: {
    rect: { topPct: 88.4, leftPct: 74, widthPct: 19, heightPct: 5.8 },
    sizePct: 0.04,
    colorHex: INK_DARK,
    weight: 700,
  },
};

// M15 Planeswalker — title plate (3.5–8.5%), upper art window (10–55%), type
// bar (56–61%), and a LOWER cut-out (63–91%) that is also transparent: the art
// fills both windows and the abilities text floats over the art, so its rules
// slot gets a translucent cream backdrop for legibility. Loyalty has no painted
// shield, so it renders on a drawn dark badge.
const M15PW: FrameProfile = {
  label: "M15 Planeswalker",
  // MSE m15-planeswalker spec: name 23–46px, image 52–479.5, type 296–316,
  // text 330–478 (indented past the loyalty badge rail), loyalty 462+.
  artSlot: { topPct: 9.9, leftPct: 6.7, widthPct: 86.4, heightPct: 81.7 },
  title: {
    rect: { topPct: 4.4, leftPct: 8.5, widthPct: 80, heightPct: 4.4 },
    sizePct: 0.0427,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
    letterSpacingEm: 0.01,
  },
  type: {
    rect: { topPct: 56.6, leftPct: 8.8, widthPct: 79, heightPct: 3.8 },
    sizePct: 0.0347,
    colorHex: INK_DARK_SOFT,
    weight: 600,
    font: "display",
  },
  rules: {
    rect: { topPct: 63.1, leftPct: 8.5, widthPct: 83.5, heightPct: 28.3 },
    sizePct: 0.0373,
    colorHex: INK_DARK,
    vAlign: "start",
    font: "body",
    lineHeight: 1.3,
    backdropHex: "rgba(244,238,226,0.72)",
  },
  // Printed planeswalkers stripe each ability row and badge its loyalty cost
  // in the left rail; parseLoyaltyAbilities supplies the rows.
  loyaltyRows: {
    badgeFillHex: "#141008",
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
    rect: { topPct: 88.2, leftPct: 81.5, widthPct: 14.5, heightPct: 7.2 },
    sizePct: 0.04,
    colorHex: "#ffffff",
    weight: 700,
    badgeColorHex: "#141008",
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
    sizePct: 0.031,
    colorHex: INK_LIGHT,
    vAlign: "center",
    font: "body",
    lineHeight: 1.28,
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
const M15SNOW: FrameProfile = { ...M15, label: "M15 Snow" };
const M15DEVOID: FrameProfile = { ...M15, label: "M15 Devoid (Eldrazi)" };

// Alpha Land — the 1993 frame's land variant ({color}lcard from
// magic-agclassic.mse-style): identical geometry to agclassic, just a land
// treatment and no cost. Straight clone + hideCost.
const ALPHALAND: FrameProfile = {
  ...AGCLASSIC,
  label: "Alpha Land",
  hideCost: true,
};

// Alpha Token — the 1993 token frame (magic-agclassic-token.mse-style). Silver
// stone border, a large white art window (cut to transparent), and a green
// panel with a tan type box at the bottom. No title plate (the name sits in the
// dark top border in light ink) and no cost. P/T is white text over the tan box
// bottom-right; token abilities render over the lower art on a dark scrim.
const ALPHATOKEN: FrameProfile = {
  label: "Alpha Token",
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
    sizePct: 0.03,
    colorHex: INK_LIGHT,
    vAlign: "center",
    font: "body",
    lineHeight: 1.28,
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
  label: "Retro (1997)",
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
    sizePct: 0.0373,
    colorHex: INK_DARK,
    vAlign: "start",
    font: "body",
    lineHeight: 1.3,
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
  pt: {
    rect: { topPct: 89.5, leftPct: 77.5, widthPct: 14, heightPct: 5.6 },
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
  label: "Modern border (2003)",
  costSizePct: 0.04,
  artSlot: { topPct: 11.6, leftPct: 8.3, widthPct: 83.2, heightPct: 43.8 },
  title: {
    rect: { topPct: 5.5, leftPct: 8.8, widthPct: 78, heightPct: 4.4 },
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
    sizePct: 0.0373,
    colorHex: INK_DARK,
    vAlign: "start",
    font: "body",
    lineHeight: 1.3,
  },
  footer: {
    rect: { topPct: 91.4, leftPct: 14, widthPct: 58, heightPct: 2.6 },
    sizePct: 0.015,
    colorHex: INK_DARK,
    uppercase: true,
    letterSpacingEm: 0.04,
    font: "display",
  },
  // The 2003 P/T box is a separate beveled plate (magic-new {color}pt.jpg),
  // upscaled to /frames/modern/pt/{color}.png. Drawn behind the dark value.
  pt: {
    rect: { topPct: 87.3, leftPct: 73.3, widthPct: 21, heightPct: 6.8 },
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
    sizePct: 0.0268,
    colorHex: INK_DARK,
    vAlign: "start",
    font: "body",
    lineHeight: 1.3,
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
    rect: { topPct: 84.9, leftPct: 8.8, widthPct: 82, heightPct: 3.9 },
    sizePct: 0.0347,
    colorHex: INK_DARK,
    weight: 600,
    font: "display",
  },
  // Required by the type, but the chapter rail replaces it (rendered only when
  // a frame has no `chapters`).
  rules: {
    rect: { topPct: 11.5, leftPct: 8, widthPct: 41, heightPct: 72 },
    sizePct: 0.029,
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
    sizePct: 0.031,
    colorHex: INK_DARK,
    vAlign: "start",
    font: "body",
    lineHeight: 1.28,
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
      sizePct: 0.029,
      colorHex: INK_DARK,
      vAlign: "start",
      font: "body",
      lineHeight: 1.25,
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
    sizePct: 0.029,
    colorHex: INK_DARK,
    vAlign: "center",
    font: "body",
    lineHeight: 1.22,
  },
  pt: {
    rect: { topPct: 24.5, leftPct: 82.1, widthPct: 11.7, heightPct: 5.4 },
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
      sizePct: 0.029,
      colorHex: INK_DARK,
      vAlign: "center",
      font: "body",
      lineHeight: 1.22,
    },
    pt: {
      rect: { topPct: 68.2, leftPct: 6.2, widthPct: 11.7, heightPct: 5.4 },
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
    sizePct: 0.027,
    colorHex: INK_DARK,
    vAlign: "start",
    font: "body",
    lineHeight: 1.28,
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
      sizePct: 0.027,
      colorHex: INK_DARK,
      vAlign: "start",
      font: "body",
      lineHeight: 1.28,
    },
  },
};

// Aftermath — the M15 Aftermath frame. A normal TOP half (cast from hand) over a
// BOTTOM half rotated 90° (cast from the graveyard). The top half is a standard
// spell layout (name/cost → small art → type → rules); the bottom half is the
// back-face content rendered ROTATED 270° (read by turning the card). The
// bottom slots are WIDE boxes centered on the rotated bars — rotate(270°) around
// each center lands it on the vertical bar (the box may extend off-card before
// rotation, which is fine). Frame stacked by scripts/build-aftermath-frame.mjs.
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
    sizePct: 0.0373,
    colorHex: INK_DARK,
    vAlign: "start",
    font: "body",
    lineHeight: 1.3,
  },
  secondFace: {
    rotation: 270,
    costSizePct: 0.034,
    // Wide boxes centered on each rotated bar (rotate 270° → vertical bar).
    title: {
      rect: { topPct: 72, leftPct: 69, widthPct: 39, heightPct: 7 },
      sizePct: 0.038,
      colorHex: INK_DARK,
      weight: 600,
      font: "display",
    },
    type: {
      rect: { topPct: 72, leftPct: 29, widthPct: 39, heightPct: 7 },
      sizePct: 0.028,
      colorHex: INK_DARK_SOFT,
      weight: 600,
      font: "display",
    },
    rules: {
      rect: { topPct: 56.5, leftPct: 4.5, widthPct: 39, heightPct: 38 },
      sizePct: 0.029,
      colorHex: INK_DARK,
      vAlign: "center",
      font: "body",
      lineHeight: 1.25,
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
      sizePct: 0.033,
      colorHex: INK_DARK,
      vAlign: "start",
      font: "body",
      lineHeight: 1.3,
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
// gets its own ink because the two frames invert per band: Dragon Wing's title
// bar + textbox are dark gothic (light ink) but its TYPE bar is light silver
// (dark ink); Draconic's title sits over dark art (light ink + shadow) while
// its type + parchment textbox take dark ink.
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
      sizePct: 0.033,
      colorHex: inks.rules,
      vAlign: "start",
      font: "body",
      lineHeight: 1.3,
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
const TARKIRDRAGON = tarkirCard("Dragon Wing", {
  title: INK_LIGHT,
  type: INK_DARK,
  rules: INK_LIGHT,
});
const TARKIRDRACONIC = tarkirCard("Draconic", {
  title: INK_DARK,
  type: INK_DARK,
  rules: INK_DARK,
});

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
    sizePct: 0.033,
    colorHex: INK_DARK,
    vAlign: "start",
    font: "body",
    lineHeight: 1.3,
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
      sizePct: 0.032,
      colorHex: INK_LIGHT,
      vAlign: "center",
      font: "body",
      lineHeight: 1.3,
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
// Ghostfire's type band + P/T plate are pale ice — dark ink reads on them.
const TARKIRGHOSTFIRE = borderlessShowcase("Ghostfire", {
  typeInk: INK_DARK,
  ptInk: INK_DARK,
});

const PROFILES: Record<FrameTemplate, FrameProfile> = {
  m15: M15,
  m15land: M15LAND,
  m15token: M15TOKEN,
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
  if (!template) return M15;
  return PROFILES[template as FrameTemplate] ?? M15;
}
