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
import { Controller, useFormContext, useFormState, useWatch } from "react-hook-form";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import {
  LandModeChips,
  landModeLabel,
  type LandMode,
} from "@/components/creator/panels/land-mode-panel";
import {
  colorIdentityForKey,
  colorWord,
  pickFrameColorKey,
  type FrameTypeInfo,
} from "@/components/cards/frame-layer";
import {
  describeFrame,
  resolvePublishedFrame,
  setQualifiedFrameLabel,
} from "@/lib/creator/frame-resolve";
import {
  FrameThumb,
  SoonBadge,
} from "@/components/creator/frame-pickers";
import {
  BASIC_ONLY_FRAME_REASON,
  CARD_KIND_VALUES,
  KIND_DEFS,
  baseFrameFor,
  framesForKind,
  isSingleBasicLand,
  kindHasAvailableFrame,
  templateIsBasicOnly,
  type CardKind,
  type FrameChoice,
  type FrameColorKey,
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
  type ColorIdentity,
  type FrameEra,
  type FrameTemplate,
} from "@/types/card";
import { eraForTemplate } from "@/lib/creator/frame-picker";
import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import { parseSubtypes } from "@/lib/creator/card-fields";
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
  /** Lands only: Basic (big symbol, no text) vs Nonbasic (rules text) —
   *  rendered as the Land kind's first Variation. */
  landMode?: LandMode;
  /** Why "Basic" is unavailable right now (multicolor frame), else null. */
  landBasicDisabledReason?: string | null;
  onLandModeChange?: (next: LandMode) => void;
};

export function CardSetupPanel({
  kind,
  colorIdentity,
  verifiedFrameKeys = [],
  onKindSelect,
  onColorIdentityChange,
  landMode,
  landBasicDisabledReason = null,
  onLandModeChange,
}: CardSetupPanelProps) {
  const { control, setValue, clearErrors } = useFormContext<FormValues>();
  // A server refusal of the frame (verification gate 0.13, kind gate 0.26)
  // lands on frame_style and the wizard jumps here — show it, or the step
  // just turns red with no reason. Any type, frame or colour pick clears it
  // (the server checks again on the next Save).
  const { errors } = useFormState({ control, name: "frame_style" });
  const frameError =
    errors.frame_style?.message ?? errors.frame_style?.template?.message;
  const verifiedKeys = useMemo(
    () => new Set(verifiedFrameKeys),
    [verifiedFrameKeys],
  );
  const choices = useMemo(
    () => framesForKind(kind, verifiedKeys),
    [kind, verifiedKeys],
  );
  const colorKey = pickFrameColorKey(colorIdentity);
  // Basic-only frames (the full-art basic land) can't draw a nonbasic's
  // rules, so their chips are disabled unless the card IS one basic land —
  // the same rule the renderers and the server gate read.
  const [cardType, title, supertype, subtypesText, rulesText] = useWatch({
    control,
    name: ["card_type", "title", "supertype", "subtypes_text", "rules_text"],
  });
  const isBasicLand = isSingleBasicLand({
    cardType,
    supertype,
    subtypes: parseSubtypes(subtypesText ?? ""),
    title,
    rulesText,
  });
  // The card's type, for the tiles of a frame that dresses a colour by type
  // (Alpha's colourless artifact paints the brown artifact card).
  const frameType: FrameTypeInfo = { cardType, supertype };

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
          colorIdentity={colorIdentity}
          type={{ cardType: KIND_DEFS[k].cardType }}
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
      {frameError ? (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-foreground"
          data-testid="frame-error"
        >
          {frameError}
        </p>
      ) : null}
      {/* 1 · Card type — one combined list; layouts are just more types. */}
      <SetupSection title="Card type" value={KIND_DEFS[kind].label}>
        <ChipGroup
          ariaLabel="Card type"
          layout="grid-2"
          size="md"
          value={kind}
          onChange={(next) => {
            clearErrors("frame_style");
            onKindSelect(next);
          }}
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
          const frameVariationSummary =
            normalized === base
              ? "Standard"
              : eraForTemplate(normalized) === "showcase"
                ? setQualifiedFrameLabel(normalized)
                : FRAME_TEMPLATE_LABELS[normalized];
          // Lands lead their Variations with Basic vs Nonbasic — the choice
          // that decides whether the card prints a big symbol or rules text.
          const showLandMode =
            kind === "land" && landMode !== undefined && Boolean(onLandModeChange);
          const variationSummary = showLandMode
            ? normalized === base
              ? landModeLabel(landMode as LandMode)
              : `${landModeLabel(landMode as LandMode)} · ${frameVariationSummary}`
            : frameVariationSummary;

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

          // Picking a tile: the FRAME is what the user meant, so when it
          // isn't published in the current colour the colour follows the
          // frame (to its first published colour) and a toast says so. The
          // form never holds an unpublished (frame, colour) pair — the
          // server refuses to save one.
          const pickFrame = (next: FrameTemplate) => {
            const resolution = resolvePublishedFrame({
              kind,
              candidates: [next],
              colorKey: colorKey as FrameColorKey,
              verifiedKeys,
              prefer: "colour",
            });
            if (resolution.status === "unavailable") return;
            field.onChange(resolution.template);
            clearErrors("frame_style");
            if (resolution.status === "colour-switched") {
              const identity = colorIdentityForKey(resolution.colorKey);
              setValue("color_identity", [identity], { shouldDirty: true });
              onColorIdentityChange?.([identity]);
              toast.info(
                `${describeFrame(next)} isn't verified in ${colorWord(resolution.fromColorKey)} yet — switched the colour to ${colorWord(resolution.colorKey)}.`,
              );
            } else if (resolution.status === "frame-switched") {
              toast.info(
                `${describeFrame(next)} isn't verified yet — using ${describeFrame(resolution.template)}.`,
              );
            }
          };

          const toOption = (
            choice: FrameChoice,
          ): ChipOption<FrameTemplate> => {
            const available = choice.availableColorKeys.length > 0;
            const isShowcase = choice.group === "showcase";
            const label = isShowcase
              ? setQualifiedFrameLabel(choice.template)
              : FRAME_TEMPLATE_LABELS[choice.template];
            const colorAvailable = isFrameComboAvailable(
              choice.template,
              colorKey,
              verifiedKeys,
            );
            const basicOnlyRefused =
              templateIsBasicOnly(choice.template) && !isBasicLand;
            return {
              value: choice.template,
              label,
              description: basicOnlyRefused
                ? BASIC_ONLY_FRAME_REASON
                : !available
                  ? "Awaiting verification"
                  : !colorAvailable
                    ? `Not verified in ${colorWord(colorKey)} yet — picking it switches to ${colorWord(choice.availableColorKeys[0])}`
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
                  colorIdentity={colorIdentity}
                  type={frameType}
                />
              ),
              disabled: !available || basicOnlyRefused,
              badge: available ? undefined : <SoonBadge />,
            };
          };

          // The Standard chip = the base frame itself.
          const standardOption: ChipOption<FrameTemplate> = {
            value: base,
            label: "Standard",
            description: `The plain ${FRAME_TEMPLATE_LABELS[base]} frame`,
            leading: (
              <FrameThumb
                template={base}
                colorKey={colorKey}
                colorIdentity={colorIdentity}
                type={frameType}
              />
            ),
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
                            colorIdentity={colorIdentity}
                            type={frameType}
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
                        onChange={pickFrame}
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

              {showLandMode || variationChoices.length > 0 ? (
                <SetupSection title="Variations" value={variationSummary}>
                  <div className="flex flex-col gap-4">
                    {showLandMode ? (
                      <div className="flex flex-col gap-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                          Land type
                        </p>
                        <LandModeChips
                          mode={landMode as LandMode}
                          basicDisabledReason={landBasicDisabledReason}
                          onChange={onLandModeChange!}
                        />
                        <p className="text-[11px] leading-4 text-subtle">
                          {landMode === "basic"
                            ? "Basic lands print the big mana symbol and no rules text."
                            : "Nonbasic lands print rules text on the Text & stats step."}
                        </p>
                      </div>
                    ) : null}
                    {variationChoices.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        {showLandMode ? (
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                            Frame
                          </p>
                        ) : null}
                        <ChipGroup
                          ariaLabel="Frame variations"
                          layout="grid-2"
                          size="md"
                          value={normalized}
                          onChange={pickFrame}
                          options={[
                            standardOption,
                            ...variationChoices.map(toOption),
                          ]}
                        />
                      </div>
                    ) : null}
                  </div>
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
              clearErrors("frame_style");
              onColorIdentityChange?.(next);
            }}
            verifiedKeys={verifiedKeys}
            frameType={frameType}
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
  frameType,
}: {
  summary: string;
  selection: ColorIdentity[];
  onChange: (next: ColorIdentity[]) => void;
  verifiedKeys: ReadonlySet<string>;
  /** The card's type: each colour tile shows the master the card would
   *  paint in that colour (Alpha's colourless tile: the artifact card for an
   *  artifact, the grey card otherwise). */
  frameType: FrameTypeInfo;
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
  // of color toggles. (Legacy multi-value identities select the Multicolor
  // chip. Most frames render them with the gold "m" dress, but a split-frame
  // template such as Dragon Wing (FrameProfile.twoColorSplit) renders a
  // two-colour identity as split wings, and only FrameThumb tiles that show
  // the card's own colour reflect that. Picking the Multicolor chip gives the
  // gold dress.)
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
          <FrameThumb template={template} colorKey={IDENTITY_COLOR_KEY[color]} type={frameType} />
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
