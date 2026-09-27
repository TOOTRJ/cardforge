"use client";

// Effects panel — the finish picker (treatments layered on top of the base
// frame). Regrouped from the old publish step; it edits
// frame_style.finish, whose error routing stays owned by the Frame panel.

import { Controller, useFormContext, useWatch } from "react-hook-form";
import {
  ChipGroup,
  type ChipOption,
} from "@/components/ui/chip-group";
import { FieldGroup } from "@/components/creator/field-group";
import { finishAvailableOn } from "@/lib/cards/art-framing";
import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import { getFrameProfile, type FrameProfile } from "@/lib/cards/template-layout";
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

/** The finish chips for a frame: Etched is hidden (shown disabled, with
 *  why) on an edge-to-edge treatment (TODO 3.23) — it masks by the frame's
 *  luminance and all but vanishes on a see-through frame, until the etched
 *  frame treatment (4.28). */
export function finishOptionsFor(profile: Pick<FrameProfile, "artSlot">): ChipOption<CardFinish>[] {
  return FINISH_OPTIONS.map((option) =>
    option.value !== "etched" || finishAvailableOn(profile, option.value)
      ? option
      : {
          ...option,
          disabled: true,
          description: "Not on borderless frames yet — pick a bordered frame to etch it.",
        },
  );
}

export function EffectsPanel() {
  const { control } = useFormContext<FormValues>();
  const template = useWatch({ control, name: "frame_style.template" });
  // The finish gate reads the code profile's art window only — the admin
  // overrides never move a window onto the card's edge.
  const options = finishOptionsFor(getFrameProfile(normalizeFrameTemplate(template)));

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
            options={options}
          />
        )}
      />
    </FieldGroup>
  );
}
