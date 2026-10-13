// ---------------------------------------------------------------------------
// Which of a second part's fields the creator shows (TODO 5.14, owner round
// 52, 2026-10-13).
//
// The second part of a split, aftermath, adventure or flip card is painted
// on the first part's picture, and neither renderer reads most of what its
// `back_face` can hold: SecondFacePanel / SecondFaceBake and AdventurePanel /
// AdventureBake are handed the part's name, cost, type words and rules text,
// its power / toughness only where the profile has `secondFace.pt` (a flip
// side's plate) and its picture only where it has `secondFace.artSlot`
// (split's and aftermath's own window); the footer prints the CARD's artist.
//
// A field the card never draws is HIDDEN WHILE IT IS EMPTY and shown
// whenever it holds a value — a stored card may hold one (an import, an
// older editor), and a stored value stays stored, sent and visible. Once
// shown, a field stays shown until the form starts over or opens another
// card (`components/creator/use-second-part-fields.ts`): it never leaves
// under the maker who is clearing it.
//
// WHAT is never drawn is read from the profile, not from a list of kinds —
// a frame that gains a slot shows its field by itself. Hiding is the
// creator's alone: the form keeps every `back_face.*` value whatever is on
// screen, so what a save sends does not change.
//
// Pure: no React, no form state.
// ---------------------------------------------------------------------------

import type { FrameProfile } from "@/lib/cards/template-layout";

/** The hideable units of a second part. Power and toughness are ONE unit
 *  (one printed "1/2": a half that holds either shows both inputs); the
 *  picture is the art box whole — upload, positioner, "use art from a real
 *  card" and the not-drawn line. */
export const SECOND_PART_HIDEABLE = ["pt", "loyalty", "defense", "flavor", "artist", "art"] as const;
export type SecondPartHideable = (typeof SECOND_PART_HIDEABLE)[number];

/** The `back_face` keys behind each unit. */
export const SECOND_PART_UNIT_KEYS: Readonly<Record<SecondPartHideable, readonly string[]>> = {
  pt: ["power", "toughness"],
  loyalty: ["loyalty"],
  defense: ["defense"],
  flavor: ["flavor_text"],
  artist: ["artist_credit"],
  art: ["art_url"],
};

type SecondPartSlots = Pick<FrameProfile, "secondFace" | "adventure">;

/** The units a frame NEVER draws for the second part it paints on its own
 *  picture. Empty for a profile that paints none (a one-part card, a
 *  double-faced body: their back fields are not this module's). */
export function neverDrawnSecondPartUnits(profile: SecondPartSlots | null | undefined): ReadonlySet<SecondPartHideable> {
  const never = new Set<SecondPartHideable>();
  if (!profile || (!profile.secondFace && !profile.adventure)) return never;
  // No renderer reads these of an inline second part, on any frame.
  never.add("loyalty").add("defense").add("flavor").add("artist");
  if (!profile.secondFace?.pt) never.add("pt");
  if (!profile.secondFace?.artSlot) never.add("art");
  return never;
}

const holds = (value: unknown) => typeof value === "string" && value.trim() !== "";

/** True when the part holds a value in the unit — or the form has an error
 *  on one of its keys (a server error on a hidden field shows the field). */
export function secondPartUnitHolds(
  unit: SecondPartHideable,
  backFace: Readonly<Record<string, unknown>> | null | undefined,
  errors?: Readonly<Record<string, unknown>> | null,
): boolean {
  return SECOND_PART_UNIT_KEYS[unit].some((key) => holds(backFace?.[key]) || Boolean(errors?.[key]));
}

/** The never-drawn units that hold a value (or an error) now. */
export function heldNeverDrawnUnits(
  never: ReadonlySet<SecondPartHideable>,
  backFace: Readonly<Record<string, unknown>> | null | undefined,
  errors?: Readonly<Record<string, unknown>> | null,
): SecondPartHideable[] {
  return SECOND_PART_HIDEABLE.filter((unit) => never.has(unit) && secondPartUnitHolds(unit, backFace, errors));
}

/** What the second part's tab shows: every unit the frame draws, and each
 *  one it never draws that holds a value or was shown earlier (`kept`). */
export type SecondPartShown = Readonly<Record<SecondPartHideable, boolean>>;

export const EVERY_SECOND_PART_UNIT: SecondPartShown = {
  pt: true,
  loyalty: true,
  defense: true,
  flavor: true,
  artist: true,
  art: true,
};

export function secondPartShown(input: {
  never: ReadonlySet<SecondPartHideable>;
  backFace: Readonly<Record<string, unknown>> | null | undefined;
  errors?: Readonly<Record<string, unknown>> | null;
  /** Units shown earlier in this sitting — they stay. */
  kept?: ReadonlySet<SecondPartHideable>;
}): SecondPartShown {
  const shown = { ...EVERY_SECOND_PART_UNIT };
  for (const unit of SECOND_PART_HIDEABLE) {
    shown[unit] =
      !input.never.has(unit) ||
      Boolean(input.kept?.has(unit)) ||
      secondPartUnitHolds(unit, input.backFace, input.errors);
  }
  return shown;
}

/** The unit a `back_face.<key>` form field belongs to, or null. */
export function secondPartUnitOfField(field: string): SecondPartHideable | null {
  if (!field.startsWith("back_face.")) return null;
  const key = field.split(".")[1] ?? "";
  if (key === "art_position") return "art";
  return SECOND_PART_HIDEABLE.find((unit) => SECOND_PART_UNIT_KEYS[unit].includes(key)) ?? null;
}
