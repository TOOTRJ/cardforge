"use client";

// Kind panel — step 1 of the kind-first flow: "what are you making?". Nine
// standard card types plus the structural layouts (Saga, Adventure, Split,
// Aftermath, Flip) as first-class choices. The value is the DERIVED kind
// (kindFromCard), not a form field — selection routes through the
// orchestrator's planKindChange so a change can remap the frame in-era or ask
// before switching eras, never silently.

import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { FrameThumb, PickerStepLabel } from "@/components/creator/frame-pickers";
import {
  CARD_KIND_VALUES,
  KIND_DEFS,
  type CardKind,
} from "@/lib/creator/card-kinds";

const STANDARD_KINDS = CARD_KIND_VALUES.filter(
  (k) => KIND_DEFS[k].layoutTemplates === null,
);
const LAYOUT_KINDS = CARD_KIND_VALUES.filter(
  (k) => KIND_DEFS[k].layoutTemplates !== null,
);

const KIND_HINTS: Partial<Record<CardKind, string>> = {
  saga: "Chapter rail (I–IV) enchantment",
  adventure: "Creature with an inline adventure spell",
  split: "Two side-by-side spells, one card",
  aftermath: "Cast the top, later the sideways half",
  flip: "Top and upside-down bottom halves",
};

type KindPanelProps = {
  /** The derived current kind (kindFromCard). */
  kind: CardKind;
  /** Frame color key for the chip thumbnails (pickFrameColorKey). */
  colorKey: string;
  onSelect: (next: CardKind) => void;
};

export function KindPanel({ kind, colorKey, onSelect }: KindPanelProps) {
  const toOption = (k: CardKind): ChipOption<CardKind> => ({
    value: k,
    label: KIND_DEFS[k].label,
    description: KIND_HINTS[k],
    leading: (
      <FrameThumb template={KIND_DEFS[k].previewTemplate} colorKey={colorKey} />
    ),
  });

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <PickerStepLabel n={1} title="Card type" />
        <ChipGroup
          ariaLabel="Card kind"
          layout="grid-2"
          size="md"
          value={kind}
          onChange={onSelect}
          options={STANDARD_KINDS.map(toOption)}
        />
      </section>
      <section className="flex flex-col gap-2">
        <PickerStepLabel
          n={2}
          title="Special layouts"
          aside="Structurally different cards"
        />
        <ChipGroup
          ariaLabel="Special layout kinds"
          layout="grid-2"
          size="md"
          value={kind}
          onChange={onSelect}
          options={LAYOUT_KINDS.map(toOption)}
        />
      </section>
    </div>
  );
}
