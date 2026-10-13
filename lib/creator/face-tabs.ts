// ---------------------------------------------------------------------------
// Face tabs (TODO 5.14, owner round 46): which face a creator step edits.
//
// A Transform or Modal double-faced card has ONE Front face | Back face
// switch at the top of every step. The step then shows the same fields, in
// the same order, for the face that is selected — the back's fields live on
// the step their front twin lives on, not in one panel on the Identity step.
// This file is the pure part: which step a back field is on, which face a
// field belongs to, what a face still lacks, and the "still needed" items
// grouped per face. No React, no form state.
//
// Part 2 (split, aftermath, adventure, flip) mounts the same switch from the
// same table (lib/creator/second-part.ts) and reuses every function here:
// only `BACK_FIELD_STEP` is about where a second part's fields sit.
// ---------------------------------------------------------------------------

import { stepIndexForField, type StepDef, type StepKey } from "@/lib/creator/steps";
import type { SaveNeed } from "@/lib/creator/save-needs";
import type { SecondPartWords } from "@/lib/creator/second-part";

export type CardFaceId = "front" | "back";

/** The step each `back_face.<key>` field of a double-faced card is edited
 *  on — the step its front twin is on. `frame_style` is the server's key
 *  for a refused back body (lib/cards/dfc-gate.ts); the form has no field
 *  of that name, the type and colour chips answer it. */
export const BACK_FIELD_STEP: Readonly<Record<string, StepKey>> = {
  // Card: the face's type and colour.
  card_type: "card",
  color_identity: "card",
  frame_style: "card",
  // Identity: name, type line, artwork, artist.
  title: "identity",
  supertype: "identity",
  printed_types: "identity",
  subtypes_text: "identity",
  art_url: "identity",
  art_position: "identity",
  artist_credit: "identity",
  // Text & stats: cost, rules, flavour, stats.
  cost: "text",
  rules_text: "text",
  flavor_text: "text",
  power: "text",
  toughness: "text",
  loyalty: "text",
  defense: "text",
};

/** The face a form field belongs to: `back_face.*` is the back's, every
 *  other field the front's (or the whole card's). */
export function faceOfField(field: string): CardFaceId {
  return field === "back_face" || field.startsWith("back_face.") ? "back" : "front";
}

/** The step key a field is edited on when the card has face tabs. An edit
 *  has no Card step: the back's locked type and colour are shown on the
 *  Identity step there, so that is where their errors go. */
export function faceFieldStepKey(field: string, steps: readonly StepDef[]): StepKey | null {
  if (faceOfField(field) !== "back") return null;
  const key = field.split(".")[1] ?? "";
  const wanted = BACK_FIELD_STEP[key] ?? "identity";
  if (steps.some((step) => step.key === wanted)) return wanted;
  return steps.some((step) => step.key === "identity") ? "identity" : null;
}

/** `stepIndexForField` for a card with face tabs: a back field goes to the
 *  step it is edited on. Without face tabs (every other card) this is
 *  `stepIndexForField` itself. */
export function faceFieldStepIndex(field: string, steps: StepDef[], faceTabs: boolean): number {
  if (faceTabs) {
    const key = faceFieldStepKey(field, steps);
    if (key) {
      const index = steps.findIndex((step) => step.key === key);
      if (index >= 0) return index;
    }
  }
  return stepIndexForField(field, steps);
}

/** The first errored field's full path in a react-hook-form errors object
 *  ("back_face.title", not "back_face") — a nested error is routed to its
 *  own step and tab. */
export function firstErrorPath(errors: unknown): string | null {
  if (!errors || typeof errors !== "object") return null;
  for (const [key, value] of Object.entries(errors as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    if (typeof (value as { message?: unknown }).message === "string") return key;
    if (key === "back_face") {
      for (const [inner, innerValue] of Object.entries(value as Record<string, unknown>)) {
        if (innerValue && typeof innerValue === "object") return `back_face.${inner}`;
      }
    }
    return key;
  }
  return null;
}

/** Every errored field path, back-face errors by their own key. */
export function errorPaths(errors: unknown): string[] {
  if (!errors || typeof errors !== "object") return [];
  const paths: string[] = [];
  for (const [key, value] of Object.entries(errors as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    if (key === "back_face" && typeof (value as { message?: unknown }).message !== "string") {
      const inner = Object.keys(value as Record<string, unknown>).filter((k) => !["ref", "type", "types", "root"].includes(k));
      if (inner.length > 0) {
        for (const k of inner) paths.push(`back_face.${k}`);
        continue;
      }
    }
    paths.push(key);
  }
  return paths;
}

export type FaceStatus = {
  /** True when the face has a name and artwork — what a card other people
   *  can see needs of each face (lib/creator/save-needs.ts). */
  complete: boolean;
  /** "complete", "needs artwork", "needs a name", "needs a name and
   *  artwork". Words, never colour alone. */
  text: string;
};

/** What a face still lacks to be shown to other people: a name and
 *  artwork. Said on its tab whatever the card's visibility — a private
 *  draft saves without them, and the tab says what is still to come. */
export function faceStatusOf(face: { title?: string | null; art_url?: string | null }): FaceStatus {
  const missing: string[] = [];
  if (!(face.title ?? "").trim()) missing.push("a name");
  if (!(face.art_url ?? "").trim()) missing.push("artwork");
  return missing.length === 0
    ? { complete: true, text: "complete" }
    : { complete: false, text: `needs ${missing.join(" and ")}` };
}

export type FaceNeedGroup = {
  face: CardFaceId;
  /** The face's label from the kind's words ("Front face"). */
  label: string;
  needs: SaveNeed[];
};

/** A still-needed item's words inside its face's group: the group already
 *  names the face, so "the back face's artwork" reads "artwork". */
export function needLabelInGroup(need: SaveNeed): string {
  return need.id === "second-art" ? "artwork" : need.id === "second-name" ? "a name" : need.label;
}

/** The Save rule's list (saveNeedsOf), grouped per face in face order.
 *  The same items, never a second rule; a face with nothing missing has no
 *  group. */
export function groupNeedsByFace(needs: readonly SaveNeed[], words: SecondPartWords): FaceNeedGroup[] {
  const groups: FaceNeedGroup[] = [
    { face: "front", label: words.first, needs: [] },
    { face: "back", label: words.second, needs: [] },
  ];
  for (const need of needs) groups[faceOfField(need.field) === "back" ? 1 : 0].needs.push(need);
  return groups.filter((group) => group.needs.length > 0);
}
