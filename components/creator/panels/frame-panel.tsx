"use client";

// Frame panel — Color + era → frame picker. Color lives here (next to the
// frame) because it drives the frame's color variant; card type arrives as a
// live-watched prop. Regrouped from the old frame/pips steps.

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
  COLOR_IDENTITY_VALUES,
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
import { useMemo } from "react";

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

// Color-identity swatches — mirror the ManaCostGlyphs palette so the picker
// reads as the same color language as the cost glyphs. (Moved here from the
// Pips panel; color now lives next to the frame it tints.)
const COLOR_SWATCH: Record<ColorIdentity, string> = {
  white:
    "radial-gradient(circle at 30% 25%, #fff 0%, #f7eccb 45%, #cfb787 100%)",
  blue:
    "radial-gradient(circle at 30% 25%, #dff2ff 0%, #7cc3ee 45%, #1f6aa1 100%)",
  black:
    "radial-gradient(circle at 30% 25%, #d6cfc8 0%, #5b5550 45%, #1a1814 100%)",
  red:
    "radial-gradient(circle at 30% 25%, #ffd9c7 0%, #ec6f4c 45%, #8e2c14 100%)",
  green:
    "radial-gradient(circle at 30% 25%, #dcf2c8 0%, #79b664 45%, #234e1a 100%)",
  multicolor:
    "conic-gradient(from 45deg, #cfb787, #7cc3ee, #ec6f4c, #79b664, #c98cf7, #cfb787)",
  colorless:
    "radial-gradient(circle at 30% 25%, #eceaea 0%, #b8b5b3 45%, #6f6c69 100%)",
};

function ColorSwatch({ color }: { color: ColorIdentity }) {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.3),0_1px_1px_rgba(0,0,0,0.3)]"
      style={{ background: COLOR_SWATCH[color] }}
    />
  );
}

const COLOR_IDENTITY_OPTIONS: ChipOption<ColorIdentity>[] =
  COLOR_IDENTITY_VALUES.map((color) => ({
    value: color,
    label: color,
    leading: <ColorSwatch color={color} />,
    activeClass: "border-foreground/50 bg-elevated text-foreground",
  }));

type FramePanelProps = {
  /** Live card type from the form — drives the era/frame derivation. */
  cardType: CardType | "";
  /** Live color identity — drives the frame thumbnails' color variant. */
  colorIdentity: ColorIdentity[];
  /** Verified (template/color) combo keys from frame_reviews — gates the
   *  special layouts / showcase treatments per color. */
  verifiedFrameKeys?: string[];
};

export function FramePanel({
  cardType,
  colorIdentity,
  verifiedFrameKeys = [],
}: FramePanelProps) {
  const { control } = useFormContext<FormValues>();
  const verifiedKeys = useMemo(
    () => new Set(verifiedFrameKeys),
    [verifiedFrameKeys],
  );

  return (
    <div className="flex flex-col gap-5">
      {/* 1 · Color — sets the frame's color variant, so it leads. */}
      <section className="flex flex-col gap-2">
        <PickerStepLabel n={1} title="Color" aside="Tints the frame" />
        <Controller
          control={control}
          name="color_identity"
          render={({ field }) => (
            <ChipGroup
              multiSelect
              ariaLabel="Color identity"
              layout="wrap"
              value={field.value}
              onChange={(next) => field.onChange(next)}
              options={COLOR_IDENTITY_OPTIONS}
            />
          )}
        />
      </section>

      {/* 2 · Era + 3 · Frame. The era is the border generation; the
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
              // Showcase & Universes Beyond is gated for now.
              const comingSoon = era === "showcase";
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
                description: comingSoon
                  ? "IP crossover frames — coming soon"
                  : supported
                    ? FRAME_ERA_HINTS[era]
                    : `No ${cardType || "creature"} frame in this era yet`,
                leading: (
                  <FrameThumb
                    template={thumbTemplate}
                    colorKey={colorKey}
                  />
                ),
                disabled: !supported || comingSoon,
                badge: comingSoon ? <SoonBadge /> : undefined,
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
            <>
              {/* 2 · Era */}
              <section className="flex flex-col gap-2">
                <PickerStepLabel
                  n={2}
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

              {/* 3 · Frame */}
              <section className="flex flex-col gap-2">
                <PickerStepLabel
                  n={3}
                  title="Frame"
                  aside={FRAME_ERA_LABELS[activeEra]}
                />
                {activeEra === "showcase" ? (
                  <ShowcaseFramePicker
                    activeSet={activeSet}
                    template={template}
                    colorKey={colorKey}
                    verifiedKeys={verifiedKeys}
                    onChange={field.onChange}
                  />
                ) : (
                  <BorderEraFramePicker
                    era={activeEra}
                    cardType={cardType}
                    template={template}
                    colorKey={colorKey}
                    verifiedKeys={verifiedKeys}
                    onChange={field.onChange}
                  />
                )}
              </section>
            </>
          );
        }}
      />
    </div>
  );
}
