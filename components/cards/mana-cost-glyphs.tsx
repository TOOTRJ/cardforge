import { cn } from "@/lib/utils";
import { pipOverrideForToken, type PipOverrides } from "@/lib/pips/override";
import { MANA_GLYPH_OF_DISC, styledSuffix, symbolStyle, type SymbolStyleSpec } from "@/lib/cards/symbol-style";

// ---------------------------------------------------------------------------
// ManaCostGlyphs — render `{2}{R}{G/W}{R/P}{T}{S}` etc. using the open-source
// Mana font (https://github.com/andrewgioia/mana, SIL OFL 1.1 + MIT). The CSS
// is imported globally in app/globals.css; this component just emits the
// right class names.
//
// Token vocabulary:
//   {0} {1} {2} … {20} {X} {Y} {Z}   — generic / variable
//   {W} {U} {B} {R} {G} {C}          — single color / colorless
//   {W/U} {U/B} … {G/U}              — hybrid (combined two-color)
//   {2/W} {2/U} … {2/G}              — twobrid
//   {W/P} … {C/P}                    — phyrexian
//   {T} {Q} {S} {E}                  — tap, untap, snow, energy
//
// Anything unknown falls back to a generic-cost gem labeled with the first
// two characters of the inner content so nothing gets silently dropped.
// ---------------------------------------------------------------------------

type GlyphSize = "sm" | "md" | "lg";

type ManaCostGlyphsProps = {
  cost: string | null | undefined;
  size?: GlyphSize;
  /** A CARD's cost row (CardPreview only; the pickers keep `size`): each
   *  disc's DIAMETER and the gap between pips, as container-relative CSS
   *  lengths (`cqw`) — the bake's disc and gap, so the row scales with the
   *  card and is the stored PNG's. When set, it wins over `size`. */
  disc?: { size: string; gap: string };
  /** The card OWNER's custom pip icons. Pure color pips ({W}…{C}) with an
   *  entry render the uploaded image instead of the mana-font glyph; all
   *  other tokens (and all callers that omit this) keep the standard look. */
  overrides?: PipOverrides | null;
  /** Vertical nudge of the whole cost (a CSS length, e.g. a `cqw` string;
   *  negative = up) — a frame profile's `costDy` (CardPreview only). */
  offsetY?: string;
  /** The frame's symbol style (lib/cards/symbol-style.ts, TODO 4.8.0) — a
   *  prop of the CARD's uses only (CardPreview hands it its profile's): the
   *  pickers, dialogs, deck lists and articles omit it and keep the
   *  "modern" look, whatever frame a card is on. */
  symbols?: SymbolStyleSpec;
  className?: string;
};

const TOKEN_PATTERN = /\{([^}]+)\}/g;

const SIZE_PX: Record<GlyphSize, number> = {
  sm: 16,
  md: 20,
  lg: 24,
};

const GAP_CLASS: Record<GlyphSize, string> = {
  sm: "gap-0.5",
  md: "gap-1",
  lg: "gap-1.5",
};

type ColorKey = "W" | "U" | "B" | "R" | "G" | "C";

// ---------------------------------------------------------------------------
// Tokenizer — unchanged so existing unit tests
// (tests/unit/scryfall/mana-glyphs.test.ts) still apply.
// ---------------------------------------------------------------------------

export type Token =
  | { kind: "solid"; color: ColorKey; label: string }
  | { kind: "hybrid"; left: ColorKey; right: ColorKey; label?: string }
  | { kind: "phyrexian"; color: ColorKey }
  | { kind: "symbol"; symbol: "T" | "Q" | "S" | "E" }
  | { kind: "text"; value: string };

const HYBRID_PATTERN = /^([WUBRG])\/([WUBRG])$/;
const TWOBRID_PATTERN = /^(\d+)\/([WUBRG])$/;
const PHYREXIAN_PATTERN = /^([WUBRGC])\/P$/;

function classifyInner(inner: string): Token {
  if (/^\d+$/.test(inner)) {
    return { kind: "solid", color: "C", label: inner };
  }
  if (inner === "X" || inner === "Y" || inner === "Z") {
    return { kind: "solid", color: "C", label: inner };
  }
  if (inner === "C") {
    return { kind: "solid", color: "C", label: "C" };
  }
  if (inner === "T") return { kind: "symbol", symbol: "T" };
  if (inner === "Q") return { kind: "symbol", symbol: "Q" };
  if (inner === "S") return { kind: "symbol", symbol: "S" };
  if (inner === "E") return { kind: "symbol", symbol: "E" };

  if (inner.length === 1 && /^[WUBRGC]$/.test(inner)) {
    return { kind: "solid", color: inner as ColorKey, label: inner };
  }

  const phy = PHYREXIAN_PATTERN.exec(inner);
  if (phy) return { kind: "phyrexian", color: phy[1] as ColorKey };

  const two = TWOBRID_PATTERN.exec(inner);
  if (two) {
    return {
      kind: "hybrid",
      left: "C",
      right: two[2] as ColorKey,
      label: two[1],
    };
  }

  const hyb = HYBRID_PATTERN.exec(inner);
  if (hyb) {
    return {
      kind: "hybrid",
      left: hyb[1] as ColorKey,
      right: hyb[2] as ColorKey,
    };
  }

  return { kind: "solid", color: "C", label: inner.slice(0, 2) };
}

export function tokenize(cost: string): Token[] {
  const out: Token[] = [];
  let cursor = 0;

  for (const match of cost.matchAll(TOKEN_PATTERN)) {
    if (match.index !== undefined && match.index > cursor) {
      const text = cost.slice(cursor, match.index).trim();
      if (text) out.push({ kind: "text", value: text });
    }
    const inner = match[1].toUpperCase().trim();
    out.push(classifyInner(inner));
    cursor = (match.index ?? 0) + match[0].length;
  }

  if (cursor < cost.length) {
    const trailing = cost.slice(cursor).trim();
    if (trailing) out.push({ kind: "text", value: trailing });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Token → Mana-font class suffix.
//   solid:       {W} → "w", {0..20} → digit string, {X|Y|Z|C} → letter
//   hybrid:      {W/U} → "wu", {2/W} → "2w"
//   phyrexian:   {W/P} → "wp"
//   symbol:      {T} → "tap", {Q} → "untap", {S} → "s", {E} → "e"
// ---------------------------------------------------------------------------

export function tokenSuffix(token: Token): string | null {
  switch (token.kind) {
    case "solid":
      return token.label.toLowerCase();
    case "hybrid": {
      const l = token.left === "C" ? token.label ?? "0" : token.left.toLowerCase();
      const r = token.right.toLowerCase();
      return `${l}${r}`;
    }
    case "phyrexian":
      return `${token.color.toLowerCase()}p`;
    case "symbol":
      if (token.symbol === "T") return "tap";
      if (token.symbol === "Q") return "untap";
      if (token.symbol === "S") return "s";
      if (token.symbol === "E") return "e";
      return null;
    case "text":
      return null;
  }
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

// mana-font's `.ms-cost` box: a disc 1.3 em of the pip's own font size, its
// line box 1.35 em.
const MS_DISC_EM = 1.3;
const MS_LINE_EM = 1.35;

// One pip of a CARD's cost row, whose font size is the disc's diameter
// (1 em = one disc): the bake's ManaGem — a disc exactly that wide, a
// one-colour symbol at MANA_GLYPH_OF_DISC of it. mana-font sizes the disc
// from the glyph's font (1.3 em of `.ms-cost`'s own 0.95 em), which left it
// 5 % short of the bake's; so the glyph keeps its size and the box is set
// around it, the line box in mana-font's own proportion. A split disc keeps
// mana-font's box at disc ÷ 1.3 — the proportions the bake's halves follow.
const COST_DISC_STYLE: React.CSSProperties = {
  fontSize: `${MANA_GLYPH_OF_DISC}em`,
  width: `${(1 / MANA_GLYPH_OF_DISC).toFixed(4)}em`,
  height: `${(1 / MANA_GLYPH_OF_DISC).toFixed(4)}em`,
  lineHeight: `${(MS_LINE_EM / MS_DISC_EM / MANA_GLYPH_OF_DISC).toFixed(4)}em`,
  flexShrink: 0,
};
const COST_SPLIT_DISC_STYLE: React.CSSProperties = {
  fontSize: `${(1 / MS_DISC_EM).toFixed(4)}em`,
  flexShrink: 0,
};

// A custom pip image drawn in the exact box mana-font gives `.ms-cost`:
// a 1.3em disc at the given font size (0.95em for the pickers' costs; a
// card's cost row and rules text pass their own scale) with the hard offset
// `.ms-shadow` pair — so override pips line up pixel-for-pixel with standard
// ones beside them.
export function PipOverrideImg({
  src,
  fontSizeEm = 0.95,
  style,
  symbols = symbolStyle(undefined),
}: {
  src: string;
  fontSizeEm?: number;
  style?: React.CSSProperties;
  /** The frame's symbol style (the disc's shadow); "modern" when omitted. */
  symbols?: SymbolStyleSpec;
}) {
  return (
    <span
      aria-hidden
      style={{ fontSize: `${fontSizeEm}em`, ...style }}
      className="inline-flex"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        style={{
          width: "1.3em",
          height: "1.3em",
          borderRadius: "50%",
          objectFit: "cover",
          // mana-font's `.ms-cost.ms-shadow` pair, where the style has a shadow.
          ...(symbols.previewShadowCss ? { boxShadow: symbols.previewShadowCss } : {}),
        }}
      />
    </span>
  );
}

export function ManaCostGlyphs({
  cost,
  size = "md",
  disc,
  overrides,
  offsetY,
  symbols = symbolStyle(undefined),
  className,
}: ManaCostGlyphsProps) {
  if (!cost || !cost.trim()) return null;
  const tokens = tokenize(cost.trim());
  if (tokens.length === 0) return null;

  // A card's row: the font size IS the disc's diameter, the gap the bake's.
  const scaled = disc != null;

  return (
    <span
      className={cn(
        "inline-flex items-center",
        scaled ? null : GAP_CLASS[size],
        className,
      )}
      // A rendered mana cost is a composite pictograph — role="img" makes
      // the aria-label valid (plain spans prohibit it) and reads the whole
      // cost as one unit instead of glyph-by-glyph.
      role="img"
      aria-label={`Cost ${cost}`}
      style={{
        ...(disc ? { fontSize: disc.size, columnGap: disc.gap } : { fontSize: SIZE_PX[size] }),
        ...(offsetY ? { transform: `translateY(${offsetY})` } : {}),
      }}
    >
      {tokens.map((token, i) => {
        if (token.kind === "text") {
          return (
            <span
              key={`t-${i}`}
              // The bake's 0.6 × disc caps on a card; the pickers' as before.
              className={cn(scaled ? "text-[0.6em]" : "text-[0.72em]", "uppercase tracking-wider text-muted")}
            >
              {token.value}
            </span>
          );
        }
        const overrideSrc = pipOverrideForToken(token, overrides);
        if (overrideSrc) {
          return (
            <PipOverrideImg
              key={`g-${i}`}
              src={overrideSrc}
              symbols={symbols}
              {...(scaled ? { fontSizeEm: 1 / MS_DISC_EM, style: { flexShrink: 0 } } : {})}
            />
          );
        }
        const suffix = tokenSuffix(token);
        if (!suffix) return null;
        // ms-cost gives the circular gem background, ms-shadow adds depth.
        // Both come from mana-font's stylesheet.
        return (
          <i
            key={`g-${i}`}
            aria-hidden
            className={cn("ms ms-cost", symbols.previewShadowClass, `ms-${styledSuffix(symbols, suffix)}`)}
            style={scaled ? (token.kind === "hybrid" ? COST_SPLIT_DISC_STYLE : COST_DISC_STYLE) : undefined}
          />
        );
      })}
    </span>
  );
}
