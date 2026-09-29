"use client";

import { useEffect, useRef, useState } from "react";
import { Frame } from "lucide-react";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { FrameThumb } from "@/components/creator/frame-pickers";
import { describeFrame } from "@/lib/creator/frame-resolve";
import type {
  ImportFrameChoice,
  ImportFramePlan,
} from "@/lib/creator/import-frame-choice";
import type { FrameTypeInfo } from "@/components/cards/frame-layer";
import type { ColorIdentity, FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// The import dialog's inline frame chooser (TODO 1.5 / 1.18): shown in the
// detail pane before commit when the printing's match isn't exact, or its
// art is only the bordered window. Frame tiles are the creator's own
// FrameThumb in the imported colour; the nearest is preselected; the
// standard frame and the printing's own family come first, the kind's other
// frames behind "Show all frames" (owner decision C2, 2026-09-29); "Keep my
// current frame" is always there (disabled, with the reason, when the
// current frame can't dress the imported card). The dialog keys it by
// printing, so another printing starts collapsed again.
// ---------------------------------------------------------------------------

const KEEP_CURRENT = "keep-current";

export function choiceKey(choice: ImportFrameChoice | null): string {
  if (!choice) return "";
  return "keepCurrent" in choice ? KEEP_CURRENT : choice.template;
}

export function ImportFrameChooser({
  plan,
  value,
  onChange,
  colorIdentity,
  type,
  disabled = false,
}: {
  plan: Extract<ImportFramePlan, { mode: "choose" }>;
  value: ImportFrameChoice | null;
  onChange: (next: ImportFrameChoice) => void;
  colorIdentity?: readonly ColorIdentity[];
  /** The imported card's type, for frames that dress a colour by type. */
  type?: FrameTypeInfo | null;
  disabled?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  // A pick among the other frames keeps them on show.
  const expanded =
    showAll || plan.moreOptions.some((option) => option.template === choiceKey(value));
  // "Show all frames" goes away once pressed: hand keyboard focus to the
  // first frame it revealed rather than dropping it on the page.
  const sectionRef = useRef<HTMLElement>(null);
  const focusRevealed = useRef(false);
  const firstRevealed = plan.options.length;
  useEffect(() => {
    if (!showAll || !focusRevealed.current) return;
    focusRevealed.current = false;
    sectionRef.current
      ?.querySelectorAll<HTMLElement>('[role="radio"]')
      [firstRevealed]?.focus();
  }, [showAll, firstRevealed]);
  const shown = expanded ? [...plan.options, ...plan.moreOptions] : plan.options;
  const options: ChipOption<string>[] = shown.map((option) => ({
    value: option.template,
    label: describeFrame(option.template),
    description: option.nearest
      ? "Nearest to this printing"
      : option.template === plan.match.template
        ? option.edgeToEdge
          ? "This printing's frame — the art is stretched to the edge"
          : "This printing's frame"
        : option.edgeToEdge
          ? "Art reaches the card edge"
          : undefined,
    leading: (
      <FrameThumb
        template={option.template}
        colorKey={plan.colorKey}
        colorIdentity={colorIdentity}
        type={type}
      />
    ),
    disabled,
  }));
  const current = plan.keepCurrent;
  options.push({
    value: KEEP_CURRENT,
    label: "Keep my current frame",
    description: current.available && current.template
      ? describeFrame(current.template)
      : (current.reason ?? undefined),
    leading: current.template ? (
      <FrameThumb template={current.template} colorKey={plan.colorKey} type={type} />
    ) : undefined,
    disabled: disabled || !current.available,
  });

  return (
    <section
      ref={sectionRef}
      aria-label="Pick a frame"
      data-testid="import-frame-chooser"
      className="flex flex-col gap-2 rounded-md border border-gold/40 bg-gold/5 p-3"
    >
      <h4 className="inline-flex items-start gap-2 text-xs font-semibold leading-5 text-foreground">
        <Frame className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold-strong" aria-hidden />
        <span>{plan.heading}</span>
      </h4>
      {plan.match.reason ? (
        <p className="text-[11px] leading-4 text-subtle">Why: {plan.match.reason}.</p>
      ) : null}
      {plan.windowCroppedNote ? (
        <p className="text-[11px] leading-4 text-muted">{plan.windowCroppedNote}</p>
      ) : null}
      {plan.options.length === 0 ? (
        <p className="text-[11px] leading-4 text-subtle">
          No frame for this card type is published in this colour yet.
        </p>
      ) : null}
      <ChipGroup
        ariaLabel="Frame for the import"
        layout="grid-2"
        size="md"
        value={choiceKey(value)}
        onChange={(next) =>
          onChange(next === KEEP_CURRENT ? { keepCurrent: true } : { template: next as FrameTemplate })
        }
        options={options}
      />
      {!expanded && plan.moreOptions.length > 0 ? (
        <button
          type="button"
          onClick={() => {
            focusRevealed.current = true;
            setShowAll(true);
          }}
          disabled={disabled}
          data-testid="import-frame-show-all"
          className="self-start text-[11px] font-medium text-primary-bright underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
        >
          Show all frames ({plan.moreOptions.length} more)
        </button>
      ) : null}
    </section>
  );
}
