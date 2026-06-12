"use client";

// Frame panel — the era → frame picker. The card type + color identity that
// DRIVE the frame derivation now live on the Identity / Pips panels and
// arrive here as live-watched props. Regrouped from the old frame step.

import { Controller, useFormContext } from "react-hook-form";
import {
  ChipGroup,
  type ChipOption,
} from "@/components/ui/chip-group";
import { pickFrameColorKey } from "@/components/cards/frame-layer";
import {
  BorderEraFramePicker,
  FrameThumb,
  PickerStepLabel,
  ShowcaseFramePicker,
} from "@/components/creator/frame-pickers";
import {
  COMING_SOON_ERAS,
  DEFAULT_FRAME_TEMPLATE,
  FRAME_ERA_HINTS,
  FRAME_ERA_LABELS,
  FRAME_ERA_VALUES,
  FRAME_SET_DEFAULT_TEMPLATE,
  FRAME_TEMPLATE_SET,
  type CardType,
  type ColorIdentity,
  type FrameEra,
  type FrameTemplate,
} from "@/types/card";
import {
  eraForTemplate,
  eraSupportsType,
  resolveFrameTemplate,
  standardFrameFor,
} from "@/lib/creator/frame-picker";
import type { FormValues } from "@/lib/creator/form-types";

// "Coming soon" chips — disabled, badge-tagged display rows for eras on the
// roadmap (types/card.ts). A separate ChipGroup block so the real (typed) era
// selection stays type-safe; clicks are no-ops.
function SoonBadge() {
  return (
    <span className="rounded-full border border-border/70 bg-elevated px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-subtle">
      Soon
    </span>
  );
}
// Roadmap ERA chips — disabled "Soon" rows for border generations not yet
// converted (Retro 1997 / Modern 2003 / Future Sight). Shown under the era tier.
const COMING_SOON_ERA_OPTIONS: ChipOption<string>[] = COMING_SOON_ERAS.map(
  (e) => ({
    value: `soon:${e.key}`,
    label: e.label,
    description: e.hint,
    disabled: true,
    badge: <SoonBadge />,
  }),
);

type FramePanelProps = {
  /** Live card type from the form — drives the era/frame derivation. */
  cardType: CardType | "";
  /** Live color identity — drives the frame thumbnails' color variant. */
  colorIdentity: ColorIdentity[];
};

export function FramePanel({ cardType, colorIdentity }: FramePanelProps) {
  const { control } = useFormContext<FormValues>();

  return (
    <>
      {/* 1 · Era + 2 · Frame. The era is the border generation; the
          specific frame is derived from the card type (no mismatches),
          with optional special layouts and a set→treatment sub-picker
          for the Showcase era. */}
      <Controller
        control={control}
        name="frame_style.template"
        render={({ field }) => {
          const template = (field.value ??
            DEFAULT_FRAME_TEMPLATE) as FrameTemplate;
          const colorKey = pickFrameColorKey(colorIdentity);
          const activeEra = eraForTemplate(template);
          const activeSet = FRAME_TEMPLATE_SET[template];

          // Era chips: a thumbnail of that era's frame for the current
          // type + color, disabled (with a reason) when the era can't
          // frame this card type.
          const eraOptions: ChipOption<FrameEra>[] = FRAME_ERA_VALUES.map(
            (era) => {
              const supported = eraSupportsType(era, cardType);
              const thumbTemplate =
                era === "showcase"
                  ? FRAME_SET_DEFAULT_TEMPLATE.lotr
                  : standardFrameFor(era, cardType) ??
                    standardFrameFor(era, "creature") ??
                    DEFAULT_FRAME_TEMPLATE;
              return {
                value: era,
                label: FRAME_ERA_LABELS[era],
                description: supported
                  ? FRAME_ERA_HINTS[era]
                  : `No ${cardType || "creature"} frame in this era yet`,
                leading: (
                  <FrameThumb
                    template={thumbTemplate}
                    colorKey={colorKey}
                  />
                ),
                disabled: !supported,
              };
            },
          );

          const selectEra = (nextEra: FrameEra) => {
            if (nextEra === activeEra) return;
            if (nextEra === "showcase") {
              field.onChange(FRAME_SET_DEFAULT_TEMPLATE.lotr);
              return;
            }
            const resolved = resolveFrameTemplate(nextEra, cardType);
            if (resolved) field.onChange(resolved);
          };

          return (
            <div className="flex flex-col gap-5">
              {/* 1 · Era */}
              <section className="flex flex-col gap-2">
                <PickerStepLabel
                  n={1}
                  title="Choose an era"
                  count={`${FRAME_ERA_VALUES.length} live`}
                />
                <ChipGroup
                  ariaLabel="Frame era"
                  layout="grid-2"
                  size="md"
                  value={activeEra}
                  onChange={selectEra}
                  options={eraOptions}
                />
                <ChipGroup
                  ariaLabel="Upcoming eras"
                  layout="grid-2"
                  size="md"
                  value=""
                  onChange={() => {}}
                  options={COMING_SOON_ERA_OPTIONS}
                />
              </section>

              {/* 2 · Frame */}
              <section className="flex flex-col gap-2">
                <PickerStepLabel
                  n={2}
                  title="Frame"
                  aside={FRAME_ERA_LABELS[activeEra]}
                />
                {activeEra === "showcase" ? (
                  <ShowcaseFramePicker
                    activeSet={activeSet}
                    template={template}
                    colorKey={colorKey}
                    onChange={field.onChange}
                  />
                ) : (
                  <BorderEraFramePicker
                    era={activeEra}
                    cardType={cardType}
                    template={template}
                    colorKey={colorKey}
                    onChange={field.onChange}
                  />
                )}
              </section>
            </div>
          );
        }}
      />
    </>
  );
}
