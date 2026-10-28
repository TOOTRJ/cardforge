"use client";

// Identity panel — title + the type line's two fields (TODO 3b.16: the
// Types field, pre-filled with the card type's word, and the subtypes). Rarity moved to the Text & stats step (rarity-panel.tsx); the
// Scryfall / AI quick-starts live in the hero cards above the stepper
// (start-with-hero.tsx); card type lives on the Card step.

import { useFormContext, useWatch } from "react-hook-form";
import {
  CARD_TYPE_OPTIONS,
  FieldGroup,
  MoreOptions,
  inputClass,
} from "@/components/creator/field-group";
import { TypesField } from "@/components/creator/types-field";
import { ChipGroup } from "@/components/ui/chip-group";
import type { FormValues } from "@/lib/creator/form-types";
import type { CardType } from "@/types/card";

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
  /** Whether the card's frame prints the nickname plate (TODO 6.3,
   *  lib/cards/nickname.ts frameDrawsNickname): the field's helper says
   *  where the nickname goes, or that this frame prints none. */
  nicknamePrinted?: boolean;
  /** A NEW card of a layout kind that draws more than one card type (TODO
   *  3b.14, `layoutKindTypeChoices`: an adventure, a flip card): the types
   *  it picks from, and the kind's name for the chip row. Never on an edit
   *  or a remix, whose card type is locked. */
  layoutTypes?: { kindLabel: string; types: readonly CardType[] } | null;
};

export function IdentityPanel({
  revise = false,
  token = false,
  emblem = false,
  nicknamePrinted = false,
  layoutTypes = null,
}: IdentityPanelProps) {
  const {
    register,
    control,
    setValue,
    formState: { errors },
  } = useFormContext<FormValues>();
  const nickname = useWatch({ control, name: "nickname" });
  const cardType = useWatch({ control, name: "card_type" });

  return (
    <>
      <FieldGroup
        label="Title"
        // On a card with Face tabs the label reads "Front face — Title".
        showFace
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

      {/* The nickname (TODO 6.3): a flavour name printed in the title bar
          with the card's own name in small type under it, as Universes
          Beyond printings do. Folded away until it holds a value — never on
          an emblem, which prints its walker's name. */}
      {emblem ? null : (
        <MoreOptions
          summary="More options — nickname"
          openWhen={Boolean(errors.nickname)}
          expandWhen={Boolean(nickname?.trim())}
        >
          <FieldGroup
            label="Nickname"
            helper={
              nicknamePrinted
                ? "Optional — prints in the title bar, with the card's name in small type under it (Universes Beyond style). The name stays the card's name everywhere else."
                : "Optional — this frame doesn't print a nickname, so the card shows its name. The nickname is kept, searchable and shown on the card's page."
            }
            error={errors.nickname?.message}
          >
            <input
              {...register("nickname")}
              placeholder="Wakandan War Panther"
              className={inputClass(Boolean(errors.nickname))}
              autoComplete="off"
            />
          </FieldGroup>
        </MoreOptions>
      )}

      {/* Card type now lives on the Kind step (step 1) — the kind IS the
          type choice, and routing every type change through planKindChange
          is what makes silent frame overrides impossible. A layout kind
          whose frame draws more than one card type (TODO 3b.14: an
          adventure — a WOE Virtue is an Enchantment — or a flip card) picks
          it here: the frame and the kind stay, the type line, the P/T
          inputs and the type words follow the card type. */}
      {layoutTypes && !revise ? (
        <FieldGroup
          kind="control"
          label="Card type"
          helper={`The ${layoutTypes.kindLabel} frame stays — the card type sets the type line and whether the card has power and toughness.`}
          error={errors.card_type?.message}
        >
          {(aria) => (
            <ChipGroup
              ariaLabel={`${layoutTypes.kindLabel} card type`}
              ariaDescribedBy={aria["aria-describedby"]}
              layout="grid-3"
              size="md"
              value={(cardType || layoutTypes.types[0]) as CardType}
              onChange={(next) => setValue("card_type", next, { shouldDirty: true })}
              options={CARD_TYPE_OPTIONS.filter((option) => layoutTypes.types.includes(option.value))}
            />
          )}
        </FieldGroup>
      ) : null}

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
