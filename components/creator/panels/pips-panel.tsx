"use client";

// Pips panel — the mana-cost picker (with the custom-pip dialog). Color moved
// to the Frame panel; here we only surface a non-blocking prompt when the cost
// implies a color the frame isn't wearing yet ("switch the frame to match?").

import { useState } from "react";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import { Palette, X } from "lucide-react";
import { ManaCostPicker } from "@/components/cards/mana-cost-picker";
import { CustomPipDialog } from "@/components/creator/custom-pip-dialog";
import { FieldGroup } from "@/components/creator/field-group";
import { Button } from "@/components/ui/button";
import { hidesCost } from "@/lib/creator/steps";
import {
  deriveColorIdentity,
  normalizeColorSelection,
} from "@/lib/creator/card-fields";
import { pickFrameColorKey } from "@/components/cards/frame-layer";
import type { FormValues } from "@/lib/creator/form-types";
import type { PipOverrides } from "@/lib/pips/override";

type PipsPanelProps = {
  /** Live frame template from the form — token/land frames hide the cost. */
  frameTemplate: string | undefined;
  /** The signed-in user's custom pip icons (server-fetched). Drives the
   *  picker's icons and the "Customize pips" dialog beside it. */
  pipOverrides: PipOverrides;
};

export function PipsPanel({ frameTemplate, pipOverrides }: PipsPanelProps) {
  const {
    control,
    setValue,
    formState: { errors },
  } = useFormContext<FormValues>();

  const cost = useWatch({ control, name: "cost" }) ?? "";
  const colorIdentity = useWatch({ control, name: "color_identity" }) ?? [];

  // Colors the cost implies. The color model is single-select (2+ colors =
  // the multicolor frame), so "mismatch" means the cost's FRAME differs from
  // the current one — a WU cost on the multicolor frame already matches.
  const derived = deriveColorIdentity(cost);
  const target = normalizeColorSelection(derived);
  const framesDiffer =
    derived.length > 0 &&
    pickFrameColorKey(target) !== pickFrameColorKey(colorIdentity);
  const notWearing = derived.filter((c) => !colorIdentity.includes(c));
  // Name the colors the frame is missing; when the frames differ but every
  // cost color is technically in a (legacy multi-value) identity, name the
  // whole cost instead so the prompt never renders empty.
  const missing = framesDiffer
    ? notWearing.length > 0
      ? notWearing
      : derived
    : [];
  // Dismissal is keyed to the cost string, so the prompt reappears the moment a
  // NEW mismatching pip is added but stays hidden after the user waves it off.
  const [dismissedCost, setDismissedCost] = useState<string | null>(null);
  const showColorPrompt = missing.length > 0 && dismissedCost !== cost;

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

      {showColorPrompt ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3">
          <Palette
            className="h-4 w-4 shrink-0 text-primary-bright"
            aria-hidden
          />
          <p className="min-w-0 flex-1 text-xs leading-5 text-muted">
            Your cost includes{" "}
            <span className="font-medium capitalize text-foreground">
              {formatColors(missing)}
            </span>{" "}
            but the frame color doesn&apos;t match. Switch the frame to match
            the cost?
          </p>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() =>
                setValue("color_identity", target, { shouldDirty: true })
              }
            >
              Switch
            </Button>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setDismissedCost(cost)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-subtle transition-colors hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

// "white, red" / "white, blue and red" — small human-readable list.
function formatColors(colors: string[]): string {
  if (colors.length <= 1) return colors[0] ?? "";
  if (colors.length === 2) return `${colors[0]} and ${colors[1]}`;
  return `${colors.slice(0, -1).join(", ")} and ${colors[colors.length - 1]}`;
}
