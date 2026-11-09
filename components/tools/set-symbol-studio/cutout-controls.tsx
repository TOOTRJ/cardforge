"use client";

import { useId } from "react";
import { ChipGroup } from "@/components/ui/chip-group";
import type { CutoutMode } from "@/lib/tools/set-symbol/cutout";
import type { CutoutSettings, InkChoice } from "@/lib/tools/set-symbol/model";

// ---------------------------------------------------------------------------
// How the background is found, how much of it goes, and whether the plain
// look keeps the picture's own colours. One control set for a new upload
// and for re-cutting a saved symbol; every change redraws the preview.
// ---------------------------------------------------------------------------

const MODE_OPTIONS: Array<{ value: CutoutMode; label: string; description: string }> = [
  { value: "auto", label: "Automatic", description: "Picks the best way for this picture" },
  { value: "edges", label: "Flat background", description: "From the edges inward; a hole of the same colour stays" },
  { value: "colour", label: "Colour key", description: "The background colour removed everywhere, holes too" },
  { value: "drawing", label: "Drawing on paper", description: "Ink against uneven paper or a photo of a sketch" },
  { value: "alpha", label: "Keep transparency", description: "The file's own see-through parts, as they are" },
];

const INK_OPTIONS: Array<{ value: InkChoice; label: string; description: string }> = [
  { value: "one", label: "One ink", description: "Plain look in black, like a printed common" },
  { value: "colour", label: "Keep colours", description: "Plain look keeps your picture's colours" },
];

export function CutoutControls({
  settings,
  onChange,
  resolvedMode,
  disabled = false,
}: {
  settings: CutoutSettings;
  onChange: (next: CutoutSettings) => void;
  /** The mode Automatic picked, to say so. */
  resolvedMode?: string | null;
  disabled?: boolean;
}) {
  const sliderId = useId();
  const modeHelpId = useId();
  const inkHelpId = useId();
  const set = (patch: Partial<CutoutSettings>) => onChange({ ...settings, ...patch });
  const autoNote =
    settings.mode === "auto" && resolvedMode
      ? `Automatic chose: ${MODE_OPTIONS.find((o) => o.value === resolvedMode)?.label ?? resolvedMode}.`
      : null;

  return (
    <fieldset className="flex flex-col gap-5" disabled={disabled}>
      <legend className="sr-only">Background removal</legend>
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">Find the background</span>
        <ChipGroup
          ariaLabel="How to find the background"
          ariaDescribedBy={modeHelpId}
          layout="grid-2"
          value={settings.mode}
          onChange={(mode) => set({ mode })}
          options={MODE_OPTIONS}
          keepCase
        />
        <span id={modeHelpId} className="text-xs text-muted">
          {autoNote ?? "No AI runs here — the background is keyed away right in your browser, and again on save."}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={sliderId} className="text-xs font-semibold uppercase tracking-wider text-subtle">
            Tolerance
          </label>
          <span className="text-xs tabular-nums text-muted">{settings.tolerance}</span>
        </div>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={100}
          step={1}
          value={settings.tolerance}
          disabled={disabled || settings.mode === "alpha"}
          aria-valuetext={`${settings.tolerance} of 100 — higher removes more`}
          onChange={(event) => set({ tolerance: Number(event.target.value) })}
          className="w-full accent-[var(--color-gold)]"
        />
        <div className="flex justify-between text-[11px] text-subtle" aria-hidden>
          <span>Keeps more</span>
          <span>Removes more</span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">Plain look</span>
        <ChipGroup
          ariaLabel="Plain look"
          ariaDescribedBy={inkHelpId}
          layout="grid-2"
          value={settings.ink}
          onChange={(ink) => set({ ink })}
          options={INK_OPTIONS}
          keepCase
        />
        <span id={inkHelpId} className="text-xs text-muted">
          The four rarity looks are always painted from the shape alone, the way printed set symbols are.
        </span>
      </div>
    </fieldset>
  );
}
