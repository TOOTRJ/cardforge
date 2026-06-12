import { cn } from "@/lib/utils";
import { pipOverrideForToken, type PipOverrides } from "@/lib/pips/override";

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
  /** Explicit font-size override. Pass a container-relative value (e.g. a
   *  `cqw` string) so the pips scale with the card instead of staying a fixed
   *  pixel size. When set, it wins over `size`; the gap + text fallback scale
   *  with it via em units. Used by CardPreview; the form pickers keep `size`. */
  fontSize?: number | string;
  /** The card OWNER's custom pip icons. Pure color pips ({W}…{C}) with an
   *  entry render the uploaded image instead of the mana-font glyph; all
   *  other tokens (and all callers that omit this) keep the standard look. */
  overrides?: PipOverrides | null;
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

// A custom pip image drawn in the exact box mana-font gives `.ms-cost`:
// a 1.3em disc at 0.95em font size with the hard offset `.ms-shadow` pair —
// so override pips line up pixel-for-pixel with standard ones beside them.
function PipOverrideImg({ src }: { src: string }) {
  return (
    <span aria-hidden style={{ fontSize: "0.95em" }} className="inline-flex">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        style={{
          width: "1.3em",
          height: "1.3em",
          borderRadius: "50%",
          objectFit: "cover",
          boxShadow: "-0.06em 0.07em 0 #111, 0 0.06em 0 #111",
        }}
      />
    </span>
  );
}

export function ManaCostGlyphs({
  cost,
  size = "md",
  fontSize,
  overrides,
  className,
}: ManaCostGlyphsProps) {
  if (!cost || !cost.trim()) return null;
  const tokens = tokenize(cost.trim());
  if (tokens.length === 0) return null;

  // A custom fontSize (e.g. a `cqw` value) scales the glyphs with the card; the
  // gap then needs to scale too, so use an em gap instead of the fixed token.
  const scaled = fontSize != null;
  const resolvedFontSize = scaled ? fontSize : SIZE_PX[size];

  return (
    <span
      className={cn(
        "inline-flex items-center",
        scaled ? "gap-[0.12em]" : GAP_CLASS[size],
        className,
      )}
      // A rendered mana cost is a composite pictograph — role="img" makes
      // the aria-label valid (plain spans prohibit it) and reads the whole
      // cost as one unit instead of glyph-by-glyph.
      role="img"
      aria-label={`Cost ${cost}`}
      style={{ fontSize: resolvedFontSize }}
    >
      {tokens.map((token, i) => {
        if (token.kind === "text") {
          return (
            <span
              key={`t-${i}`}
              className="text-[0.72em] uppercase tracking-wider text-muted"
            >
              {token.value}
            </span>
          );
        }
        const overrideSrc = pipOverrideForToken(token, overrides);
        if (overrideSrc) {
          return <PipOverrideImg key={`g-${i}`} src={overrideSrc} />;
        }
        const suffix = tokenSuffix(token);
        if (!suffix) return null;
        // ms-cost gives the circular gem background, ms-shadow adds depth.
        // Both come from mana-font's stylesheet.
        return (
          <i
            key={`g-${i}`}
            aria-hidden
            className={cn("ms ms-cost ms-shadow", `ms-${suffix}`)}
          />
        );
      })}
    </span>
  );
}
