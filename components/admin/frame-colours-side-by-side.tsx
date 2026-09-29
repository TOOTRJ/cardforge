"use client";

import { useState } from "react";
import Link from "next/link";
import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";
import { ChipGroup } from "@/components/ui/chip-group";
import { frameMatchPct, isLowFrameScore } from "@/lib/cards/frame-signoff";
import { cardCornersClass } from "@/lib/cards/card-orientation";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Every colour of one frame side by side (TODO 4.12) on the sign-off view:
// our live render (the reference's content, today's layout override) next
// to the real printing, one tile per colour, so a colour that drifts from
// its siblings — or from print — shows at a glance before the owner ticks
// anything. "Ours" and "Printing" put the seven of one kind in a row. The
// scan of a landscape frame (battle, split) is a portrait file with the
// layout turned, so it is turned back here (lib/frames/scan-geometry.ts).
// ---------------------------------------------------------------------------

export type SideBySideColour = {
  colorKey: string;
  /** Our render's input; null only when there is nothing to draw. */
  preview: CardPreviewData | null;
  scanUrl: string | null;
  referenceName: string | null;
  /** Sample content (no printing, or the lookup failed). */
  sample: boolean;
  score: { state: string; overall: number | null };
  compareHref: string;
};

type Mode = "both" | "ours" | "scan";

function ScanImage({ url, alt, landscape }: { url: string; alt: string; landscape: boolean }) {
  if (!landscape) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={alt} loading="lazy" className={cn("block aspect-[5/7] w-full object-fill", cardCornersClass(false))} />;
  }
  // The box is 7:5; the portrait file is sized as the box on its side
  // (width = box height, height = box width) and turned 90° clockwise.
  return (
    <div className={cn("relative aspect-[7/5] w-full overflow-hidden", cardCornersClass(true))}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        loading="lazy"
        className="absolute left-1/2 top-1/2 h-[140%] w-[71.4286%] max-w-none -translate-x-1/2 -translate-y-1/2 rotate-90 object-fill"
      />
    </div>
  );
}

function MissingScan({ landscape, reason }: { landscape: boolean; reason: string }) {
  return (
    <div
      className={cn(
        "flex w-full items-center justify-center rounded-md border border-dashed border-border/50 p-2 text-center text-[11px] text-subtle",
        landscape ? "aspect-[7/5]" : "aspect-[5/7]",
      )}
    >
      {reason}
    </div>
  );
}

export function FrameColoursSideBySide({
  colours,
  landscape,
}: {
  colours: SideBySideColour[];
  landscape: boolean;
}) {
  const [mode, setMode] = useState<Mode>("both");
  const tileMin = mode === "both" ? (landscape ? "22rem" : "15rem") : landscape ? "13rem" : "8.5rem";

  return (
    <div className="flex flex-col gap-3" data-testid="signoff-side-by-side">
      <div className="flex flex-wrap items-center gap-3">
        <ChipGroup
          ariaLabel="What to show for each colour"
          value={mode}
          onChange={setMode}
          options={[
            { value: "both", label: "Ours + printing" },
            { value: "ours", label: "Ours" },
            { value: "scan", label: "Printing" },
          ]}
        />
        <span className="text-[11px] text-subtle">
          Our live render of each colour&apos;s reference, today&apos;s layout — click a colour to open it in Compare.
        </span>
      </div>
      <ul
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${tileMin}), 1fr))` }}
      >
        {colours.map((colour) => {
          const low = colour.score.state === "scored" && isLowFrameScore(colour.score.overall);
          const ours = colour.preview ? (
            <div className="w-full">
              <CardPreview {...colour.preview} staticInEditor />
            </div>
          ) : (
            <MissingScan landscape={landscape} reason="Nothing to render" />
          );
          const scan = colour.scanUrl ? (
            <ScanImage
              url={colour.scanUrl}
              alt={`Printed ${colour.referenceName ?? "reference"} (${colour.colorKey.toUpperCase()})`}
              landscape={landscape}
            />
          ) : (
            <MissingScan
              landscape={landscape}
              reason={colour.referenceName ? "Couldn't load the printing" : "No real printing"}
            />
          );
          return (
            <li
              key={colour.colorKey}
              className={cn(
                "flex flex-col gap-2 rounded-card border p-2",
                low ? "border-gold/50" : "border-border/50",
              )}
              data-testid={`side-by-side-${colour.colorKey}`}
            >
              <Link
                href={colour.compareHref}
                className="flex items-center justify-between gap-2 text-xs hover:text-foreground"
                title="Open this colour in Compare"
              >
                <span className="font-semibold uppercase text-foreground">{colour.colorKey}</span>
                <span className="truncate text-[11px] text-muted">
                  {colour.sample ? "sample content" : colour.referenceName}
                </span>
              </Link>
              <div className={cn("grid gap-2", mode === "both" ? "grid-cols-2" : "grid-cols-1")}>
                {mode !== "scan" ? ours : null}
                {mode !== "ours" ? scan : null}
              </div>
              <span
                className={cn(
                  "text-[11px] tabular-nums",
                  low || colour.score.state === "stale" ? "text-gold-strong" : "text-muted",
                )}
              >
                {colour.score.overall !== null && colour.score.state !== "no-reference"
                  ? `${frameMatchPct(colour.score.overall)}% match${colour.score.state === "stale" ? " · stale" : ""}`
                  : colour.score.state === "no-reference"
                    ? "No printing — tick on its own"
                    : "Not scored yet"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
