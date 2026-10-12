"use client";

import { Fragment } from "react";
import { offCardSuffix, tokenize } from "@/components/cards/mana-cost-glyphs";
import { MORE_SYMBOLS_LABEL, MORE_SYMBOL_GROUPS, capitalized } from "@/lib/cards/more-symbols";
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
// The collapsed group — the ONE list the cost picker offers too
// (lib/cards/more-symbols.ts). A two-colour Phyrexian symbol ({G/U/P}:
// Tamiyo, Compleated Sage) is read out by name, then its code.
const HYBRID_PHYREXIAN_NAMES: Record<string, string> = Object.fromEntries(
  MORE_SYMBOL_GROUPS.filter((group) => group.id === "hybrid-phyrexian").flatMap((group) =>
    group.symbols.map((symbol) => [symbol.token, symbol.name]),
  ),
);

const TOKEN_TITLES: Record<string, string> = {
  "{T}": "Tap",
  "{Q}": "Untap",
  "{X}": "X (variable)",
  "{S}": "Snow",
  "{E}": "Energy",
  "{C}": "Colorless",
  ...Object.fromEntries(Object.entries(HYBRID_PHYREXIAN_NAMES).map(([token, name]) => [token, capitalized(name)])),
};

function SymbolButton({
  token,
  onInsert,
}: {
  token: string;
  onInsert: (token: string) => void;
}) {
  const suffix = offCardSuffix(tokenize(token)[0]);
  if (!suffix) return null;
  const name = HYBRID_PHYREXIAN_NAMES[token];
  return (
    <button
      type="button"
      title={`${TOKEN_TITLES[token] ?? token} — inserts ${token}`}
      aria-label={name ? `Insert ${name} ${token}` : `Insert ${token}`}
      // Prevent the textarea from losing its caret position before we read it.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onInsert(token)}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-elevated/40 transition-colors hover:border-border-strong hover:bg-elevated"
    >
      <i aria-hidden className={cn("ms ms-cost", `ms-${suffix}`)} style={{ fontSize: 13 }} />
    </button>
  );
}

/** The print characters a plain keyboard has no key for (TODO 6.11). Typing
 *  " - " / "--" or a leading "- " gives the same two when the field loses
 *  focus (lib/validation/print-typography.ts). No minus sign: the rules
 *  face has no U+2212 and both renderers set it as a hyphen. */
const PRINT_CHARACTERS = [
  { char: "\u2014", name: "Em dash", hint: "as in \u201cLandfall \u2014 Whenever\u2026\u201d" },
  { char: "\u2022", name: "Bullet", hint: "starts each choice of a modal list" },
] as const;

function CharacterButton({
  char,
  name,
  hint,
  onInsert,
}: {
  char: string;
  name: string;
  hint: string;
  onInsert: (token: string) => void;
}) {
  return (
    <button
      type="button"
      title={`${name} \u2014 ${hint}`}
      aria-label={`Insert ${name.toLowerCase()}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onInsert(char)}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-elevated/40 text-sm font-semibold text-foreground transition-colors hover:border-border-strong hover:bg-elevated"
    >
      <span aria-hidden>{char}</span>
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
        <span aria-hidden className="mx-1 h-5 w-px bg-border/60" />
        {PRINT_CHARACTERS.map((c) => (
          <CharacterButton key={c.char} {...c} onInsert={onInsert} />
        ))}
      </div>
      <details>
        <summary className="cursor-pointer list-none text-xs text-subtle transition-colors hover:text-muted [&::-webkit-details-marker]:hidden">
          {MORE_SYMBOLS_LABEL}
        </summary>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {MORE_SYMBOL_GROUPS.map((group, index) => (
            <Fragment key={group.id}>
              {index > 0 ? <span aria-hidden className="mx-1 h-5 w-px bg-border/60" /> : null}
              {group.symbols.map((symbol) => (
                <SymbolButton key={symbol.token} token={symbol.token} onInsert={onInsert} />
              ))}
            </Fragment>
          ))}
        </div>
      </details>
    </div>
  );
}
