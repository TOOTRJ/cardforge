import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Mana pip renderer
//
// Renders a single mana symbol ("2", "R", "X", "C") as a small circle with
// the symbol inside. Colored symbols get their mana color; generic mana
// numbers and special symbols (X, C) get their own neutral style.
//
// Usage:
//   <ManaPip symbol="W" size="sm" />
// ---------------------------------------------------------------------------

export type PipSize = "xs" | "sm" | "md" | "lg";

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
  const displaySymbol = symbol;

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
