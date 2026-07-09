"use client";

// Identity panel — title + rarity + the "more options" collapsible
// (supertype / subtypes). The Scryfall / AI quick-starts moved to the hero
// cards above the stepper (start-with-hero.tsx); card type lives on the
// Card step.

import { Controller, useFormContext } from "react-hook-form";
import {
  ChipGroup,
  type ChipOption,
} from "@/components/ui/chip-group";
import {
  FieldGroup,
  MoreOptions,
  inputClass,
} from "@/components/creator/field-group";
import { RARITY_VALUES, type Rarity } from "@/types/card";
import type { FormValues } from "@/lib/creator/form-types";
import { RARITY_TINT } from "@/lib/brand/constants";

// Bright gem tints for chips on dark surfaces (see lib/brand/constants for
// why this differs from the set-symbol's printed ink palette).
const RARITY_COLOR_HEX: Record<Rarity, string> = RARITY_TINT;

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

export function IdentityPanel() {
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
        {/* Required-ness is enforced by the form resolver
            (lib/creator/form-schema.ts) — register-level rules are
            ignored once a resolver is set. */}
        <input
          {...register("title")}
          placeholder="Emberbound Wyrm"
          className={inputClass(Boolean(errors.title))}
          autoComplete="off"
        />
      </FieldGroup>

      {/* Card type now lives on the Kind step (step 1) — the kind IS the
          type choice, and routing every type change through planKindChange
          is what makes silent frame overrides impossible. */}

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

      {/* Quick path stops here: title + type + rarity make a real card.
          Everything below is detail control. */}
      <MoreOptions summary="More options — supertype, subtypes">
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldGroup
            label="Supertype"
            helper="Optional — e.g. Legendary, Basic."
            error={errors.supertype?.message}
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
            error={errors.subtypes_text?.message}
          >
            <input
              {...register("subtypes_text")}
              placeholder="Dragon, Elder"
              className={inputClass(Boolean(errors.subtypes_text))}
              autoComplete="off"
            />
          </FieldGroup>
        </div>
      </MoreOptions>
    </>
  );
}
