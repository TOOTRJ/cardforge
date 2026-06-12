"use client";

// Details step — title, mana cost, rarity, plus the "more options" collapsible
// (supertype / subtypes / tags). Extracted verbatim from card-creator-form.tsx.

import { Controller, useFormContext } from "react-hook-form";
import {
  ChipGroup,
  type ChipOption,
} from "@/components/ui/chip-group";
import { ManaCostPicker } from "@/components/cards/mana-cost-picker";
import {
  FieldGroup,
  MoreOptions,
  inputClass,
} from "@/components/creator/field-group";
import { RARITY_VALUES, type Rarity } from "@/types/card";
import { hidesCost } from "@/lib/creator/steps";
import type { FormValues } from "@/lib/creator/form-types";

const RARITY_COLOR_HEX: Record<Rarity, string> = {
  common: "#cfcfd4",
  uncommon: "#c6e2f5",
  rare: "#f3d57c",
  mythic: "#f08a4a",
};

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
  leading: <SmallGem color={RARITY_COLOR_HEX[rarity]} />,
  activeClass: "border-foreground/50 bg-elevated text-foreground",
}));

type DetailsStepProps = {
  /** Live frame template from the form — token/land frames hide the cost. */
  frameTemplate: string | undefined;
};

export function DetailsStep({ frameTemplate }: DetailsStepProps) {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<FormValues>();

  return (
    <>
      <FieldGroup
        label="Title"
        helper="The card's name. Defaults the slug if you leave that blank."
        error={errors.title?.message}
      >
        <input
          {...register("title", { required: "A title is required." })}
          placeholder="Emberbound Wyrm"
          className={inputClass(Boolean(errors.title))}
          autoComplete="off"
        />
      </FieldGroup>

      {hidesCost(frameTemplate) ? null : (
        <FieldGroup
          label="Cost"
          helper="Click pips to build the mana cost."
          error={errors.cost?.message}
        >
          <Controller
            control={control}
            name="cost"
            render={({ field }) => (
              <ManaCostPicker
                value={field.value ?? ""}
                onChange={field.onChange}
              />
            )}
          />
        </FieldGroup>
      )}

      {/* Rarity. (The old "Template" select was removed: template_id is
          a vestigial DB field — no renderer reads it; the visual layout is
          driven entirely by the Frame picker, and stat visibility by card
          type. template_id is still defaulted + persisted in form state for
          schema compatibility, just no longer user-editable.) */}
      <FieldGroup label="Rarity">
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

      {/* Quick path stops here: type + color (step 1) + title + cost +
          rarity make a real card. Everything below is detail control. */}
      <MoreOptions summary="More options — supertype, subtypes, tags">
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldGroup
            label="Supertype"
            helper="Optional — e.g. Legendary, Basic."
          >
            <input
              {...register("supertype")}
              placeholder="Legendary"
              className={inputClass(Boolean(errors.supertype))}
              autoComplete="off"
            />
          </FieldGroup>
          <FieldGroup
            label="Subtypes"
            helper="Comma-separated. Up to 10."
          >
            <input
              {...register("subtypes_text")}
              placeholder="Dragon, Elder"
              className={inputClass(Boolean(errors.subtypes_text))}
              autoComplete="off"
            />
          </FieldGroup>
        </div>

        <FieldGroup
          label="Tags"
          helper="Comma-separated keywords for discovery (e.g. dragons, tokens). Up to 12."
        >
          <input
            {...register("tags_text")}
            placeholder="dragons, tokens, tribal"
            className={inputClass(Boolean(errors.tags_text))}
            autoComplete="off"
          />
        </FieldGroup>
      </MoreOptions>
    </>
  );
}
