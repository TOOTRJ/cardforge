"use client";

// The anatomy switches (TODO 4.6.0) — the printed legendary crown (4.6a)
// and the two-colour frame (4.6b). Both are ADDITIONS, opt-in per card
// (owner rule 2026-09-29, lib/cards/anatomy.ts): a new card starts with the
// switch on, a stored card shows it OFF — with a one-line hint while its
// owner has never set it — and nothing changes until the owner turns it on.
// A switch shows only where it can draw something: the template draws the
// piece (its PROFILES entry declares it) and the card qualifies (Legendary
// for the crown; a multicolour card for the two-colour frame). Both draw on
// the m15 / m15artifact / m15land PROFILES entries: the crown (4.6a) and the
// two-colour pair masters (4.6b).
//
// The two-colour frame needs the card's colour PAIR (color_identity): the
// "Two colours" row (TwoColorPairRow) — under the Multicolor chip on the
// Card step for a new card, and here, pre-filled from the cost, when the
// owner of a stored multicolour card switches the frame on (owner decision
// 2026-09-29: never derived at render, never a silent re-colour).

import { useCallback, useEffect, useRef, useState } from "react";
import { useFormContext, useWatch, type UseFormReturn } from "react-hook-form";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { cn } from "@/lib/utils";
import {
  frameAnatomyOf,
  pairColorIdentity,
  qualifiesForCrown,
  twoColorDressOf,
  twoColorFromCost,
  twoColorPairOf,
  type FrameAnatomyKey,
  type TwoColorPair,
} from "@/lib/cards/anatomy";
import type { FormValues } from "@/lib/creator/form-types";
import type { ColorIdentity, FrameStyle } from "@/types/card";

/** The one-line hint a stored card shows beside a switch its owner has never
 *  set (owner decision 2026-09-29: the switch and a /news post, never a
 *  badge or a notification). */
export const ANATOMY_HINTS: Record<FrameAnatomyKey, string> = {
  crown: "New: the printed legendary crown. Switch it on to add it.",
  twoColor: "New: the printed two-colour frame. Switch it on to add it.",
};

const ANATOMY_COPY: Record<FrameAnatomyKey, { label: string; help: string }> = {
  crown: {
    label: "Legendary crown",
    help: "The crown printed on legendary cards since 2018. Legendary cards printed before 2018 have no crown.",
  },
  twoColor: {
    label: "Two-colour frame",
    help: "The frame printed in the card's two colours. A cost made only of hybrid pips gets the hybrid frame.",
  },
};

/** Shown under the two-colour switch when the card's cost asks for the
 *  hybrid dress on a frame that has none (m15artifact: no hybrid P/T plate
 *  yet, TODO 4.6b) — the render falls back to the gold-split pair master
 *  (lib/cards/anatomy.ts resolveTwoColor), and the owner should know why. */
export const HYBRID_FALLBACK_NOTE =
  "This frame has no hybrid version yet, so an all-hybrid cost gets the gold two-colour frame.";

const PAIR_COLORS = ["white", "blue", "black", "red", "green"] as const;
type PairColor = (typeof PAIR_COLORS)[number];

/** True for a multicolour identity that names no colour or exactly the pair
 *  it holds — the cards the two-colour frame is for. */
export function isMulticolourIdentity(colors: readonly ColorIdentity[]): boolean {
  return colors.length > 1 || colors[0] === "multicolor";
}

/**
 * A NEW card's pair follows its cost (create and remix; owner decision
 * 2026-09-29: "pre-filled from the cost's pips"): while the card is plain
 * "multicolor" — or holds the pair this hook filled in — on a template that
 * draws the two-colour frame, a cost spanning exactly two colours fills the
 * pair, and a cost that stops spanning them takes it out again. A pick in the
 * "Two colours" row (the returned `markTouched`) or any other colour ends
 * it. The fill is not an edit of the user's (no dirty flag). Called by the
 * form itself (it takes the form's methods: it runs above the provider),
 * so it follows the cost on every step. Disabled for a
 * stored card's edit: there the pair is filled only when its owner switches
 * the two-colour frame on (AnatomyPanel).
 */
export function useTwoColorPairFollow(
  form: Pick<UseFormReturn<FormValues>, "control" | "setValue">,
  enabled: boolean,
): () => void {
  const { control, setValue } = form;
  const [template, cost, colorIdentity] = useWatch({
    control,
    name: ["frame_style.template", "cost", "color_identity"],
  });
  const touched = useRef(false);
  const filled = useRef<TwoColorPair | null>(null);
  useEffect(() => {
    if (!enabled || touched.current) return;
    if (frameAnatomyOf(template).twoColor.length === 0) return;
    const identity = (colorIdentity ?? []) as ColorIdentity[];
    const current = twoColorPairOf(identity);
    const plain = identity.length === 1 && identity[0] === "multicolor";
    if (!plain && !(current !== null && current === filled.current)) return;
    const fromCost = twoColorFromCost(cost);
    if (fromCost && fromCost !== current) {
      filled.current = fromCost;
      setValue("color_identity", pairColorIdentity(fromCost));
    } else if (!fromCost && current !== null) {
      filled.current = null;
      setValue("color_identity", ["multicolor"]);
    }
  }, [enabled, template, cost, colorIdentity, setValue]);
  return useCallback(() => {
    touched.current = true;
  }, []);
}

/**
 * The "Two colours" row: pick the two colours of a multicolour card. Exactly
 * two picked = the card's pair (color_identity, in printed order); fewer =
 * plain "multicolor" (the gold frame) — the one colour picked so far waits
 * here for the second. A third pick is ignored: take one off first.
 */
export function TwoColorPairRow({
  pair,
  onChange,
  help,
}: {
  pair: TwoColorPair | null;
  onChange: (next: TwoColorPair | null) => void;
  help?: string;
}) {
  const [pending, setPending] = useState<PairColor | null>(null);
  const selected: PairColor[] = pair
    ? (pairColorIdentity(pair) as PairColor[])
    : pending
      ? [pending]
      : [];
  const pick = (next: PairColor[]) => {
    if (next.length > 2) return;
    if (next.length === 2) {
      setPending(null);
      onChange(twoColorPairOf(next));
      return;
    }
    setPending(next[0] ?? null);
    if (pair) onChange(null);
  };
  const options: ChipOption<PairColor>[] = PAIR_COLORS.map((color) => ({ value: color, label: color }));
  return (
    <div className="flex flex-col gap-2" data-testid="two-colour-row">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Two colours</span>
      <ChipGroup
        multiSelect
        ariaLabel="Two colours"
        layout="wrap"
        size="sm"
        value={selected}
        onChange={pick}
        options={options}
      />
      <p className="text-[11px] leading-4 text-subtle">
        {help ?? "Pick the card's two colours for the two-colour frame, or none for the gold frame."}
      </p>
    </div>
  );
}

function SwitchRow({
  anatomy,
  on,
  hint,
  onToggle,
  children,
}: {
  anatomy: FrameAnatomyKey;
  on: boolean;
  hint: string | null;
  onToggle: (next: boolean) => void;
  children?: React.ReactNode;
}) {
  const copy = ANATOMY_COPY[anatomy];
  const helpId = `anatomy-${anatomy}-help`;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-elevated/30 px-4 py-3" data-anatomy={anatomy}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">{copy.label}</span>
          <span id={helpId} className="text-xs leading-5 text-muted">
            {copy.help}
          </span>
          {hint ? (
            <span className="text-xs leading-5 text-accent" data-testid={`anatomy-hint-${anatomy}`}>
              {hint}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={copy.label}
          aria-describedby={helpId}
          onClick={() => onToggle(!on)}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            on ? "bg-primary" : "border border-border bg-elevated",
          )}
        >
          <span
            className={cn(
              "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
              on ? "translate-x-[22px]" : "translate-x-0.5",
            )}
          />
        </button>
      </div>
      {children}
    </div>
  );
}

/** The stored card an EDIT starts from (frame_style and colours as saved). */
export type AnatomyStoredCard = {
  frameStyle: FrameStyle | null;
  colorIdentity: readonly ColorIdentity[];
};

/**
 * The switches for `which` pieces, each shown only where it can draw.
 * `stored` is the saved card when EDITING it: a switch its frame_style names
 * no value for shows the hint, and a stored pair is locked like the rest of
 * its colour. Null for a new card or a remix, which start with every switch
 * on (NEW_CARD_ANATOMY).
 */
export function AnatomyPanel({
  which,
  stored = null,
  onPairTouched,
  pairRow = true,
}: {
  which: readonly FrameAnatomyKey[];
  stored?: AnatomyStoredCard | null;
  /** A pick in the "Two colours" row (useTwoColorPairFollow's markTouched). */
  onPairTouched?: () => void;
  /** Show the "Two colours" row under the two-colour switch — for an edit
   *  or a remix, whose Colour step is locked. A new card picks its pair in
   *  the Colour step's own row (card-setup-panel.tsx), so the Card step
   *  passes false. */
  pairRow?: boolean;
}) {
  const { control, setValue } = useFormContext<FormValues>();
  const [template, crown, twoColor, cardType, supertype, cost, colorIdentity] = useWatch({
    control,
    name: [
      "frame_style.template",
      "frame_style.crown",
      "frame_style.twoColor",
      "card_type",
      "supertype",
      "cost",
      "color_identity",
    ],
  });
  const anatomy = frameAnatomyOf(template);
  const colors = (colorIdentity ?? []) as ColorIdentity[];
  const pair = twoColorPairOf(colors);
  const showCrown = which.includes("crown") && anatomy.crown && qualifiesForCrown({ cardType, supertype });
  const showTwoColor =
    which.includes("twoColor") && anatomy.twoColor.length > 0 && isMulticolourIdentity(colors);
  if (!showCrown && !showTwoColor) return null;

  const editing = stored !== null;
  const hintFor = (key: FrameAnatomyKey, on: boolean) =>
    editing && !on && typeof stored?.frameStyle?.[key] !== "boolean" ? ANATOMY_HINTS[key] : null;
  const setSwitch = (key: FrameAnatomyKey, next: boolean) =>
    setValue(`frame_style.${key}`, next, { shouldDirty: true });
  const setPair = (next: TwoColorPair | null) =>
    setValue("color_identity", next ? pairColorIdentity(next) : ["multicolor"], { shouldDirty: true });

  // An all-hybrid cost on a frame with no hybrid dress draws the gold-split
  // pair (resolveTwoColor's fallback): say so under the switch.
  const hybridFallback =
    showTwoColor && twoColorDressOf(cost, cardType) === "hybrid" && !anatomy.twoColor.includes("hybrid");

  // A stored card that already names a pair keeps it: its colours are locked
  // like the rest of its colour. A stored plain-multicolour card gets the
  // row, pre-filled from the cost, once its owner switches the frame on.
  const pairEditable = !editing || twoColorPairOf(stored?.colorIdentity) === null;

  return (
    // A group, not a FieldGroup: that is a <label>, which would name every
    // switch and chip inside it with its caption.
    <div role="group" aria-labelledby="anatomy-panel-heading" className="flex flex-col gap-1.5" data-testid="anatomy-panel">
      <span id="anatomy-panel-heading" className="text-xs font-semibold uppercase tracking-wider text-subtle">
        Printed details
      </span>
      <div className="flex flex-col gap-3">
        {showCrown ? (
          <SwitchRow
            anatomy="crown"
            on={crown === true}
            hint={hintFor("crown", crown === true)}
            onToggle={(next) => setSwitch("crown", next)}
          />
        ) : null}
        {showTwoColor ? (
          <SwitchRow
            anatomy="twoColor"
            on={twoColor === true}
            hint={hintFor("twoColor", twoColor === true)}
            onToggle={(next) => {
              setSwitch("twoColor", next);
              // Switching it on pre-fills a missing pair from the cost for
              // the owner to confirm below (never at render).
              if (next && !pair) {
                const fromCost = twoColorFromCost(cost);
                if (fromCost) setPair(fromCost);
              }
            }}
          >
            {hybridFallback ? (
              <p className="text-xs leading-5 text-muted" data-testid="anatomy-note-twoColor">
                {HYBRID_FALLBACK_NOTE}
              </p>
            ) : null}
            {pairRow && twoColor === true && pairEditable ? (
              <TwoColorPairRow
                pair={pair}
                onChange={(next) => {
                  onPairTouched?.();
                  setPair(next);
                }}
                help={
                  pair
                    ? "Filled in from the mana cost — change it if the card's colours differ."
                    : "Pick the card's two colours to draw the two-colour frame."
                }
              />
            ) : null}
          </SwitchRow>
        ) : null}
      </div>
    </div>
  );
}

