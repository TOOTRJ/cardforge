"use client";

// Land mode — the Text & stats step's first control for lands. A BASIC land
// prints a large mana symbol and no rules text; a NONBASIC land prints its
// rules text. The creator seeds every new Land as a basic (that's what makes
// the big symbol render immediately), so this toggle is the visible way out
// of the seed — before it existed, users renaming a seeded Plains to Command
// Tower were left with "Basic — Plains", a textless card, and no obvious
// control to fix it (the hint pointed at a field hidden under "More options").

import { Mountain, ScrollText } from "lucide-react";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { FieldGroup } from "@/components/creator/field-group";

export type LandMode = "basic" | "nonbasic";

type LandModePanelProps = {
  mode: LandMode;
  /** Multicolor frames have no basic — the option renders disabled. */
  basicDisabledReason?: string | null;
  onChange: (next: LandMode) => void;
};

export function LandModePanel({
  mode,
  basicDisabledReason = null,
  onChange,
}: LandModePanelProps) {
  const options: ChipOption<LandMode>[] = [
    {
      value: "nonbasic",
      label: "Nonbasic land",
      description: "Prints rules text — Command Tower, duals, utility lands.",
      icon: ScrollText,
    },
    {
      value: "basic",
      label: "Basic land",
      description:
        basicDisabledReason ??
        "Prints the big mana symbol instead of text — Plains, Island, ….",
      icon: Mountain,
      disabled: Boolean(basicDisabledReason),
    },
  ];

  return (
    <FieldGroup
      label="Land type"
      helper={
        mode === "basic"
          ? "Basic lands have no rules text — switch to Nonbasic to write some."
          : "Nonbasic lands print rules text below. Switch to Basic for a Plains/Island-style big symbol."
      }
    >
      <ChipGroup
        ariaLabel="Land type"
        layout="grid-2"
        size="md"
        value={mode}
        onChange={onChange}
        options={options}
      />
    </FieldGroup>
  );
}
