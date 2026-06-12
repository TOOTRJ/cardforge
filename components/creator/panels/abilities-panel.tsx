"use client";

// Abilities panel — the type-gated stat inputs (P/T, loyalty, defense).
// Regrouped from the old rules step. The panel itself only appears when the
// card type displays a stat (lib/creator/steps.ts); the inner statVis gates
// keep the form showing exactly the stat the card can render.

import { useFormContext } from "react-hook-form";
import {
  FieldGroup,
  inputClass,
} from "@/components/creator/field-group";
import type { FormValues } from "@/lib/creator/form-types";

type AbilitiesPanelProps = {
  /** Which stat inputs the current card type displays (P/T vs loyalty vs
   *  defense) — computed by the orchestrator via statVisibility(). */
  statVis: { pt: boolean; loyalty: boolean; defense: boolean };
};

export function AbilitiesPanel({ statVis }: AbilitiesPanelProps) {
  const {
    register,
    formState: { errors },
  } = useFormContext<FormValues>();

  return (
    <>
      {/* Only the stat the card type can actually display (P/T for
          creatures/tokens, loyalty for planeswalkers, defense for
          battles); spells/etc. show none. */}
      {statVis.pt || statVis.loyalty || statVis.defense ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {statVis.pt ? (
            <>
              <FieldGroup label="Power">
                <input
                  {...register("power")}
                  placeholder="4"
                  className={inputClass(Boolean(errors.power))}
                  autoComplete="off"
                />
              </FieldGroup>
              <FieldGroup label="Toughness">
                <input
                  {...register("toughness")}
                  placeholder="4"
                  className={inputClass(Boolean(errors.toughness))}
                  autoComplete="off"
                />
              </FieldGroup>
            </>
          ) : null}
          {statVis.loyalty ? (
            <FieldGroup label="Loyalty">
              <input
                {...register("loyalty")}
                placeholder="3"
                className={inputClass(Boolean(errors.loyalty))}
                autoComplete="off"
              />
            </FieldGroup>
          ) : null}
          {statVis.defense ? (
            <FieldGroup label="Defense">
              <input
                {...register("defense")}
                placeholder="4"
                className={inputClass(Boolean(errors.defense))}
                autoComplete="off"
              />
            </FieldGroup>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
