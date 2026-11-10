"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { CardPip } from "@/components/cards/mana-cost-glyphs";
import { symbolStyle } from "@/lib/cards/symbol-style";
import { cn } from "@/lib/utils";
import { CUSTOM_PIPS_HREF } from "@/lib/pips/href";
import {
  CUSTOM_PIP_SYMBOLS,
  CUSTOM_PIP_SYMBOL_LABELS,
  type CustomPipSymbol,
  type PipOverrides,
} from "@/lib/pips/override";
import { setPipAsOverrideAction } from "@/lib/tools/pip-forge/actions";
import type { ForgedPip } from "@/lib/tools/pip-forge/model";

// ---------------------------------------------------------------------------
// "Use it on your cards": the six symbols a maker can swap (custom pips,
// W U B R G C), each showing what it draws today. A press makes the forged
// pip that symbol's override through the custom pips' own write
// (setPipAsOverrideAction → lib/pips/write-pip.ts) — every card the maker
// owns then draws it there; costs and rules don't change. Replacing an
// override the maker already set asks first.
// ---------------------------------------------------------------------------

const UI_SYMBOLS = symbolStyle(undefined);

/** The `?v=` stamp of an override URL, to tell the pip's copy apart. */
function sameFile(a: string | undefined, b: string | undefined): boolean {
  return Boolean(a && b && a === b);
}

export function UseAsPip({
  pip,
  overrides,
  onOverridesChange,
  disabled,
  onAnnounce,
}: {
  pip: ForgedPip;
  overrides: PipOverrides;
  onOverridesChange: (next: PipOverrides) => void;
  disabled?: boolean;
  onAnnounce: (text: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [working, setWorking] = useState<CustomPipSymbol | null>(null);
  // Which slot holds THIS pip, as set in this visit (an override is a copy:
  // its URL never names the forge's file).
  const [placed, setPlaced] = useState<Partial<Record<CustomPipSymbol, { pipId: string; url: string }>>>({});

  const use = (symbol: CustomPipSymbol) => {
    const label = CUSTOM_PIP_SYMBOL_LABELS[symbol];
    const holds = placed[symbol];
    const current = overrides[symbol];
    if (current && !(holds && holds.pipId === pip.id && sameFile(holds.url, current))) {
      if (!window.confirm(`Replace your custom ${label} pip with ${pip.name}? Your cards redraw with the new one.`)) return;
    }
    setWorking(symbol);
    startTransition(async () => {
      const result = await setPipAsOverrideAction({ id: pip.id, symbol }).catch(() => ({
        ok: false as const,
        error: "The pip couldn't be set. Try again.",
      }));
      setWorking(null);
      if (!result.ok) {
        toast.error(result.error);
        onAnnounce(result.error);
        return;
      }
      onOverridesChange({ ...overrides, [symbol]: result.imageUrl });
      setPlaced((prev) => ({ ...prev, [symbol]: { pipId: pip.id, url: result.imageUrl } }));
      const message = `${pip.name} is now your ${label} pip. Your cards draw it in place of {${symbol}}.`;
      toast.success(message);
      onAnnounce(message);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs font-semibold uppercase tracking-wider text-subtle">Use it on your cards</span>
      <p className="text-xs leading-5 text-muted">
        Pick the symbol it replaces. Every card you own draws it there — costs and rules read the same.
      </p>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {CUSTOM_PIP_SYMBOLS.map((symbol) => {
          const label = CUSTOM_PIP_SYMBOL_LABELS[symbol];
          const current = overrides[symbol];
          const here = placed[symbol]?.pipId === pip.id && sameFile(placed[symbol]?.url, current);
          const busy = working === symbol;
          return (
            <li key={symbol}>
              <button
                type="button"
                onClick={() => use(symbol)}
                disabled={disabled || pending}
                aria-label={
                  here
                    ? `${label}: ${pip.name} is your ${label} pip`
                    : `Use ${pip.name} as your ${label} pip${current ? " (replaces your custom one)" : ""}`
                }
                className={cn(
                  "flex w-full flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 disabled:opacity-60",
                  here ? "border-gold bg-gold/10 text-foreground" : "border-border/70 bg-surface/60 text-muted hover:border-border-strong hover:text-foreground",
                )}
              >
                <span aria-hidden className="inline-flex h-7 w-7 items-center justify-center" style={{ fontSize: 26 }}>
                  {busy ? (
                    <Loader2 className="h-5 w-5 animate-spin text-gold" />
                  ) : (
                    <CardPip suffix={symbol.toLowerCase()} discPx={26} symbols={UI_SYMBOLS} overrideSrc={current ?? null} />
                  )}
                </span>
                <span className="flex items-center gap-1">
                  {here ? <Check className="h-3 w-3 text-gold" aria-hidden /> : null}
                  {label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Link href={CUSTOM_PIPS_HREF} className="w-fit text-xs text-gold underline-offset-4 hover:underline">
        Manage your custom pips
      </Link>
    </div>
  );
}
