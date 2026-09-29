"use client";

// The token kind's "Emblem" choice (TODO 6.23, 3b.15's seam; owner decision
// 2026-09-29): Emblem sits inside the Token kind, next to Creature /
// Artifact / Enchantment, not as a chip of its own in the kind picker. It is
// a KIND change, not a type word — turning it on makes the card an emblem
// (its own card type, the emblem frame), turning it off makes it a token
// again. Until the emblem frame is verified it shows as "Soon", like any
// kind whose frames await verification.

import { ChipGroup } from "@/components/ui/chip-group";
import { SoonBadge } from "@/components/creator/frame-pickers";

export type EmblemChoiceProps = {
  /** The card is an emblem now. */
  on: boolean;
  /** The emblem frame has a published colour (kindHasAvailableFrame). */
  available: boolean;
  onChange: (on: boolean) => void;
};

export function EmblemChoice({ on, available, onChange }: EmblemChoiceProps) {
  const pickable = on || available;
  return (
    <ChipGroup
      multiSelect
      ariaLabel="Emblem"
      layout="grid-3"
      size="md"
      value={on ? ["emblem"] : []}
      onChange={(next) => onChange(next.includes("emblem"))}
      options={[
        {
          value: "emblem",
          label: "Emblem",
          description: pickable
            ? "A planeswalker's emblem — no colour, cost or stats"
            : "Frame awaiting verification",
          disabled: !pickable,
          badge: pickable ? undefined : <SoonBadge />,
        },
      ]}
    />
  );
}
