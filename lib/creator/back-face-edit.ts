// What an EDIT sends for a back face the maker did not touch (TODO 3b.29).
//
// The editor holds a stored `back_face` in its flat form shape and rebuilds
// the object from it on every save. Where the form cannot hold the stored
// object whole, that rebuild CHANGES the row on a save that only retitled
// the card — a LEGACY back (a stored back on a frame that draws no second
// face: a saga, a plain M15 card, an imported DFC not moved onto the
// bodies) lost its `color_identity` (only a frame that draws a part colour
// sends one), gained the form's default `art_position`, and turned a stored
// `null` or `""` into an absent key. That breaks the rule that an edit never
// changes a field its maker did not touch (CLAUDE.md, #524).
//
// The row-diff of #524 / #528 / #534: an untouched back is sent only where
// the rebuilt object IS the stored one (every second part main's payload
// fixtures pin round-trips: its fields all present, nothing the form drops);
// otherwise it is LEFT OUT, and the update action keeps the row's back as it
// is (an omitted `back_face` is "leave it alone"). A back the maker changed
// — or switched off — travels as it always did.

import type { FormValues } from "@/lib/creator/form-types";

/** The values a back face's form fields hold, compared field by field. */
function sameBackFace(a: FormValues["back_face"], b: FormValues["back_face"]): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/** `value` with its object keys sorted and its `undefined` members dropped
 *  — JSON's own reading, so key order never makes two equal objects
 *  differ. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const member = (value as Record<string, unknown>)[key];
      if (member !== undefined) out[key] = canonical(member);
    }
    return out;
  }
  return value;
}

/** True when the edit's back face is exactly as the form OPENED it: still
 *  on, every field as it was. */
export function backFaceUntouched(
  opened: Pick<FormValues, "has_back_face" | "back_face">,
  values: Pick<FormValues, "has_back_face" | "back_face">,
): boolean {
  return opened.has_back_face && values.has_back_face && sameBackFace(opened.back_face, values.back_face);
}

/** True when `built` (the object the save would send) is the stored back
 *  — same keys, same values, key order aside. */
export function backFaceRoundTrips(stored: unknown, built: unknown): boolean {
  if (!stored || typeof stored !== "object" || !built || typeof built !== "object") return false;
  return JSON.stringify(canonical(stored)) === JSON.stringify(canonical(built));
}

/**
 * The `back_face` an edit sends when it would send `built` for a back the
 * form holds as `values` (the legacy / inline-part path of the submit):
 * `built` itself, unless the back is untouched AND rebuilding it would
 * change the stored row — then `undefined`, which the update action reads as
 * "keep the stored back". `trustOpened` is false once a save of this
 * session has gone out for the card as it opened (until its refresh lands,
 * "untouched" is read against values the row may no longer hold — the
 * footer's and face_content's rule): the built back is sent then.
 */
export function editBackFacePayload<T>(input: {
  stored: unknown;
  opened: Pick<FormValues, "has_back_face" | "back_face">;
  values: Pick<FormValues, "has_back_face" | "back_face">;
  built: T;
  trustOpened: boolean;
}): T | undefined {
  const { stored, opened, values, built, trustOpened } = input;
  if (!trustOpened || !stored || !backFaceUntouched(opened, values)) return built;
  return backFaceRoundTrips(stored, built) ? built : undefined;
}
