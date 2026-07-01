"use client";

import { useState } from "react";
import { Delete, Eraser } from "lucide-react";
import { cn } from "@/lib/utils";
import { ManaCostGlyphs } from "@/components/cards/mana-cost-glyphs";
import { normalizeManaCost } from "@/lib/cards/mana-order";
import {
  isCustomPipSymbol,
  type PipOverrides,
} from "@/lib/pips/override";

// ---------------------------------------------------------------------------
// ManaCostPicker — click-driven editor for the card's mana cost. Replaces
// the freeform text input. Users click the colored pip buttons to append
// {W}, {U}, etc. to the cost; the generic-cost row appends {N} based on
// the chosen digit; backspace removes the last token, clear wipes it.
//
// Backed by the existing string-based cost field — every interaction emits
// the same `{...}{...}` notation the rest of the app already speaks. The
// existing ManaCostGlyphs component is reused for the live preview row at
// the top so the picker shows the user exactly what's saved.
//
// Every append runs through normalizeManaCost, so pips always land in the
// canonical printed order (X → generic → snow → colorless → colors on the
// wheel) no matter which button the user clicks first. Generic clicks sum
// into one number, and backspace removes the last token of the SORTED
// cost. Costs the normalizer doesn't recognize (custom tokens) append
// as-is. We never normalize on mount — an existing card's stored cost is
// only rewritten when the user interacts with the picker.
// ---------------------------------------------------------------------------

type Props = {
  /** Current cost in canonical `{N}{W}` notation. Empty string = no cost. */
  value: string;
  onChange: (next: string) => void;
  /** Identifier so React Hook Form can wire up errors and aria. */
  id?: string;
  /** The user's custom pip icons — swaps the ICON on the color buttons and
   *  in the preview row. Behavior (tokens emitted, order, removal) is
   *  identical with or without overrides. */
  overrides?: PipOverrides | null;
  className?: string;
};

// Single-token buttons. Each emits exactly one `{token}` when clicked.
// Generic numbers are handled separately via a stepper so we don't litter
// the row with 21 number buttons.
const COLOR_BUTTONS: Array<{
  token: string;
  label: string;
  /** Mana-font class suffix — drives the icon glyph. */
  iconSuffix: string;
  /** Background ring color so the picker rows read as colored. */
  ring: string;
}> = [
  { token: "W", label: "White",     iconSuffix: "w", ring: "from-amber-200/30 to-amber-100/0" },
  { token: "U", label: "Blue",      iconSuffix: "u", ring: "from-sky-400/30 to-sky-300/0" },
  { token: "B", label: "Black",     iconSuffix: "b", ring: "from-zinc-700/40 to-zinc-500/0" },
  { token: "R", label: "Red",       iconSuffix: "r", ring: "from-rose-500/30 to-rose-400/0" },
  { token: "G", label: "Green",     iconSuffix: "g", ring: "from-emerald-500/30 to-emerald-400/0" },
  { token: "C", label: "Colorless", iconSuffix: "c", ring: "from-slate-400/30 to-slate-300/0" },
];

const SYMBOL_BUTTONS: Array<{
  token: string;
  label: string;
  iconSuffix: string;
}> = [
  { token: "X", label: "X mana",   iconSuffix: "x" },
  { token: "T", label: "Tap",      iconSuffix: "tap" },
  { token: "S", label: "Snow",     iconSuffix: "s" },
  { token: "E", label: "Energy",   iconSuffix: "e" },
];

// Pull the last `{...}` token off the cost so backspace removes one pip
// rather than one character.
function dropLastToken(cost: string): string {
  const trimmed = cost.trimEnd();
  if (!trimmed) return "";
  const lastOpen = trimmed.lastIndexOf("{");
  if (lastOpen === -1) return "";
  return trimmed.slice(0, lastOpen);
}

export function ManaCostPicker({
  value,
  onChange,
  id,
  overrides,
  className,
}: Props) {
  // The generic-mana stepper is local UI state — it only matters while the
  // picker is mounted and never needs to round-trip to the form.
  const [generic, setGeneric] = useState<number>(1);

  const append = (token: string) =>
    onChange(normalizeManaCost(value + `{${token}}`));
  const backspace = () => onChange(dropLastToken(value));
  const clear = () => onChange("");

  return (
    <div
      id={id}
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border/50 bg-elevated/40 p-3",
        className,
      )}
    >
      {/* Live preview of what's currently in the cost field. */}
      <div className="flex min-h-9 items-center justify-between gap-2 rounded-md border border-border/40 bg-background/60 px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          {value.trim() ? (
            <ManaCostGlyphs cost={value} size="md" overrides={overrides} />
          ) : (
            <span className="text-[11px] uppercase tracking-wider text-subtle">
              No cost yet — click pips below
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={backspace}
            disabled={!value.trim()}
            aria-label="Remove last mana symbol"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/40 bg-elevated/60 text-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-40 disabled:hover:border-border/40 disabled:hover:text-muted"
          >
            <Delete className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={!value.trim()}
            aria-label="Clear cost"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/40 bg-elevated/60 text-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-40 disabled:hover:border-border/40 disabled:hover:text-muted"
          >
            <Eraser className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>

      {/* Generic mana stepper — number input + "Add {N}" button. */}
      <div className="flex items-center gap-2">
        <label className="text-[11px] uppercase tracking-wider text-subtle">
          Generic
        </label>
        <input
          type="number"
          min={0}
          max={20}
          value={generic}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value, 10);
            if (Number.isNaN(n)) {
              setGeneric(0);
            } else {
              setGeneric(Math.max(0, Math.min(20, n)));
            }
          }}
          className="h-8 w-16 rounded-md border border-border/40 bg-background/80 px-2 text-sm text-foreground tabular-nums focus:outline-none focus:ring-1 focus:ring-primary-bright/40"
        />
        <button
          type="button"
          onClick={() => append(String(generic))}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/40 bg-elevated/60 px-3 text-xs font-medium text-foreground transition-colors hover:border-border-strong hover:bg-elevated"
        >
          <i className={`ms ms-${generic} ms-cost ms-shadow`} aria-hidden style={{ fontSize: 16 }} />
          Add
        </button>
      </div>

      {/* Colored mana pips. Each click appends one token. Identical clicks
          stack (e.g. clicking R twice yields {R}{R}). */}
      <div className="flex flex-wrap gap-2">
        {COLOR_BUTTONS.map((b) => (
          <PipButton
            key={b.token}
            label={b.label}
            iconSuffix={b.iconSuffix}
            onClick={() => append(b.token)}
            ring={b.ring}
            overrideUrl={
              isCustomPipSymbol(b.token) ? overrides?.[b.token] ?? null : null
            }
          />
        ))}
      </div>

      {/* Specials — X, tap, snow, energy. Separated to keep the colored
          row's rhythm uniform. */}
      <div className="flex flex-wrap gap-2">
        {SYMBOL_BUTTONS.map((b) => (
          <PipButton
            key={b.token}
            label={b.label}
            iconSuffix={b.iconSuffix}
            onClick={() => append(b.token)}
            ring="from-slate-500/20 to-slate-400/0"
          />
        ))}
      </div>
    </div>
  );
}

function PipButton({
  label,
  iconSuffix,
  onClick,
  ring,
  overrideUrl,
}: {
  label: string;
  iconSuffix: string;
  onClick: () => void;
  ring: string;
  /** Custom pip icon — replaces the mana-font glyph, nothing else. */
  overrideUrl?: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Add ${label}`}
      title={label}
      className={cn(
        "inline-flex h-10 w-10 items-center justify-center rounded-full border border-border/40 bg-gradient-to-br shadow-sm transition-all hover:scale-110 hover:border-border-strong active:scale-95",
        ring,
      )}
    >
      {overrideUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={overrideUrl}
          alt=""
          aria-hidden
          className="h-[26px] w-[26px] rounded-full object-cover shadow-[-1px_2px_0_#111]"
        />
      ) : (
        <i
          className={`ms ms-${iconSuffix} ms-cost ms-shadow`}
          aria-hidden
          style={{ fontSize: 22 }}
        />
      )}
    </button>
  );
}
