// Revise mode (edit + remix of an existing card) — the pure contract for
// WHICH fields a saved card exposes for change. Owner decision 2026-09-16:
// changing a card's type, frame, variation, colour, type line, finish, set
// or deck after the fact is how bad cards got made, so those are locked and
// only the content fields below are ever sent to the server from a revise.
//
// Kept React-free so the form, the server payload builder and the unit
// tests all agree on the same list.

import type { FormValues } from "@/lib/creator/form-types";
import { CARD_TITLE_MAX } from "@/lib/validation/card";
import {
  FRAME_ANATOMY_KEYS,
  pairColorIdentity,
  twoColorPairOf,
  type FrameAnatomyPatch,
} from "@/lib/cards/anatomy";
import type { ColorIdentity } from "@/types/card";

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
  // The collector fields (TODO 4.9a) are card CONTENT like the set icon
  // (owner 2026-09-29: editable on an existing card) — what the printing
  // says, not what the card structurally is.
  "set_code",
  "collector_number",
  "lang",
  "tags_text",
  "watermark",
  "footer_text",
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
  "set_code",
  "collector_number",
  "lang",
  "tags",
  "watermark",
  "footer_text",
  "visibility",
  "back_face",
  // The anatomy switches (the legendary crown, the two-colour frame — TODO
  // 4.6.0): a LOOK the owner switches on per card (owner rule 2026-09-29),
  // not structure. They travel on their own key so an edit never re-sends
  // the locked frame_style; the action merges them over the stored one, and
  // a colour pair only ever refines a multicolour card
  // (lib/cards/anatomy.ts applyFrameAnatomyPatch).
  "frame_anatomy",
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

/** "Title (remix)" — the prefilled name for a remix, cut to the card title
 *  limit; the slug is derived from whatever title the user finally saves
 *  with. */
export function remixTitleFor(parentTitle: string): string {
  return `${parentTitle} (remix)`.slice(0, CARD_TITLE_MAX);
}

/**
 * An EDIT's anatomy change (the `frame_anatomy` payload key,
 * updateCardAction): each switch the form sets to a value the stored card
 * doesn't hold, and — when the owner switched the two-colour frame on for a
 * stored card with no colour pair — the pair the editor pre-filled and they
 * confirmed. Undefined when nothing changed, so an ordinary edit sends
 * nothing and the stored frame_style is left exactly as it is.
 */
export function frameAnatomyPatchFor(
  stored: { frame_style: unknown; color_identity: readonly ColorIdentity[] | null },
  values: Pick<FormValues, "frame_style" | "color_identity">,
): FrameAnatomyPatch | undefined {
  const storedStyle = (stored.frame_style ?? {}) as Record<string, unknown>;
  const patch: FrameAnatomyPatch = {};
  for (const key of FRAME_ANATOMY_KEYS) {
    const next = values.frame_style[key];
    if (typeof next === "boolean" && next !== storedStyle[key]) patch[key] = next;
  }
  const pair = twoColorPairOf(values.color_identity);
  if (pair && values.frame_style.twoColor === true && !twoColorPairOf(stored.color_identity)) {
    patch.twoColor = true;
    patch.pair = pairColorIdentity(pair);
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}
