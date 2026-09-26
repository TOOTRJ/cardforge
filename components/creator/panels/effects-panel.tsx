"use client";

// Effects panel — the finish picker (treatments layered on top of the base
// frame). Regrouped from the old publish step; it edits
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

// Finish presets. Foil and Etched shipped with TODO 6.5 (owner decision
// 2026-09-26): the live preview and the saved image draw the same shared SVG
// (lib/cards/foil-finish.tsx since layout v28, lib/cards/etched-finish.tsx
// since v26), so what the editor shows is what the card saves as. Every
// finish is free (PREMIUM_FINISHES in types/card.ts is empty). Showcase stays
// "Soon": only the preview slants its title (the browser fakes an italic
// Beleren; the bake has no italic face and prints it upright), and the ornate
// hairline its description promises is drawn by neither renderer.
export const FINISH_OPTIONS: ChipOption<CardFinish>[] = [
  {
    value: "regular",
    label: "Regular",
    description: "Baseline frame. The default look.",
  },
  {
    value: "foil",
    label: "Foil",
    description: "Holographic rainbow sheen across the card, strongest on light areas.",
  },
  {
    value: "etched",
    label: "Etched",
    description: "Fine etched texture on the frame, like foil-etched printings.",
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
      helper="A treatment layered on top of the frame. Free on every plan."
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
