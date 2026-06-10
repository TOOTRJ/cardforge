// Pure, React-free resolver for the era-based frame picker. The creator flow
// is: card type + color → era → frame. For BORDER eras (classic/m15) the
// specific frame is derived from the card type here, so a user can never land
// on a type-mismatched frame (e.g. the planeswalker frame on a creature). The
// "showcase" era picks its frame via a set→treatment sub-picker in the form, so
// this module just passes those templates through.
//
// Kept side-effect free + dependency-light so it's unit-testable and shared by
// the form and tests.

import {
  ERA_TYPE_FRAME,
  FRAME_ERA_VALUES,
  FRAME_SET_ERA,
  FRAME_TEMPLATE_SET,
  type CardType,
  type FrameEra,
  type FrameTemplate,
} from "@/types/card";

// Every frame that is a type-derived "standard" (vs a special layout like Saga,
// or a showcase treatment). These are the frames that should auto-follow a
// card-type change; special layouts + showcase frames are explicit user picks
// and stay put.
const TYPE_DERIVED_STANDARDS: ReadonlySet<FrameTemplate> = new Set(
  [
    ...Object.values(ERA_TYPE_FRAME.classic),
    ...Object.values(ERA_TYPE_FRAME.m15),
  ].filter((t): t is FrameTemplate => Boolean(t)),
);

/** True when the template is a type-derived standard frame (so the picker may
 *  auto-swap it when the card type changes). */
export function isTypeDerivedStandard(template: FrameTemplate): boolean {
  return TYPE_DERIVED_STANDARDS.has(template);
}

/** The era a template belongs to (via its FrameSet). Used to initialize the
 *  picker from a card's saved `frame_style.template`. */
export function eraForTemplate(template: FrameTemplate): FrameEra {
  return FRAME_SET_ERA[FRAME_TEMPLATE_SET[template]];
}

/** The standard / type-derived frame for a border era + card type, or null when
 *  that era has no frame for the type (e.g. Classic + planeswalker). The
 *  showcase era has no type mapping (its frames come from the set→treatment
 *  sub-picker), so it always returns null here. */
export function standardFrameFor(
  era: FrameEra,
  cardType: CardType | "" | null | undefined,
): FrameTemplate | null {
  if (era === "showcase") return null;
  const ct = (cardType || "creature") as CardType;
  return ERA_TYPE_FRAME[era][ct] ?? null;
}

/** Resolve the template the picker should select for a given (era, type),
 *  honoring an explicit override (a chosen special layout or showcase
 *  treatment) when it belongs to that era. Returns null when a border era can't
 *  frame the type and no override applies. */
export function resolveFrameTemplate(
  era: FrameEra,
  cardType: CardType | "" | null | undefined,
  override?: FrameTemplate | null,
): FrameTemplate | null {
  if (override && eraForTemplate(override) === era) return override;
  return standardFrameFor(era, cardType);
}

/** Which eras can frame the given card type — drives era-chip enable/disable.
 *  The showcase era can dress any type (stats still gate on type), so it's
 *  always available; border eras are available only when they have a frame for
 *  the type. */
export function erasAvailableForType(
  cardType: CardType | "" | null | undefined,
): FrameEra[] {
  return FRAME_ERA_VALUES.filter(
    (era) => era === "showcase" || standardFrameFor(era, cardType) !== null,
  );
}

/** True when the era has a frame for the type (or is the showcase era). */
export function eraSupportsType(
  era: FrameEra,
  cardType: CardType | "" | null | undefined,
): boolean {
  return era === "showcase" || standardFrameFor(era, cardType) !== null;
}
