"use client";

// Text panel — rules/flavor text with the symbol toolbar and the AI assistant
// panel. Regrouped from the old rules step (the stat inputs moved to the
// Abilities panel); the caret-preserving symbol insertion (shared with the
// Layout panel's back-face textarea) stays in the orchestrator and arrives
// here as the hoisted field registration + ref + insert callback.

import { useFormContext, type UseFormRegisterReturn } from "react-hook-form";
import { RulesSymbolToolbar } from "@/components/creator/rules-symbol-toolbar";
import {
  AIAssistantPanel,
  type CardFieldPatch,
} from "@/components/creator/ai-assistant-panel";
import {
  FieldGroup,
  textareaClass,
} from "@/components/creator/field-group";
import type { CardContext } from "@/lib/ai/schemas";
import type { FormValues } from "@/lib/creator/form-types";

type TextPanelProps = {
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

export function TextPanel({
  cardContext,
  aiConfigured,
  onAIPatch,
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

      {/* AI assistant — temporarily gated: grayed + non-interactive with a
          "Coming soon" overlay. The panel still renders underneath so the
          layout is preview-accurate for when it ships. */}
      <div id="ai-assistant-anchor" className="relative scroll-mt-20">
        <div className="pointer-events-none select-none opacity-40 blur-[1px]">
          <AIAssistantPanel
            cardContext={cardContext}
            onApply={onAIPatch}
            configured={aiConfigured}
          />
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="rounded-full border border-border/70 bg-background/90 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted shadow-lg backdrop-blur-sm">
            Forge AI · Coming soon
          </span>
        </div>
      </div>
    </>
  );
}
