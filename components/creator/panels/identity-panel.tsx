"use client";

// Identity panel — title + the "more options" collapsible (supertype /
// subtypes). Rarity moved to the Text & stats step (rarity-panel.tsx); the
// Scryfall / AI quick-starts live in the hero cards above the stepper
// (start-with-hero.tsx); card type lives on the Card step.

import { useFormContext } from "react-hook-form";
import {
  FieldGroup,
  MoreOptions,
  inputClass,
} from "@/components/creator/field-group";
import type { FormValues } from "@/lib/creator/form-types";

type IdentityPanelProps = {
  /** Edit / remix: supertype + subtypes are part of the locked type line
   *  (see LockedSummary), so the "More options" editor is not offered. */
  revise?: boolean;
};

export function IdentityPanel({ revise = false }: IdentityPanelProps) {
  const {
    register,
    formState: { errors },
  } = useFormContext<FormValues>();

  return (
    <>
      <FieldGroup
        label="Title"
        helper="The card's name. It also becomes the card's web address."
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

      {/* Quick path stops here: a title makes a real card. Everything below
          is detail control. */}
      {revise ? null : (
      <MoreOptions
        summary="More options — supertype, subtypes"
        openWhen={Boolean(errors.supertype || errors.subtypes_text)}
      >
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
      )}
    </>
  );
}
