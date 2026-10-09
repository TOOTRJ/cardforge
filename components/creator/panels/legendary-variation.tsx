"use client";

// The Variations section's "Legendary" entry (TODO 3b.17, owner 2026-10-09):
// one chip that gives the legendary crown version of the frame the card is
// on. It is the SAME switch as the anatomy panel's "Legendary crown"
// (`frame_style.crown`, written through the form like that switch — the save
// runs normalizeAnatomy, an edit sends it as `frame_anatomy`) and never
// touches `frame_style.template`. Every rule — offered, selected, which face
// takes the word — is lib/creator/legendary-variation.ts.
//
// A frame with no printed crown shows the chip DISABLED with its reason, as
// the section's other chips do ("Awaiting verification", the basic-only
// frames) — never missing.

import { Crown } from "lucide-react";
import { useFormContext, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { ChipGroup } from "@/components/ui/chip-group";
import type { FormValues } from "@/lib/creator/form-types";
import {
  legendaryVariationOf,
  withLegendaryWord,
  type LegendaryVariation,
} from "@/lib/creator/legendary-variation";
import type { ColorIdentity } from "@/types/card";

/** The entry's state for the form's current values — the chip, the
 *  Variations summary and the anatomy panel's switch all read this. */
export function useLegendaryVariation({ typeLineLocked = false }: { typeLineLocked?: boolean } = {}): LegendaryVariation {
  const { control } = useFormContext<FormValues>();
  const [template, crown, twoColor, cardType, supertype, cost, colorIdentity, dfcIcon, backType, backSupertype] = useWatch({
    control,
    name: [
      "frame_style.template",
      "frame_style.crown",
      "frame_style.twoColor",
      "card_type",
      "supertype",
      "cost",
      "color_identity",
      "frame_style.dfcIcon",
      "back_face.card_type",
      "back_face.supertype",
    ],
  });
  return legendaryVariationOf({
    template,
    crown,
    twoColor,
    cardType,
    supertype,
    cost,
    colorIdentity: (colorIdentity ?? []) as ColorIdentity[],
    dfcIcon,
    backCardType: backType,
    backSupertype,
    typeLineLocked,
  });
}

export const LEGENDARY_WORD_ADDED = "Added “Legendary” to the type line — every crowned card is legendary.";

const HELP_ON = "The legendary crown is on this frame. The card stays Legendary if you take it off.";
const HELP_OFF = "The legendary crown version of this frame";
const HELP_ADDS_WORD = "The legendary crown version of this frame. Adds “Legendary” to the type line.";

/**
 * The chip. `standalone` is an edit or a remix: no Card step (type, frame,
 * colour and the TYPE LINE are locked, lib/creator/revise.ts), so the entry
 * sits on the Identity step under the locked summary, with its own
 * "Variations" caption — and never writes the word there: on a stored card
 * that is not legendary it is disabled, with that reason.
 */
export function LegendaryVariationChip({ standalone = false }: { standalone?: boolean }) {
  const { setValue, getValues } = useFormContext<FormValues>();
  const state = useLegendaryVariation({ typeLineLocked: standalone });

  const toggle = (on: boolean) => {
    if (!state.available) return;
    setValue("frame_style.crown", on, { shouldDirty: true });
    if (!on || state.addsWordTo === null) return;
    const field = state.addsWordTo === "front" ? "supertype" : "back_face.supertype";
    setValue(field, withLegendaryWord(getValues(field)), { shouldDirty: true });
    toast.info(LEGENDARY_WORD_ADDED);
  };

  const chips = (
    <ChipGroup
      multiSelect
      ariaLabel="Legendary"
      layout="grid-2"
      size="md"
      value={state.selected ? ["legendary"] : []}
      onChange={(next) => toggle(next.includes("legendary"))}
      options={[
        {
          value: "legendary",
          label: "Legendary",
          description: !state.available
            ? (state.reason ?? undefined)
            : state.selected
              ? HELP_ON
              : state.addsWordTo
                ? HELP_ADDS_WORD
                : HELP_OFF,
          leading: <Crown className="h-4 w-4" aria-hidden />,
          disabled: !state.available,
        },
      ]}
    />
  );
  if (!standalone) {
    return (
      <div className="flex flex-col gap-2" data-testid="legendary-variation">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Crown</p>
        {chips}
      </div>
    );
  }
  return (
    <div
      role="group"
      aria-labelledby="legendary-variation-heading"
      className="flex flex-col gap-1.5"
      data-testid="legendary-variation"
    >
      <span id="legendary-variation-heading" className="text-xs font-semibold uppercase tracking-wider text-subtle">
        Variations
      </span>
      {chips}
    </div>
  );
}
