"use client";

// The collector line's switches (TODO 4.9b) and the holofoil stamp's (TODO
// 4.9c) on the Set & collector info step — ADDITIONS, opt-in per card (owner
// rule 2026-09-29, lib/cards/anatomy.ts): a new card starts with the line on
// in today's printed style ("2023") and the stamp on "auto" (the oval on a
// rare or mythic); a stored card from before either shows it OFF with a
// one-line hint until its owner switches it on — the line then in the 2015
// style when its number carries a set size (a 2015-era import's "107/281"),
// else the 2023 style (collectorStyleForNumber), the stamp on "auto"; an
// explicit "off" / "none" shows no hint. The style chip swaps the two
// printed styles; the ★ switch prints a foil-only printing's star between
// the set code and the language (owner 2026-09-29: a separate flag, no
// sheen, free for every plan — a Foil finish prints it too). The stamp's
// chips: "Auto" (rares and mythics), "Always" (the frame's own shape),
// "Never". Shown only where the template has the slot (COLLECTOR_TEMPLATES)
// and, for the stamp, the notch (frameAnatomyOf(template).stamp) — never
// on a token or an emblem (STAMPLESS_CARD_TYPES); elsewhere the frame
// prints its own footer.

import { useFormContext, useWatch } from "react-hook-form";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { ANATOMY_HINTS, COLLECTOR_ONLY_HINT, SwitchRow } from "@/components/creator/panels/anatomy-panel";
import { frameAnatomyOf, resolveHoloStamp, twoColorPairOf } from "@/lib/cards/anatomy";
import {
  collectorLetter,
  collectorNumberRuns,
  collectorStyleForNumber,
  isCollectorStyle,
  type CollectorStyle,
} from "@/lib/cards/collector-line";
import { holoStampWanted, isHoloStampSwitch, offersHoloStampForType, type HoloStampSwitch } from "@/lib/cards/holo-stamp";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import type { FormValues } from "@/lib/creator/form-types";
import type { ColorIdentity, FrameStyle } from "@/types/card";

/** What a frame without the slot says instead of the switch. */
export const NO_COLLECTOR_SLOT_NOTE = "This frame prints its own footer. The collector line comes to it in a later release.";

/** Shown under the ★ switch while the card's finish is Foil. */
export const FOIL_FINISH_STAR_NOTE = "A Foil or Etched finish prints the ★ already.";

/** Shown under the stamp switch while the card draws its two-colour frame
 *  (TODO 4.9c, wave 1): the pair masters have no notch yet. */
export const TWO_COLOUR_STAMP_NOTE = "The two-colour frame has no stamp notch yet, so this card prints no stamp until it does.";

/** The stamp's chips (lib/cards/holo-stamp.ts): "Always" writes the frame's
 *  own shape — the oval on every wave-1 frame. */
export function holoStampChipOptions(shape: "oval" | "triangle"): ChipOption<HoloStampSwitch>[] {
  return [
    { value: "auto", label: "Auto: rares & mythics" },
    { value: shape, label: "Always" },
    { value: "none", label: "Never" },
  ];
}

/** The live answer under the chips: what the card draws now. */
export function holoStampAnswer(stamp: unknown, card: { cardType?: string | null; rarity?: string | null }): string {
  const rarity = (card.rarity ?? "").trim();
  const label = rarity ? rarity.charAt(0).toUpperCase() + rarity.slice(1) : "No rarity";
  return holoStampWanted(stamp, card) ? `${label} → stamp` : `${label} → no stamp`;
}

/** Each style's example line 1 for the chips, from the card's own letter
 *  and number ("R 0040" / "040/281 R"), a sample number when it has none. */
export function collectorStyleExamples(card: {
  cardType?: string | null;
  supertype?: string | null;
  rarity?: string | null;
  collectorNumber?: string | null;
}): Record<CollectorStyle, string> {
  const letter = collectorLetter(card) ?? "R";
  const number = (card.collectorNumber ?? "").trim() || "40/281";
  const text = (style: CollectorStyle) =>
    collectorNumberRuns(number, style)
      .map((run) => (run.kind === "text" ? run.text : "★"))
      .join("");
  return {
    "2023": `${letter} ${text("2023")}`,
    "2015": `${text("2015")} ${letter}`,
  };
}

/**
 * The collector line's switch, its style chips, the ★ switch and the
 * holofoil stamp's switch with its chips. `stored` is the saved card's frame
 * style when EDITING it (a hint shows while it names no `collector`, and
 * under the stamp while it names no `stamp`); null for a new card or a
 * remix.
 */
export function CollectorSwitches({ stored = null }: { stored?: FrameStyle | null }) {
  const { control, setValue } = useFormContext<FormValues>();
  const [template, collector, star, stamp, twoColor, finish, cardType, supertype, rarity, collectorNumber, colorIdentity, cost] = useWatch({
    control,
    name: [
      "frame_style.template",
      "frame_style.collector",
      "frame_style.star",
      "frame_style.stamp",
      "frame_style.twoColor",
      "frame_style.finish",
      "card_type",
      "supertype",
      "rarity",
      "collector_number",
      "color_identity",
      "cost",
    ],
  });
  const anatomy = frameAnatomyOf(template);
  if (!anatomy.collector) {
    return (
      <p className="text-xs leading-5 text-muted" data-testid="collector-no-slot">
        {NO_COLLECTOR_SLOT_NOTE}
      </p>
    );
  }
  const on = isCollectorStyle(collector);
  const editing = stored !== null;
  // The stamp's control: the frame has the notch and the card's type prints
  // one (never a token or an emblem).
  const showStamp = anatomy.stamp && offersHoloStampForType(cardType);
  // Honest about what the switch adds: the stamp only where it is offered.
  const collectorHint =
    editing && !on && stored?.collector === undefined ? (showStamp ? (ANATOMY_HINTS.collector ?? null) : COLLECTOR_ONLY_HINT) : null;
  const examples = collectorStyleExamples({ cardType, supertype, rarity, collectorNumber });
  const styleOptions: ChipOption<CollectorStyle>[] = [
    { value: "2023", label: `Current (${examples["2023"]})` },
    { value: "2015", label: `2015–2022 (${examples["2015"]})` },
  ];
  // The stamp as the renderers resolve it for this card (the notch for the
  // master drawn: none on its pair master in wave 1).
  const profile = getFrameProfile(template);
  const colors = (colorIdentity ?? []) as ColorIdentity[];
  const stampOn = showStamp && holoStampWanted(stamp, { cardType, rarity });
  const resolved = showStamp
    ? resolveHoloStamp(
        profile,
        { stamp, twoColor },
        { colors, cost, cardType, supertype, rarity, colorKey: pickFrameColorKey(colors) },
      )
    : null;
  const pairDrawn = stampOn && resolved === null && twoColor === true && twoColorPairOf(colors) !== null;
  // The hint while the stored card names no stamp and the form still
  // holds none (a click on the switch or a chip sets a value and hides it).
  const stampHint = showStamp && editing && stored?.stamp === undefined && !isHoloStampSwitch(stamp) ? (ANATOMY_HINTS.stamp ?? null) : null;
  const shape = (profile.overlays ?? []).find((slot) => slot.anatomy === "holoStamp")?.stamp.shape ?? "oval";
  return (
    <div className="flex flex-col gap-3" data-testid="collector-switches">
      <SwitchRow
        anatomy="collector"
        on={on}
        hint={collectorHint}
        onToggle={(next) =>
          setValue("frame_style.collector", next ? collectorStyleForNumber(collectorNumber) : "off", { shouldDirty: true })
        }
      >
        {on ? (
          <div className="flex flex-col gap-2" data-testid="collector-style">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Style</span>
            <ChipGroup
              ariaLabel="Collector line style"
              layout="wrap"
              size="sm"
              value={collector as CollectorStyle}
              onChange={(next) => setValue("frame_style.collector", next, { shouldDirty: true })}
              options={styleOptions}
            />
          </div>
        ) : null}
      </SwitchRow>
      {on ? (
        <SwitchRow
          anatomy="star"
          on={star === true}
          hint={null}
          onToggle={(next) => setValue("frame_style.star", next ? true : undefined, { shouldDirty: true })}
        >
          {finish === "foil" || finish === "etched" ? (
            <p className="text-xs leading-5 text-muted" data-testid="collector-foil-note">
              {FOIL_FINISH_STAR_NOTE}
            </p>
          ) : null}
        </SwitchRow>
      ) : null}
      {showStamp ? (
        <SwitchRow
          anatomy="stamp"
          on={stampOn}
          hint={stampHint}
          onToggle={(next) => setValue("frame_style.stamp", next ? "auto" : "none", { shouldDirty: true })}
        >
          <div className="flex flex-col gap-2" data-testid="stamp-rule">
            <ChipGroup
              ariaLabel="Holofoil stamp"
              layout="wrap"
              size="sm"
              value={(stamp as HoloStampSwitch | undefined) ?? "none"}
              onChange={(next) => setValue("frame_style.stamp", next, { shouldDirty: true })}
              options={holoStampChipOptions(shape)}
            />
            <p className="text-[11px] leading-4 text-subtle" data-testid="stamp-answer">
              {holoStampAnswer(stamp, { cardType, rarity })}
            </p>
            {pairDrawn ? (
              <p className="text-xs leading-5 text-muted" data-testid="stamp-pair-note">
                {TWO_COLOUR_STAMP_NOTE}
              </p>
            ) : null}
          </div>
        </SwitchRow>
      ) : null}
    </div>
  );
}
