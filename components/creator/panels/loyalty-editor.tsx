"use client";

// Planeswalker loyalty-ability editor — one row per ability: a cost badge
// input (+1 / −N / 0 / X, or blank for a static line) and the ability text.
// Replaces the raw rules textarea on the Text step for planeswalkers; on
// save the rows serialize into face_content AND a canonical rules_text
// (lib/cards/face-content.ts), so exports/search keep working.

import { useRef } from "react";
import { useController, useFieldArray, useFormContext } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldGroup, inputClass, textareaClass } from "@/components/creator/field-group";
import {
  PipTextEditor,
  type PipTextEditorHandle,
} from "@/components/creator/pip-text-editor";
import { RulesSymbolToolbar } from "@/components/creator/rules-symbol-toolbar";
import type { FormValues } from "@/lib/creator/form-types";

const MAX_ROWS = 6; // Urza, Planeswalker is the printed extreme.

const COST_PRESETS = ["+1", "+2", "0", "-1", "-2", "-3", "X", ""] as const;

export function LoyaltyAbilitiesEditor() {
  const {
    control,
    register,
    formState: { errors },
  } = useFormContext<FormValues>();
  const { fields, append, remove } = useFieldArray({
    control,
    name: "loyalty_abilities",
  });
  // The toolbar drops symbols into the row that last had focus (the first
  // row until one is clicked).
  const focusedRow = useRef<PipTextEditorHandle | null>(null);
  const firstRow = useRef<PipTextEditorHandle | null>(null);
  const insertSymbol = (token: string) =>
    (focusedRow.current ?? firstRow.current)?.insertToken(token);

  return (
    <FieldGroup
      label="Loyalty abilities"
      helper="One row per ability. Real walkers run 1–4 rows (plus/minus/ultimate); leave the cost blank for a static ability line. Symbols go into the row you last clicked."
    >
      <div className="flex flex-col gap-3">
        <RulesSymbolToolbar onInsert={insertSymbol} />
        {fields.map((row, i) => {
          const rowErrors = errors.loyalty_abilities?.[i];
          return (
          <div
            key={row.id}
            className="flex flex-col gap-2 rounded-lg border border-border/60 bg-elevated/40 p-3"
          >
            <div className="flex items-center gap-2">
              <input
                {...register(`loyalty_abilities.${i}.cost`)}
                placeholder="+1"
                aria-label={`Ability ${i + 1} loyalty cost`}
                aria-invalid={Boolean(rowErrors?.cost)}
                className={`${inputClass(Boolean(rowErrors?.cost))} w-20 text-center font-semibold`}
                autoComplete="off"
              />
              <div className="flex flex-wrap gap-1" aria-hidden>
                {COST_PRESETS.map((preset) => (
                  <CostPresetButton key={preset || "static"} index={i} preset={preset} />
                ))}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto"
                aria-label={`Remove ability ${i + 1}`}
                onClick={() => remove(i)}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </div>
            <LoyaltyRowText
              index={i}
              hasError={Boolean(rowErrors?.text)}
              onHandle={(handle) => {
                if (i === 0) firstRow.current = handle;
              }}
              onFocus={(handle) => {
                focusedRow.current = handle;
              }}
            />
            {rowErrors?.cost?.message || rowErrors?.text?.message ? (
              <span role="alert" className="text-xs text-danger">
                {rowErrors?.cost?.message ?? rowErrors?.text?.message}
              </span>
            ) : null}
          </div>
          );
        })}
        {fields.length < MAX_ROWS ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() =>
              append({
                cost: fields.length === 0 ? "+1" : fields.length === 1 ? "-2" : "",
                text: "",
              })
            }
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add ability
          </Button>
        ) : null}
      </div>
    </FieldGroup>
  );
}

// Small preset chip that writes the cost field directly — kept as its own
// component so it can use setValue without re-registering the input.
function CostPresetButton({ index, preset }: { index: number; preset: string }) {
  const { setValue } = useFormContext<FormValues>();
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={() =>
        setValue(`loyalty_abilities.${index}.cost`, preset, {
          shouldDirty: true,
        })
      }
      className="rounded-full border border-border/70 bg-elevated px-2 py-px text-[10px] font-semibold text-subtle transition-colors hover:border-border-strong hover:text-foreground"
    >
      {preset === "" ? "static" : preset}
    </button>
  );
}

function LoyaltyRowText({
  index,
  hasError,
  onHandle,
  onFocus,
}: {
  index: number;
  hasError: boolean;
  onHandle: (handle: PipTextEditorHandle | null) => void;
  onFocus: (handle: PipTextEditorHandle | null) => void;
}) {
  const { control } = useFormContext<FormValues>();
  const { field } = useController({
    control,
    name: `loyalty_abilities.${index}.text`,
  });
  const handleRef = useRef<PipTextEditorHandle | null>(null);
  return (
    <PipTextEditor
      ref={(handle) => {
        handleRef.current = handle;
        field.ref(handle);
        onHandle(handle);
      }}
      name={field.name}
      value={field.value ?? ""}
      onChange={field.onChange}
      onBlur={field.onBlur}
      onFocus={() => onFocus(handleRef.current)}
      placeholder={
        index === 0
          ? "Draw a card."
          : index === 1
            ? "Deal 3 damage to any target."
            : "You get an emblem with …"
      }
      rows={2}
      aria-label={`Ability ${index + 1} text`}
      aria-invalid={hasError}
      className={textareaClass(hasError)}
    />
  );
}
