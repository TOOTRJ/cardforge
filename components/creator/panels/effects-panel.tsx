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

// Finish presets — premium treatments layered on top of the base frame.
// Descriptions are surfaced via ChipGroup's `md` size which shows the
// description under the label.
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
    activeClass: "border-accent bg-accent/15 text-accent",
  },
  {
    value: "etched",
    label: "Etched",
    description: "Gold-leaf inner border with a subtle texture.",
    activeClass: "border-amber-300 bg-amber-300/15 text-amber-200",
  },
  {
    value: "showcase",
    label: "Showcase",
    description: "Italic display title with an ornate hairline.",
    activeClass: "border-primary bg-primary/15 text-primary-bright",
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
