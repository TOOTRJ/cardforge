// Pure, React-free era/frame lookups shared by the kind-first creator model
// (lib/creator/card-kinds.ts) and tests. The era-chip picker this module once
// powered (isTypeDerivedStandard / resolveFrameTemplate / erasAvailableForType
// / eraSupportsType) was replaced by framesForKind + planKindChange — kind
// changes are explicit and prompted, never auto-synced.

import {
  ERA_TYPE_FRAME,
  FRAME_SET_ERA,
  FRAME_TEMPLATE_SET,
  type CardType,
  type FrameEra,
  type FrameTemplate,
} from "@/types/card";

/** The era a template belongs to (via its FrameSet). Used to derive where a
 *  card's saved `frame_style.template` sits in the gallery. */
export function eraForTemplate(template: FrameTemplate): FrameEra {
  return FRAME_SET_ERA[FRAME_TEMPLATE_SET[template]];
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
