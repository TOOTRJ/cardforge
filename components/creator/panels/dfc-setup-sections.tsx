"use client";

// The Card step's double-faced rows (TODO 5.2; design 2026-10-02 §4):
//
//   • DfcFaceTypeSection — the FRONT face's type, one chip row under the
//     kind chips (as the token's types sit there): the six wave-1 face
//     types (DFC_FACE_TYPES; walker faces wait, owner Q2). The body follows
//     the type — the land front for a land, the spell front for the rest
//     (dfcFrontBodyFor) — so a hand-made modal card can be ZNR's spell //
//     land. The orchestrator writes both and keeps the colour verified.
//   • DfcIconFamilySection — a transform card's icon family: today's ▲ / ▼
//     (`arrows`, the default — owner Q5: every transform printed since
//     2022-11), the sun / moon, the full moon / Emrakul, the compass / land
//     and the fans, each one chip away. The family picks the BACK body too
//     (lib/cards/dfc.ts bodyFor): the four left families move the back's
//     icon to the left well. A modal card's housing has no family.
//
// Both are chip rows in existing sections of the stepper; nothing moves
// (6.29 stays last). The family chips are rendered again by the back-face
// panel in revise mode, where the Card step is absent.

import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { FrameThumb, SoonBadge } from "@/components/creator/frame-pickers";
import { SetupSection } from "@/components/creator/panels/setup-section";
import { CARD_TYPE_OPTIONS } from "@/components/creator/field-group";
import { isFrameComboAvailable } from "@/lib/cards/frame-availability";
import { DFC_ICON_FAMILY_VALUES, type DfcIconFamily } from "@/lib/cards/dfc";
import {
  DFC_FACE_TYPES,
  KIND_DEFS,
  dfcFrontBodyFor,
  type CardKind,
  type FrameColorKey,
} from "@/lib/creator/card-kinds";
import { FRAME_TEMPLATE_LABELS, type CardType } from "@/types/card";

/** The family chips' copy: the printed pair each one wears. */
export const DFC_ICON_FAMILY_COPY: Record<DfcIconFamily, { label: string; description: string }> = {
  arrows: { label: "Arrows", description: "▲ on the front, ▼ at the right of the back — every transform printed since late 2022" },
  sunmoon: { label: "Sun / moon", description: "Innistrad's werewolves (2016–2022): the sun on the front, the moon at the left of the back" },
  moon: { label: "Moon / Emrakul", description: "Eldritch Moon's meld and Eldrazi backs: the full moon, then Emrakul" },
  compass: { label: "Compass / land", description: "Ixalan's explorers: the compass on the front, the land on the back" },
  fan: { label: "Fans", description: "Kamigawa: Neon Dynasty's sagas: a closed fan, then an open one" },
};

export function DfcFaceTypeSection({
  kind,
  cardType,
  colorKey,
  verifiedKeys,
  onPick,
}: {
  kind: CardKind;
  cardType: CardType | "" | null | undefined;
  colorKey: FrameColorKey;
  verifiedKeys: ReadonlySet<string>;
  onPick?: (next: CardType) => void;
}) {
  const current = (cardType || KIND_DEFS[kind].cardType) as CardType;
  const options: ChipOption<CardType>[] = CARD_TYPE_OPTIONS.filter((option) =>
    (DFC_FACE_TYPES as readonly string[]).includes(option.value),
  ).map((option) => {
    const body = dfcFrontBodyFor(kind, option.value);
    // A type whose front body isn't verified in ANY colour is dark; one
    // verified only in another colour switches the colour (the orchestrator
    // says so), like a frame tile.
    const available =
      body !== null &&
      (option.value === current ||
        ["w", "u", "b", "r", "g", "c", "m"].some((k) => isFrameComboAvailable(body, k, verifiedKeys)));
    const inColour = body !== null && isFrameComboAvailable(body, colorKey, verifiedKeys);
    return {
      ...option,
      description: !available
        ? "Frames awaiting verification"
        : body && !inColour && option.value !== current
          ? `${FRAME_TEMPLATE_LABELS[body]} isn't verified in this colour yet — picking it switches the colour`
          : body
            ? FRAME_TEMPLATE_LABELS[body]
            : undefined,
      leading: body ? <FrameThumb template={body} colorKey={colorKey} type={{ cardType: option.value }} /> : undefined,
      disabled: !available,
      badge: available ? undefined : <SoonBadge />,
    };
  });
  const label = CARD_TYPE_OPTIONS.find((option) => option.value === current)?.label ?? current;
  return (
    <SetupSection title="Front face" value={label} testId="dfc-front-type">
      <ChipGroup
        ariaLabel="Front face type"
        layout="grid-3"
        size="md"
        value={current}
        onChange={(next) => onPick?.(next)}
        options={options}
      />
      <p className="text-[11px] leading-4 text-subtle">
        The front&apos;s type. A land front wears the land frame; the back
        face has a type of its own on the Identity step.
      </p>
    </SetupSection>
  );
}

export function DfcIconFamilySection({
  family,
  onChange,
  title = "Transform icons",
  testId = "dfc-icon-family",
}: {
  /** The card's family (frame_style.dfcIcon); absent reads as `arrows`. */
  family: DfcIconFamily | string | null | undefined;
  onChange: (next: DfcIconFamily) => void;
  title?: string;
  testId?: string;
}) {
  const current: DfcIconFamily = (DFC_ICON_FAMILY_VALUES as readonly string[]).includes(family ?? "")
    ? (family as DfcIconFamily)
    : "arrows";
  const options: ChipOption<DfcIconFamily>[] = DFC_ICON_FAMILY_VALUES.map((value) => ({
    value,
    label: DFC_ICON_FAMILY_COPY[value].label,
    description: DFC_ICON_FAMILY_COPY[value].description,
  }));
  return (
    <SetupSection title={title} value={DFC_ICON_FAMILY_COPY[current].label} testId={testId}>
      <ChipGroup
        ariaLabel="Transform icon family"
        layout="grid-2"
        size="md"
        value={current}
        onChange={onChange}
        options={options}
      />
      <p className="text-[11px] leading-4 text-subtle">
        The pair of icons printed in the front&apos;s and the back&apos;s
        corner. Arrows put the back&apos;s icon at the right of its name,
        as cards print today; the other pairs put it at the left, as the
        2016–2022 printings did.
      </p>
    </SetupSection>
  );
}
