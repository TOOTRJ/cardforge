// ---------------------------------------------------------------------------
// PipGlyph brand constants — the single source of truth for brand colors in
// contexts that cannot read CSS variables: Satori OG images, ImageResponse
// icons, node asset scripts, and static SVG exports.
//
// Each value is the sRGB literal of a token in app/globals.css @theme — if a
// token changes there, update the literal here (and re-run
// scripts/generate-brand-assets.mjs). Keep this file dependency-free and
// erasable-syntax-only: it is imported by edge-runtime OG routes and by node
// scripts via type-stripping.
// ---------------------------------------------------------------------------

export const BRAND = {
  /** --color-gold oklch(0.78 0.09 84) — flat brand gold (mockup anchor) */
  gold: "#d8b26e",
  /** Web-logo gradient stops (light → deep) */
  goldLight: "#ecca8a",
  goldDeep: "#b8904a",
  /** --color-primary-bright oklch(0.7 0.11 300) — accents, gem facet */
  purple: "#8e72c9",
  /** --color-primary oklch(0.5 0.13 300) — gem fill, deep accents */
  purpleDeep: "#6b4d9a",
  /** Headline-gradient midpoint between gold and purple */
  lilac: "#b794e6",
  /** --color-background oklch(0.18 0.03 262) — mockup anchor */
  navy: "#0d1320",
  /** --color-surface oklch(0.23 0.03 262) — mockup anchor */
  surface: "#1a2030",
  /** Chip/medallion face — between navy and surface */
  ink: "#10151f",
  /** Carved-socket floor for the Deep Seal treatment */
  socket: "#0a0e17",
  /** --color-foreground oklch(0.96 0.005 262) */
  foreground: "#f2f3f5",
  /** --color-muted oklch(0.72 0.018 262) */
  muted: "#9aa3b5",
  /** OG footer bronze (domain label) */
  bronze: "#6e6248",
} as const;

/** WUBRG pip colors — sRGB of the --color-mana-* tokens in
 *  app/globals.css (canvas-measured so OG art matches the live site). */
export const MANA_HEX = {
  W: "#f7efd1",
  U: "#0089df",
  B: "#7055b0",
  R: "#ee343b",
  G: "#009c3f",
  C: "#707178",
} as const;

/** WUBRG strip used by OG chrome (order is the color wheel). */
export const MANA_PIPS = [
  { color: MANA_HEX.W, label: "W" },
  { color: MANA_HEX.U, label: "U" },
  { color: MANA_HEX.B, label: "B" },
  { color: MANA_HEX.R, label: "R" },
  { color: MANA_HEX.G, label: "G" },
] as const;

export const OG_SIZE = { width: 1200, height: 630 } as const;
