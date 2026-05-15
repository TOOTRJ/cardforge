"use client";

// ---------------------------------------------------------------------------
// ManaCostBuilder
//
// A visual mana cost picker for the card creator. Renders the current cost
// as colored pips and exposes buttons to append/remove pips — no typing
// required. A plain text input below acts as a fallback / power-user override.
//
// Output format: "{2}{R}{R}", "{W}{U}", "{X}{G}{G}", etc.
// ---------------------------------------------------------------------------

import { cn } from "@/lib/utils";
import { ManaPip, ManaString, parseCost } from "@/components/cards/mana-pip";

// The buttons we expose in the picker UI, in display order.
const GENERIC_VALUES = ["X", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "15", "20"];
const COLORED_VALUES = ["W", "U", "B", "R", "G", "C"];

// Generic pips (numbers, X) get a neutral look; colored get their WUBRG color.
// We also show a small label below each group.

function appendPip(current: string, symbol: string): string {
  return `${current}{${symbol}}`;
}

function removeLastPip(current: string): string {
  // Strip the final {…} group from the cost string.
  return current.replace(/\{[^}]+\}$/, "");
}

export function ManaCostBuilder({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const pips = parseCost(value);

  return (
    <div className="flex flex-col gap-3">
      {/* Preview bar */}
      <div className="flex min-h-8 items-center gap-2 rounded-md border border-border bg-background/60 px-3 py-1.5">
        {pips.length > 0 ? (
          <>
            <ManaString cost={value} size="sm" />
            <span className="ml-auto font-mono text-[10px] text-subtle">
              {value}
            </span>
          </>
        ) : (
          <span className="text-xs text-subtle">No mana cost — click pips below to build one.</span>
        )}
      </div>

      {/* Colored mana pips */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-subtle">Colored mana</span>
        <div className="flex flex-wrap gap-1.5">
          {COLORED_VALUES.map((sym) => (
            <PipButton
              key={sym}
              symbol={sym}
              onClick={() => onChange(appendPip(value, sym))}
            />
          ))}
        </div>
      </div>

      {/* Generic / variable mana */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-subtle">Generic & variable</span>
        <div className="flex flex-wrap gap-1.5">
          {GENERIC_VALUES.map((sym) => (
            <PipButton
              key={sym}
              symbol={sym}
              onClick={() => onChange(appendPip(value, sym))}
            />
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(removeLastPip(value))}
          disabled={pips.length === 0}
          className={cn(
            "rounded-md border border-border bg-elevated px-3 py-1.5 text-xs font-medium text-muted transition-colors",
            "hover:border-border-strong hover:text-foreground",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          ← Remove last
        </button>
        <button
          type="button"
          onClick={() => onChange("")}
          disabled={pips.length === 0}
          className={cn(
            "rounded-md border border-border bg-elevated px-3 py-1.5 text-xs font-medium text-muted transition-colors",
            "hover:border-danger/60 hover:text-foreground",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          Clear
        </button>
        <span className="ml-auto text-[10px] text-subtle">
          {pips.length} pip{pips.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Text override — power users can type directly */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] uppercase tracking-wider text-subtle">
          Raw cost string (advanced)
        </label>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="{2}{R}{R}"
          className={cn(
            "h-8 w-full rounded-md border border-border bg-background/60 px-3 font-mono text-xs text-foreground placeholder:text-subtle",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          )}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single pip button used in the picker grid
// ---------------------------------------------------------------------------

function PipButton({
  symbol,
  onClick,
}: {
  symbol: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Add ${symbol} mana pip`}
      className="group transition-transform active:scale-90"
    >
      <ManaPip
        symbol={symbol}
        size="md"
        className="cursor-pointer transition-opacity group-hover:opacity-80 group-focus-visible:ring-2 group-focus-visible:ring-primary/60 group-focus-visible:ring-offset-1 group-focus-visible:ring-offset-background"
      />
    </button>
  );
}
