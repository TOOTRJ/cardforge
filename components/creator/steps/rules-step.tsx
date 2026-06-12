"use client";

// Rules step — rules/flavor text with the symbol toolbar, the type-gated stat
// inputs, and the AI assistant panel. Extracted verbatim from
// card-creator-form.tsx; the caret-preserving symbol insertion (shared with
// the Extra step's back-face textarea) stays in the orchestrator and arrives
// here as the hoisted field registration + ref + insert callback.

import { useFormContext, type UseFormRegisterReturn } from "react-hook-form";
import { RulesSymbolToolbar } from "@/components/creator/rules-symbol-toolbar";
import {
  AIAssistantPanel,
  type CardFieldPatch,
} from "@/components/creator/ai-assistant-panel";
import {
  FieldGroup,
  inputClass,
  textareaClass,
} from "@/components/creator/field-group";
import type { CardContext } from "@/lib/ai/schemas";
import type { FormValues } from "@/lib/creator/form-types";

type RulesStepProps = {
  /** Which stat inputs the current card type displays (P/T vs loyalty vs
   *  defense) — computed by the orchestrator via statVisibility(). */
  statVis: { pt: boolean; loyalty: boolean; defense: boolean };
  /** Slice of the live form state the AI panel sends as context. */
  cardContext: CardContext;
  aiConfigured: boolean;
  onAIPatch: (patch: CardFieldPatch) => void;
  /** Hoisted register("rules_text") result — merged with the caret ref below. */
  rulesTextField: UseFormRegisterReturn<"rules_text">;
  rulesTextRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  /** Caret-preserving symbol insertion into rules_text (orchestrator-owned). */
  onInsertSymbol: (token: string) => void;
};

export function RulesStep({
  statVis,
  cardContext,
  aiConfigured,
  onAIPatch,
  rulesTextField,
  rulesTextRef,
  onInsertSymbol,
}: RulesStepProps) {
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

      {/* AI assistant — drafts/refines abilities + flavor from a prompt.
          The hero / command palette jump here via the openAiConcept event. */}
      <div id="ai-assistant-anchor" className="scroll-mt-20">
        <AIAssistantPanel
          cardContext={cardContext}
          onApply={onAIPatch}
          configured={aiConfigured}
        />
      </div>
    </>
  );
}
