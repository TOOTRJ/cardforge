"use client";

// Text panel — rules/flavor text with the symbol toolbar. Regrouped from the
// old rules step (the stat inputs moved to the Abilities panel; the AI
// assistant moved to the ForgeAIPanel, rendered at the bottom of the step).
// The rules box is a PipTextEditor: it draws {T}/{G} codes as real pips while
// the form keeps the brace-code string. The orchestrator owns the handle ref
// so the toolbar (here and on the Layout panel's back face) can insert at the
// caret.

import { useController, useFormContext } from "react-hook-form";
import { RulesSymbolToolbar } from "@/components/creator/rules-symbol-toolbar";
import {
  PipTextEditor,
  type PipTextEditorHandle,
} from "@/components/creator/pip-text-editor";
import {
  FieldGroup,
  textareaClass,
} from "@/components/creator/field-group";
import type { FormValues } from "@/lib/creator/form-types";

type TextPanelProps = {
  rulesTextRef: React.MutableRefObject<PipTextEditorHandle | null>;
  /** Symbol insertion into rules_text at the caret (orchestrator-owned). */
  onInsertSymbol: (token: string) => void;
};

export function TextPanel({ rulesTextRef, onInsertSymbol }: TextPanelProps) {
  const {
    control,
    register,
    formState: { errors },
  } = useFormContext<FormValues>();
  const { field, fieldState } = useController({ control, name: "rules_text" });

  return (
    <>
      <FieldGroup
        label="Rules text"
        error={fieldState.error?.message}
        helper="Click a symbol to drop it in at the cursor — or type its code ({T}, {2}, {W/U}) and it turns into the icon. Up to 4000 characters."
      >
        <div className="flex flex-col gap-2">
          <RulesSymbolToolbar onInsert={onInsertSymbol} />
          <PipTextEditor
            ref={(handle) => {
              rulesTextRef.current = handle;
              field.ref(handle);
            }}
            name={field.name}
            value={field.value ?? ""}
            onChange={field.onChange}
            onBlur={field.onBlur}
            aria-label="Rules text"
            aria-invalid={Boolean(fieldState.error)}
            placeholder="{T}: Add {G}. Whenever this creature attacks, draw a card."
            rows={6}
            className={textareaClass(Boolean(fieldState.error))}
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
