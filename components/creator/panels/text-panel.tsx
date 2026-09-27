"use client";

// Text panel — rules/flavor text with the symbol toolbar. Regrouped from the
// old rules step (the stat inputs moved to the Abilities panel; the AI
// assistant moved to the ForgeAIPanel, rendered at the bottom of the step).
// The rules box is a PipTextEditor: it draws {T}/{G} codes as real pips while
// the form keeps the brace-code string. The orchestrator owns the handle ref
// so the toolbar (here and on the Layout panel's back face) can insert at the
// caret.

import { useController, useFormContext, useWatch } from "react-hook-form";
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
import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import { getFrameProfile } from "@/lib/cards/template-layout";

/** Said on the Text step when the frame is textless (FrameProfile.textless,
 *  TODO 3.24): the card keeps its text and prints it on any other frame. */
export const TEXTLESS_FRAME_NOTE =
  "This frame prints no rules text — it's kept and shows on other frames.";

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
  const template = useWatch({ control, name: "frame_style.template" });
  // Code-owned, never overridden by the admin layout editor.
  const textless = Boolean(getFrameProfile(normalizeFrameTemplate(template)).textless);

  return (
    <>
      {textless ? (
        <p
          role="status"
          data-testid="textless-frame-note"
          className="rounded-lg border border-primary/40 bg-primary/5 px-4 py-3 text-sm text-foreground"
        >
          {TEXTLESS_FRAME_NOTE}
        </p>
      ) : null}
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
            placeholder="Add text and rules here."
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
