"use client";

import { useState } from "react";
import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";
import { SurfaceCard } from "@/components/ui/surface-card";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// FrameCompare — overlays a real Scryfall scan on our rendered frame so
// alignment/typography drift is visible at a glance. One (template, color)
// combination per view; the combo is picked on the /admin/frame-compare
// checklist.
//
// Workflow (difference mode is the sharp tool):
//   1. Open a combo. 2. Switch to "difference" — anywhere the two renders
//   agree goes black; misaligned text/boxes glow. 3. Nudge the relevant
//   FrameProfile rects in lib/cards/template-layout.ts, hot-reload, repeat.
//   4. When it reads near-perfect, check the verify box (page header).
//
// The scan comes as a 745×1040 PNG (5:7, same aspect as our card box), so
// stretching it over the preview container lines the two up 1:1.
// ---------------------------------------------------------------------------

type Mode = "overlay" | "side-by-side" | "difference";

type FrameCompareProps = {
  preview: CardPreviewData;
  /** 745×1040 PNG url from Scryfall for the reference printing; null when
   *  the combo has no real printing (sample content, no overlay). */
  scanUrl: string | null;
  scanAlt: string;
};

const CARD_WIDTH_PX = 372.5; // half of 745 — fits two side by side on laptops
const ZOOMED_WIDTH_PX = 745;

export function FrameCompare({ preview, scanUrl, scanAlt }: FrameCompareProps) {
  const [mode, setMode] = useState<Mode>("overlay");
  const [opacity, setOpacity] = useState(50);
  const [zoomed, setZoomed] = useState(false);

  const width = zoomed ? ZOOMED_WIDTH_PX : CARD_WIDTH_PX;

  // `isolate` caps CardPreview's internal z-indexed layers inside their own
  // stacking context — without it the card's text layers paint ABOVE the
  // scan overlay regardless of DOM order.
  const ourCard = (
    <div style={{ width }} className="isolate shrink-0">
      <CardPreview {...preview} staticInEditor />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <SurfaceCard className="flex flex-wrap items-center gap-4 p-4">
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
              disabled={!scanUrl && m !== "side-by-side"}
              className={cn(
                "px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                mode === m
                  ? "bg-primary/20 text-foreground"
                  : "text-muted hover:text-foreground",
                !scanUrl && m !== "side-by-side" && "opacity-40",
              )}
            >
              {m}
            </button>
          ))}
        </div>

        {mode === "overlay" && scanUrl ? (
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

        {!scanUrl ? (
          <span className="text-xs text-subtle">
            No real printing exists for this combination — eyeball the sample
            render.
          </span>
        ) : null}
      </SurfaceCard>

      {/* Canvas */}
      <div className="flex flex-wrap items-start gap-6 overflow-x-auto pb-4">
        {mode === "side-by-side" || !scanUrl ? (
          <>
            <figure className="flex flex-col gap-2">
              <figcaption className="text-[11px] uppercase tracking-wider text-subtle">
                Our render
              </figcaption>
              {ourCard}
            </figure>
            {scanUrl ? (
              <figure className="flex flex-col gap-2">
                <figcaption className="text-[11px] uppercase tracking-wider text-subtle">
                  Scryfall scan
                </figcaption>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={scanUrl}
                  alt={scanAlt}
                  style={{ width }}
                  className="shrink-0 rounded-[4.5%]"
                />
              </figure>
            ) : null}
          </>
        ) : (
          <figure className="flex flex-col gap-2">
            <figcaption className="text-[11px] uppercase tracking-wider text-subtle">
              {mode === "difference"
                ? "Difference — aligned pixels go dark; drift glows"
                : `Scan over our render at ${opacity}%`}
            </figcaption>
            {/* isolation: isolate scopes the difference blend to THIS box —
                without it the scan blends against the page background
                instead of our render. */}
            <div
              className="relative"
              style={{ width, isolation: "isolate" }}
            >
              {ourCard}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={scanUrl ?? undefined}
                alt={scanAlt}
                className="pointer-events-none absolute inset-0 z-10 h-full w-full rounded-[4.5%]"
                style={
                  mode === "difference"
                    ? { mixBlendMode: "difference" }
                    : { opacity: opacity / 100 }
                }
              />
            </div>
          </figure>
        )}
      </div>
    </div>
  );
}
