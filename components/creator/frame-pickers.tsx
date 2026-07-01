"use client";

// Frame-picker building blocks for the card creator's Frame step: the numbered
// sub-step label, the frame thumbnail chip art, and the two era-scoped pickers
// (border eras vs. the showcase set→treatment two-stage). Extracted from
// card-creator-form.tsx.

import {
  ChipGroup,
  type ChipOption,
} from "@/components/ui/chip-group";
import {
  type CardType,
  type FrameEra,
  type FrameSet,
  type FrameTemplate,
  ERA_SPECIAL_LAYOUTS,
  FRAME_SET_DEFAULT_TEMPLATE,
  FRAME_SET_ERA,
  FRAME_SET_LABELS,
  FRAME_SET_VALUES,
  FRAME_TEMPLATE_LABELS,
  FRAME_TEMPLATE_SET,
  FRAME_TEMPLATE_VALUES,
} from "@/types/card";
import { standardFrameFor } from "@/lib/creator/frame-picker";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { cn } from "@/lib/utils";

// How many shippable frames each set holds — surfaced on the showcase set chip
// so a set reads as a *family* of frames, not a single style. Derived from the
// template→set map so it stays correct as frames are added.
const FRAMES_PER_SET = FRAME_TEMPLATE_VALUES.reduce(
  (acc, template) => {
    const set = FRAME_TEMPLATE_SET[template];
    acc[set] = (acc[set] ?? 0) + 1;
    return acc;
  },
  {} as Record<FrameSet, number>,
);

// Small "Soon" pill for frames/layouts that aren't shippable yet.
function SoonBadge() {
  return (
    <span className="rounded-full border border-border/70 bg-elevated px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-subtle">
      Soon
    </span>
  );
}

// A numbered sub-step heading for the two-stage frame picker: a small index
// badge, a title, an optional muted context line (the active set name), and a
// right-aligned count. Makes "first a set, then a frame within it" legible.
export function PickerStepLabel({
  n,
  title,
  aside,
  count,
}: {
  n: number;
  title: string;
  aside?: string;
  count?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wider text-subtle">
        <span
          aria-hidden
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-elevated/60 text-[10px] text-foreground"
        >
          {n}
        </span>
        <span className="shrink-0">{title}</span>
        {aside ? (
          <span className="truncate font-normal normal-case tracking-normal text-muted">
            · {aside}
          </span>
        ) : null}
      </span>
      {count ? (
        <span className="shrink-0 text-[11px] text-muted">{count}</span>
      ) : null}
    </div>
  );
}

export function FrameThumb({
  template,
  colorKey = "u",
}: {
  template: FrameTemplate;
  /** Frame color variant to preview. Defaults to blue (representative) for the
   *  static module-level chips; the in-step picker passes the card's live color
   *  so the thumbnails match what the user will get. */
  colorKey?: string;
}) {
  const landscape = getFrameProfile(template).orientation === "landscape";
  return (
    <span
      aria-hidden
      className={cn(
        "block shrink-0 overflow-hidden rounded-[3px] border border-border/60 bg-[#101015] bg-cover bg-center",
        landscape ? "h-7 w-10" : "h-10 w-[29px]",
      )}
      style={{ backgroundImage: `url(/frames/${template}/${colorKey}.png)` }}
    />
  );
}

// Border-era frame picker (Classic / M15): the type-derived standard frame as a
// single chip, plus an optional "Special layouts" row (Saga, Adventure, Split,
// Flip, Aftermath, Snow, Devoid for M15) that overrides it. Both chip groups
// bind to the same template value, so exactly one shows as selected.
export function BorderEraFramePicker({
  era,
  cardType,
  template,
  colorKey,
  onChange,
}: {
  era: FrameEra;
  cardType: CardType | "";
  template: FrameTemplate;
  colorKey: string;
  onChange: (next: FrameTemplate) => void;
}) {
  const standard =
    standardFrameFor(era, cardType) ?? standardFrameFor("m15", cardType);
  const specials = ERA_SPECIAL_LAYOUTS[era];
  const standardOptions: ChipOption<FrameTemplate>[] = standard
    ? [
        {
          value: standard,
          label: FRAME_TEMPLATE_LABELS[standard],
          description: "The standard frame for this card type",
          leading: <FrameThumb template={standard} colorKey={colorKey} />,
        },
      ]
    : [];
  return (
    <div className="flex flex-col gap-3">
      <ChipGroup
        ariaLabel="Standard frame"
        layout="grid-2"
        size="md"
        value={template}
        onChange={onChange}
        options={standardOptions}
      />
      {specials.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-wider text-subtle">
            Special layouts — replace the standard frame
          </span>
          <ChipGroup
            ariaLabel="Special layouts"
            layout="grid-2"
            size="md"
            value={template}
            onChange={onChange}
            options={specials.map((t) => {
              // Every M15 special layout is gated for now (alignment WIP) —
              // only the standard M15 frame ships. Saga stays gated in any era.
              const comingSoon = era === "m15" || t === "saga";
              return {
                value: t,
                label: FRAME_TEMPLATE_LABELS[t],
                leading: <FrameThumb template={t} colorKey={colorKey} />,
                disabled: comingSoon,
                badge: comingSoon ? <SoonBadge /> : undefined,
              };
            })}
          />
        </div>
      ) : null}
      <p className="text-[11px] text-subtle">More frames coming soon.</p>
    </div>
  );
}

// Showcase & Universes Beyond picker: the existing set → treatment two-stage,
// scoped to the showcase IP families (LOTR / Avatar / Bloomburrow / Tarkir).
export function ShowcaseFramePicker({
  activeSet,
  template,
  colorKey,
  onChange,
}: {
  activeSet: FrameSet;
  template: FrameTemplate;
  colorKey: string;
  onChange: (next: FrameTemplate) => void;
}) {
  const showcaseSets = FRAME_SET_VALUES.filter(
    (s) => FRAME_SET_ERA[s] === "showcase",
  );
  const setOptions: ChipOption<FrameSet>[] = showcaseSets.map((set) => ({
    value: set,
    label: FRAME_SET_LABELS[set],
    description: `${FRAMES_PER_SET[set]} frame${FRAMES_PER_SET[set] === 1 ? "" : "s"}`,
    leading: (
      <FrameThumb
        template={FRAME_SET_DEFAULT_TEMPLATE[set]}
        colorKey={colorKey}
      />
    ),
  }));
  const treatments: ChipOption<FrameTemplate>[] = FRAME_TEMPLATE_VALUES.filter(
    (t) => FRAME_TEMPLATE_SET[t] === activeSet,
  ).map((t) => ({
    value: t,
    label: FRAME_TEMPLATE_LABELS[t],
    leading: <FrameThumb template={t} colorKey={colorKey} />,
  }));
  return (
    <div className="flex flex-col gap-3">
      <ChipGroup
        ariaLabel="Showcase set"
        layout="grid-2"
        size="md"
        value={activeSet}
        onChange={(nextSet) => {
          if (nextSet !== activeSet) {
            onChange(FRAME_SET_DEFAULT_TEMPLATE[nextSet]);
          }
        }}
        options={setOptions}
      />
      {treatments.length > 1 ? (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-wider text-subtle">
            Treatment · {FRAME_SET_LABELS[activeSet]}
          </span>
          <ChipGroup
            ariaLabel={`Treatments in ${FRAME_SET_LABELS[activeSet]}`}
            layout="grid-2"
            size="md"
            value={template}
            onChange={onChange}
            options={treatments}
          />
        </div>
      ) : null}
    </div>
  );
}
