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
// Two styles exist: "modern" — M15's discs, their hard offset shadow and the
// modern tap, what every profile resolves to unless it names another — and
// "1997" (TODO 4.10a: flat discs, the 1997 tap; `retro`, `retroland`). The
// other era items (4.10b "2003", 4.10c "original") add a value HERE and name
// it on their profiles; a renderer never learns a
// style's name. A style is a CORRECTION of a frame, never a per-card switch.
// Client-safe, no imports.
// ---------------------------------------------------------------------------

/** FrameProfile.symbolStyle's values. */
export type SymbolStyle = "modern" | "1997";

export const DEFAULT_SYMBOL_STYLE: SymbolStyle = "modern";

export type SymbolStyleSpec = {
  id: SymbolStyle;
  /** The disc's hard shadow, as fractions of the disc's diameter (each at
   *  least 1 px in the bake): `left` of it and `down` from it, in `colorHex`.
   *  null = the style draws none. */
  discShadow: { left: number; down: number; colorHex: string } | null;
  /** The mana-font class that draws the same shadow in the preview
   *  (`.ms-shadow`: 0.06 / 0.07 of the disc's 1.3 em); null with no shadow. */
  previewShadowClass: string | null;
  /** That class's own `box-shadow`, for an owner's custom pip IMAGE (which
   *  has no mana-font class to carry it); null with no shadow. */
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
    previewShadowClass: null,
    previewShadowCss: null,
    costRowShadowDiscs: 0,
    tapSuffix: "tap-4ed",
  },
};

/** A one-colour symbol's font size as a fraction of its disc's diameter —
 *  mana-font's `.ms-cost` at a cost's size (a 0.95 em glyph, a 1.3 em disc).
 *  The bake's ManaGem draws it; the preview's cost row sets the same glyph in
 *  the same disc (components/cards/mana-cost-glyphs.tsx). */
export const MANA_GLYPH_OF_DISC = 0.73;

/** The style named `style`; "modern" when it names none. */
export function symbolStyle(style: SymbolStyle | undefined): SymbolStyleSpec {
  return SYMBOL_STYLES[style ?? DEFAULT_SYMBOL_STYLE];
}

/** The style a profile's symbols are drawn in. */
export function symbolStyleOf(profile: { symbolStyle?: SymbolStyle } | null | undefined): SymbolStyleSpec {
  return symbolStyle(profile?.symbolStyle);
}

/** The disc shadow's reach in whole px for a disc `discPx` wide — what the
 *  bake draws and the rules layout keeps clear: at least 1 px each way, 0
 *  for a style with no shadow. */
export function discShadowPx(spec: SymbolStyleSpec, discPx: number): { left: number; down: number } {
  if (!spec.discShadow) return { left: 0, down: 0 };
  return {
    left: Math.max(1, Math.round(discPx * spec.discShadow.left)),
    down: Math.max(1, Math.round(discPx * spec.discShadow.down)),
  };
}

/** The bake's `box-shadow` for a disc `discPx` wide; undefined with none. */
export function discShadowCss(spec: SymbolStyleSpec, discPx: number): string | undefined {
  if (!spec.discShadow) return undefined;
  const { left, down } = discShadowPx(spec, discPx);
  return `${-left}px ${down}px 0 ${spec.discShadow.colorHex}`;
}

/** The mana-font suffix a symbol draws in `spec`: the style's own tap for
 *  {T}, every other symbol as it is. */
export function styledSuffix(spec: SymbolStyleSpec, suffix: string): string {
  return suffix === "tap" ? spec.tapSuffix : suffix;
}
