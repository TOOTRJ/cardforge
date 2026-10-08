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
// Three styles exist: "modern" — M15's discs, their hard offset shadow and
// the modern tap, what every profile resolves to unless it names another —
// "1997" (TODO 4.10a: flat discs, the 1997 tap; `retro`, `retroland`) and
// "2003" (TODO 4.10b: a COST disc with a black shadow down and a little to
// the left, flat pips in the rules text, the modern tap; `modern`,
// `modernland`). The last
// era item (4.10c "original") adds a value HERE and names it on its
// profiles; a renderer never learns a style's name. A style is a CORRECTION of a frame, never a per-card switch.
// Client-safe, no imports.
// ---------------------------------------------------------------------------

/** FrameProfile.symbolStyle's values. */
export type SymbolStyle = "modern" | "1997" | "2003";

export const DEFAULT_SYMBOL_STYLE: SymbolStyle = "modern";

export type SymbolStyleSpec = {
  id: SymbolStyle;
  /** The disc's hard shadow, as fractions of the disc's diameter (each at
   *  least 1 px in the bake; a `left` of 0 is none to the left): `left` of
   *  it and `down` from it, in `colorHex`. null = the style draws none. */
  discShadow: { left: number; down: number; colorHex: string } | null;
  /** A pip set in the RULES text carries the disc's shadow too ("modern");
   *  false = the shadow is the COST row's alone and an inline pip is flat
   *  (the 2003 prints). Read through inlineSymbolStyle. */
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
  /** The mana-font suffix {T} draws (`ms-tap`; the 1997 prints' is
   *  `tap-4ed`, the original's `tap-3ed`). */
  tapSuffix: string;
};

export const SYMBOL_STYLES: Readonly<Record<SymbolStyle, SymbolStyleSpec>> = {
  modern: {
    id: "modern",
    discShadow: { left: 0.06, down: 0.07, colorHex: "#111" },
    inlineShadow: true,
    previewShadowClass: "ms-shadow",
    previewShadowCss: "-0.06em 0.07em 0 #111, 0 0.06em 0 #111",
    costRowShadowDiscs: 0.1,
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
    tapSuffix: "tap",
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

/** The mana-font suffix a symbol draws in `spec`: the style's own tap for
 *  {T}, every other symbol as it is. */
export function styledSuffix(spec: SymbolStyleSpec, suffix: string): string {
  return suffix === "tap" ? spec.tapSuffix : suffix;
}
