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
//   - the two shadow models: the rules layout's inline pip
//     (lib/cards/rules-layout.ts metricsFor) and the cost row's
//     (lib/cards/render-tiers.ts costRowWidthPct).
//
// Three styles exist: "modern" — M15's discs, their hard offset shadow and
// the modern tap, what every profile resolves to unless it names another —
// "1997" (TODO 4.10a: flat discs, the 1997 tap; `retro`, `retroland`) and
// "2003" (TODO 4.10b: a COST disc with a black shadow straight down, flat
// pips in the rules text, the modern tap; `modern`, `modernland`). The last
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
  /** The mana-font class that draws the same shadow in the preview
   *  (`.ms-shadow`: 0.06 / 0.07 of the disc's 1.3 em); null with no shadow. */
  previewShadowClass: string | null;
  /** The shadow as a `box-shadow` in em of the PIP'S OWN font size (its disc
   *  is 1.3 em): the class's own value, for an owner's custom pip IMAGE
   *  (which has no mana-font class to carry it) — and, for a style whose
   *  shadow no mana-font class draws (`previewShadowClass` null), what the
   *  preview sets on the glyph itself. null with no shadow. */
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
  // cost discs (66–68 px, the profile's costSizePct) carry a BLACK shadow
  // 6 px straight down — nothing to the left (M12 #1: discs 140–206 px, the
  // shadow to 212) — while a pip in the rules text is flat; {T} is the
  // modern arrow (from Mirrodin 2003 on) and the five colour symbols are the
  // font's. The shadow is 6 ÷ 68 of the disc: 0.1147 em of the glyph's own
  // font size in the preview (the disc is 1.3 em). It reaches no further
  // than the disc along the row.
  "2003": {
    id: "2003",
    discShadow: { left: 0, down: 6 / 68, colorHex: "#000" },
    inlineShadow: false,
    previewShadowClass: null,
    previewShadowCss: "0 0.1147em 0 #000",
    costRowShadowDiscs: 0,
    tapSuffix: "tap",
  },
};

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

/** The mana-font suffix a symbol draws in `spec`: the style's own tap for
 *  {T}, every other symbol as it is. */
export function styledSuffix(spec: SymbolStyleSpec, suffix: string): string {
  return suffix === "tap" ? spec.tapSuffix : suffix;
}
