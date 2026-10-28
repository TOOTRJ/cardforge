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
  useFaceLabel,
} from "@/components/creator/field-group";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import type { FormValues } from "@/lib/creator/form-types";
import { frameAnatomyOf } from "@/lib/cards/anatomy";
import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { StationEditor } from "@/components/creator/panels/station-editor";
import { selfReferenceFor } from "@/lib/cards/self-name";
import { SelfNameLiteralNote } from "@/components/creator/self-name-literal-note";
import { parseSubtypes } from "@/lib/creator/card-fields";
import type { RulesAlign } from "@/types/card";
import { FLAVOR_MARKUP_HINT } from "@/lib/cards/flavor-markup";

/** Said on the Text step when the frame is textless (FrameProfile.textless,
 *  TODO 3.24): the card keeps its text and prints it on any other frame. */
export const TEXTLESS_FRAME_NOTE =
  "This frame prints no rules text — it's kept and shows on other frames.";

/** The text alignment choice (TODO 4.21e, FrameStyle.rulesAlign): shown on
 *  every frame that sets its text in plain rules boxes (lib/cards/
 *  template-layout.ts profileOffersRulesAlign — not a textless frame; a
 *  walker's rows and a saga's chapters have their own editors). A new card
 *  starts on Left; an absent key is Left. */
export const RULES_ALIGN_OPTIONS: ChipOption<RulesAlign>[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Centred" },
];
export const RULES_ALIGN_HELP =
  "Centred sets every line in the middle of its text box, as some printed cards set a short text. It applies to every text box of the card.";

/** The rules box's helper. Its last sentence is TODO 6.11's: the conversion
 *  happens when a text field loses focus (lib/validation/
 *  print-typography.ts), and the box says so before it does. */
export const RULES_TEXT_HELP =
  "Click a symbol to drop it in at the cursor — or type its code ({T}, {2}, {W/U}) and it turns into the icon. Up to 4000 characters. Plain quotes, a spaced hyphen and a line starting “- ” become print’s ’ “ ” — and • when you leave the box.";

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
  // "Front face" on a card with Face tabs (TODO 5.14); null elsewhere.
  const faceLabel = useFaceLabel();
  // Code-owned, never overridden by the admin layout editor.
  const profile = getFrameProfile(normalizeFrameTemplate(template));
  const textless = Boolean(profile.textless);
  // The station frame (TODO 4.27a): its text box is a top band over tiers,
  // and the tier editor is the rules field (a view of the same `rules_text`).
  const station = Boolean(profile.tiers) && !textless;
  // The words row (TODO 6.2): the card's "this …" from its type and subtypes.
  const cardType = useWatch({ control, name: "card_type" });
  const subtypesText = useWatch({ control, name: "subtypes_text" });
  const selfReference = selfReferenceFor(cardType, parseSubtypes(subtypesText ?? ""));

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
      {/* ONE control under its toolbar: the editor is the field — named for
          it, described by the helper or the error. No group around the two
          that would say "Rules text" twice (TODO 3b.24). */}
      {station ? <StationEditor rulesTextRef={rulesTextRef} onInsertSymbol={onInsertSymbol} /> : null}
      {station ? null : (
      <FieldGroup
        kind="control"
        label="Rules text"
        error={fieldState.error?.message}
        helper={RULES_TEXT_HELP}
      >
        {(aria) => (
          <div className="flex flex-col gap-2">
            <RulesSymbolToolbar onInsert={onInsertSymbol} selfReference={selfReference} />
            <SelfNameLiteralNote texts={[field.value]} />
            <PipTextEditor
              ref={(handle) => {
                rulesTextRef.current = handle;
                field.ref(handle);
              }}
              name={field.name}
              value={field.value ?? ""}
              onChange={field.onChange}
              onBlur={field.onBlur}
              aria-label={faceLabel ? `${faceLabel} rules text` : "Rules text"}
              aria-describedby={aria["aria-describedby"]}
              aria-invalid={Boolean(fieldState.error)}
              placeholder="Add text and rules here."
              rows={6}
              className={textareaClass(Boolean(fieldState.error))}
            />
          </div>
        )}
      </FieldGroup>
      )}

      <RulesAlignChoice />

      <FieldGroup
        label="Flavor text"
        error={errors.flavor_text?.message}
        helper={`Optional — up to 1000 characters. ${FLAVOR_MARKUP_HINT}`}
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

/** The card's text alignment chips — card-wide (every text box of the card,
 *  both faces of a double-faced one): the Text step shows them between the
 *  rules and the flavour text of whichever face is being edited. Nothing
 *  where the frame does not offer the choice. */
export function RulesAlignChoice() {
  const { control, setValue } = useFormContext<FormValues>();
  const template = useWatch({ control, name: "frame_style.template" });
  const rulesAlign = useWatch({ control, name: "frame_style.rulesAlign" });
  // The frame offers the choice (its CODE profile, like every switch).
  const offersAlign = frameAnatomyOf(normalizeFrameTemplate(template)).rulesAlign;
  return (
    <>
      {offersAlign ? (
        // The chip row IS the field: named for it, described by the help
        // under it — no group around it that would say "Text alignment"
        // twice (TODO 3b.24). Card-wide, so never a face's words.
        <div className="flex flex-col gap-1.5" data-testid="rules-align">
          <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
            Text alignment
          </span>
          <ChipGroup
            ariaLabel="Text alignment"
            ariaDescribedBy="rules-align-help"
            layout="wrap"
            size="sm"
            value={rulesAlign === "center" ? "center" : "left"}
            onChange={(next) => setValue("frame_style.rulesAlign", next, { shouldDirty: true })}
            options={RULES_ALIGN_OPTIONS}
          />
          <p id="rules-align-help" className="text-xs leading-5 text-muted">{RULES_ALIGN_HELP}</p>
        </div>
      ) : null}
    </>
  );
}
