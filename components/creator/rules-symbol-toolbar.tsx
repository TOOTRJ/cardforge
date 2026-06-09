"use client";

import { tokenize, tokenSuffix } from "@/components/cards/mana-cost-glyphs";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// RulesSymbolToolbar — one-click symbol insertion for the rules-text editor.
//
// Competitor research note: serious tools (Card Conjurer and derivatives) all
// settled on brace codes ({T}, {2/U}) typed by hand, while beginner tools have
// tiny button vocabularies. This toolbar bridges the two: every button INSERTS
// the brace code at the caret — users see the syntax as they click, so the
// keyboard path teaches itself. The pips render with the same mana-font
// classes the card preview uses, so the palette doubles as a legend.
// ---------------------------------------------------------------------------

const CORE = ["{W}", "{U}", "{B}", "{R}", "{G}", "{C}"];
const UTILITY = ["{T}", "{Q}", "{X}", "{S}", "{E}"];
const GENERIC = ["{0}", "{1}", "{2}", "{3}", "{4}", "{5}"];
const HYBRID = [
  "{W/U}",
  "{U/B}",
  "{B/R}",
  "{R/G}",
  "{G/W}",
  "{W/B}",
  "{U/R}",
  "{B/G}",
  "{R/W}",
  "{G/U}",
];
const TWOBRID = ["{2/W}", "{2/U}", "{2/B}", "{2/R}", "{2/G}"];
const PHYREXIAN = ["{W/P}", "{U/P}", "{B/P}", "{R/P}", "{G/P}"];

const TOKEN_TITLES: Record<string, string> = {
  "{T}": "Tap",
  "{Q}": "Untap",
  "{X}": "X (variable)",
  "{S}": "Snow",
  "{E}": "Energy",
  "{C}": "Colorless",
};

function SymbolButton({
  token,
  onInsert,
}: {
  token: string;
  onInsert: (token: string) => void;
}) {
  const suffix = tokenSuffix(tokenize(token)[0]);
  if (!suffix) return null;
  return (
    <button
      type="button"
      title={`${TOKEN_TITLES[token] ?? token} — inserts ${token}`}
      aria-label={`Insert ${token}`}
      // Prevent the textarea from losing its caret position before we read it.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onInsert(token)}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-elevated/40 transition-colors hover:border-border-strong hover:bg-elevated"
    >
      <i aria-hidden className={cn("ms ms-cost", `ms-${suffix}`)} style={{ fontSize: 13 }} />
    </button>
  );
}

export function RulesSymbolToolbar({
  onInsert,
  className,
}: {
  onInsert: (token: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex flex-wrap items-center gap-1">
        {CORE.map((t) => (
          <SymbolButton key={t} token={t} onInsert={onInsert} />
        ))}
        <span aria-hidden className="mx-1 h-5 w-px bg-border/60" />
        {UTILITY.map((t) => (
          <SymbolButton key={t} token={t} onInsert={onInsert} />
        ))}
        <span aria-hidden className="mx-1 h-5 w-px bg-border/60" />
        {GENERIC.map((t) => (
          <SymbolButton key={t} token={t} onInsert={onInsert} />
        ))}
      </div>
      <details>
        <summary className="cursor-pointer list-none text-xs text-subtle transition-colors hover:text-muted [&::-webkit-details-marker]:hidden">
          Hybrid, twobrid &amp; Phyrexian symbols…
        </summary>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {HYBRID.map((t) => (
            <SymbolButton key={t} token={t} onInsert={onInsert} />
          ))}
          <span aria-hidden className="mx-1 h-5 w-px bg-border/60" />
          {TWOBRID.map((t) => (
            <SymbolButton key={t} token={t} onInsert={onInsert} />
          ))}
          <span aria-hidden className="mx-1 h-5 w-px bg-border/60" />
          {PHYREXIAN.map((t) => (
            <SymbolButton key={t} token={t} onInsert={onInsert} />
          ))}
        </div>
      </details>
    </div>
  );
}
