"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { symbolVariantUrl } from "@/lib/tools/set-symbol/naming";

// ---------------------------------------------------------------------------
// "Your symbols" — the card creator's door into Set Symbol Studio, on the Set
// icon step and in the Watermark picker. It reads the viewer's symbols from
// GET /api/tools/set-symbol-studio/symbols; a viewer the tool isn't open to
// gets a 404 there and sees nothing here (the creator is unchanged for
// them). A set icon is written as the symbol's `-auto` file while "Colour by
// rarity" is on — the card then draws the file of its own rarity, in both
// renderers (lib/tools/set-symbol/naming.ts) — or its `-plain` file (one
// look on every rarity) when it is off. Opt-in per card: nothing changes for
// a card that never picks one.
// ---------------------------------------------------------------------------

export type PickerSymbol = { id: string; name: string; auto: string; plain: string; rare: string; watermark: string };

type Loaded = { state: "loading" } | { state: "none" } | { state: "ready"; symbols: PickerSymbol[] };

let cache: Promise<Loaded> | null = null;

function loadSymbols(): Promise<Loaded> {
  cache ??= fetch("/api/tools/set-symbol-studio/symbols", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return { state: "none" } as const;
      const body = (await response.json().catch(() => null)) as { ok?: boolean; symbols?: PickerSymbol[] } | null;
      return body?.ok && Array.isArray(body.symbols) ? ({ state: "ready", symbols: body.symbols } as const) : ({ state: "none" } as const);
    })
    .catch(() => {
      cache = null;
      return { state: "none" } as const;
    });
  return cache;
}

/** Forget the list (a symbol was made or removed in the studio). */
export function forgetStudioSymbols(): void {
  cache = null;
}

function useStudioSymbols(): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  useEffect(() => {
    let live = true;
    void loadSymbols().then((result) => {
      if (live) setLoaded(result);
    });
    return () => {
      live = false;
    };
  }, []);
  return loaded;
}

const TILE =
  "group flex w-20 flex-col items-center gap-1 rounded-md border p-1.5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60";

function Empty() {
  return (
    <p className="text-xs text-muted">
      No symbols yet.{" "}
      <Link href="/dashboard/tools/set-symbol-studio" className="text-primary-bright underline-offset-2 hover:underline">
        Make one in Set Symbol Studio
      </Link>
      .
    </p>
  );
}

/** The Set icon step's row: pick a symbol, and whether it follows the
 *  card's rarity. `current` is the form's set_icon_url. */
export function StudioSetIconPicker({ current, onPick }: { current: string; onPick: (url: string) => void }) {
  const loaded = useStudioSymbols();
  const headingId = useId();
  const switchId = useId();
  if (loaded.state !== "ready") return null;
  const { symbols } = loaded;
  const picked = symbols.find((s) => s.auto === current || s.plain === current) ?? null;
  // A symbol picked from another device (an older version): its own URL
  // tells which way it follows.
  const follows = picked ? picked.auto === current : !current.endsWith("-plain.png");
  const setFollows = (next: boolean) => {
    if (!current) return;
    const url = symbolVariantUrl(current, next ? "auto" : "plain");
    if (url) onPick(url);
  };
  const onStudioIcon = Boolean(current && symbolVariantUrl(current, "auto"));

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-gold/30 bg-gold/[0.04] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={headingId} className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-gold">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          Your symbols · Set Symbol Studio
        </span>
        {onStudioIcon ? (
          <label htmlFor={switchId} className="inline-flex cursor-pointer items-center gap-2 text-xs text-foreground">
            <input
              id={switchId}
              type="checkbox"
              role="switch"
              checked={follows}
              onChange={(event) => setFollows(event.target.checked)}
              aria-describedby={`${switchId}-note`}
              className="h-4 w-4 accent-[var(--color-gold)]"
            />
            Colour by rarity
            <span id={`${switchId}-note`} className="sr-only">
              On: the card draws the common, uncommon, rare or mythic look of its rarity. Off: one look on every rarity.
            </span>
          </label>
        ) : null}
      </div>
      {symbols.length === 0 ? (
        <Empty />
      ) : (
        <div role="group" aria-labelledby={headingId} className="flex flex-wrap gap-2">
          {symbols.map((symbol) => {
            const active = picked?.id === symbol.id;
            return (
              <button
                key={symbol.id}
                type="button"
                aria-pressed={active}
                onClick={() => onPick(follows || !active ? symbol.auto : symbol.plain)}
                className={cn(
                  TILE,
                  active ? "border-gold bg-gold/10" : "border-border bg-elevated/50 hover:border-border-strong",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={symbol.rare} alt="" className="h-10 w-10 object-contain" />
                <span className="line-clamp-1 w-full text-[11px] text-muted group-hover:text-foreground">{symbol.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The Watermark picker's row: a symbol's watermark file as the card's
 *  custom watermark. */
export function StudioWatermarkPicker({ current, onPick }: { current: string; onPick: (url: string) => void }) {
  const loaded = useStudioSymbols();
  const headingId = useId();
  if (loaded.state !== "ready") return null;
  const { symbols } = loaded;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-gold/30 bg-gold/[0.04] p-3">
      <span id={headingId} className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-gold">
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        Your symbols as a watermark
      </span>
      {symbols.length === 0 ? (
        <Empty />
      ) : (
        <div role="group" aria-labelledby={headingId} className="flex flex-wrap gap-2">
          {symbols.map((symbol) => {
            const active = current === symbol.watermark;
            return (
              <button
                key={symbol.id}
                type="button"
                aria-pressed={active}
                onClick={() => onPick(symbol.watermark)}
                className={cn(
                  TILE,
                  active ? "border-gold bg-gold/10" : "border-border bg-elevated/50 hover:border-border-strong",
                )}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-sm bg-[#efe6d2]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={symbol.watermark} alt="" className="h-9 w-9 object-contain opacity-60" />
                </span>
                <span className="line-clamp-1 w-full text-[11px] text-muted group-hover:text-foreground">{symbol.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
