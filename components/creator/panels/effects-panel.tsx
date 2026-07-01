"use client";

// Effects panel — the finish picker (premium treatments layered on top of the
// base frame). Regrouped from the old publish step; it edits
// frame_style.finish, whose error routing stays owned by the Frame panel.

import { Controller, useFormContext } from "react-hook-form";
import {
  ChipGroup,
  type ChipOption,
} from "@/components/ui/chip-group";
import { FieldGroup } from "@/components/creator/field-group";
import type { CardFinish } from "@/types/card";
import type { FormValues } from "@/lib/creator/form-types";

// Small "Soon" pill for finishes that aren't shippable yet.
function SoonBadge() {
  return (
    <span className="rounded-full border border-border/70 bg-elevated px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-subtle">
      Soon
    </span>
  );
}

// Finish presets — premium treatments layered on top of the base frame. Only
// "Regular" is shippable for now; the rest are disabled with a "Soon" badge.
const FINISH_OPTIONS: ChipOption<CardFinish>[] = [
  {
    value: "regular",
    label: "Regular",
    description: "Baseline frame. The default look.",
  },
  {
    value: "foil",
    label: "Foil",
    description: "Animated holographic sheen for showpieces.",
    disabled: true,
    badge: <SoonBadge />,
  },
  {
    value: "etched",
    label: "Etched",
    description: "Gold-leaf inner border with a subtle texture.",
    disabled: true,
    badge: <SoonBadge />,
  },
  {
    value: "showcase",
    label: "Showcase",
    description: "Italic display title with an ornate hairline.",
    disabled: true,
    badge: <SoonBadge />,
  },
];

export function EffectsPanel() {
  const { control } = useFormContext<FormValues>();

  return (
    <FieldGroup
      label="Finish"
      helper="Premium treatment layered on top of the frame."
    >
      <Controller
        control={control}
        name="frame_style.finish"
        render={({ field }) => (
          <ChipGroup
            ariaLabel="Finish"
            layout="grid-2"
            size="md"
            value={field.value ?? "regular"}
            onChange={(next) => field.onChange(next)}
            options={FINISH_OPTIONS}
          />
        )}
      />
    </FieldGroup>
  );
}
