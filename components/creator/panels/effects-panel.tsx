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

// Finish presets. Foil and Etched shipped with TODO 6.5 (owner decision
// 2026-09-26): the live preview and the saved image draw the same shared SVG
// (lib/cards/foil-finish.tsx since layout v28, lib/cards/etched-finish.tsx
// since v26), so what the editor shows is what the card saves as. Every
// finish is free (PREMIUM_FINISHES in types/card.ts is empty).
// Showcase is NOT a finish anyone can pick, and its chip promises nothing
// (TODO 3b.12): the saved image draws a showcase card exactly as a regular
// one (only the live preview slants its title — the bake has no italic
// Beleren), and the ornate hairline it once promised is drawn by neither
// renderer. The chip stays, off, so a stored "showcase" value still shows
// as picked, and it points at what IS drawn: the showcase FRAMES, under the
// Card step's Variations.
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
    description:
      "Not a finish: the showcase looks are frames. Pick one under Variations on the Card step.",
    disabled: true,
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
    // ONE control: the chip row is the field — named for it, described by
    // the helper — with no group around it saying "Finish" twice (3b.24).
    <FieldGroup
      kind="control"
      label="Finish"
      helper="A treatment layered on top of the frame. Free on every plan."
    >
      {(aria) => (
        <Controller
          control={control}
          name="frame_style.finish"
          render={({ field }) => (
            <ChipGroup
              ariaLabel="Finish"
              ariaDescribedBy={aria["aria-describedby"]}
              layout="grid-2"
              size="md"
              value={field.value ?? "regular"}
              onChange={(next) => field.onChange(next)}
              options={options}
            />
          )}
        />
      )}
    </FieldGroup>
  );
}
