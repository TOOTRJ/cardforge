"use client";

// The collector line's switches (TODO 4.9b) on the Set & collector info step
// — an ADDITION, opt-in per card (owner rule 2026-09-29, lib/cards/
// anatomy.ts): a new card starts with the line on in today's printed style
// ("2023"); a stored card from before the line shows it OFF with the
// one-line hint until its owner switches it on — then in the 2015 style
// when its number carries a set size (a 2015-era import's "107/281"), else
// the 2023 style (collectorStyleForNumber); an explicit "off" shows no
// hint. The style chip swaps the two printed styles; the ★ switch prints a
// foil-only printing's star between the set code and the language (owner
// 2026-09-29: a separate flag, no sheen, free for every plan — a Foil
// finish prints it too). Shown only where the template has the slot
// (COLLECTOR_TEMPLATES); elsewhere the frame prints its own footer.

import { useFormContext, useWatch } from "react-hook-form";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { ANATOMY_HINTS, SwitchRow } from "@/components/creator/panels/anatomy-panel";
import { frameAnatomyOf } from "@/lib/cards/anatomy";
import {
  collectorLetter,
  collectorNumberRuns,
  collectorStyleForNumber,
  isCollectorStyle,
  type CollectorStyle,
} from "@/lib/cards/collector-line";
import type { FormValues } from "@/lib/creator/form-types";
import type { FrameStyle } from "@/types/card";

/** What a frame without the slot says instead of the switch. */
export const NO_COLLECTOR_SLOT_NOTE = "This frame prints its own footer. The collector line comes to it in a later release.";

/** Shown under the ★ switch while the card's finish is Foil. */
export const FOIL_FINISH_STAR_NOTE = "A Foil finish prints the ★ already.";

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
 * The collector line's switch, its style chips and the ★ switch. `stored`
 * is the saved card's frame style when EDITING it (the hint shows while
 * it names no `collector`); null for a new card or a remix.
 */
export function CollectorSwitches({ stored = null }: { stored?: FrameStyle | null }) {
  const { control, setValue } = useFormContext<FormValues>();
  const [template, collector, star, finish, cardType, supertype, rarity, collectorNumber] = useWatch({
    control,
    name: [
      "frame_style.template",
      "frame_style.collector",
      "frame_style.star",
      "frame_style.finish",
      "card_type",
      "supertype",
      "rarity",
      "collector_number",
    ],
  });
  if (!frameAnatomyOf(template).collector) {
    return (
      <p className="text-xs leading-5 text-muted" data-testid="collector-no-slot">
        {NO_COLLECTOR_SLOT_NOTE}
      </p>
    );
  }
  const on = isCollectorStyle(collector);
  const editing = stored !== null;
  const hint = editing && !on && stored?.collector === undefined ? (ANATOMY_HINTS.collector ?? null) : null;
  const examples = collectorStyleExamples({ cardType, supertype, rarity, collectorNumber });
  const styleOptions: ChipOption<CollectorStyle>[] = [
    { value: "2023", label: `Current (${examples["2023"]})` },
    { value: "2015", label: `2015–2022 (${examples["2015"]})` },
  ];
  return (
    <div className="flex flex-col gap-3" data-testid="collector-switches">
      <SwitchRow
        anatomy="collector"
        on={on}
        hint={hint}
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
          {finish === "foil" ? (
            <p className="text-xs leading-5 text-muted" data-testid="collector-foil-note">
              {FOIL_FINISH_STAR_NOTE}
            </p>
          ) : null}
        </SwitchRow>
      ) : null}
    </div>
  );
}
