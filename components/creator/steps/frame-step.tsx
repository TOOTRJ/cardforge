"use client";

// Frame step — quick-start actions (Scryfall import / AI random card), the
// "what are you making" type + color pickers, and the era → frame picker.
// Extracted verbatim from card-creator-form.tsx; orchestrator-owned state
// (Scryfall dialog, random-card flight, autoColors) arrives via props.

import { Controller, useFormContext } from "react-hook-form";
import { Search, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ChipGroup,
  type ChipOption,
} from "@/components/ui/chip-group";
import { pickFrameColorKey } from "@/components/cards/frame-layer";
import {
  CARD_TYPE_OPTIONS,
  FieldGroup,
} from "@/components/creator/field-group";
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

// Color swatch gradients — mirror the ManaCostGlyphs palette so the
// color-identity chips read as the same color language as the cost preview.
// Multicolor is a conic sweep so it visibly differs from any single color.
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
  // Small filled circle that mirrors the mana-glyph palette. Used as the
  // `leading` element on color-identity chips so the picker reads as a
  // continuation of the cost glyphs instead of generic text pills.
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

type FrameStepProps = {
  userId: string | null;
  /** Live card type from the form — drives the era/frame derivation. */
  cardType: CardType | "";
  /** Live color identity — drives the frame thumbnails' color variant. */
  colorIdentity: ColorIdentity[];
  /** "Match mana cost" toggle — owned by the orchestrator (the AI / Scryfall
   *  import handlers also flip it off). */
  autoColors: boolean;
  onAutoColorsChange: (next: boolean) => void;
  /** Random-card request in flight (orchestrator-owned). */
  generatingRandom: boolean;
  onRandomCard: () => void;
  onOpenScryfall: () => void;
};

export function FrameStep({
  userId,
  cardType,
  colorIdentity,
  autoColors,
  onAutoColorsChange,
  generatingRandom,
  onRandomCard,
  onOpenScryfall,
}: FrameStepProps) {
  const {
    control,
    formState: { errors },
  } = useFormContext<FormValues>();

  return (
    <>
      {/* Quick-start: import a real card or let the AI draft one. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-elevated/40 px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
            Start from a real card
          </span>
          <span className="text-[11px] text-muted">
            Search Scryfall and seed every field, including the artwork.
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={!userId}
          title={
            userId
              ? undefined
              : "Sign in to search and import real cards."
          }
          onClick={onOpenScryfall}
        >
          <Search className="h-4 w-4" aria-hidden />
          Search a real card
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary-bright">
            <Sparkles className="h-3 w-3" aria-hidden />
            Generate with AI
          </span>
          <span className="text-[11px] text-muted">
            AI drafts the card and an image model paints original art.
            Capped at 10 random cards per day.
          </span>
        </div>
        <Button
          type="button"
          variant="primary"
          disabled={!userId || generatingRandom}
          title={
            userId
              ? generatingRandom
                ? "Generating…"
                : undefined
              : "Sign in to use the AI generator."
          }
          onClick={onRandomCard}
        >
          {generatingRandom ? (
            <>
              <Wand2 className="h-4 w-4 animate-pulse" aria-hidden />
              Forging…
            </>
          ) : (
            <>
              <Wand2 className="h-4 w-4" aria-hidden />
              Random card
            </>
          )}
        </Button>
      </div>

      {/* 1 · What are you making — type + color drive the frame. */}
      <section className="flex flex-col gap-3">
        <PickerStepLabel n={1} title="What are you making" />
        <FieldGroup label="Card type" error={errors.card_type?.message}>
          <Controller
            control={control}
            name="card_type"
            render={({ field }) => (
              <ChipGroup
                ariaLabel="Card type"
                layout="grid-3"
                value={field.value}
                onChange={(next) => field.onChange(next)}
                options={CARD_TYPE_OPTIONS}
              />
            )}
          />
        </FieldGroup>
        <FieldGroup
          label="Color"
          helper={
            autoColors
              ? "Following the mana cost — tap a color to take over."
              : "Sets the frame color. Pick one or more, or none for colorless."
          }
        >
          <div className="flex flex-col gap-2">
            <Controller
              control={control}
              name="color_identity"
              render={({ field }) => (
                <ChipGroup
                  multiSelect
                  ariaLabel="Color identity"
                  layout="wrap"
                  value={field.value}
                  onChange={(next) => {
                    onAutoColorsChange(false);
                    field.onChange(next);
                  }}
                  options={COLOR_IDENTITY_OPTIONS}
                />
              )}
            />
            <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={autoColors}
                onChange={(event) => onAutoColorsChange(event.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--color-primary)]"
              />
              Match mana cost automatically
            </label>
          </div>
        </FieldGroup>
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
