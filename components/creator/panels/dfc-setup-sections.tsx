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
// (6.29 stays last). The family chips are rendered again on the Identity
// step in revise mode, where the Card step is absent. With Face tabs (TODO
// 5.14) the Back face tab shows the back's own type and colour in the place
// of the "Front face" row and the Color section (panels/back-face-panels.tsx).

import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { FrameThumb, SoonBadge } from "@/components/creator/frame-pickers";
import { SetupSection } from "@/components/creator/panels/setup-section";
import { CARD_TYPE_OPTIONS } from "@/components/creator/field-group";
import { isFrameComboAvailable } from "@/lib/cards/frame-availability";
import { DEFAULT_DFC_ICON, DEFAULT_DFC_LOOK, DFC_ICON_FAMILY_VALUES, type DfcIconFamily, type DfcLook } from "@/lib/cards/dfc";
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
  look = DEFAULT_DFC_LOOK,
}: {
  kind: CardKind;
  cardType: CardType | "" | null | undefined;
  colorKey: FrameColorKey;
  verifiedKeys: ReadonlySet<string>;
  onPick?: (next: CardType) => void;
  /** The card's look (TODO 5.7): a borderless card keeps it — a type with
   *  no borderless front (a land) is off. */
  look?: DfcLook;
}) {
  const current = (cardType || KIND_DEFS[kind].cardType) as CardType;
  const options: ChipOption<CardType>[] = CARD_TYPE_OPTIONS.filter((option) =>
    (DFC_FACE_TYPES as readonly string[]).includes(option.value),
  ).map((option) => {
    const body = dfcFrontBodyFor(kind, option.value, look);
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
        ? body === null && look === "borderless"
          ? BORDERLESS_NO_FACE
          : "Frames awaiting verification"
        : body && !inColour && option.value !== current
          ? `${FRAME_TEMPLATE_LABELS[body]} isn't verified in this colour yet — picking it switches the colour`
          : body
            ? FRAME_TEMPLATE_LABELS[body]
            : undefined,
      leading: body ? <FrameThumb template={body} colorKey={colorKey} type={{ cardType: option.value }} /> : undefined,
      disabled: !available,
      badge: available || (body === null && look === "borderless") ? undefined : <SoonBadge />,
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
        face has a type of its own on the Back face tab.
      </p>
    </SetupSection>
  );
}

/** Why a face is off on a borderless double-faced card (TODO 5.7). */
export const BORDERLESS_NO_FACE = "The borderless frame has no land face yet";
export const BORDERLESS_ARROWS_ONLY = "The borderless frame prints the arrows only";

export function DfcIconFamilySection({
  family,
  onChange,
  title = "Transform icons",
  testId = "dfc-icon-family",
  look = DEFAULT_DFC_LOOK,
}: {
  /** The card's family (frame_style.dfcIcon); absent reads as `arrows`. */
  family: DfcIconFamily | string | null | undefined;
  onChange: (next: DfcIconFamily) => void;
  title?: string;
  testId?: string;
  /** The card's look (TODO 5.7): the borderless back exists for the
   *  arrows only, so the other pairs are off there. */
  look?: DfcLook;
}) {
  const current: DfcIconFamily = (DFC_ICON_FAMILY_VALUES as readonly string[]).includes(family ?? "")
    ? (family as DfcIconFamily)
    : "arrows";
  const options: ChipOption<DfcIconFamily>[] = DFC_ICON_FAMILY_VALUES.map((value) => {
    const off = look === "borderless" && value !== DEFAULT_DFC_ICON && value !== current;
    return {
      value,
      label: DFC_ICON_FAMILY_COPY[value].label,
      description: off ? BORDERLESS_ARROWS_ONLY : DFC_ICON_FAMILY_COPY[value].description,
      ...(off ? { disabled: true } : {}),
    };
  });
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

/** A battle's faces (TODO 5.5 (a), owner Round 68): its back is OPTIONAL —
 *  a new battle starts with its back (every printed battle has one), and
 *  "One face" switches it off, so the battle saves one-faced exactly as it
 *  did before 5.5 (no back_face, one PNG). Shown on a NEW battle's Card step
 *  only while its back can be a face of its own (lib/creator/battle-back.ts);
 *  an edit keeps the faces it was saved with. A single-select chip row (one
 *  tab stop, arrows move, Space / Enter picks — components/ui/chip-group). */
export function BattleBackSection({
  on,
  onChange,
  testId = "battle-back-faces",
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  testId?: string;
}) {
  const options: ChipOption<"two" | "one">[] = [
    { value: "two", label: "Two faces", description: "A back face on the transform frame" },
    { value: "one", label: "One face", description: "The battle alone, no back" },
  ];
  return (
    <SetupSection title="Faces" value={on ? "Two faces" : "One face"} testId={testId}>
      <ChipGroup
        ariaLabel="Battle faces"
        layout="grid-2"
        size="md"
        value={on ? "two" : "one"}
        onChange={(next) => onChange(next === "two")}
        options={options}
      />
      <p className="text-[11px] leading-4 text-subtle">
        A battle transforms into its back face once it is defeated. Switch the
        back off to save the battle on its own; the back&apos;s fields are kept
        while you stay on this card.
      </p>
    </SetupSection>
  );
}

/** Why the Saga kind's "Two faces" is off: the double-faced saga front or
 *  its default back is not published in any colour yet. */
export const SAGA_TWO_FACES_UNAVAILABLE = "Frames awaiting verification";

/** A saga's faces (TODO 5.5 (b)): "One face" is the saga frame, "Two faces"
 *  the double-faced saga front — Kamigawa: Neon Dynasty's transforming
 *  Sagas, whose last chapter returns the card transformed — with a back
 *  face of its own on the Back face tab. The pick IS the frame (both are
 *  the Saga kind's templates; the Frame section lists them too). A NEW
 *  saga's Card step only: an edit keeps the faces it was saved with. A
 *  single-select chip row (one tab stop, arrows move, Space / Enter picks);
 *  "Two faces" is off with its reason until the frames are published. */
export function SagaFacesSection({
  two,
  twoAvailable,
  onChange,
  testId = "saga-faces",
}: {
  two: boolean;
  twoAvailable: boolean;
  onChange: (next: boolean) => void;
  testId?: string;
}) {
  const options: ChipOption<"one" | "two">[] = [
    { value: "one", label: "One face", description: "A saga on its own" },
    {
      value: "two",
      label: "Two faces",
      description: twoAvailable ? "A transforming saga with a back face" : SAGA_TWO_FACES_UNAVAILABLE,
      ...(twoAvailable || two ? {} : { disabled: true, badge: <SoonBadge /> }),
    },
  ];
  return (
    <SetupSection title="Faces" value={two ? "Two faces" : "One face"} testId={testId}>
      <ChipGroup
        ariaLabel="Saga faces"
        layout="grid-2"
        size="md"
        value={two ? "two" : "one"}
        onChange={(next) => onChange(next === "two")}
        options={options}
      />
      <p className="text-[11px] leading-4 text-subtle">
        A transforming saga returns as its back face after its last chapter —
        the icon in the corner and the back&apos;s power and toughness at the
        foot of the chapters, as Kamigawa: Neon Dynasty printed them.
      </p>
    </SetupSection>
  );
}
