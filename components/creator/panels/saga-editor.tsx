"use client";

// Saga chapter editor — an intro line plus one row per chapter effect, each
// with numeral toggles (real sagas share text across chapters: "I, II —").
// Replaces the raw rules textarea on the Text step for sagas; rows serialize
// into face_content AND a canonical rules_text on save.

import { useRef } from "react";
import {
  useController,
  useFieldArray,
  useFormContext,
  useWatch,
} from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  FieldGroup,
  textareaClass,
} from "@/components/creator/field-group";
import {
  PipTextEditor,
  type PipTextEditorHandle,
} from "@/components/creator/pip-text-editor";
import { RulesSymbolToolbar } from "@/components/creator/rules-symbol-toolbar";
import { cn } from "@/lib/utils";
import type { FormValues } from "@/lib/creator/form-types";

const MAX_CHAPTERS = 6; // Long List of the Ents runs I–VI.
const NUMERALS = ["I", "II", "III", "IV", "V", "VI"] as const;

export function SagaChaptersEditor() {
  const {
    control,
    setValue,
    formState: { errors },
  } = useFormContext<FormValues>();
  const { fields, append, remove } = useFieldArray({
    control,
    name: "saga_chapters",
  });
  // Live numeral values so the toggles reflect state (fields snapshots lag).
  const rows = useWatch({ control, name: "saga_chapters" }) ?? [];
  // One toolbar for the whole editor: symbols go into the box that last had
  // focus (the intro line until one is clicked).
  const focusedBox = useRef<PipTextEditorHandle | null>(null);
  const introBox = useRef<PipTextEditorHandle | null>(null);
  const insertSymbol = (token: string) =>
    (focusedBox.current ?? introBox.current)?.insertToken(token);
  const intro = useController({ control, name: "saga_intro" });

  return (
    <>
      <FieldGroup
        label="Intro / reminder"
        helper="The line above chapter I — e.g. the lore-counter reminder. Optional."
        error={errors.saga_intro?.message}
      >
        <div className="flex flex-col gap-2">
          <RulesSymbolToolbar onInsert={insertSymbol} />
          <PipTextEditor
            ref={(handle) => {
              introBox.current = handle;
              intro.field.ref(handle);
            }}
            name={intro.field.name}
            value={intro.field.value ?? ""}
            onChange={intro.field.onChange}
            onBlur={intro.field.onBlur}
            onFocus={() => {
              focusedBox.current = introBox.current;
            }}
            placeholder="(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)"
            rows={2}
            aria-label="Saga intro"
            aria-invalid={Boolean(errors.saga_intro)}
            className={textareaClass(Boolean(errors.saga_intro))}
          />
        </div>
      </FieldGroup>

      <FieldGroup
        label="Chapters"
        helper="One row per effect; toggle which chapters trigger it (rows can share, like “I, II —”). Real sagas run II–VI chapters."
      >
        <div className="flex flex-col gap-3">
          {fields.map((row, i) => {
            const numerals: number[] = rows[i]?.numerals ?? [];
            const toggle = (n: number) => {
              const next = numerals.includes(n)
                ? numerals.filter((v) => v !== n)
                : [...numerals, n].sort((a, b) => a - b);
              setValue(`saga_chapters.${i}.numerals`, next, {
                shouldDirty: true,
              });
            };
            return (
              <div
                key={row.id}
                className="flex flex-col gap-2 rounded-lg border border-border/60 bg-elevated/40 p-3"
              >
                <div className="flex items-center gap-1.5">
                  {NUMERALS.map((roman, idx) => {
                    const n = idx + 1;
                    const active = numerals.includes(n);
                    return (
                      <button
                        key={roman}
                        type="button"
                        aria-pressed={active}
                        aria-label={`Chapter ${roman} for row ${i + 1}`}
                        onClick={() => toggle(n)}
                        className={cn(
                          "flex h-7 w-8 items-center justify-center rounded-md border text-xs font-semibold transition-colors",
                          active
                            ? "border-primary bg-primary/15 text-primary-bright"
                            : "border-border bg-elevated text-subtle hover:border-border-strong hover:text-foreground",
                        )}
                      >
                        {roman}
                      </button>
                    );
                  })}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    aria-label={`Remove chapter row ${i + 1}`}
                    onClick={() => remove(i)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
                <SagaRowText
                  index={i}
                  hasError={Boolean(errors.saga_chapters?.[i]?.text)}
                  onFocus={(handle) => {
                    focusedBox.current = handle;
                  }}
                />
                {errors.saga_chapters?.[i]?.text?.message ? (
                  <span role="alert" className="text-xs text-danger">
                    {errors.saga_chapters[i]?.text?.message}
                  </span>
                ) : null}
              </div>
            );
          })}
          {fields.length < MAX_CHAPTERS ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => {
                // Default the new row to the next unused chapter number.
                const used = new Set(rows.flatMap((r) => r?.numerals ?? []));
                const next =
                  [1, 2, 3, 4, 5, 6].find((n) => !used.has(n)) ??
                  Math.min(fields.length + 1, 6);
                append({ numerals: [next], text: "" });
              }}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Add chapter
            </Button>
          ) : null}
        </div>
      </FieldGroup>
    </>
  );
}

function SagaRowText({
  index,
  hasError,
  onFocus,
}: {
  index: number;
  hasError: boolean;
  onFocus: (handle: PipTextEditorHandle | null) => void;
}) {
  const { control } = useFormContext<FormValues>();
  const { field } = useController({
    control,
    name: `saga_chapters.${index}.text`,
  });
  const handleRef = useRef<PipTextEditorHandle | null>(null);
  return (
    <PipTextEditor
      ref={(handle) => {
        handleRef.current = handle;
        field.ref(handle);
      }}
      name={field.name}
      value={field.value ?? ""}
      onChange={field.onChange}
      onBlur={field.onBlur}
      onFocus={() => onFocus(handleRef.current)}
      placeholder={
        index === 0
          ? "Create a 2/2 white Knight creature token with vigilance."
          : "Knights you control get +2/+1 until end of turn."
      }
      rows={2}
      aria-label={`Chapter row ${index + 1} effect`}
      aria-invalid={hasError}
      className={textareaClass(hasError)}
    />
  );
}
