"use client";

// Text panel — rules/flavor text with the symbol toolbar. Regrouped from the
// old rules step (the stat inputs moved to the Abilities panel; the AI
// assistant moved to the ForgeAIPanel, rendered at the bottom of the step).
// The caret-preserving symbol insertion (shared with the Layout panel's
// back-face textarea) stays in the orchestrator and arrives here as the
// hoisted field registration + ref + insert callback.

import { useFormContext, type UseFormRegisterReturn } from "react-hook-form";
import { RulesSymbolToolbar } from "@/components/creator/rules-symbol-toolbar";
import {
  FieldGroup,
  textareaClass,
} from "@/components/creator/field-group";
import type { FormValues } from "@/lib/creator/form-types";

type TextPanelProps = {
  /** Hoisted register("rules_text") result — merged with the caret ref below. */
  rulesTextField: UseFormRegisterReturn<"rules_text">;
  rulesTextRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  /** Caret-preserving symbol insertion into rules_text (orchestrator-owned). */
  onInsertSymbol: (token: string) => void;
};

export function TextPanel({
  rulesTextField,
  rulesTextRef,
  onInsertSymbol,
}: TextPanelProps) {
  const {
    register,
    formState: { errors },
  } = useFormContext<FormValues>();

  return (
    <>
      <FieldGroup
        label="Rules text"
        error={errors.rules_text?.message}
        helper="Symbols render as real pips on the card — click one above or type the {T} / {2} / {W/U} code. Up to 4000 characters."
      >
        <div className="flex flex-col gap-2">
          <RulesSymbolToolbar onInsert={onInsertSymbol} />
          <textarea
            {...rulesTextField}
            ref={(el) => {
              rulesTextField.ref(el);
              rulesTextRef.current = el;
            }}
            placeholder="{T}: Add {G}. Whenever this creature attacks, draw a card."
            rows={6}
            className={textareaClass(Boolean(errors.rules_text))}
          />
        </div>
      </FieldGroup>

      <FieldGroup
        label="Flavor text"
        error={errors.flavor_text?.message}
        helper="Optional — up to 1000 characters."
      >
        <textarea
          {...register("flavor_text")}
          placeholder="A coil of fire, bound by oath."
          rows={3}
          className={textareaClass(Boolean(errors.flavor_text))}
        />
      </FieldGroup>
    </>
  );
}
