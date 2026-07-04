"use client";

// Frame gallery — step 2 of the kind-first flow: every frame, from every era,
// that can dress the chosen kind, grouped by era with the frame's COLOR picked
// inline underneath. Color comes after the frame because it's a pure PNG swap
// (layout geometry is per-template — lib/cards/profile-override.ts), so
// switching color can never move a single element.
//
// There is no fallback logic here: framesForKind() simply doesn't include an
// era that can't frame the kind, so the dead-end era chips (and the silent
// M15 fallback they forced) are gone by construction.

import { useMemo } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { pickFrameColorKey } from "@/components/cards/frame-layer";
import {
  FrameThumb,
  PickerStepLabel,
  SoonBadge,
} from "@/components/creator/frame-pickers";
import {
  framesForKind,
  type CardKind,
  type FrameChoice,
} from "@/lib/creator/card-kinds";
import { isFrameComboAvailable } from "@/lib/cards/frame-availability";
import {
  COLOR_IDENTITY_VALUES,
  COMING_SOON_ERAS,
  DEFAULT_FRAME_TEMPLATE,
  FRAME_ERA_HINTS,
  FRAME_ERA_LABELS,
  FRAME_ERA_VALUES,
  FRAME_TEMPLATE_LABELS,
  FRAME_SET_LABELS,
  FRAME_TEMPLATE_SET,
  type ColorIdentity,
  type FrameEra,
  type FrameTemplate,
} from "@/types/card";
import type { FormValues } from "@/lib/creator/form-types";

// Single-color key each identity chip contributes (frame-layer's palette).
const IDENTITY_COLOR_KEY: Record<ColorIdentity, string> = {
  white: "w",
  blue: "u",
  black: "b",
  red: "r",
  green: "g",
  colorless: "c",
  multicolor: "m",
};

const GROUP_HEADINGS: Record<FrameChoice["group"], string | null> = {
  standard: null,
  skin: "Variants",
  layout: null,
  showcase: null,
};

type FrameGalleryPanelProps = {
  kind: CardKind;
  /** Live color identity — tints every thumbnail to what the user will get. */
  colorIdentity: ColorIdentity[];
  /** Verified (template/color) combo keys from frame_reviews. */
  verifiedFrameKeys?: string[];
};

export function FrameGalleryPanel({
  kind,
  colorIdentity,
  verifiedFrameKeys = [],
}: FrameGalleryPanelProps) {
  const { control } = useFormContext<FormValues>();
  const verifiedKeys = useMemo(
    () => new Set(verifiedFrameKeys),
    [verifiedFrameKeys],
  );
  const choices = useMemo(
    () => framesForKind(kind, verifiedKeys),
    [kind, verifiedKeys],
  );

  return (
    <Controller
      control={control}
      name="frame_style.template"
      render={({ field }) => {
        const template = (field.value ??
          DEFAULT_FRAME_TEMPLATE) as FrameTemplate;
        const colorKey = pickFrameColorKey(colorIdentity);

        // Group the flat choice list into era sections, preserving order.
        const byEra = new Map<FrameEra, FrameChoice[]>();
        for (const choice of choices) {
          const list = byEra.get(choice.era) ?? [];
          list.push(choice);
          byEra.set(choice.era, list);
        }

        // A saved template the gallery wouldn't offer for this kind (old-bug
        // artifacts, withdrawn combos): pin it as a visible "current frame"
        // tile instead of silently swapping it out from under the card.
        const isLegacyPin = !choices.some((c) => c.template === template);

        const toOption = (choice: FrameChoice): ChipOption<FrameTemplate> => {
          const available = choice.availableColorKeys.length > 0;
          const isShowcase = choice.group === "showcase";
          const label = isShowcase
            ? `${FRAME_SET_LABELS[FRAME_TEMPLATE_SET[choice.template]]} — ${FRAME_TEMPLATE_LABELS[choice.template]}`
            : FRAME_TEMPLATE_LABELS[choice.template];
          const colorAvailable = isFrameComboAvailable(
            choice.template,
            colorKey,
            verifiedKeys,
          );
          return {
            value: choice.template,
            label,
            description: !available
              ? "Awaiting verification"
              : !colorAvailable
                ? "Not verified in this color yet — pick another color below"
                : undefined,
            leading: (
              <FrameThumb
                template={choice.template}
                colorKey={colorAvailable ? colorKey : choice.availableColorKeys[0] ?? colorKey}
              />
            ),
            disabled: !available,
            badge: available ? undefined : <SoonBadge />,
          };
        };

        let sectionIndex = 0;

        return (
          <div className="flex flex-col gap-5">
            {isLegacyPin ? (
              <section className="flex flex-col gap-2">
                <PickerStepLabel
                  n={++sectionIndex}
                  title="Current frame"
                  aside="Saved on this card"
                />
                <ChipGroup
                  ariaLabel="Current frame"
                  layout="grid-2"
                  size="md"
                  value={template}
                  onChange={field.onChange}
                  options={[
                    {
                      value: template,
                      label: FRAME_TEMPLATE_LABELS[template],
                      description:
                        "This frame isn't offered for the chosen kind anymore; it stays until you pick another.",
                      leading: (
                        <FrameThumb template={template} colorKey={colorKey} />
                      ),
                    },
                  ]}
                />
              </section>
            ) : null}

            {FRAME_ERA_VALUES.filter((era) => byEra.has(era)).map((era) => {
              const eraChoices = byEra.get(era)!;
              const main = eraChoices.filter((c) => !GROUP_HEADINGS[c.group]);
              const variants = eraChoices.filter((c) =>
                Boolean(GROUP_HEADINGS[c.group]),
              );
              return (
                <section key={era} className="flex flex-col gap-2">
                  <PickerStepLabel
                    n={++sectionIndex}
                    title={FRAME_ERA_LABELS[era]}
                    aside={FRAME_ERA_HINTS[era]}
                  />
                  <ChipGroup
                    ariaLabel={`${FRAME_ERA_LABELS[era]} frames`}
                    layout="grid-2"
                    size="md"
                    value={template}
                    onChange={field.onChange}
                    options={main.map(toOption)}
                  />
                  {variants.length > 0 ? (
                    <>
                      <span className="text-[11px] uppercase tracking-wider text-subtle">
                        Variants — same layout, different dress
                      </span>
                      <ChipGroup
                        ariaLabel={`${FRAME_ERA_LABELS[era]} frame variants`}
                        layout="grid-2"
                        size="md"
                        value={template}
                        onChange={field.onChange}
                        options={variants.map(toOption)}
                      />
                    </>
                  ) : null}
                </section>
              );
            })}

            {COMING_SOON_ERAS.length > 0 ? (
              <p className="text-[11px] text-subtle">
                Coming soon:{" "}
                {COMING_SOON_ERAS.map((e) => `${e.label} — ${e.hint}`).join(
                  " · ",
                )}
              </p>
            ) : null}

            {/* Color — last on purpose: geometry is per-template, so color is
                a pure PNG swap and can never break alignment. */}
            <ColorSection
              sectionIndex={++sectionIndex}
              template={template}
              verifiedKeys={verifiedKeys}
            />
          </div>
        );
      }}
    />
  );
}

function ColorSection({
  sectionIndex,
  template,
  verifiedKeys,
}: {
  sectionIndex: number;
  template: FrameTemplate;
  verifiedKeys: ReadonlySet<string>;
}) {
  const { control } = useFormContext<FormValues>();
  return (
    <Controller
      control={control}
      name="color_identity"
      render={({ field }) => {
        const selection = (field.value ?? []) as ColorIdentity[];
        const currentKey = pickFrameColorKey(selection);
        const currentAvailable = isFrameComboAvailable(
          template,
          currentKey,
          verifiedKeys,
        );

        const options: ChipOption<ColorIdentity>[] =
          COLOR_IDENTITY_VALUES.map((color) => {
            // Disable a chip when TOGGLING it would land on a color variant
            // this frame doesn't have published yet (deselecting is always a
            // toggle too, so a selected chip stays clickable when backing out
            // leads somewhere valid).
            const next = selection.includes(color)
              ? selection.filter((c) => c !== color)
              : [...selection, color];
            const nextKey = pickFrameColorKey(next);
            const reachable = isFrameComboAvailable(
              template,
              nextKey,
              verifiedKeys,
            );
            return {
              value: color,
              label: color,
              leading: (
                <FrameThumb
                  template={template}
                  colorKey={IDENTITY_COLOR_KEY[color]}
                />
              ),
              disabled: !reachable,
              badge: reachable ? undefined : <SoonBadge />,
              activeClass: "border-foreground/50 bg-elevated text-foreground",
            };
          });

        return (
          <section className="flex flex-col gap-2">
            <PickerStepLabel
              n={sectionIndex}
              title="Color"
              aside="The frame in your colors"
            />
            <ChipGroup
              multiSelect
              ariaLabel="Color identity"
              layout="grid-2"
              size="md"
              value={selection}
              onChange={(next) => field.onChange(next)}
              options={options}
            />
            {!currentAvailable ? (
              <p className="text-[11px] text-subtle" role="status">
                This frame isn&apos;t verified in the selected color yet — pick
                an available color, or a different frame above.
              </p>
            ) : null}
          </section>
        );
      }}
    />
  );
}
