// Revise mode (edit + remix of an existing card) — the pure contract for
// WHICH fields a saved card exposes for change. Owner decision 2026-09-16:
// changing a card's type, frame, variation, colour, type line, finish, set
// or deck after the fact is how bad cards got made, so those are locked and
// only the content fields below are ever sent to the server from a revise.
//
// Kept React-free so the form, the server payload builder and the unit
// tests all agree on the same list.

import type { FormValues } from "@/lib/creator/form-types";

/** Form fields a user may change while editing or remixing. Everything else
 *  is displayed read-only (LockedSummary) and never leaves the client. */
export const REVISABLE_FIELDS = [
  "title",
  "rarity",
  "cost",
  "art_url",
  "art_position",
  "artist_credit",
  "rules_text",
  "loyalty_abilities",
  "saga_intro",
  "saga_chapters",
  "flavor_text",
  "power",
  "toughness",
  "loyalty",
  "defense",
  "set_icon_url",
  "set_icon_code",
  "tags_text",
  "watermark",
  "visibility",
  // The inline second face (Adventure spell / split half) is CONTENT of the
  // frame the card already has, so it stays editable; the standard-frame
  // back-face link (back_card_id) is structural and stays locked.
  "has_back_face",
  "back_face",
] as const satisfies readonly (keyof FormValues)[];

export type RevisableField = (typeof REVISABLE_FIELDS)[number];

const REVISABLE_SET: ReadonlySet<string> = new Set(REVISABLE_FIELDS);

export function isRevisableField(name: string): name is RevisableField {
  return REVISABLE_SET.has(name);
}

/** The server-payload keys a revise may carry. The form maps some FormValues
 *  onto different payload keys (subtypes_text → subtypes, tags_text → tags,
 *  the structured rows → face_content), so this is the payload-side twin of
 *  REVISABLE_FIELDS. */
export const REVISABLE_PAYLOAD_KEYS = [
  "title",
  "rarity",
  "cost",
  "art_url",
  "art_position",
  "artist_credit",
  "rules_text",
  "face_content",
  "flavor_text",
  "power",
  "toughness",
  "loyalty",
  "defense",
  "set_icon_url",
  "set_icon_code",
  "tags",
  "watermark",
  "visibility",
  "back_face",
] as const;

export type RevisablePayloadKey = (typeof REVISABLE_PAYLOAD_KEYS)[number];

/** Keep only the revisable keys of a full create payload — what an edit
 *  sends to updateCardAction. Locked columns are simply absent, and the
 *  update action leaves absent columns untouched. */
export function pickRevisablePayload<T extends Record<string, unknown>>(
  payload: T,
): Pick<T, Extract<keyof T, RevisablePayloadKey>> {
  const out: Record<string, unknown> = {};
  for (const key of REVISABLE_PAYLOAD_KEYS) {
    if (key in payload) out[key] = payload[key];
  }
  return out as Pick<T, Extract<keyof T, RevisablePayloadKey>>;
}

/** Whether a remix has been made the user's own. Visibility is a publishing
 *  choice, not a change to the card, so it doesn't count (owner decision);
 *  for a plain edit every dirty field counts, visibility included. */
export function hasMeaningfulChange(
  dirtyFieldNames: readonly string[],
  mode: "edit" | "remix",
): boolean {
  return dirtyFieldNames.some(
    (name) => mode === "edit" || name !== "visibility",
  );
}

/** "Title (remix)" — the prefilled name for a remix; the slug is derived from
 *  whatever title the user finally saves with. */
export function remixTitleFor(parentTitle: string): string {
  return `${parentTitle} (remix)`.slice(0, 120);
}
