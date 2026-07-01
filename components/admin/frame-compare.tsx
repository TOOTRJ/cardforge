"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CardPreview } from "@/components/cards/card-preview";
import { SurfaceCard } from "@/components/ui/surface-card";
import { cn } from "@/lib/utils";
import type { FrameReferenceCard } from "@/lib/cards/frame-reference-cards";

// ---------------------------------------------------------------------------
// FrameCompare — overlays a real Scryfall scan on our rendered frame so
// alignment/typography drift is visible at a glance.
//
// Workflow (difference mode is the sharp tool):
//   1. Pick an era. 2. Switch to "difference" — anywhere the two renders
//   agree goes black; misaligned text/boxes glow. 3. Nudge the relevant
//   FrameProfile rects in lib/cards/template-layout.ts, hot-reload, repeat.
//
// The scan comes as a 745×1040 PNG (5:7, same aspect as our card box), so
// stretching it over the preview container lines the two up 1:1.
// ---------------------------------------------------------------------------

type Mode = "overlay" | "side-by-side" | "difference";

type FrameCompareProps = {
  references: Array<Pick<FrameReferenceCard, "key" | "label">>;
  selected: FrameReferenceCard;
  /** 745×1040 PNG url from Scryfall for the selected printing. */
  referenceImageUrl: string | null;
};

const CARD_WIDTH_PX = 372.5; // half of 745 — fits two side by side on laptops
const ZOOMED_WIDTH_PX = 745;

export function FrameCompare({
  references,
  selected,
  referenceImageUrl,
}: FrameCompareProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("overlay");
  const [opacity, setOpacity] = useState(50);
  const [zoomed, setZoomed] = useState(false);

  const width = zoomed ? ZOOMED_WIDTH_PX : CARD_WIDTH_PX;

  const selectRef = (key: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("ref", key);
    router.replace(`?${params.toString()}`);
  };

  const ourCard = (
    <div style={{ width }} className="shrink-0">
      <CardPreview {...selected.preview} staticInEditor />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <SurfaceCard className="flex flex-wrap items-center gap-4 p-4">
        <label className="flex items-center gap-2 text-sm text-muted">
          Reference
          <select
            value={selected.key}
            onChange={(event) => selectRef(event.target.value)}
            className="h-8 rounded-md border border-border/50 bg-background/80 px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary-bright/40"
          >
            {references.map((ref) => (
              <option key={ref.key} value={ref.key}>
                {ref.label}
              </option>
            ))}
          </select>
        </label>

        <div
          role="radiogroup"
          aria-label="Comparison mode"
          className="flex overflow-hidden rounded-md border border-border/50"
        >
          {(["overlay", "side-by-side", "difference"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                mode === m
                  ? "bg-primary/20 text-foreground"
                  : "text-muted hover:text-foreground",
              )}
            >
              {m}
            </button>
          ))}
        </div>

        {mode === "overlay" ? (
          <label className="flex items-center gap-2 text-sm text-muted">
            Scan opacity
            <input
              type="range"
              min={0}
              max={100}
              value={opacity}
              onChange={(event) => setOpacity(Number(event.target.value))}
              className="w-36 accent-primary"
            />
            <span className="w-10 text-right text-xs tabular-nums">
              {opacity}%
            </span>
          </label>
        ) : null}

        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={zoomed}
            onChange={(event) => setZoomed(event.target.checked)}
            className="accent-primary"
          />
          2× zoom
        </label>
      </SurfaceCard>

      {/* Canvas */}
      <div className="flex flex-wrap items-start gap-6 overflow-x-auto pb-4">
        {mode === "side-by-side" ? (
          <>
            <figure className="flex flex-col gap-2">
              <figcaption className="text-[11px] uppercase tracking-wider text-subtle">
                Our render — {selected.template}
              </figcaption>
              {ourCard}
            </figure>
            <figure className="flex flex-col gap-2">
              <figcaption className="text-[11px] uppercase tracking-wider text-subtle">
                Scryfall scan
              </figcaption>
              {referenceImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={referenceImageUrl}
                  alt={`Official scan of ${selected.label}`}
                  style={{ width }}
                  className="shrink-0 rounded-[4.5%]"
                />
              ) : (
                <MissingScan width={width} />
              )}
            </figure>
          </>
        ) : (
          <figure className="flex flex-col gap-2">
            <figcaption className="text-[11px] uppercase tracking-wider text-subtle">
              {mode === "difference"
                ? "Difference — aligned pixels go dark; drift glows"
                : `Scan over our render at ${opacity}%`}
            </figcaption>
            <div className="relative" style={{ width }}>
              {ourCard}
              {referenceImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={referenceImageUrl}
                  alt={`Official scan of ${selected.label}`}
                  className="pointer-events-none absolute inset-0 h-full w-full rounded-[4.5%]"
                  style={
                    mode === "difference"
                      ? { mixBlendMode: "difference" }
                      : { opacity: opacity / 100 }
                  }
                />
              ) : null}
            </div>
            {!referenceImageUrl ? <MissingScan width={width} /> : null}
          </figure>
        )}
      </div>
    </div>
  );
}

function MissingScan({ width }: { width: number }) {
  return (
    <div
      style={{ width, aspectRatio: "5 / 7" }}
      className="flex items-center justify-center rounded-lg border border-dashed border-border/60 text-xs text-subtle"
    >
      Scan unavailable — Scryfall lookup failed.
    </div>
  );
}
