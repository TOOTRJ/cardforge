"use client";

// Planeswalker loyalty-ability editor — one row per ability: a cost badge
// input (+1 / −N / 0 / X, or blank for a static line) and the ability text.
// Replaces the raw rules textarea on the Text step for planeswalkers; on
// save the rows serialize into face_content AND a canonical rules_text
// (lib/cards/face-content.ts), so exports/search keep working.

import { useFieldArray, useFormContext } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldGroup, inputClass, textareaClass } from "@/components/creator/field-group";
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

  return (
    <FieldGroup
      label="Loyalty abilities"
      helper="One row per ability. Real walkers run 1–4 rows (plus/minus/ultimate); leave the cost blank for a static ability line."
    >
      <div className="flex flex-col gap-3">
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
            <textarea
              {...register(`loyalty_abilities.${i}.text`)}
              placeholder={
                i === 0
                  ? "Draw a card."
                  : i === 1
                    ? "Deal 3 damage to any target."
                    : "You get an emblem with …"
              }
              rows={2}
              aria-label={`Ability ${i + 1} text`}
              aria-invalid={Boolean(rowErrors?.text)}
              className={textareaClass(Boolean(rowErrors?.text))}
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
