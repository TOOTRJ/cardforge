"use client";

// The Types field (TODO 3b.16, owner 2026-10-09) — the words a card prints
// LEFT of its type line's dash, as ONE text pre-filled with the card type's
// word ("Creature"). The maker types before and after that word, reorders
// the words or removes it; the card prints what the field says, each word
// capitalised. One component for the front face and for a second face
// (`back_face.*`: an adventure's spell, a split half, a double-faced back).
//
// What it writes (lib/cards/type-line-field.ts):
//   * `printed_types` — the text as typed (null until the maker edits the
//     field, and again after Reset: the card then builds its own line);
//   * `supertype` — the typed words but the card type's own, which is where
//     the P/T, the token frame, the crown and the DFC gates read a card's
//     type words. NOT written with `printedOnly` (the front face of an edit
//     or a remix: a saved card's type is locked, its printed words are not).
//
// Controls that write `supertype` themselves (a token's type toggles, a
// borrowed frame's Artifact word, an import, an AI fill) are followed by
// useTypesFieldSync, mounted once per face by the creator form.

import { useEffect, useRef } from "react";
import { useFormContext, useWatch, type UseFormReturn } from "react-hook-form";
import { RotateCcw } from "lucide-react";
import { useProvidedBorrowedWordSeeds } from "@/components/creator/borrowed-words";
import { FieldGroup, inputClass, joinIds } from "@/components/creator/field-group";
import { supertypeWords, withSupertypeWord } from "@/lib/cards/card-display";
import {
  PRINTED_TYPES_MAX,
  baseTypeWord,
  derivedTypesText,
  splitTypedDash,
  supertypeFromTypes,
  typesAfterCardTypeChange,
  typesAfterSupertypeChange,
  typesFieldText,
} from "@/lib/cards/type-line-field";
import { printTypography } from "@/lib/validation/print-typography";
import type { FormValues } from "@/lib/creator/form-types";
import type { CardType } from "@/types/card";

type Face = "front" | "back";

const PATHS = {
  front: { cardType: "card_type", supertype: "supertype", printed: "printed_types", subtypes: "subtypes_text" },
  back: {
    cardType: "back_face.card_type",
    supertype: "back_face.supertype",
    printed: "back_face.printed_types",
    subtypes: "back_face.subtypes_text",
  },
} as const;

/** Whether two supertypes hold the same words (any case, any order). */
function sameWords(a: string | null | undefined, b: string | null | undefined): boolean {
  const key = (text: string | null | undefined) =>
    supertypeWords(text)
      .map((word) => word.toLowerCase())
      .sort()
      .join(" ");
  return key(a) === key(b);
}

/**
 * Keeps a face's typed Types text and its `supertype` in step when something
 * OTHER than the field changes the card (mounted once per face by the form;
 * off while revising the front, whose type words are locked):
 *   * the card type changes → the old type's word, where the text still
 *     says it, becomes the new type's (typesAfterCardTypeChange); every
 *     other word of the maker's text is KEPT and the supertype is re-read
 *     from it (a text without the type's word says so, with its Reset); an
 *     emblem has no Types text;
 *   * another control adds or removes a type word (a token toggle, the
 *     artifact frame's word, "Basic") → the same word is added to / removed
 *     from the text, every other word left where the maker typed it.
 * A face whose field was never edited (`printed_types` null) needs nothing:
 * its line is built from the supertype.
 */
export function useTypesFieldSync(
  face: Face,
  enabled: boolean,
  { control, getValues, setValue }: Pick<UseFormReturn<FormValues>, "control" | "getValues" | "setValue">,
) {
  const paths = PATHS[face];
  const [cardType, supertype, printed] = useWatch({
    control,
    name: [paths.cardType, paths.supertype, paths.printed],
  }) as [CardType | "", string, string | null];
  const lastCardType = useRef(cardType);
  useEffect(() => {
    const previousCardType = lastCardType.current;
    const typeChanged = previousCardType !== cardType;
    lastCardType.current = cardType;
    if (!enabled || typeof printed !== "string") return;
    if (cardType === "emblem") {
      setValue(paths.printed, null, { shouldDirty: true });
      return;
    }
    if (typeChanged) {
      const text = typesAfterCardTypeChange(printed, previousCardType, cardType);
      if (text !== supertypeWords(printed).join(" ")) setValue(paths.printed, text, { shouldDirty: true });
      const next = supertypeFromTypes(text, cardType);
      if (!sameWords(next, supertype)) setValue(paths.supertype, next, { shouldDirty: true });
      return;
    }
    const implied = supertypeFromTypes(printed, cardType);
    if (sameWords(implied, supertype)) return;
    const next = typesAfterSupertypeChange(printed, implied, supertype, withSupertypeWord);
    if (next !== supertypeWords(getValues(paths.printed)).join(" ")) {
      setValue(paths.printed, next, { shouldDirty: true });
    }
  }, [enabled, cardType, supertype, printed, paths, getValues, setValue]);
}

type TypesFieldProps = {
  face?: Face;
  /** The front face of an edit / remix: only the PRINTED words change. */
  printedOnly?: boolean;
  /** The face prints a fixed "Token" before the field's words. */
  token?: boolean;
  label?: string;
  placeholder?: string;
};

export function TypesField({
  face = "front",
  printedOnly = false,
  token = false,
  label = "Types",
  placeholder,
}: TypesFieldProps) {
  const {
    control,
    getValues,
    setValue,
    formState: { errors },
  } = useFormContext<FormValues>();
  const paths = PATHS[face];
  const [cardType, supertype, printed] = useWatch({
    control,
    name: [paths.cardType, paths.supertype, paths.printed],
  }) as [CardType | "", string, string | null];

  const built = derivedTypesText({ cardType, supertype });
  const text = typesFieldText({ cardType, supertype, printedTypes: printed });
  const base = baseTypeWord(cardType);
  const edited = typeof printed === "string";
  const saysBase = !base || supertypeWords(text).some((word) => word.toLowerCase() === base.toLowerCase());

  const faceErrors = face === "back" ? errors.back_face : errors;
  // `supertype` (the words but the card type's own, 64 at most) has no field
  // of its own any more: its limit is said in this field's words.
  const error =
    faceErrors?.printed_types?.message ??
    (faceErrors?.supertype
      ? base
        ? `Too long: the words besides “${base}” must be 64 characters or fewer.`
        : "Too long: these words must be 64 characters or fewer."
      : undefined);
  const invalid = Boolean(error);

  const borrowedSeeds = useProvidedBorrowedWordSeeds();
  const write = (typed: string) => {
    setValue(paths.printed, typed, { shouldDirty: true, shouldValidate: invalid });
    if (printedOnly) return;
    // The front face's words typed BY HAND are the maker's from here on: a
    // word a borrowed frame wrote ("Artifact", "Enchantment") that the maker
    // keeps or types here is never taken out again when the card leaves
    // that frame (components/creator/borrowed-words.tsx).
    if (face === "front") borrowedSeeds?.forget();
    const next = supertypeFromTypes(typed, getValues(paths.cardType));
    if (next !== (getValues(paths.supertype) ?? "")) {
      setValue(paths.supertype, next, { shouldDirty: true, shouldValidate: invalid });
    }
  };

  // Capitals when the field is left (TODO 3b.16: "each word capitalised as
  // prints do") — only a text the maker EDITED: focusing and leaving a
  // stored card's field never re-spells its line.
  const tidy = () => {
    const typed = getValues(paths.printed);
    if (typeof typed !== "string") return;
    let tidied = printTypography(typed, "type").replace(/\s+/g, " ").trim();
    // A dash typed here: the card draws its own before the subtypes, so the
    // words after it go to the Subtypes field (splitTypedDash) — "Creature
    // - Goblin" is "Creature" + "Goblin", never two dashes on the card. Not
    // on an edit or a remix, whose subtypes are locked: the line is the
    // maker's as typed.
    if (!printedOnly) {
      const { types, subtypes } = splitTypedDash(tidied);
      if (types !== tidied) {
        const have = (getValues(paths.subtypes) ?? "")
          .split(/[,\n]/)
          .map((piece) => piece.trim())
          .filter(Boolean);
        const added = subtypes.filter((word) => !have.some((piece) => piece.toLowerCase() === word.toLowerCase()));
        if (added.length) {
          setValue(paths.subtypes, [...have, ...added].join(", "), { shouldDirty: true, shouldValidate: true });
        }
        tidied = types;
      }
    }
    if (tidied !== typed) write(tidied);
  };

  const inputId = `types-field-${face}`;
  const noteId = `${inputId}-note`;

  const reset = () => {
    setValue(paths.printed, null, { shouldDirty: true, shouldValidate: invalid });
    // "Reset" leaves the page with the edit it undoes: the focus goes to the
    // field it reset, not to the top of the document.
    document.getElementById(inputId)?.focus();
  };

  const typeName = base ?? (token ? "token" : "card");
  const helper = token
    ? "The words after “Token”. Type “Creature” for a token with power and toughness, “Artifact” for the artifact frame. They print in the order you type them."
    : printedOnly
      ? "The words the card prints before the dash, in the order you type them. This changes the printed line only — the card’s type, frame and stats stay as they were made."
      : `Starts as the card’s type. Add words before or after it (Legendary, Artifact, Snow), or remove it — the card prints these words in the order you type them, and stays ${/^[aeiou]/i.test(typeName) ? "an" : "a"} ${typeName.toLowerCase()} either way.`;

  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid={`types-field-${face}`}>
      <FieldGroup label={label} helper={helper} error={error}>
        {(aria) => (
        <span className="flex min-w-0 items-stretch gap-2">
          {token ? (
            <span
              className="inline-flex shrink-0 items-center rounded-md border border-border/60 bg-elevated/40 px-2.5 text-sm text-muted"
              title="Every token prints “Token” first."
              data-testid="types-field-token-prefix"
            >
              Token
            </span>
          ) : null}
          <input
            id={inputId}
            aria-labelledby={aria["aria-labelledby"]}
            value={text}
            maxLength={PRINTED_TYPES_MAX}
            onChange={(event) => write(event.target.value)}
            onBlur={tidy}
            onKeyDown={(event) => {
              // Enter saves the form without a blur: tidy first, so the
              // save stores what the field will show.
              if (event.key === "Enter" && !event.nativeEvent.isComposing) tidy();
            }}
            placeholder={placeholder ?? (base ? `Legendary ${base}` : "Legendary Creature")}
            aria-invalid={invalid || undefined}
            aria-describedby={joinIds(aria["aria-describedby"], edited ? noteId : undefined)}
            className={`${inputClass(invalid)} min-w-0 flex-1`}
            autoComplete="off"
            autoCapitalize="words"
            data-testid={`types-field-input-${face}`}
          />
        </span>
        )}
      </FieldGroup>
      {edited ? (
        <div id={noteId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {!saysBase && base ? (
            <span data-testid={`types-field-note-${face}`}>
              {text.trim()
                ? `The line doesn’t say “${base}”. The card is still ${/^[aeiou]/i.test(base) ? "an" : "a"} ${base.toLowerCase()}.`
                : `Nothing prints before the dash. The card is still ${/^[aeiou]/i.test(base) ? "an" : "a"} ${base.toLowerCase()}.`}
            </span>
          ) : null}
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1 rounded-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
            data-testid={`types-field-reset-${face}`}
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            {built ? `Reset to “${built}”` : "Reset"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
