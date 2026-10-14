// Pure, React-free era/frame lookups shared by the kind-first creator model
// (lib/creator/card-kinds.ts) and tests. The era-chip picker this module once
// powered (isTypeDerivedStandard / resolveFrameTemplate / erasAvailableForType
// / eraSupportsType) was replaced by framesForKind + planKindChange — kind
// changes are explicit and prompted, never auto-synced.

import {
  ERA_TYPE_FRAME,
  FRAME_SET_ERA,
  FRAME_TEMPLATE_SET,
  M15_TREATMENT_SETS,
  type CardType,
  type FrameEra,
  type FrameTemplate,
} from "@/types/card";

/** The era a template belongs to (via its FrameSet). Used to derive where a
 *  card's saved `frame_style.template` sits in the gallery. */
export function eraForTemplate(template: FrameTemplate): FrameEra {
  return FRAME_SET_ERA[FRAME_TEMPLATE_SET[template]];
}

/** True for a general TREATMENT of the 2015 frame that is a body of its own
 *  (extended art, the full-art basics, the textless frames): M15-era in the
 *  picker — a variation of the kind's M15 standard — and no set's showcase
 *  (types/card.ts M15_TREATMENT_SETS). Borderless is not one: it has a
 *  template per kind, each a skin of that kind's standard. */
export function isM15Treatment(template: FrameTemplate): boolean {
  return M15_TREATMENT_SETS.includes(FRAME_TEMPLATE_SET[template]);
}

/** True for a frame that is JUDGED AS A BODY OF ITS OWN, whatever group the
 *  picker lists it in: a showcase or an M15 treatment. What read "is this a
 *  showcase frame" to decide behaviour — which kinds the body draws, the
 *  import's stand-ins, the treatment notice — reads this, so moving a frame
 *  between the two groups changes its label and its place and nothing else. */
export function isTreatmentBody(template: FrameTemplate): boolean {
  return eraForTemplate(template) === "showcase" || isM15Treatment(template);
}

/** The standard / type-derived frame for a border era + card type, or null when
 *  that era has no frame for the type (e.g. Classic + planeswalker). The
 *  showcase era has no type mapping (its treatments dress any type), so it
 *  always returns null here. */
export function standardFrameFor(
  era: FrameEra,
  cardType: CardType | "" | null | undefined,
): FrameTemplate | null {
  if (era === "showcase") return null;
  const ct = (cardType || "creature") as CardType;
  return ERA_TYPE_FRAME[era]?.[ct] ?? null;
}
