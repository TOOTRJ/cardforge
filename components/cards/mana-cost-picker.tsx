"use client";

import { useState } from "react";
import { Delete, Eraser } from "lucide-react";
import { cn } from "@/lib/utils";
import { ManaCostGlyphs, offCardSuffix, tokenize } from "@/components/cards/mana-cost-glyphs";
import { normalizeManaCost } from "@/lib/cards/mana-order";
import { MORE_SYMBOLS, MORE_SYMBOLS_LABEL, MORE_SYMBOL_GROUPS, capitalized } from "@/lib/cards/more-symbols";
import { CARD_COST_MAX } from "@/lib/validation/card";
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
//
// The hybrid, twobrid and Phyrexian symbols sit in a collapsed group under
// the specials — the SAME thirty, in the same order and under the same
// label, as the rules-text toolbar's (lib/cards/more-symbols.ts is the one
// list). The picker is the same on every frame and every cost field (the
// front's, a second face's, a modal back's): nothing here reads a template.
//
// A cost holds CARD_COST_MAX characters (the schema's and the database's
// limit). A symbol that would take the cost past it is NOT added: its button
// dims (aria-disabled — it keeps its place in the tab order), and a line
// under the cost says why.
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
  // The collapsed group, opened by its summary. Held here (not left to the
  // <details>) so the summary's click can be cancelled: see `onClick` below.
  const [moreOpen, setMoreOpen] = useState(false);

  const withToken = (token: string) => normalizeManaCost(value + `{${token}}`);
  /** False when the symbol would take the cost past the limit. A generic
   *  number merges into the one already there, so it is asked token by
   *  token, never by length alone. */
  const fits = (token: string) => withToken(token).length <= CARD_COST_MAX;
  const append = (token: string) => {
    const next = withToken(token);
    if (next.length > CARD_COST_MAX) return;
    onChange(next);
  };
  const someRefused =
    !fits(String(generic)) ||
    [...COLOR_BUTTONS, ...SYMBOL_BUTTONS].some((b) => !fits(b.token)) ||
    MORE_SYMBOLS.some((symbol) => !fits(symbol.token.slice(1, -1)));
  const backspace = () => onChange(dropLastToken(value));
  const clear = () => onChange("");

  return (
    <div
      id={id}
      // Every mount sits inside a FieldGroup's <label>, and a <label> hands a
      // click on anything that is not a control of its own to its first
      // button — here "Remove last mana symbol". A click on the picker's
      // plain parts (a gap between pips, the limit's line, a caption) is
      // cancelled so it presses nothing.
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest("button, input, summary")) event.preventDefault();
      }}
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border/50 bg-elevated/40 p-3",
        className,
      )}
    >
      {/* Live preview of what's currently in the cost field. */}
      <div className="flex min-h-9 items-center justify-between gap-2 rounded-md border border-border/40 bg-background/60 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          {value.trim() ? (
            // A long cost wraps inside the row instead of widening the page.
            <ManaCostGlyphs cost={value} size="md" overrides={overrides} className="flex-wrap gap-y-1" />
          ) : (
            <span className="text-[11px] uppercase tracking-wider text-subtle">
              No cost yet — click pips below
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
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

      {/* Always in the tree, so a screen reader hears it appear. */}
      <p role="status" className={cn("text-[11px] leading-4 text-muted", someRefused ? null : "sr-only")}>
        {someRefused
          ? `A cost holds up to ${CARD_COST_MAX} characters — the dimmed symbols no longer fit. Remove one to add another.`
          : ""}
      </p>

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
          // The caption beside it is not tied to it: named here.
          aria-label="Generic mana amount"
          // Enter in a form's input submits the form — here it would SAVE
          // the card from the middle of building a cost. It adds the number
          // instead, as the button beside it does.
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            append(String(generic));
          }}
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
          aria-disabled={fits(String(generic)) ? undefined : true}
          title={fits(String(generic)) ? undefined : capitalized(REFUSED_TITLE)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md border border-border/40 bg-elevated/60 px-3 text-xs font-medium text-foreground transition-colors hover:border-border-strong hover:bg-elevated",
            fits(String(generic)) ? null : REFUSED_CLASS,
          )}
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
            refused={!fits(b.token)}
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
            refused={!fits(b.token)}
            ring="from-slate-500/20 to-slate-400/0"
          />
        ))}
      </div>

      {/* Hybrid, twobrid and Phyrexian — the rules toolbar's group, collapsed
          until asked for. A <details>: its summary is in the tab order and
          opens with Enter / Space. */}
      <details open={moreOpen}>
        <summary
          // Cancelled and toggled by hand: the browser's own toggle would
          // also let the <label> round the picker forward the click (above)
          // where a browser does not count a summary as a control. Enter and
          // Space on the summary arrive here as a click too.
          onClick={(event) => {
            event.preventDefault();
            setMoreOpen((open) => !open);
          }}
          className="w-fit cursor-pointer list-none rounded-sm text-xs text-subtle transition-colors hover:text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-bright/60 [&::-webkit-details-marker]:hidden"
        >
          {MORE_SYMBOLS_LABEL}
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          {MORE_SYMBOL_GROUPS.map((group) => (
            <div key={group.id} role="group" aria-label={group.label} className="flex flex-wrap gap-2">
              {group.symbols.map((symbol) => {
                const inner = symbol.token.slice(1, -1);
                return (
                  <PipButton
                    key={symbol.token}
                    label={`${symbol.name} ${symbol.token}`}
                    title={`${capitalized(symbol.name)} — adds ${symbol.token}`}
                    iconSuffix={offCardSuffix(tokenize(symbol.token)[0]) ?? ""}
                    onClick={() => append(inner)}
                    refused={!fits(inner)}
                    compact
                    ring="from-slate-500/20 to-slate-400/0"
                  />
                );
              })}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

/** A symbol the cost has no room for: dimmed, still focusable, not added. */
const REFUSED_CLASS = "cursor-not-allowed opacity-40 hover:scale-100 active:scale-100";
const REFUSED_TITLE = `the cost is full (${CARD_COST_MAX} characters)`;

function PipButton({
  label,
  title,
  iconSuffix,
  onClick,
  refused = false,
  compact = false,
  ring,
  overrideUrl,
}: {
  label: string;
  /** The tooltip; the label when omitted. */
  title?: string;
  iconSuffix: string;
  onClick: () => void;
  /** The cost has no room for this symbol. */
  refused?: boolean;
  /** The collapsed group's size: ten to a row in the creator's column. */
  compact?: boolean;
  ring: string;
  /** Custom pip icon — replaces the mana-font glyph, nothing else. */
  overrideUrl?: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Add ${label}`}
      aria-disabled={refused ? true : undefined}
      title={refused ? `${title ?? label} — ${REFUSED_TITLE}` : (title ?? label)}
      className={cn(
        "inline-flex items-center justify-center rounded-full border border-border/40 bg-gradient-to-br shadow-sm transition-all hover:scale-110 hover:border-border-strong active:scale-95",
        compact ? "h-9 w-9" : "h-10 w-10",
        ring,
        refused ? REFUSED_CLASS : null,
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
          style={{ fontSize: compact ? 20 : 22 }}
        />
      )}
    </button>
  );
}
