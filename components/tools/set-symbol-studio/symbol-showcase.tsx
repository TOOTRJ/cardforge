"use client";

import { useState } from "react";
import { ChipGroup } from "@/components/ui/chip-group";
import { cn } from "@/lib/utils";
import { LEGIBILITY_WARN, RARITY_LOOKS, type RarityLook } from "@/lib/tools/set-symbol/paint";

// ---------------------------------------------------------------------------
// The studio's stage: one symbol shown the ways a card shows it — large on
// the light table, in each rarity on a type line, tiny (the size it really
// prints at), and faint behind rules text as a watermark — with how well it
// survives at card size. The same view for a live preview (data URLs) and a
// saved symbol (its stored files).
// ---------------------------------------------------------------------------

export type SymbolLooks = Record<RarityLook | "plain" | "watermark", string>;

type HeroLook = RarityLook | "plain";

const LOOK_LABELS: Record<HeroLook, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  mythic: "Mythic",
  plain: "Plain",
};

/** A light-table backdrop: a faint checkerboard so transparency reads as
 *  transparency, under a soft vignette. */
const TABLE_STYLE: React.CSSProperties = {
  backgroundColor: "#1a1b22",
  backgroundImage:
    "radial-gradient(ellipse at center, rgba(255,255,255,0.07), transparent 70%), conic-gradient(rgba(255,255,255,0.045) 25%, transparent 0 50%, rgba(255,255,255,0.045) 0 75%, transparent 0)",
  backgroundSize: "100% 100%, 20px 20px",
};

function TypeLine({ look, url }: { look: RarityLook; url: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-xs text-muted">{LOOK_LABELS[look]}</span>
      <div
        className="flex h-9 min-w-0 flex-1 items-center justify-between rounded-[6px] border px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"
        style={{ background: "linear-gradient(180deg,#f3ede0,#d8ccb4)", borderColor: "#5b4b33" }}
      >
        <span className="truncate font-serif text-[13px] font-semibold text-[#1d1a14]">Creature — Wyrm</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={`${LOOK_LABELS[look]} symbol on a type line`} className="h-[22px] w-[22px] shrink-0 object-contain" />
      </div>
    </div>
  );
}

function Legibility({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const good = value >= LEGIBILITY_WARN;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-foreground">Reads at card size</span>
        <span className={good ? "text-gold" : "text-ember"}>{pct}%</span>
      </div>
      <div
        role="meter"
        aria-label="How well the symbol reads at card size"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-1.5 overflow-hidden rounded-full bg-elevated"
      >
        <div className={cn("h-full rounded-full", good ? "bg-gold" : "bg-ember")} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs leading-5 text-muted">
        {good
          ? "The shape survives the trip down to the size a card prints it."
          : "Fine details vanish at the size a card prints it. Bolder shapes, fewer thin lines and a higher tolerance help."}
      </p>
    </div>
  );
}

export function SymbolShowcase({
  looks,
  name,
  legibility,
  footer,
  busy = false,
}: {
  looks: SymbolLooks;
  name: string;
  legibility: number | null;
  footer?: React.ReactNode;
  busy?: boolean;
}) {
  const [hero, setHero] = useState<HeroLook>("rare");
  return (
    <div className={cn("flex flex-col gap-6 transition-opacity", busy && "opacity-60")} aria-busy={busy || undefined}>
      <div className="flex flex-col items-center gap-4">
        <div
          className="relative flex aspect-square w-full max-w-[280px] items-center justify-center overflow-hidden rounded-2xl border border-border/70"
          style={TABLE_STYLE}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={looks[hero]}
            alt={`${name}, ${LOOK_LABELS[hero].toLowerCase()} look`}
            className="h-[64%] w-[64%] object-contain drop-shadow-[0_6px_18px_rgba(0,0,0,0.45)]"
          />
        </div>
        <ChipGroup
          ariaLabel="Look to show large"
          value={hero}
          onChange={setHero}
          options={(["common", "uncommon", "rare", "mythic", "plain"] as const).map((value) => ({
            value,
            label: LOOK_LABELS[value],
          }))}
          keepCase
        />
      </div>

      <section className="flex flex-col gap-2.5" aria-label="On a type line">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-subtle">On a type line</h3>
        {RARITY_LOOKS.map((look) => (
          <TypeLine key={look} look={look} url={looks[look]} />
        ))}
      </section>

      <div className="grid gap-5 sm:grid-cols-2">
        <section className="flex flex-col gap-2.5" aria-label="At print size">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-subtle">At print size</h3>
          <div className="flex items-end gap-4 rounded-lg border border-border/60 bg-[#ede6d6] px-4 py-3">
            {[14, 18, 24, 32].map((size) => (
              <div key={size} className="flex flex-col items-center gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={looks[hero]} alt="" style={{ width: size, height: size }} className="object-contain" />
                <span className="text-[10px] text-[#5b5244]">{size}px</span>
              </div>
            ))}
          </div>
          <div className="flex items-end gap-4 rounded-lg border border-border/60 bg-[#14151b] px-4 py-3">
            {[14, 18, 24, 32].map((size) => (
              <div key={size} className="flex flex-col items-center gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={looks[hero]} alt="" style={{ width: size, height: size }} className="object-contain" />
                <span className="text-[10px] text-subtle">{size}px</span>
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2.5" aria-label="As a watermark">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-subtle">As a watermark</h3>
          <div
            className="relative flex min-h-[132px] flex-col justify-center gap-1.5 overflow-hidden rounded-lg border px-4 py-3"
            style={{ background: "#f1ead9", borderColor: "#5b4b33" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={looks.watermark}
              alt={`${name} as a watermark behind rules text`}
              className="pointer-events-none absolute inset-0 m-auto h-[80%] w-[80%] object-contain"
              style={{ opacity: 0.14 }}
            />
            <p className="relative font-serif text-[12.5px] leading-[1.35] text-[#1d1a14]">
              Flying. When this creature enters, draw a card.
            </p>
            <p className="relative font-serif text-[12.5px] italic leading-[1.35] text-[#3b3126]">
              &ldquo;Its mark was carved before the first dawn.&rdquo;
            </p>
          </div>
        </section>
      </div>

      {legibility != null ? <Legibility value={legibility} /> : null}
      {footer}
    </div>
  );
}
