"use client";

// Card setup — the compact first step: card TYPE (one combined list — the
// structural layouts sit alongside creature/instant/…; users just pick
// "Saga" without needing to know it's structurally different), the FRAME
// across every era + showcase, and the frame's COLOR. Each choice lives in
// its own collapsible with the current value in the summary, so the step
// reads at a glance and the defaults (Creature / M15 standard / colorless)
// let a user skip straight past it.
//
// Color still comes after the frame on purpose: geometry is per-template
// (lib/cards/profile-override.ts), so color is a pure PNG swap and can
// never move an element. And there's no fallback logic anywhere here —
// framesForKind() simply doesn't include an era that can't frame the kind.

import { useMemo, useState } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { ChevronDown } from "lucide-react";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { pickFrameColorKey } from "@/components/cards/frame-layer";
import {
  FrameThumb,
  SoonBadge,
} from "@/components/creator/frame-pickers";
import {
  CARD_KIND_VALUES,
  KIND_DEFS,
  baseFrameFor,
  framesForKind,
  kindHasAvailableFrame,
  type CardKind,
  type FrameChoice,
} from "@/lib/creator/card-kinds";
import { isFrameComboAvailable } from "@/lib/cards/frame-availability";
import {
  COLOR_IDENTITY_VALUES,
  COMING_SOON_ERAS,
  TEMPLATE_SKIN_VARIANTS,
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
import { eraForTemplate } from "@/lib/creator/frame-picker";
import { normalizeFrameTemplate } from "@/lib/cards/card-display";
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

const KIND_HINTS: Partial<Record<CardKind, string>> = {
  saga: "Chapter rail (I–IV)",
  adventure: "Creature + inline adventure spell",
  split: "Two side-by-side spells",
  aftermath: "Top half now, sideways half later",
  flip: "Top and upside-down halves",
};

// Collapsible chooser section: the summary always shows the CURRENT value,
// so a collapsed step still reads as a complete sentence. All sections start
// CLOSED (new cards carry sensible defaults) and close themselves once a
// selection lands.
function SetupSection({
  title,
  value,
  children,
}: {
  title: string;
  value: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Auto-close on selection: the summary value changing while the section is
  // open means the user just picked something — collapse so the step reads
  // as its result. (Derived during render — no effect — so the kind-change
  // confirm dialog closes the section only when the change actually lands.)
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if (open) setOpen(false);
  }
  return (
    <details
      open={open}
      className="rounded-lg border border-border/60 bg-elevated/30"
    >
      <summary
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
          {title}
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {value}
          </span>
          <ChevronDown
            aria-hidden
            className={`h-4 w-4 shrink-0 text-subtle transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4 pt-1">{children}</div>
    </details>
  );
}

type CardSetupPanelProps = {
  /** The derived current kind (kindFromCard). */
  kind: CardKind;
  /** Live color identity — tints every thumbnail to what the user will get. */
  colorIdentity: ColorIdentity[];
  /** Verified (template/color) combo keys from frame_reviews. */
  verifiedFrameKeys?: string[];
  /** Kind selection routes through the orchestrator's planKindChange so a
   *  change can remap the frame in-era or ask — never silently. */
  onKindSelect: (next: CardKind) => void;
  /** Fires AFTER a color-identity change lands in the form — the orchestrator
   *  uses it to keep a pristine basic-land name/subtype in step with the
   *  color. */
  onColorIdentityChange?: (next: ColorIdentity[]) => void;
};

export function CardSetupPanel({
  kind,
  colorIdentity,
  verifiedFrameKeys = [],
  onKindSelect,
  onColorIdentityChange,
}: CardSetupPanelProps) {
  const { control } = useFormContext<FormValues>();
  const verifiedKeys = useMemo(
    () => new Set(verifiedFrameKeys),
    [verifiedFrameKeys],
  );
  const choices = useMemo(
    () => framesForKind(kind, verifiedKeys),
    [kind, verifiedKeys],
  );
  const colorKey = pickFrameColorKey(colorIdentity);

  const kindOptions: ChipOption<CardKind>[] = CARD_KIND_VALUES.map((k) => {
    // A kind is pickable only when at least one of its frames has a
    // published color — otherwise selecting the type would bypass the
    // verification gate and land on an unreviewed frame.
    const available = k === kind || kindHasAvailableFrame(k, verifiedKeys);
    return {
      value: k,
      label: KIND_DEFS[k].label,
      description: available ? KIND_HINTS[k] : "Frames awaiting verification",
      leading: (
        <FrameThumb
          template={KIND_DEFS[k].previewTemplate}
          colorKey={colorKey}
        />
      ),
      disabled: !available,
      badge: available ? undefined : <SoonBadge />,
    };
  });

  const colorSummary = (() => {
    const c =
      colorIdentity.length > 1
        ? "multicolor"
        : colorIdentity[0] ?? "colorless";
    return c[0].toUpperCase() + c.slice(1);
  })();

  return (
    <div className="flex flex-col gap-3">
      {/* 1 · Card type — one combined list; layouts are just more types. */}
      <SetupSection title="Card type" value={KIND_DEFS[kind].label}>
        <ChipGroup
          ariaLabel="Card type"
          layout="grid-2"
          size="md"
          value={kind}
          onChange={onKindSelect}
          options={kindOptions}
        />
      </SetupSection>

      {/* 2 · Frame (border eras + layouts) and 3 · Variations (skins +
          showcase treatments of the chosen frame). One stored value —
          frame_style.template — drives both: the Frame section highlights
          the template's BASE (baseFrameFor), the Variations section owns
          the difference. Picking a frame writes the base itself, so the
          variation resets to Standard by construction. */}
      <Controller
        control={control}
        name="frame_style.template"
        render={({ field }) => {
          const template = (field.value ??
            DEFAULT_FRAME_TEMPLATE) as FrameTemplate;
          const normalized = normalizeFrameTemplate(template);
          const base = baseFrameFor(kind, normalized);

          // Split the availability universe: standards + layouts belong to
          // the Frame section; skins + showcase are variations of the base.
          const frameChoices = choices.filter(
            (c) => c.group === "standard" || c.group === "layout",
          );
          const skinChoices = choices.filter(
            (c) =>
              c.group === "skin" &&
              (TEMPLATE_SKIN_VARIANTS[base] ?? []).includes(c.template),
          );
          const showcaseChoices = choices.filter(
            (c) => c.group === "showcase",
          );
          const variationChoices = [...skinChoices, ...showcaseChoices];

          const frameSummary =
            eraForTemplate(base) === "showcase"
              ? FRAME_TEMPLATE_LABELS[base]
              : `${FRAME_ERA_LABELS[eraForTemplate(base)]} — ${FRAME_TEMPLATE_LABELS[base]}`;
          const variationSummary =
            normalized === base
              ? "Standard"
              : eraForTemplate(normalized) === "showcase"
                ? `${FRAME_SET_LABELS[FRAME_TEMPLATE_SET[normalized]]} — ${FRAME_TEMPLATE_LABELS[normalized]}`
                : FRAME_TEMPLATE_LABELS[normalized];

          // Group the frame list into era sections, preserving order.
          const byEra = new Map<FrameEra, FrameChoice[]>();
          for (const choice of frameChoices) {
            const list = byEra.get(choice.era) ?? [];
            list.push(choice);
            byEra.set(choice.era, list);
          }

          // A saved template NOTHING offers for this kind (old-bug
          // artifacts, withdrawn combos): pin it visibly instead of
          // silently swapping it out from under the card.
          const isLegacyPin = !choices.some((c) => c.template === normalized);

          const toOption = (
            choice: FrameChoice,
          ): ChipOption<FrameTemplate> => {
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
                  : choice.group === "skin"
                    ? "Same layout, different dress"
                    : undefined,
              leading: (
                <FrameThumb
                  template={choice.template}
                  colorKey={
                    colorAvailable
                      ? colorKey
                      : choice.availableColorKeys[0] ?? colorKey
                  }
                />
              ),
              disabled: !available,
              badge: available ? undefined : <SoonBadge />,
            };
          };

          // The Standard chip = the base frame itself.
          const standardOption: ChipOption<FrameTemplate> = {
            value: base,
            label: "Standard",
            description: `The plain ${FRAME_TEMPLATE_LABELS[base]} frame`,
            leading: <FrameThumb template={base} colorKey={colorKey} />,
          };

          return (
            <>
              <SetupSection title="Frame" value={frameSummary}>
                {isLegacyPin ? (
                  <ChipGroup
                    ariaLabel="Current frame"
                    layout="grid-2"
                    size="md"
                    value={normalized}
                    onChange={field.onChange}
                    options={[
                      {
                        value: normalized,
                        label: FRAME_TEMPLATE_LABELS[normalized],
                        description:
                          "Saved on this card; it stays until you pick another.",
                        leading: (
                          <FrameThumb
                            template={normalized}
                            colorKey={colorKey}
                          />
                        ),
                      },
                    ]}
                  />
                ) : null}
                {FRAME_ERA_VALUES.filter((era) => byEra.has(era)).map(
                  (era) => (
                    <div key={era} className="flex flex-col gap-2">
                      <span className="text-[11px] uppercase tracking-wider text-subtle">
                        {FRAME_ERA_LABELS[era]} · {FRAME_ERA_HINTS[era]}
                      </span>
                      <ChipGroup
                        ariaLabel={`${FRAME_ERA_LABELS[era]} frames`}
                        layout="grid-2"
                        size="md"
                        value={base}
                        onChange={field.onChange}
                        options={byEra.get(era)!.map(toOption)}
                      />
                    </div>
                  ),
                )}
                {COMING_SOON_ERAS.length > 0 ? (
                  <p className="text-[11px] text-subtle">
                    Coming soon:{" "}
                    {COMING_SOON_ERAS.map(
                      (e) => `${e.label} — ${e.hint}`,
                    ).join(" · ")}
                  </p>
                ) : null}
              </SetupSection>

              {variationChoices.length > 0 ? (
                <SetupSection title="Variations" value={variationSummary}>
                  <ChipGroup
                    ariaLabel="Frame variations"
                    layout="grid-2"
                    size="md"
                    value={normalized}
                    onChange={field.onChange}
                    options={[
                      standardOption,
                      ...variationChoices.map(toOption),
                    ]}
                  />
                </SetupSection>
              ) : null}
            </>
          );
        }}
      />

      {/* 3 · Color — last on purpose (pure PNG swap; never moves layout). */}
      <Controller
        control={control}
        name="color_identity"
        render={({ field }) => (
          <ColorSection
            summary={colorSummary}
            selection={(field.value ?? []) as ColorIdentity[]}
            onChange={(next) => {
              field.onChange(next);
              onColorIdentityChange?.(next);
            }}
            verifiedKeys={verifiedKeys}
          />
        )}
      />
    </div>
  );
}

function ColorSection({
  summary,
  selection,
  onChange,
  verifiedKeys,
}: {
  summary: string;
  selection: ColorIdentity[];
  onChange: (next: ColorIdentity[]) => void;
  verifiedKeys: ReadonlySet<string>;
}) {
  // Live template so chip availability + thumbnails track frame changes.
  const { watch } = useFormContext<FormValues>();
  const template = normalizeFrameTemplate(watch("frame_style.template"));
  const currentKey = pickFrameColorKey(selection);
  const currentAvailable = isFrameComboAvailable(
    template,
    currentKey,
    verifiedKeys,
  );

  // SINGLE-select: a card wears exactly one frame dress, so the picker is
  // one chip per dress — a gold card is the "Multicolor" chip, not a stack
  // of color toggles. (Legacy multi-value identities display as Multicolor,
  // which IS the frame they render with.)
  const selected: ColorIdentity =
    selection.length > 1 ? "multicolor" : selection[0] ?? "colorless";

  const options: ChipOption<ColorIdentity>[] = COLOR_IDENTITY_VALUES.map(
    (color) => {
      const reachable = isFrameComboAvailable(
        template,
        IDENTITY_COLOR_KEY[color],
        verifiedKeys,
      );
      return {
        value: color,
        label: color,
        leading: (
          <FrameThumb template={template} colorKey={IDENTITY_COLOR_KEY[color]} />
        ),
        disabled: !reachable,
        badge: reachable ? undefined : <SoonBadge />,
        activeClass: "border-foreground/50 bg-elevated text-foreground",
      };
    },
  );

  return (
    <SetupSection title="Color" value={summary}>
      <ChipGroup
        ariaLabel="Color identity"
        layout="grid-2"
        size="md"
        value={selected}
        onChange={(color) => onChange([color])}
        options={options}
      />
      {!currentAvailable ? (
        <p className="text-[11px] text-subtle" role="status">
          This frame isn&apos;t verified in the selected color yet — pick an
          available color, or a different frame above.
        </p>
      ) : null}
    </SetupSection>
  );
}
