"use client";

// Identity panel — title + the type line's two fields (TODO 3b.16: the
// Types field, pre-filled with the card type's word, and the subtypes). Rarity moved to the Text & stats step (rarity-panel.tsx); the
// Scryfall / AI quick-starts live in the hero cards above the stepper
// (start-with-hero.tsx); card type lives on the Card step.

import { useFormContext } from "react-hook-form";
import {
  FieldGroup,
  MoreOptions,
  inputClass,
} from "@/components/creator/field-group";
import { TypesField } from "@/components/creator/types-field";
import type { FormValues } from "@/lib/creator/form-types";

type IdentityPanelProps = {
  /** Edit / remix: the card's type words and subtypes are locked (see
   *  LockedSummary) — the Types field edits the PRINTED words only and the
   *  subtypes are not offered. */
  revise?: boolean;
  /** The token kind: "Token" is a fixed prefix beside the field, whose
   *  words are the token's types (the Card step's "Token type" toggles
   *  write the same words, TODO 3b.15). */
  token?: boolean;
  /** The emblem kind (TODO 6.23): the name is the source planeswalker's, and
   *  an emblem has no supertype — only the optional subtype ("Emblem —
   *  Kaito", the 2014–19 and AFR style) is offered. */
  emblem?: boolean;
};

export function IdentityPanel({ revise = false, token = false, emblem = false }: IdentityPanelProps) {
  const {
    register,
    formState: { errors },
  } = useFormContext<FormValues>();

  return (
    <>
      <FieldGroup
        label="Title"
        helper={
          emblem
            ? "The planeswalker the emblem comes from — its name prints in the title bar."
            : "The card's name. It also becomes the card's web address."
        }
        error={errors.title?.message}
      >
        {/* Required-ness is enforced by the form resolver
            (lib/creator/form-schema.ts) — register-level rules are
            ignored once a resolver is set. */}
        <input
          {...register("title")}
          placeholder={emblem ? "Kaito, Cunning Infiltrator" : "Emberbound Wyrm"}
          className={inputClass(Boolean(errors.title))}
          autoComplete="off"
        />
      </FieldGroup>

      {/* Card type now lives on the Kind step (step 1) — the kind IS the
          type choice, and routing every type change through planKindChange
          is what makes silent frame overrides impossible. */}

      {/* Quick path stops here: a title makes a real card. Everything below
          is detail control. */}
      {/* The type line (TODO 3b.16): its words left of the dash are ONE
          field, pre-filled with the card type's word — primary, never
          folded away. An emblem's line is fixed ("Emblem"); only its
          optional subtype is offered. On an edit or a remix the card's type
          words and subtypes are locked (LockedSummary): the field then
          changes the PRINTED words alone. */}
      {emblem ? (
        revise ? null : (
        <MoreOptions
          summary="More options — subtype"
          openWhen={Boolean(errors.subtypes_text)}
        >
          <FieldGroup
            label="Subtype"
            helper="Optional — prints “Emblem — Kaito”, the 2014–19 style. Leave it empty for today’s “Emblem”."
            error={errors.subtypes_text?.message}
          >
            <input
              {...register("subtypes_text")}
              placeholder="Kaito"
              className={inputClass(Boolean(errors.subtypes_text))}
              autoComplete="off"
            />
          </FieldGroup>
        </MoreOptions>
        )
      ) : (
        <div className="grid gap-4 sm:grid-cols-2" data-testid="type-line-fields">
          <TypesField
            printedOnly={revise}
            token={token}
            label={revise ? "Type line" : "Types"}
            placeholder={token ? "Creature" : undefined}
          />
          {revise ? null : (
            <FieldGroup
              label="Subtypes"
              helper="After the dash. Comma-separated, up to 10 — e.g. Goblin, Wizard."
              error={errors.subtypes_text?.message}
            >
              <input
                {...register("subtypes_text")}
                placeholder="Dragon, Elder"
                className={inputClass(Boolean(errors.subtypes_text))}
                autoComplete="off"
              />
            </FieldGroup>
          )}
        </div>
      )}
    </>
  );
}
