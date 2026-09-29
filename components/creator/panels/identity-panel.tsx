"use client";

// Identity panel — title + the "more options" collapsible (supertype /
// subtypes). Rarity moved to the Text & stats step (rarity-panel.tsx); the
// Scryfall / AI quick-starts live in the hero cards above the stepper
// (start-with-hero.tsx); card type lives on the Card step.

import { useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import {
  FieldGroup,
  MoreOptions,
  inputClass,
} from "@/components/creator/field-group";
import {
  tokenOtherWordsOf,
  withTokenOtherWords,
} from "@/lib/creator/card-kinds";
import type { FormValues } from "@/lib/creator/form-types";

type IdentityPanelProps = {
  /** Edit / remix: supertype + subtypes are part of the locked type line
   *  (see LockedSummary), so the "More options" editor is not offered. */
  revise?: boolean;
  /** The token kind: its type picker (the Card step's "Token type") owns
   *  Legendary, Enchantment, Artifact and Creature, so the Supertype field
   *  shows and edits only the other words (TODO 3b.15). */
  token?: boolean;
};

export function IdentityPanel({ revise = false, token = false }: IdentityPanelProps) {
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
          {token ? (
            <FieldGroup
              label="Supertype"
              helper="Optional — e.g. Snow, Basic. Legendary and the card types are the Token type choices."
              error={errors.supertype?.message}
            >
              <TokenSupertypeInput invalid={Boolean(errors.supertype)} />
            </FieldGroup>
          ) : (
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
          )}
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

/**
 * The token's free Supertype field (TODO 3b.15): the supertype's words the
 * Token type picker doesn't own ("Snow", "Basic"), written back merged in
 * printed order with the picker's words (withTokenOtherWords). The text is
 * the user's while they type (a trailing space survives); it re-reads the
 * supertype when another control changes those words (an AI fill, an
 * import) and on blur, when a picker word typed here ("Legendary") turns its
 * toggle on and leaves the field. Enter does the same first: it submits the
 * form (Save is the form's default button) without a blur, and the save
 * must not drop a word the field still shows.
 */
function TokenSupertypeInput({ invalid }: { invalid: boolean }) {
  const { control, getValues, setValue } = useFormContext<FormValues>();
  const supertype = useWatch({ control, name: "supertype" }) ?? "";
  const others = tokenOtherWordsOf(supertype);
  const [text, setText] = useState(others);
  const [shown, setShown] = useState(others);
  if (others !== shown) {
    setShown(others);
    if (tokenOtherWordsOf(text) !== others) setText(others);
  }
  const write = (next: string) =>
    setValue("supertype", next, { shouldDirty: true, shouldValidate: invalid });
  // Only a typed picker word is left to write (the other words went in as
  // they were typed): focusing and leaving the field never re-spells a
  // stored supertype, nor marks the card edited.
  const adoptPickerWords = () => {
    const current = getValues("supertype") ?? "";
    const adopted = withTokenOtherWords(current, text, { adoptPickerWords: true });
    if (adopted !== withTokenOtherWords(current, text)) write(adopted);
    setText(tokenOtherWordsOf(getValues("supertype")));
  };
  return (
    <input
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        write(withTokenOtherWords(getValues("supertype"), event.target.value));
      }}
      onBlur={adoptPickerWords}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) adoptPickerWords();
      }}
      placeholder="Snow"
      aria-invalid={invalid || undefined}
      className={inputClass(invalid)}
      autoComplete="off"
    />
  );
}
