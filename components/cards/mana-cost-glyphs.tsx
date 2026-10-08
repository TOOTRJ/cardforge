import { cn } from "@/lib/utils";
import { pipOverrideForToken, type PipOverrides } from "@/lib/pips/override";
import { SNOW_FLAKE_MITRE, drawsManaGem, manaGemSpec } from "@/lib/cards/mana-gem";
import { frameUrl } from "@/lib/frames/frame-url";
import {
  previewDiscShadowCss,
  styledSuffix,
  symbolStyle,
  type SymbolStyleSpec,
} from "@/lib/cards/symbol-style";

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
//   {G/U/P} {G/W/P} …                — two-colour phyrexian
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
   *  card and is the stored PNG's — and that disc in the stored HD bake's
   *  whole `px` (the glyph and the shadow are rounded there, CardPip). When
   *  set, it wins over `size`. */
  disc?: { size: string; gap: string; px: number };
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
  | { kind: "hybrid"; left: ColorKey; right: ColorKey; label?: string; phyrexian?: true }
  | { kind: "phyrexian"; color: ColorKey }
  | { kind: "symbol"; symbol: "T" | "Q" | "S" | "E" }
  | { kind: "text"; value: string };

const HYBRID_PATTERN = /^([WUBRG])\/([WUBRG])$/;
const TWOBRID_PATTERN = /^(\d+)\/([WUBRG])$/;
const PHYREXIAN_PATTERN = /^([WUBRGC])\/P$/;
// The two-colour Phyrexian form, {G/U/P} (Tamiyo, Compleated Sage): a
// hybrid token that says `phyrexian` — a card draws a split disc with a
// Phyrexian symbol in each half (layout v49).
const HYBRID_PHYREXIAN_PATTERN = /^([WUBRG])\/([WUBRG])\/P$/;

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

  const hybPhy = HYBRID_PHYREXIAN_PATTERN.exec(inner);
  if (hybPhy && hybPhy[1] !== hybPhy[2]) {
    return { kind: "hybrid", left: hybPhy[1] as ColorKey, right: hybPhy[2] as ColorKey, phyrexian: true };
  }

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
//   hybrid:      {W/U} → "wu", {2/W} → "2w", {G/U/P} → "gup"
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
      return token.phyrexian ? `${l}${r}p` : `${l}${r}`;
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

/** A length of the HD bake, in em of an element whose font is `emPx` of
 *  those px. */
const emOf = (px: number, emPx: number) => `${(px / emPx).toFixed(4)}em`;

// One pip of a CARD (CardPreview only: the cost rows, the rules text, the
// flipside strip, the saga rail), inside a parent whose font size is a PLAIN
// pip's disc (1 em = one plain disc) — the bake's ManaGem at the stored HD
// bake's whole px where that disc is `discPx` wide, from the SAME
// description (lib/cards/mana-gem.ts manaGemSpec): the disc's own diameter
// (a Phyrexian symbol's is larger), its colour or none, the ink, the
// glyph's size, a split disc's fill and its two half-symbols, the snow
// flake's drawing.
//
// It takes mana-font's `ms ms-<suffix>` classes for the FONT and the glyph
// only — never `ms-cost`, whose own look is not the stored card's (its own
// untap disc, Phyrexian scale and snow glyphs, a disc behind the energy
// symbol, split halves at its own offsets in its own lighter colours, #111
// ink): those are for the pickers, deck lists and articles.
//
//   - a one-colour symbol at the spec's glyph size, in a box exactly its
//     disc, the line box in mana-font's own proportion (1.35 em in a 1.3 em
//     disc). Satori centres the glyph's em box in the disc; Chromium rounds
//     the font's ascent and floors the half-leading, which sets a glyph in a
//     line box exactly one disc tall ~2 % of the disc HIGH of the bake on
//     average, and mana-font's proportion halves that (measured against the
//     bake at ten preview widths, 2026-10-07; either way it is within a px);
//   - a split disc: the bake's 135° fill, each half's glyph an absolutely
//     placed box at the bake's corner and size;
//   - the snow flake: the bake's inline SVG, centred on the disc;
//   - the disc's shadow as the bake's ONE layer (previewDiscShadowCss) —
//     none for a symbol with no disc ({E});
//   - NOTHING for a one-colour symbol the font has no glyph for, as the bake
//     (cardPipDraws — a caller that wraps the pip asks it first).
export function CardPip({
  suffix,
  discPx: pipPx,
  symbols,
  overrideSrc = null,
}: {
  /** The symbol's mana-font suffix, before the style's own {T}. */
  suffix: string;
  /** A plain pip's disc in the HD bake's px (the parent's 1 em). */
  discPx: number;
  symbols: SymbolStyleSpec;
  /** The card owner's image for this pip, when they set one. */
  overrideSrc?: string | null;
}) {
  if (overrideSrc != null) {
    const emPx = pipPx / MS_DISC_EM;
    return (
      <PipOverrideImg
        src={overrideSrc}
        symbols={symbols}
        style={{ fontSize: emOf(emPx, pipPx), flexShrink: 0 }}
        boxShadow={previewDiscShadowCss(symbols, pipPx, emPx) ?? null}
      />
    );
  }
  if (!drawsManaGem(suffix, symbols)) return null;
  const gem = manaGemSpec(suffix, pipPx, symbols);
  if (gem.kind === "image") {
    // A style's own symbol image (the 1993 frame's five colour symbols):
    // the whole pip in the disc's box, as the bake's ManaGem draws it — the
    // element an owner's custom pip uses.
    const emPx = pipPx / MS_DISC_EM;
    return (
      <PipOverrideImg
        src={frameUrl(gem.path)}
        symbols={symbols}
        pip={gem.suffix}
        style={{ fontSize: emOf(emPx, pipPx), flexShrink: 0 }}
        boxShadow={previewDiscShadowCss(symbols, pipPx, emPx) ?? null}
      />
    );
  }
  // The gem's own disc, in em of the parent (1 em = a plain disc).
  const disc = emOf(gem.discPx, pipPx);
  if (gem.kind === "split") {
    const boxShadow = previewDiscShadowCss(symbols, gem.discPx, pipPx);
    return (
      <span
        aria-hidden
        data-pip={gem.suffix}
        style={{
          position: "relative",
          display: "inline-block",
          verticalAlign: "middle",
          width: disc,
          height: disc,
          borderRadius: "50%",
          overflow: "hidden",
          background: gem.background,
          flexShrink: 0,
          ...(boxShadow ? { boxShadow } : {}),
        }}
      >
        {[gem.top, gem.bottom].map((half, index) => (
          <i
            key={index}
            className={cn("ms", `ms-${half.suffix}`)}
            style={{
              position: "absolute",
              top: emOf(half.topPx, gem.halfPx),
              left: emOf(half.leftPx, gem.halfPx),
              fontSize: emOf(gem.halfPx, pipPx),
              lineHeight: 1,
              color: gem.ink,
            }}
          />
        ))}
      </span>
    );
  }
  if (gem.flake) {
    const boxShadow = gem.bg === null ? undefined : previewDiscShadowCss(symbols, gem.discPx, pipPx);
    const side = emOf(gem.flake.sizePx, pipPx);
    return (
      <span
        aria-hidden
        data-pip={gem.suffix}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          verticalAlign: "middle",
          width: disc,
          height: disc,
          borderRadius: "50%",
          ...(gem.bg === null ? {} : { backgroundColor: gem.bg }),
          flexShrink: 0,
          ...(boxShadow ? { boxShadow } : {}),
        }}
      >
        <svg viewBox={gem.flake.viewBox} style={{ display: "block", width: side, height: side, flexShrink: 0 }}>
          <path d={gem.flake.d} fill={gem.ink} stroke={gem.ink} strokeWidth={gem.flake.outlineWidth} strokeLinejoin="miter" strokeMiterlimit={SNOW_FLAKE_MITRE} />
          <path d={gem.flake.d} fill={gem.flake.fill} stroke={gem.flake.fill} strokeWidth={gem.flake.fillWidth} strokeLinejoin="miter" strokeMiterlimit={SNOW_FLAKE_MITRE} />
        </svg>
      </span>
    );
  }
  const box = emOf(gem.discPx, gem.glyphPx);
  const boxShadow = gem.bg === null ? undefined : previewDiscShadowCss(symbols, gem.discPx, gem.glyphPx);
  return (
    <i
      aria-hidden
      data-pip={gem.suffix}
      className={cn("ms", `ms-${gem.suffix}`)}
      style={{
        fontSize: emOf(gem.glyphPx, pipPx),
        width: box,
        height: box,
        lineHeight: emOf((MS_LINE_EM / MS_DISC_EM) * gem.discPx, gem.glyphPx),
        textAlign: "center",
        borderRadius: "50%",
        // No disc at all for a bare symbol ({E}).
        ...(gem.bg === null ? {} : { backgroundColor: gem.bg }),
        color: gem.ink,
        flexShrink: 0,
        ...(boxShadow ? { boxShadow } : {}),
      }}
    />
  );
}

/** True when CardPip draws anything for this pip: an owner's image, a split
 *  disc, or a symbol mana-font has a glyph for. The bake draws no disc and
 *  keeps no room for the rest — a caller that wraps the pip (a gap, a
 *  margin) leaves the wrapper out too. */
export function cardPipDraws(suffix: string, symbols: SymbolStyleSpec, overrideSrc?: string | null): boolean {
  return overrideSrc != null || drawsManaGem(suffix, symbols);
}

// A custom pip image drawn in the exact box mana-font gives `.ms-cost`:
// a 1.3em disc at the given font size (0.95em for the pickers' costs; a
// card's pips pass their own scale, CardPip) with the hard offset
// `.ms-shadow` pair — or, on a card, the bake's one layer (`boxShadow`) — so
// override pips line up pixel-for-pixel with standard ones beside them.
export function PipOverrideImg({
  src,
  fontSizeEm = 0.95,
  style,
  symbols = symbolStyle(undefined),
  boxShadow,
  pip,
}: {
  src: string;
  /** A style's own symbol image: the suffix it draws (`data-pip`, as a
   *  glyph pip carries). */
  pip?: string;
  fontSizeEm?: number;
  style?: React.CSSProperties;
  /** The frame's symbol style (the disc's shadow); "modern" when omitted. */
  symbols?: SymbolStyleSpec;
  /** A CARD's pip: the bake's shadow in place of the style's mana-font pair
   *  (null = none). */
  boxShadow?: string | null;
}) {
  const shadow = boxShadow === undefined ? symbols.previewShadowCss : boxShadow;
  return (
    <span
      aria-hidden
      {...(pip ? { "data-pip": pip } : {})}
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
          // mana-font's `.ms-cost.ms-shadow` pair (a card: the bake's one
          // layer), where the style has a shadow.
          ...(shadow ? { boxShadow: shadow } : {}),
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
        const suffix = tokenSuffix(token);
        if (disc) {
          if (!overrideSrc && !suffix) return null;
          return <CardPip key={`g-${i}`} suffix={suffix ?? ""} discPx={disc.px} symbols={symbols} overrideSrc={overrideSrc} />;
        }
        if (overrideSrc) {
          return <PipOverrideImg key={`g-${i}`} src={overrideSrc} symbols={symbols} />;
        }
        if (!suffix) return null;
        // ms-cost gives the circular gem background, ms-shadow adds depth.
        // Both come from mana-font's stylesheet.
        return (
          <i
            key={`g-${i}`}
            aria-hidden
            className={cn("ms ms-cost", symbols.previewShadowClass, `ms-${styledSuffix(symbols, suffix)}`)}
          />
        );
      })}
    </span>
  );
}
