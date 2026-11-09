"use client";

import { useId } from "react";
import { Sparkles } from "lucide-react";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { DISC_SWATCHES, normaliseHex } from "@/lib/tools/pip-forge/model";

// ---------------------------------------------------------------------------
// The disc's colour: the forge's swatches (pale-to-mid like the mana discs),
// the maker's own (a colour input), or — before a pip is forged — "Let the
// colour card choose". One ChipGroup (one tab stop, arrows move, Space /
// Enter picks) and the colour input beside it.
// ---------------------------------------------------------------------------

export const AI_DISC = "ai";
const CUSTOM = "custom";

function Dot({ hex }: { hex: string }) {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-black/20"
      style={{ backgroundColor: hex }}
    />
  );
}

export function DiscPicker({
  value,
  onChange,
  allowAi,
  disabled,
  label = "Disc colour",
}: {
  /** A `#rrggbb`, or AI_DISC. */
  value: string;
  onChange: (next: string) => void;
  allowAi: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const inputId = useId();
  const labelId = useId();
  const isSwatch = DISC_SWATCHES.some((s) => s.hex === value);
  const custom = value !== AI_DISC && !isSwatch ? value : null;
  const options: ChipOption<string>[] = [
    ...(allowAi
      ? [{ value: AI_DISC, label: "Colour card picks", icon: Sparkles, disabled } satisfies ChipOption<string>]
      : []),
    ...DISC_SWATCHES.map((s) => ({ value: s.hex, label: s.label, leading: <Dot hex={s.hex} />, disabled })),
  ];
  return (
    <div className="flex flex-col gap-2" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="text-xs font-semibold uppercase tracking-wider text-subtle">
        {label}
      </span>
      <ChipGroup ariaLabel={label} layout="wrap" value={custom ? CUSTOM : value} onChange={onChange} options={options} keepCase />
      <label htmlFor={inputId} className="flex w-fit items-center gap-2 text-xs text-muted">
        <input
          id={inputId}
          type="color"
          value={custom ?? (value === AI_DISC ? DISC_SWATCHES[0].hex : value)}
          disabled={disabled}
          onChange={(event) => {
            const hex = normaliseHex(event.target.value);
            if (hex) onChange(hex);
          }}
          className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent p-0.5"
        />
        {custom ? <span>Your own colour: {custom}</span> : <span>Or pick your own colour</span>}
      </label>
    </div>
  );
}
