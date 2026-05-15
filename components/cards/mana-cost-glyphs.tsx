import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// ManaCostGlyphs — render `{2}{R}{G/W}{R/P}{T}{S}` etc. as small colored
// circular glyphs. Everything is rendered with CSS gradients + inline SVG;
// no vendor mana symbol art is shipped.
//
// Token vocabulary (chunk 02):
//   {0} {1} {2} … {X}          — generic / variable, colorless gem
//   {W} {U} {B} {R} {G}        — single colors
//   {C}                         — explicit colorless
//   {W/U} {U/B} … {G/U}        — two-color hybrid (split gem)
//   {2/W} {2/U} … {2/G}        — twobrid (split with numeric label)
//   {W/P} … {C/P}              — Phyrexian (color gem with ϕ overlay)
//   {T}                         — tap symbol
//   {Q}                         — untap symbol
//   {S}                         — snow mana
//
// Anything unknown falls back to a colorless gem labeled with the first two
// characters of the inner content so nothing gets silently dropped.
// ---------------------------------------------------------------------------

type GlyphSize = "sm" | "md" | "lg";

type ManaCostGlyphsProps = {
  /** Cost string in curly-brace notation, e.g. "{2}{R}{R}". Non-bracketed
   *  text is rendered as a plain trailing fragment so weirdness like "1 or 2"
   *  doesn't get silently dropped. */
  cost: string | null | undefined;
  size?: GlyphSize;
  className?: string;
};

const TOKEN_PATTERN = /\{([^}]+)\}/g;

const SIZE_CLASS: Record<GlyphSize, string> = {
  sm: "h-4 w-4 text-[9px]",
  md: "h-5 w-5 text-[10px]",
  lg: "h-6 w-6 text-xs",
};

const GAP_CLASS: Record<GlyphSize, string> = {
  sm: "gap-0.5",
  md: "gap-1",
  lg: "gap-1.5",
};

// ---------------------------------------------------------------------------
// Color palette
//
// Each color has three pieces of info:
//   - `bgClass` — the full background gradient + text-color for solid gems
//   - `baseHex` — the saturated middle hex used in hybrid composites
//   - `textClass` — text color for content rendered on a hybrid background
// ---------------------------------------------------------------------------

type ColorKey = "W" | "U" | "B" | "R" | "G" | "C";

const COLOR: Record<ColorKey, { bgClass: string; baseHex: string; textClass: string }> = {
  W: {
    bgClass:
      "bg-[radial-gradient(circle_at_30%_25%,#fff_0%,#f7eccb_45%,#cfb787_100%)] text-amber-950",
    baseHex: "#f7eccb",
    textClass: "text-amber-950",
  },
  U: {
    bgClass:
      "bg-[radial-gradient(circle_at_30%_25%,#dff2ff_0%,#7cc3ee_45%,#1f6aa1_100%)] text-sky-950",
    baseHex: "#7cc3ee",
    textClass: "text-sky-950",
  },
  B: {
    bgClass:
      "bg-[radial-gradient(circle_at_30%_25%,#d6cfc8_0%,#5b5550_45%,#1a1814_100%)] text-zinc-100",
    baseHex: "#5b5550",
    textClass: "text-zinc-100",
  },
  R: {
    bgClass:
      "bg-[radial-gradient(circle_at_30%_25%,#ffd9c7_0%,#ec6f4c_45%,#8e2c14_100%)] text-rose-50",
    baseHex: "#ec6f4c",
    textClass: "text-rose-50",
  },
  G: {
    bgClass:
      "bg-[radial-gradient(circle_at_30%_25%,#dcf2c8_0%,#79b664_45%,#234e1a_100%)] text-emerald-50",
    baseHex: "#79b664",
    textClass: "text-emerald-50",
  },
  C: {
    bgClass:
      "bg-[radial-gradient(circle_at_30%_25%,#eceaea_0%,#b8b5b3_45%,#6f6c69_100%)] text-zinc-900",
    baseHex: "#b8b5b3",
    textClass: "text-zinc-900",
  },
};

// Shared shadow / shape classes pulled out so every glyph variant is the
// exact same dimensions and bevel — keeps rows aligned visually.
const GEM_SHELL_CLASS =
  "inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none shadow-[inset_0_0_0_1px_rgba(0,0,0,0.25),0_1px_2px_rgba(0,0,0,0.4)]";

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

// Exported for the unit tests so they can refer to the discriminated
// union by name. Not part of the public ManaCostGlyphs surface.
export type Token =
  | { kind: "solid"; color: ColorKey; label: string }
  | { kind: "hybrid"; left: ColorKey; right: ColorKey; label?: string }
  | { kind: "phyrexian"; color: ColorKey }
  | { kind: "symbol"; symbol: "T" | "Q" | "S" }
  | { kind: "text"; value: string };

const HYBRID_PATTERN = /^([WUBRG])\/([WUBRG])$/;
const TWOBRID_PATTERN = /^(\d+)\/([WUBRG])$/;
const PHYREXIAN_PATTERN = /^([WUBRGC])\/P$/;

function classifyInner(inner: string): Token {
  if (/^\d+$/.test(inner)) {
    return { kind: "solid", color: "C", label: inner };
  }
  if (inner === "X") {
    return { kind: "solid", color: "C", label: "X" };
  }
  if (inner === "C") {
    return { kind: "solid", color: "C", label: "C" };
  }
  if (inner === "T") return { kind: "symbol", symbol: "T" };
  if (inner === "Q") return { kind: "symbol", symbol: "Q" };
  if (inner === "S") return { kind: "symbol", symbol: "S" };

  // Single color letter
  if (inner.length === 1 && inner in COLOR) {
    return { kind: "solid", color: inner as ColorKey, label: inner };
  }

  // Phyrexian: {X/P}
  const phy = PHYREXIAN_PATTERN.exec(inner);
  if (phy) {
    return { kind: "phyrexian", color: phy[1] as ColorKey };
  }

  // Twobrid: {N/X}
  const two = TWOBRID_PATTERN.exec(inner);
  if (two) {
    return {
      kind: "hybrid",
      left: "C",
      right: two[2] as ColorKey,
      label: two[1],
    };
  }

  // Hybrid: {X/Y}
  const hyb = HYBRID_PATTERN.exec(inner);
  if (hyb) {
    return {
      kind: "hybrid",
      left: hyb[1] as ColorKey,
      right: hyb[2] as ColorKey,
    };
  }

  // Anything else (e.g. unknown future Scryfall tokens) — best-effort
  // fallback so the cost field still renders something legible.
  return { kind: "solid", color: "C", label: inner.slice(0, 2) };
}

// Exported for unit tests (tests/unit/scryfall/mana-glyphs.test.ts).
// The tokenizer is a pure function — easier to verify in isolation than
// via component rendering. Internal API; callers should still use
// <ManaCostGlyphs /> for rendering.
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
// Renderers — one per token kind. All share GEM_SHELL_CLASS so the row
// reads as uniform shapes regardless of which kinds are mixed.
// ---------------------------------------------------------------------------

export function ManaCostGlyphs({
  cost,
  size = "md",
  className,
}: ManaCostGlyphsProps) {
  if (!cost || !cost.trim()) return null;
  const tokens = tokenize(cost.trim());
  if (tokens.length === 0) return null;

  return (
    <span
      className={cn("inline-flex items-center", GAP_CLASS[size], className)}
      aria-label={`Cost ${cost}`}
    >
      {tokens.map((token, i) => {
        switch (token.kind) {
          case "text":
            return (
              <span
                key={`t-${i}`}
                className="text-[10px] uppercase tracking-wider text-muted"
              >
                {token.value}
              </span>
            );
          case "solid":
            return <SolidGlyph key={`s-${i}`} token={token} size={size} />;
          case "hybrid":
            return <HybridGlyph key={`h-${i}`} token={token} size={size} />;
          case "phyrexian":
            return <PhyrexianGlyph key={`p-${i}`} token={token} size={size} />;
          case "symbol":
            return <SymbolGlyph key={`y-${i}`} token={token} size={size} />;
        }
      })}
    </span>
  );
}

function SolidGlyph({
  token,
  size,
}: {
  token: Extract<Token, { kind: "solid" }>;
  size: GlyphSize;
}) {
  return (
    <span
      aria-hidden
      className={cn(GEM_SHELL_CLASS, SIZE_CLASS[size], COLOR[token.color].bgClass)}
    >
      {token.label}
    </span>
  );
}

function HybridGlyph({
  token,
  size,
}: {
  token: Extract<Token, { kind: "hybrid" }>;
  size: GlyphSize;
}) {
  // Two-color (or twobrid) split gem. A diagonal `linear-gradient` with
  // hard 50%/50% stops produces a sharp cut from upper-left to lower-right.
  // The radial highlight on top preserves the 3D "gem" look from the solid
  // glyphs so the row reads as one family.
  const leftHex = COLOR[token.left].baseHex;
  const rightHex = COLOR[token.right].baseHex;
  // For twobrid (e.g. {2/W}) the label is the generic-cost digit and sits
  // over the colorless half — pick that side's text color so it reads.
  // Pure hybrid has no label, so this value is unused but harmless.
  const textClass = COLOR[token.left].textClass;
  const background = [
    "radial-gradient(circle at 30% 25%, rgba(255,255,255,0.45), transparent 55%)",
    `linear-gradient(135deg, ${leftHex} 0%, ${leftHex} 49.5%, ${rightHex} 50.5%, ${rightHex} 100%)`,
  ].join(", ");
  return (
    <span
      aria-hidden
      className={cn(GEM_SHELL_CLASS, SIZE_CLASS[size], textClass)}
      style={{ backgroundImage: background }}
    >
      {token.label ?? ""}
    </span>
  );
}

function PhyrexianGlyph({
  token,
  size,
}: {
  token: Extract<Token, { kind: "phyrexian" }>;
  size: GlyphSize;
}) {
  // Color gem with a Phyrexian ϕ overlay. Render the symbol via a tiny
  // inline SVG so it scales cleanly at every gem size and doesn't depend
  // on the user's font having a φ glyph.
  const { bgClass } = COLOR[token.color];
  return (
    <span
      aria-hidden
      className={cn(GEM_SHELL_CLASS, SIZE_CLASS[size], bgClass)}
    >
      <PhiSvg />
    </span>
  );
}

function PhiSvg() {
  // Stylized Phyrexian phi: a vertical stem with a wide horizontal oval
  // through the middle. Sized via parent's text-color so it inherits the
  // right contrast (light glyph on dark base, dark glyph on light base).
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-[70%] w-[70%]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden
    >
      <line x1="8" y1="2" x2="8" y2="14" />
      <ellipse cx="8" cy="8" rx="4.5" ry="2.5" />
    </svg>
  );
}

function SymbolGlyph({
  token,
  size,
}: {
  token: Extract<Token, { kind: "symbol" }>;
  size: GlyphSize;
}) {
  // Tap / Untap / Snow render on a neutral base so they visually separate
  // from the colored mana gems.
  return (
    <span
      aria-hidden
      className={cn(GEM_SHELL_CLASS, SIZE_CLASS[size], COLOR.C.bgClass)}
    >
      {token.symbol === "T" ? (
        <TapSvg />
      ) : token.symbol === "Q" ? (
        <UntapSvg />
      ) : (
        <SnowSvg />
      )}
    </span>
  );
}

function TapSvg() {
  // 270° arc with an arrow head — evokes "rotate this card 90° clockwise"
  // without copying the WotC tap glyph.
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-[80%] w-[80%]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11.5 3.5 A 5 5 0 1 0 13 8" />
      <polyline points="11 1 11.5 3.5 14 4" />
    </svg>
  );
}

function UntapSvg() {
  // Mirror of TapSvg so the row visually distinguishes the two when they
  // appear together.
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-[80%] w-[80%]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4.5 3.5 A 5 5 0 1 1 3 8" />
      <polyline points="5 1 4.5 3.5 2 4" />
    </svg>
  );
}

function SnowSvg() {
  // Six-armed snowflake using three crossed lines.
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-[80%] w-[80%]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden
    >
      <line x1="8" y1="2" x2="8" y2="14" />
      <line x1="2.5" y1="5" x2="13.5" y2="11" />
      <line x1="2.5" y1="11" x2="13.5" y2="5" />
    </svg>
  );
}
