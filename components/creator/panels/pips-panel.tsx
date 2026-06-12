"use client";

// Pips panel — the mana-cost picker (with the custom-pip dialog) and the
// color-identity picker with its "match mana cost" automation. Regrouped from
// the old details (cost) + frame (color) steps; the autoColors toggle is
// orchestrator-owned (the AI / Scryfall import handlers also flip it off).

import { Controller, useFormContext } from "react-hook-form";
import {
  ChipGroup,
  type ChipOption,
} from "@/components/ui/chip-group";
import { ManaCostPicker } from "@/components/cards/mana-cost-picker";
import { CustomPipDialog } from "@/components/creator/custom-pip-dialog";
import { FieldGroup } from "@/components/creator/field-group";
import {
  COLOR_IDENTITY_VALUES,
  type ColorIdentity,
} from "@/types/card";
import { hidesCost } from "@/lib/creator/steps";
import type { FormValues } from "@/lib/creator/form-types";
import type { PipOverrides } from "@/lib/pips/override";

// Color swatch gradients — mirror the ManaCostGlyphs palette so the
// color-identity chips read as the same color language as the cost preview.
// Multicolor is a conic sweep so it visibly differs from any single color.
const COLOR_SWATCH: Record<ColorIdentity, string> = {
  white:
    "radial-gradient(circle at 30% 25%, #fff 0%, #f7eccb 45%, #cfb787 100%)",
  blue:
    "radial-gradient(circle at 30% 25%, #dff2ff 0%, #7cc3ee 45%, #1f6aa1 100%)",
  black:
    "radial-gradient(circle at 30% 25%, #d6cfc8 0%, #5b5550 45%, #1a1814 100%)",
  red:
    "radial-gradient(circle at 30% 25%, #ffd9c7 0%, #ec6f4c 45%, #8e2c14 100%)",
  green:
    "radial-gradient(circle at 30% 25%, #dcf2c8 0%, #79b664 45%, #234e1a 100%)",
  multicolor:
    "conic-gradient(from 45deg, #cfb787, #7cc3ee, #ec6f4c, #79b664, #c98cf7, #cfb787)",
  colorless:
    "radial-gradient(circle at 30% 25%, #eceaea 0%, #b8b5b3 45%, #6f6c69 100%)",
};

function ColorSwatch({ color }: { color: ColorIdentity }) {
  // Small filled circle that mirrors the mana-glyph palette. Used as the
  // `leading` element on color-identity chips so the picker reads as a
  // continuation of the cost glyphs instead of generic text pills.
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.3),0_1px_1px_rgba(0,0,0,0.3)]"
      style={{ background: COLOR_SWATCH[color] }}
    />
  );
}

const COLOR_IDENTITY_OPTIONS: ChipOption<ColorIdentity>[] =
  COLOR_IDENTITY_VALUES.map((color) => ({
    value: color,
    label: color,
    leading: <ColorSwatch color={color} />,
    activeClass: "border-foreground/50 bg-elevated text-foreground",
  }));

type PipsPanelProps = {
  /** Live frame template from the form — token/land frames hide the cost. */
  frameTemplate: string | undefined;
  /** The signed-in user's custom pip icons (server-fetched). Drives the
   *  picker's icons and the "Customize pips" dialog beside it. */
  pipOverrides: PipOverrides;
  /** "Match mana cost" toggle — owned by the orchestrator (the AI / Scryfall
   *  import handlers also flip it off). */
  autoColors: boolean;
  onAutoColorsChange: (next: boolean) => void;
};

export function PipsPanel({
  frameTemplate,
  pipOverrides,
  autoColors,
  onAutoColorsChange,
}: PipsPanelProps) {
  const {
    control,
    formState: { errors },
  } = useFormContext<FormValues>();

  return (
    <>
      {hidesCost(frameTemplate) ? null : (
        <FieldGroup
          label="Cost"
          helper="Click pips to build the mana cost."
          error={errors.cost?.message}
        >
          <div className="flex flex-col gap-2">
            <Controller
              control={control}
              name="cost"
              render={({ field }) => (
                <ManaCostPicker
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  overrides={pipOverrides}
                />
              )}
            />
            <CustomPipDialog overrides={pipOverrides} />
          </div>
        </FieldGroup>
      )}

      <FieldGroup
        label="Color"
        helper={
          autoColors
            ? "Following the mana cost — tap a color to take over."
            : "Sets the frame color. Pick one or more, or none for colorless."
        }
      >
        <div className="flex flex-col gap-2">
          <Controller
            control={control}
            name="color_identity"
            render={({ field }) => (
              <ChipGroup
                multiSelect
                ariaLabel="Color identity"
                layout="wrap"
                value={field.value}
                onChange={(next) => {
                  onAutoColorsChange(false);
                  field.onChange(next);
                }}
                options={COLOR_IDENTITY_OPTIONS}
              />
            )}
          />
          <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={autoColors}
              onChange={(event) => onAutoColorsChange(event.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--color-primary)]"
            />
            Match mana cost automatically
          </label>
        </div>
      </FieldGroup>
    </>
  );
}
