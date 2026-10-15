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
// frames) — wherever the section itself shows (owner 2026-10-12: a section
// that would hold nothing but that dead chip stays hidden, as before).
//
// An EDIT or a REMIX has no Card step and shows no chip (owner 2026-10-12):
// the anatomy panel's "Legendary crown" switch is the one control there.
// Where that switch is hidden because the stored card is not legendary on a
// frame that prints the crown, LegendaryCrownReason says why, in one line.

import { Crown } from "lucide-react";
import { useFormContext, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { ChipGroup } from "@/components/ui/chip-group";
import type { FormValues } from "@/lib/creator/form-types";
import {
  NOT_LEGENDARY_LOCKED_REASON,
  legendaryVariationOf,
  withLegendaryWord,
  type LegendaryVariation,
} from "@/lib/creator/legendary-variation";
import type { ColorIdentity } from "@/types/card";

/** The entry's state for the form's current values — the chip, the
 *  Variations summary and the anatomy panel's switch all read this. */
export function useLegendaryVariation({ typeLineLocked = false }: { typeLineLocked?: boolean } = {}): LegendaryVariation {
  const { control } = useFormContext<FormValues>();
  const [template, crown, twoColor, cardType, supertype, cost, colorIdentity, dfcIcon, backType, backSupertype, hasBackFace] = useWatch({
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
      "has_back_face",
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
    hasBackFace: Boolean(hasBackFace),
    typeLineLocked,
  });
}

export const LEGENDARY_WORD_ADDED = "Added “Legendary” to the type line — every crowned card is legendary.";

const HELP_ON = "The legendary crown is on this frame. The card stays Legendary if you take it off.";
const HELP_OFF = "The legendary crown version of this frame";
const HELP_ADDS_WORD = "The legendary crown version of this frame. Adds “Legendary” to the type line.";

/**
 * The chip, in a NEW card's Variations section (the Card step). Its rules —
 * offered, selected, which face takes the word — are legendaryVariationOf.
 */
export function LegendaryVariationChip() {
  const { setValue, getValues } = useFormContext<FormValues>();
  const state = useLegendaryVariation();

  const toggle = (on: boolean) => {
    if (!state.available) return;
    setValue("frame_style.crown", on, { shouldDirty: true });
    if (!on || state.addsWordTo === null) return;
    const field = state.addsWordTo === "front" ? "supertype" : "back_face.supertype";
    setValue(field, withLegendaryWord(getValues(field)), { shouldDirty: true });
    toast.info(LEGENDARY_WORD_ADDED);
  };

  return (
    <div className="flex flex-col gap-2" data-testid="legendary-variation">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Crown</p>
      {/* ONE chip that says "Legendary" itself: no group named "Legendary"
          around it (TODO 3b.24). Where the frame has no crown it is
          aria-disabled, still reachable, and its line says why (3b.10). */}
      <ChipGroup
        multiSelect
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
    </div>
  );
}

/**
 * An edit's or a remix's one line where the "Legendary crown" switch can't
 * show: the stored card is not legendary on a frame that prints the crown,
 * and its type line is locked (lib/creator/revise.ts) — so the maker learns
 * why there is no crown. Nothing on a frame with no crown at all (as before
 * 3b.17), nor while the switch shows.
 */
export function LegendaryCrownReason() {
  const state = useLegendaryVariation({ typeLineLocked: true });
  if (state.reason !== NOT_LEGENDARY_LOCKED_REASON) return null;
  return (
    <p className="flex items-start gap-2 text-xs text-subtle" data-testid="legendary-crown-reason">
      <Crown className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{state.reason}.</span>
    </p>
  );
}
