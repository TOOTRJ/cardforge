"use client";

import { FieldGroup, inputClass } from "@/components/creator/field-group";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// BatchSizeField — "how many cards" for the AI deck/set generators. A number
// input with quick-pick chips replaces the old <select> that rendered one
// <option> per allowed card: fine at 3, awkward at 60, unusable at the
// 100-card Commander ceiling.
// ---------------------------------------------------------------------------

export type BatchPreset = { label: string; value: number };

function clampBatchInput(raw: number, max: number): number {
  if (!Number.isFinite(raw)) return 1;
  return Math.max(1, Math.min(max, Math.round(raw)));
}

export function BatchSizeField({
  value,
  onChange,
  max,
  presets,
  disabled = false,
  label = "Cards",
  helper,
}: {
  value: number;
  onChange: (next: number) => void;
  max: number;
  /** Quick picks; any preset above `max` is dropped, duplicates collapse. */
  presets: BatchPreset[];
  disabled?: boolean;
  label?: string;
  helper?: string;
}) {
  const visible = presets
    .filter((preset, index, all) =>
      preset.value <= max && all.findIndex((p) => p.value === preset.value) === index,
    );
  return (
    <FieldGroup
      label={label}
      helper={helper ?? `1–${max} per generation · 1 credit per card.`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={max}
          step={1}
          value={value}
          onChange={(event) => onChange(clampBatchInput(Number(event.target.value), max))}
          disabled={disabled}
          aria-label={`${label} (1 to ${max})`}
          className={cn(inputClass(false), "w-24")}
        />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick picks">
          {visible.map((preset) => {
            const active = preset.value === value;
            return (
              <button
                key={preset.value}
                type="button"
                onClick={() => onChange(preset.value)}
                disabled={disabled}
                aria-pressed={active}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-primary-bright/60 bg-primary/15 text-foreground"
                    : "border-border/60 text-muted hover:border-border hover:text-foreground",
                  disabled ? "opacity-60" : "",
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>
    </FieldGroup>
  );
}
