"use client";

// Canvas creator (the lab's second walkthrough): clickable regions laid
// over the live preview. Each region maps to the panel that edits it; the
// boxes are frame-relative percentages tuned to the M15 family (the lab's
// point is to test the interaction, not to be pixel-perfect on every era).

import type { StepKey } from "@/lib/creator/steps";
import { cn } from "@/lib/utils";

type Region = {
  key: string;
  label: string;
  step: StepKey;
  /** Percent box: top, left, width, height. */
  box: [number, number, number, number];
};

const REGIONS: Region[] = [
  { key: "title", label: "Title", step: "identity", box: [4, 6, 54, 7] },
  { key: "cost", label: "Mana cost", step: "text", box: [4, 62, 32, 7] },
  { key: "art", label: "Artwork", step: "identity", box: [11.5, 6, 88, 41] },
  { key: "type", label: "Type & frame", step: "card", box: [53, 6, 70, 5.5] },
  { key: "seticon", label: "Set icon", step: "seticon", box: [53, 78, 16, 5.5] },
  { key: "text", label: "Rules & flavor", step: "text", box: [59.5, 6, 88, 27.5] },
  { key: "stats", label: "Stats", step: "text", box: [87.5, 72, 24, 6.5] },
];

type CanvasHotspotsProps = {
  active: StepKey | undefined;
  /** Edit / remix: the type line is locked, so its region opens the Identity
   *  panel (where the locked summary lives) instead of the Card step. */
  revise: boolean;
  hasStats: boolean;
  onPick: (step: StepKey) => void;
};

export function CanvasHotspots({ active, revise, hasStats, onPick }: CanvasHotspotsProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-30" aria-label="Card regions">
      {REGIONS.filter((r) => hasStats || r.key !== "stats").map((region) => {
        const step = region.step === "card" && revise ? "identity" : region.step;
        const [top, left, width, height] = region.box;
        const isActive = active === step;
        return (
          <button
            key={region.key}
            type="button"
            onClick={() => onPick(step)}
            title={`Edit ${region.label.toLowerCase()}`}
            data-testid={`hotspot-${region.key}`}
            style={{ top: `${top}%`, left: `${left}%`, width: `${width}%`, height: `${height}%` }}
            className={cn(
              "group pointer-events-auto absolute rounded-md border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
              isActive
                ? "border-accent/70 bg-accent/10"
                : "border-transparent hover:border-accent/60 hover:bg-accent/10",
            )}
          >
            <span className="pointer-events-none absolute -top-2.5 left-1 rounded-full border border-accent/50 bg-background/95 px-2 py-px text-[10px] font-semibold uppercase tracking-wider text-foreground opacity-0 shadow transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              {region.label}
            </span>
            <span className="sr-only">Edit {region.label.toLowerCase()}</span>
          </button>
        );
      })}
    </div>
  );
}
