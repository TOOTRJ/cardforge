import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Mana pip renderer
//
// Parses a cost string like "{2}{R}{R}" or "{W}{U}{B}{G}{C}" into an array
// of visual pip elements. Each pip is a small circle with the mana symbol
// inside. Generic mana numbers (e.g. {2}) and special symbols (X, C) get
// their own neutral style.
//
// Usage:
//   <ManaString cost="{2}{R}{R}" size="md" />
//   <ManaPip symbol="W" size="sm" />
// ---------------------------------------------------------------------------

export type PipSize = "xs" | "sm" | "md" | "lg";

// The subset of mana symbols we render with distinct color styles.
// Anything else falls through to the generic "colorless" look.
const COLORED_SYMBOLS = new Set(["W", "U", "B", "R", "G"]);

const PIP_SIZE_CLASSES: Record<PipSize, string> = {
  xs: "h-3.5 w-3.5 text-[7px]",
  sm: "h-4.5 w-4.5 text-[8px]",
  md: "h-5 w-5 text-[9px]",
  lg: "h-6 w-6 text-[11px]",
};

// ---------------------------------------------------------------------------
// Pip styling — symbol → CSS classes for background + text
// ---------------------------------------------------------------------------

function pipClasses(symbol: string): string {
  switch (symbol) {
    case "W":
      return "bg-mana-w text-amber-900 border-amber-300/60";
    case "U":
      return "bg-mana-u text-sky-100 border-sky-400/40";
    case "B":
      return "bg-mana-b text-purple-100 border-purple-900/60";
    case "R":
      return "bg-mana-r text-red-100 border-red-700/40";
    case "G":
      return "bg-mana-g text-green-100 border-green-700/40";
    case "C":
      // Colorless — pale silver
      return "bg-mana-c text-slate-200 border-slate-500/40";
    default:
      // Generic mana (numbers) and X — neutral dark
      return "bg-elevated text-foreground border-border/60";
  }
}

// ---------------------------------------------------------------------------
// Individual pip
// ---------------------------------------------------------------------------

export function ManaPip({
  symbol,
  size = "md",
  className,
}: {
  symbol: string;
  size?: PipSize;
  className?: string;
}) {
  const displaySymbol =
    COLORED_SYMBOLS.has(symbol)
      ? symbol
      : symbol; // numbers and X pass through unchanged

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border font-mono font-bold leading-none",
        PIP_SIZE_CLASSES[size],
        pipClasses(symbol),
        className,
      )}
      aria-label={`${symbol} mana`}
    >
      {displaySymbol}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Parse "{2}{R}{R}{G}" → ["2", "R", "R", "G"]
// ---------------------------------------------------------------------------

export function parseCost(cost: string | null | undefined): string[] {
  if (!cost?.trim()) return [];
  const matches = cost.match(/\{([^}]+)\}/g);
  if (!matches) return [];
  return matches.map((m) => m.slice(1, -1).toUpperCase());
}

// ---------------------------------------------------------------------------
// ManaString — renders a full cost string as a row of pips
// ---------------------------------------------------------------------------

export function ManaString({
  cost,
  size = "md",
  className,
}: {
  cost?: string | null;
  size?: PipSize;
  className?: string;
}) {
  const pips = parseCost(cost);
  if (pips.length === 0) return null;

  return (
    <span
      className={cn("inline-flex items-center gap-0.5", className)}
      aria-label={`Mana cost: ${cost}`}
    >
      {pips.map((sym, i) => (
        <ManaPip key={`${sym}-${i}`} symbol={sym} size={size} />
      ))}
    </span>
  );
}
