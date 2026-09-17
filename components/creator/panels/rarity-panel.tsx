"use client";

// Rarity chips — on the Text & stats step beside the cost (owner decision
// 2026-09-16: Identity is name + art; everything printed in ink sits
// together). Extracted from identity-panel.tsx unchanged.

import { Controller, useFormContext } from "react-hook-form";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { FieldGroup } from "@/components/creator/field-group";
import { RARITY_VALUES, type Rarity } from "@/types/card";
import type { FormValues } from "@/lib/creator/form-types";
import { RARITY_TINT } from "@/lib/brand/constants";

function SmallGem({ color }: { color: string }) {
  // Tiny diamond gem, matches the larger RarityGem in the card preview but
  // sized for the chip's leading slot.
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
      <polygon
        points="6,1 11,6 6,11 1,6"
        fill={color}
        stroke="rgba(0,0,0,0.4)"
        strokeWidth="0.6"
      />
    </svg>
  );
}

const RARITY_OPTIONS: ChipOption<Rarity>[] = RARITY_VALUES.map((rarity) => ({
  value: rarity,
  label: rarity,
  leading: <SmallGem color={RARITY_TINT[rarity]} />,
  activeClass: "border-foreground/50 bg-elevated text-foreground",
}));

export function RarityPanel() {
  const { control } = useFormContext<FormValues>();
  return (
    <FieldGroup
      label="Rarity"
      helper="Tints the set icon on the type line."
    >
      <Controller
        control={control}
        name="rarity"
        render={({ field }) => (
          <ChipGroup
            ariaLabel="Rarity"
            layout="grid-4"
            value={field.value}
            onChange={(next) => field.onChange(next)}
            options={RARITY_OPTIONS}
          />
        )}
      />
    </FieldGroup>
  );
}
