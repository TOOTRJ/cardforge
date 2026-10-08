// ---------------------------------------------------------------------------
// How a frame's ERA drew its mana symbols (TODO 4.8.0 / 4.24; era design
// 2026-10-06 §4, decision D8) — profile data (FrameProfile.symbolStyle),
// resolved here ONCE and read by:
//
//   - the bake's ManaGem / CostGlyphs / RulesItemBake / FlipsideLineBake
//     (lib/render/card-image.tsx);
//   - the preview's ManaCostGlyphs / RulesPip / PipOverrideImg, as a prop of
//     the CARD's uses only (the same component draws the cost picker, the
//     import dialog, deck lists and articles — those never take a style);
//     WHAT a card's pip is — disc colour, ink, glyph size, a split disc's
//     halves — is lib/cards/mana-gem.ts, read by both renderers;
//   - the two shadow models: the rules layout's inline pip
//     (lib/cards/rules-layout.ts metricsFor) and the cost row's
//     (lib/cards/render-tiers.ts costRowWidthPct).
//
// Four styles exist: "modern" — M15's discs, their hard offset shadow under
// the COST (flat pips in the rules text, layout v49) and the modern tap,
// what every profile resolves to unless it names another —
// "1997" (TODO 4.10a: flat discs, the 1997 tap; `retro`, `retroland`) and
// "2003" (TODO 4.10b: a COST disc with a black shadow down and a little to
// the left, flat pips in the rules text, the modern tap; `modern`,
// `modernland`) — and "original" (TODO 4.10c: the 1993 frame's flat discs,
// the five colour symbols as Alpha drew them — bucket images, not the
// font's — a wider pip gap and the tilted-T tap; `agclassic`, `alphaland`).
// A new style adds a value HERE and names it on its profiles; a renderer
// never learns a style's name. A style is a CORRECTION of a frame, never a per-card switch.
// Client-safe, no imports.
// ---------------------------------------------------------------------------

/** FrameProfile.symbolStyle's values. */
export type SymbolStyle = "modern" | "1997" | "2003" | "original";

export const DEFAULT_SYMBOL_STYLE: SymbolStyle = "modern";

/** The gap between two cost pips on every style that names no other, in
 *  discs (render-tiers' COST_PIP_GAP is this number). */
export const DEFAULT_COST_GAP_DISCS = 0.12;

/** The 1993 frame's cost disc and the gap between two, HD px (proof 3; the
 *  profile's costSizePct is the disc — lib/cards/typography.ts
 *  ALPHA_COST_DISC_PCT). */
export const ORIGINAL_DISC_PX = 72;
export const ORIGINAL_COST_GAP_PX = 12;

/** The five colour symbols the "original" style draws as images. */
export const ORIGINAL_SYMBOL_LETTERS = ["w", "u", "b", "r", "g"] as const;
/** The bucket folder they live in, and one symbol's public path. */
export const ORIGINAL_SYMBOL_FOLDER = "manaoriginal";
export function originalSymbolPath(letter: string): string {
  return `/frames/${ORIGINAL_SYMBOL_FOLDER}/${letter}.png`;
}

export type SymbolStyleSpec = {
  id: SymbolStyle;
  /** The disc's hard shadow, as fractions of the disc's diameter (each at
   *  least 1 px in the bake; a `left` of 0 is none to the left): `left` of
   *  it and `down` from it, in `colorHex`. null = the style draws none. */
  discShadow: { left: number; down: number; colorHex: string } | null;
  /** A pip set in the RULES text carries the disc's shadow too; false = the
   *  shadow is the COST row's alone and an inline pip is flat — every style
   *  today (the 1993, 1997 and 2003 prints, and "modern" since layout v49). Read through
   *  inlineSymbolStyle. */
  inlineShadow: boolean;
  /** The mana-font class a shadowed pip carries in the browser OUTSIDE a
   *  card (`.ms-shadow`: the pickers, deck lists, articles); null with no
   *  shadow. Its own `box-shadow` is mana-font's — two layers in em of the
   *  PIP's font, 0.044–0.046 of the disc. A CARD's pip takes no mana-font
   *  cost class; it draws the bake's one layer (previewDiscShadowCss). */
  previewShadowClass: string | null;
  /** That class's own `box-shadow`, for an owner's custom pip IMAGE outside
   *  a card (which has no mana-font class to carry it); null with no
   *  shadow. */
  previewShadowCss: string | null;
  /** How far the shadow reaches past a COST ROW's ends, in discs — what the
   *  name's room is measured against (costRowWidthPct). */
  costRowShadowDiscs: number;
  /** The gap between two COST pips, in discs — COST_PIP_GAP (0.12,
   *  lib/cards/render-tiers.ts) on every style but one whose prints set
   *  their discs further apart ("original"). Read through costPipGap by the
   *  bake's CostGlyphs, the preview's cost row and the name's room. */
  costGapDiscs: number;
  /** The five colour symbols as IMAGES (a whole pip — disc and drawing — per
   *  one-letter suffix: public paths the frames bucket resolves,
   *  lib/frames/frame-url.ts), for an era whose drawings the font lacks;
   *  null = the font's glyph on the disc. lib/cards/mana-gem.ts turns one
   *  into a pip's `image` spec; an owner's own pip image still wins. */
  symbolImages: Readonly<Record<string, string>> | null;
  /** The mana-font suffix {T} draws (`ms-tap`; the 1997 prints' is
   *  `tap-4ed`, the original's `tap-3ed`). */
  tapSuffix: string;
};

export const SYMBOL_STYLES: Readonly<Record<SymbolStyle, SymbolStyleSpec>> = {
  modern: {
    id: "modern",
    discShadow: { left: 0.06, down: 0.07, colorHex: "#111" },
    // The M15-era prints set a pip in the RULES text flat (layout v49,
    // owner round 43): 31 text pips on 21 prints, M15 2014 → TDM 2025,
    // shadow 0.003 ± 0.010 of the disc below them, against 0.079 ± 0.017
    // under the same cards' cost discs. The cost row keeps the shadow.
    inlineShadow: false,
    previewShadowClass: "ms-shadow",
    previewShadowCss: "-0.06em 0.07em 0 #111, 0 0.06em 0 #111",
    costRowShadowDiscs: 0.1,
    costGapDiscs: DEFAULT_COST_GAP_DISCS,
    symbolImages: null,
    tapSuffix: "tap",
  },
  // The 1997 frame (TODO 4.10a / 4.24; `retro`, `retroland`): the prints'
  // cost discs are FLAT — no drop shadow on any of 13 sets, Mirage 1996 →
  // Scourge 2003 (INV #230, USG #179, TMP #163, INV #93 measured: discs
  // 72–74 px, the profile's costSizePct) — and {T} is the era's own symbol,
  // a white arrow on a black tilted square in a grey disc (11 sets read):
  // mana-font's `tap-4ed`. The five colour symbols are the font's, as
  // printed.
  "1997": {
    id: "1997",
    discShadow: null,
    inlineShadow: false,
    previewShadowClass: null,
    previewShadowCss: null,
    costRowShadowDiscs: 0,
    costGapDiscs: DEFAULT_COST_GAP_DISCS,
    symbolImages: null,
    tapSuffix: "tap-4ed",
  },
  // The 2003 frame (TODO 4.10b / 4.24; `modern`, `modernland`): the prints'
  // cost discs (66 px, the profile's costSizePct) carry a BLACK shadow 6 px
  // down and 2 px to the LEFT — a crescent from nine o'clock round the
  // bottom to four, nothing on the right (84 prints, CHK 2004 → JOU 2014:
  // discs on rows 140–206, the shadow ending on row 212 and reaching
  // 1302 px beside the last disc; its black is 6.3 px deep under the disc
  // and 1–2 px wide beside it) — while a pip in the rules text is flat; {T}
  // is the modern arrow (from Mirrodin 2003 on) and the five colour symbols
  // are the font's. No mana-font class draws this shadow: a card's pip takes
  // it from `discShadow` in both renderers (the preview through
  // previewDiscShadowCss). Along the row it reaches 2 px past the first
  // disc (costRowShadowDiscs).
  "2003": {
    id: "2003",
    discShadow: { left: 2 / 66, down: 6 / 66, colorHex: "#000" },
    inlineShadow: false,
    previewShadowClass: null,
    previewShadowCss: null,
    costRowShadowDiscs: 2 / 66,
    costGapDiscs: DEFAULT_COST_GAP_DISCS,
    symbolImages: null,
    tapSuffix: "tap",
  },
  // The 1993 frame (TODO 4.10c / 4.24; `agclassic`, `alphaland`), measured
  // on 102 Alpha / Beta prints with a cost (proof 3, 2026-10-08; a circle
  // fitted to each disc's outer edge): FLAT discs — the ground just under a
  // disc is as light as the ground above it (+ 1.7 ± 7 luma over 166 discs;
  // a shadow would read − 40 or more) — ORIGINAL_DISC_PX across, their
  // centres 83.2 ± 1.3 px apart: a gap of 12 px a disc, a third wider than
  // the 0.12 every later frame keeps. The five colour symbols are the
  // drawings of 1993 (the sun with a ring and twelve short rays; the drop,
  // skull, flame and tree drawn to fill the disc) on their own pale discs:
  // nine sets print that sun, Alpha 1993 → Fallen Empires 1994, and Fourth
  // Edition 1995 already prints today's. mana-font has only the sun
  // (`w-original`), so all five are ONE set — Card Conjurer's
  // `img/manaSymbols/old/old{w,u,b,r,g}.svg`, rasterised into the frames
  // bucket (`manaoriginal/<letter>.png`; never git) — drawn as images.
  // {T}: Alpha, Beta, Unlimited, Arabian Nights and Antiquities spell the
  // word "Tap"; the first symbol is Revised's tilted T (1994; Legends, The
  // Dark and Fallen Empires print it too) — mana-font's `tap-3ed`.
  original: {
    id: "original",
    discShadow: null,
    inlineShadow: false,
    previewShadowClass: null,
    previewShadowCss: null,
    costRowShadowDiscs: 0,
    costGapDiscs: ORIGINAL_COST_GAP_PX / ORIGINAL_DISC_PX,
    symbolImages: Object.fromEntries(ORIGINAL_SYMBOL_LETTERS.map((c) => [c, originalSymbolPath(c)])),
    tapSuffix: "tap-3ed",
  },
};

/** A one-colour symbol's font size as a fraction of its disc's diameter —
 *  mana-font's `.ms-cost` at a cost's size (a 0.95 em glyph, a 1.3 em disc).
 *  The bake's ManaGem draws it; the preview's cost row sets the same glyph in
 *  the same disc (components/cards/mana-cost-glyphs.tsx). */
export const MANA_GLYPH_OF_DISC = 0.73;

/** That symbol's font size in whole px for a disc `discPx` wide — what the
 *  bake's ManaGem sets, and the preview at the stored bake's px. */
export function manaGlyphPx(discPx: number): number {
  return Math.round(discPx * MANA_GLYPH_OF_DISC);
}

/** The style named `style`; "modern" when it names none. */
export function symbolStyle(style: SymbolStyle | undefined): SymbolStyleSpec {
  return SYMBOL_STYLES[style ?? DEFAULT_SYMBOL_STYLE];
}

/** The style a profile's symbols are drawn in. */
export function symbolStyleOf(profile: { symbolStyle?: SymbolStyle } | null | undefined): SymbolStyleSpec {
  return symbolStyle(profile?.symbolStyle);
}

/** The style of a pip set in the RULES text: `spec` itself where an inline
 *  pip carries the disc's shadow, else the same style with no shadow (the
 *  2003 prints shadow the cost row only). The rules layout's shadow model
 *  and both renderers' inline pips read the style through this. */
export function inlineSymbolStyle(spec: SymbolStyleSpec): SymbolStyleSpec {
  if (spec.inlineShadow || !spec.discShadow) return spec;
  return { ...spec, discShadow: null, previewShadowClass: null, previewShadowCss: null, costRowShadowDiscs: 0 };
}

/** The disc shadow's reach in whole px for a disc `discPx` wide — what the
 *  bake draws and the rules layout keeps clear: at least 1 px each way a
 *  style reaches (a `left` of 0 stays 0), 0 for a style with no shadow. */
export function discShadowPx(spec: SymbolStyleSpec, discPx: number): { left: number; down: number } {
  if (!spec.discShadow) return { left: 0, down: 0 };
  const px = (share: number) => (share > 0 ? Math.max(1, Math.round(discPx * share)) : 0);
  return { left: px(spec.discShadow.left), down: px(spec.discShadow.down) };
}

/** The bake's `box-shadow` for a disc `discPx` wide; undefined with none. */
export function discShadowCss(spec: SymbolStyleSpec, discPx: number): string | undefined {
  if (!spec.discShadow) return undefined;
  const { left, down } = discShadowPx(spec, discPx);
  return `${left ? -left : 0}px ${down}px 0 ${spec.discShadow.colorHex}`;
}

/** The colour a `colorHex` box-shadow HAS in the stored PNG. Satori draws a
 *  box-shadow through an SVG filter, and the rasteriser (sharp's librsvg,
 *  lib/render/satori-png.ts) runs filters in linearRGB at 8 bits a channel:
 *  each channel goes sRGB → linear → a whole 0–255 step → sRGB. Near black
 *  that step is coarse — "modern"'s #111 lands on #0d0d0d in every stored
 *  bake — so the preview asks the browser for the landed colour. The model
 *  is general, not fitted to #111: 17 colours (blacks, greys, saturated,
 *  near-white) each landed on its prediction at the HD and the 750 px bake
 *  (2026-10-07), and tests/unit/render/mana-gem-parity.test.tsx reads the
 *  shadow's colour out of a real bake's PNG for every style that has one —
 *  a rasteriser that stops rounding this way fails there. Opaque colours
 *  only (#rgb or #rrggbb): a translucent shadow is not modelled. */
export function bakedShadowHex(colorHex: string): string {
  const hex = colorHex.replace("#", "");
  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
  const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
  const channel = (i: number) => {
    const step = Math.round(toLinear(Number.parseInt(full.slice(i, i + 2), 16) / 255) * 255);
    return Math.round(toSrgb(step / 255) * 255).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

/** The bake's disc shadow for the PREVIEW's pip of a card: discShadowCss's ONE
 *  layer at the stored bake's whole px for a disc `discPx` wide, written
 *  in em of an element whose font size is `emPx` of those px — so it scales
 *  with the card and is the stored PNG's at every preview size — in the
 *  colour the PNG holds (bakedShadowHex). undefined with no shadow. */
export function previewDiscShadowCss(
  spec: SymbolStyleSpec,
  discPx: number,
  emPx: number,
): string | undefined {
  if (!spec.discShadow) return undefined;
  const { left, down } = discShadowPx(spec, discPx);
  return `${((left ? -left : 0) / emPx).toFixed(4)}em ${(down / emPx).toFixed(4)}em 0 ${bakedShadowHex(spec.discShadow.colorHex)}`;
}

/** The gap between two cost pips in `spec`, in discs. */
export function costPipGap(spec: SymbolStyleSpec): number {
  return spec.costGapDiscs;
}

/** The whole-px gap the bake's CostGlyphs draws between discs `discPx`
 *  wide (at least 1 px) — the preview draws the stored bake's. */
export function costPipGapPx(spec: SymbolStyleSpec, discPx: number): number {
  return Math.max(1, Math.round(discPx * spec.costGapDiscs));
}

/** The image `spec` draws for the symbol `suffix` (a whole pip), or null:
 *  the font's glyph on the disc. */
export function symbolImagePath(spec: SymbolStyleSpec, suffix: string): string | null {
  return spec.symbolImages?.[suffix.toLowerCase()] ?? null;
}

/** The mana-font suffix a symbol draws in `spec`: the style's own tap for
 *  {T}, every other symbol as it is. */
export function styledSuffix(spec: SymbolStyleSpec, suffix: string): string {
  return suffix === "tap" ? spec.tapSuffix : suffix;
}
