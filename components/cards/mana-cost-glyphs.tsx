import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// ManaCostGlyphs — render `{2}{R}{G}` etc. as small colored circular glyphs.
//
// Everything is rendered with CSS gradients and a built-in letterform; we
// don't ship any vendor mana symbol art. Each color uses the same OKLCH
// palette the rest of the app is built on so the glyphs blend with the
// surrounding card frame.
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

// Background gradients are pure CSS so there's no SVG asset to license or
// version. Colors are picked to read on the dark editor background AND on
// the lighter title bar / type line of the card preview.
const COLOR_BG: Record<string, string> = {
  // Five "colors". Soft inner highlight + saturated edge keeps the glyphs
  // looking like little gems rather than flat dots.
  W: "bg-[radial-gradient(circle_at_30%_25%,#fff_0%,#f7eccb_45%,#cfb787_100%)] text-amber-950",
  U: "bg-[radial-gradient(circle_at_30%_25%,#dff2ff_0%,#7cc3ee_45%,#1f6aa1_100%)] text-sky-950",
  B: "bg-[radial-gradient(circle_at_30%_25%,#d6cfc8_0%,#5b5550_45%,#1a1814_100%)] text-zinc-100",
  R: "bg-[radial-gradient(circle_at_30%_25%,#ffd9c7_0%,#ec6f4c_45%,#8e2c14_100%)] text-rose-50",
  G: "bg-[radial-gradient(circle_at_30%_25%,#dcf2c8_0%,#79b664_45%,#234e1a_100%)] text-emerald-50",
  // Colorless / generic / hybrid catch-all.
  C: "bg-[radial-gradient(circle_at_30%_25%,#eceaea_0%,#b8b5b3_45%,#6f6c69_100%)] text-zinc-900",
  X: "bg-[radial-gradient(circle_at_30%_25%,#eceaea_0%,#b8b5b3_45%,#6f6c69_100%)] text-zinc-900",
};

/**
 * Tokenize a cost string into either parsed glyph tokens (e.g. "2", "R") or
 * a raw text fragment we couldn't parse (returned for transparency).
 */
function tokenize(cost: string): Array<
  | { kind: "glyph"; label: string; colorKey: keyof typeof COLOR_BG | "num" }
  | { kind: "text"; value: string }
> {
  const out: ReturnType<typeof tokenize> = [];
  let cursor = 0;

  for (const match of cost.matchAll(TOKEN_PATTERN)) {
    if (match.index !== undefined && match.index > cursor) {
      const text = cost.slice(cursor, match.index).trim();
      if (text) out.push({ kind: "text", value: text });
    }
    const inner = match[1].toUpperCase().trim();
    // Numeric generic costs (e.g. "2", "10") get the colorless treatment.
    if (/^\d+$/.test(inner)) {
      out.push({ kind: "glyph", label: inner, colorKey: "C" });
    } else if (inner === "X") {
      out.push({ kind: "glyph", label: "X", colorKey: "X" });
    } else if (inner.length === 1 && inner in COLOR_BG) {
      out.push({ kind: "glyph", label: inner, colorKey: inner as keyof typeof COLOR_BG });
    } else {
      // Hybrid / phyrexian / weird tokens — render the inner text on a
      // colorless gem so nothing's lost.
      out.push({ kind: "glyph", label: inner.slice(0, 2), colorKey: "C" });
    }
    cursor = (match.index ?? 0) + match[0].length;
  }

  if (cursor < cost.length) {
    const trailing = cost.slice(cursor).trim();
    if (trailing) out.push({ kind: "text", value: trailing });
  }

  return out;
}

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
      className={cn(
        "inline-flex items-center",
        GAP_CLASS[size],
        className,
      )}
      aria-label={`Cost ${cost}`}
    >
      {tokens.map((token, i) => {
        if (token.kind === "text") {
          return (
            <span
              key={`t-${i}`}
              className="text-[10px] uppercase tracking-wider text-muted"
            >
              {token.value}
            </span>
          );
        }
        return (
          <span
            key={`g-${i}`}
            aria-hidden
            className={cn(
              "inline-flex items-center justify-center rounded-full font-semibold leading-none shadow-[inset_0_0_0_1px_rgba(0,0,0,0.25),0_1px_2px_rgba(0,0,0,0.4)]",
              SIZE_CLASS[size],
              COLOR_BG[token.colorKey] ?? COLOR_BG.C,
            )}
          >
            {token.label}
          </span>
        );
      })}
    </span>
  );
}
