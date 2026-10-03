"use client";

// The colour chips — one per frame dress, each tile the master the card
// would paint in that colour, offered only where the frame is verified in
// it. Extracted from card-setup-panel.tsx (TODO 5.2) so the Card step's
// colour (the front) and the back-face panel's colour (the back's own body)
// are ONE control: the caller names the template the colours dress.

import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import {
  pickFrameColorKey,
  type FrameTypeInfo,
} from "@/components/cards/frame-layer";
import { FrameThumb, SoonBadge } from "@/components/creator/frame-pickers";
import { SetupSection } from "@/components/creator/panels/setup-section";
import { isFrameComboAvailable } from "@/lib/cards/frame-availability";
import { frameAnatomyOf, pairColorIdentity, twoColorPairOf } from "@/lib/cards/anatomy";
import { TwoColorPairRow } from "@/components/creator/panels/anatomy-panel";
import { COLOR_IDENTITY_VALUES, type ColorIdentity, type FrameTemplate } from "@/types/card";

// Single-color key each identity chip contributes (frame-layer's palette).
export const IDENTITY_COLOR_KEY: Record<ColorIdentity, string> = {
  white: "w",
  blue: "u",
  black: "b",
  red: "r",
  green: "g",
  colorless: "c",
  multicolor: "m",
};

/** "Multicolor" for several colours, the one colour's word otherwise. */
export function colorSummaryOf(selection: readonly ColorIdentity[]): string {
  const c = selection.length > 1 ? "multicolor" : (selection[0] ?? "colorless");
  return c[0].toUpperCase() + c.slice(1);
}

export function ColorSection({
  title = "Color",
  ariaLabel = "Color identity",
  summary,
  template,
  selection,
  onChange,
  onPairTouched,
  verifiedKeys,
  frameType,
  frameFor,
  colorlessDisabledReason = null,
  autoClose = true,
  testId,
}: {
  title?: string;
  ariaLabel?: string;
  summary: string;
  /** The template the colours dress: the card's own, or — the back-face
   *  panel — the back's body. */
  template: FrameTemplate;
  selection: readonly ColorIdentity[];
  onChange: (next: ColorIdentity[]) => void;
  /** The user picked the pair by hand: the cost no longer re-fills it. */
  onPairTouched?: () => void;
  verifiedKeys: ReadonlySet<string>;
  /** The face's type: each colour tile shows the master the face would
   *  paint in that colour (Alpha's colourless tile: the artifact card for an
   *  artifact, the grey card otherwise). */
  frameType: FrameTypeInfo;
  /** The frame a pick of each colour lands the card on (a new token on the
   *  default switch's pick, CardSetupPanelProps.colorFrameFor); null = no
   *  frame of it is verified there. Absent: the card's own frame. */
  frameFor?: (colorKey: string) => FrameTemplate | null;
  /** Why the Colorless chip is disabled on this face (a double-faced back
   *  whose `c` is the artifact stand-in — design D2), else null. */
  colorlessDisabledReason?: string | null;
  autoClose?: boolean;
  testId?: string;
}) {
  // The two-colour frame (TODO 4.6b): on a template that draws it, a
  // multicolour card picks its PAIR in the "Two colours" row, pre-filled
  // from the cost (owner decision 2026-09-29, useTwoColorPairFollow).
  // Nowhere else the row shows.
  const drawsPairs = frameAnatomyOf(template).twoColor.length > 0;
  const pair = twoColorPairOf(selection);
  const currentKey = pickFrameColorKey([...selection]);
  const currentAvailable = isFrameComboAvailable(
    template,
    currentKey,
    verifiedKeys,
  );

  // SINGLE-select: a card wears exactly one frame dress, so the picker is
  // one chip per dress — a gold card is the "Multicolor" chip, not a stack
  // of color toggles. (Legacy multi-value identities select the Multicolor
  // chip. Most frames render them with the gold "m" dress, but a split-frame
  // template such as Dragon Wing (FrameProfile.twoColorSplit) renders a
  // two-colour identity as split wings, and only FrameThumb tiles that show
  // the card's own colour reflect that. Picking the Multicolor chip gives the
  // gold dress.)
  const selected: ColorIdentity =
    selection.length > 1 ? "multicolor" : (selection[0] ?? "colorless");

  const options: ChipOption<ColorIdentity>[] = COLOR_IDENTITY_VALUES.map(
    (color) => {
      const key = IDENTITY_COLOR_KEY[color];
      // The card's own colour keeps the card's frame (picking it again
      // changes nothing); another colour, the frame a pick lands on.
      const there = frameFor && key !== currentKey ? frameFor(key) : template;
      const refused = color === "colorless" && colorlessDisabledReason !== null;
      const reachable =
        !refused && there !== null && isFrameComboAvailable(there, key, verifiedKeys);
      return {
        value: color,
        label: color,
        description: refused ? colorlessDisabledReason ?? undefined : undefined,
        leading: (
          <FrameThumb template={there ?? template} colorKey={key} type={frameType} />
        ),
        disabled: !reachable,
        badge: reachable || refused ? undefined : <SoonBadge />,
        activeClass: "border-foreground/50 bg-elevated text-foreground",
      };
    },
  );

  return (
    <SetupSection title={title} value={summary} autoClose={autoClose} testId={testId}>
      <ChipGroup
        ariaLabel={ariaLabel}
        layout="grid-2"
        size="md"
        value={selected}
        // Multicolor on a template with the two-colour frame: the creator
        // pre-fills the pair from the cost (useTwoColorPairFollow).
        onChange={(color) => onChange([color])}
        options={options}
      />
      {drawsPairs && selected === "multicolor" ? (
        <TwoColorPairRow
          pair={pair}
          onChange={(next) => {
            onPairTouched?.();
            onChange(next ? pairColorIdentity(next) : ["multicolor"]);
          }}
        />
      ) : null}
      {!currentAvailable ? (
        <p className="text-[11px] text-subtle" role="status">
          This frame isn&apos;t verified in the selected color yet — pick an
          available color, or a different frame above.
        </p>
      ) : null}
    </SetupSection>
  );
}
