"use client";

// Land mode — Basic vs Nonbasic, offered as the Land kind's first
// "Variation" on the Card step (components/creator/panels/card-setup-panel).
// A BASIC land prints a large mana symbol and no rules text; a NONBASIC land
// prints its rules text. The creator seeds every new Land as a basic (that's
// what makes the big symbol render immediately), so this choice is the
// visible way out of the seed. It used to live on the Text & stats step;
// choosing it with the frame reads better (owner decision 2026-09-15).

import { Mountain, ScrollText } from "lucide-react";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";

export type LandMode = "basic" | "nonbasic";

export function landModeOptions(
  basicDisabledReason: string | null = null,
): ChipOption<LandMode>[] {
  return [
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
}

export function landModeLabel(mode: LandMode): string {
  return mode === "basic" ? "Basic land" : "Nonbasic land";
}

export function LandModeChips({
  mode,
  basicDisabledReason = null,
  onChange,
}: {
  mode: LandMode;
  /** Multicolor frames have no basic — the option renders disabled. */
  basicDisabledReason?: string | null;
  onChange: (next: LandMode) => void;
}) {
  return (
    <ChipGroup
      ariaLabel="Land type"
      layout="grid-2"
      size="md"
      value={mode}
      onChange={onChange}
      options={landModeOptions(basicDisabledReason)}
    />
  );
}
