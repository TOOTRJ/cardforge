// ---------------------------------------------------------------------------
// A card's FACE (TODO 5.0b): the front, or the back of a double-faced card.
// The admin tools compare, score and walk one face at a time; Scryfall
// indexes the faces 0 / 1 (`card_faces`, the `/front/` and `/back/` image
// paths), the preview and the URLs name them. No imports: the URL parsers,
// the registry, the Scryfall client and the pages all read this.
// ---------------------------------------------------------------------------

export type CardFace = "front" | "back";

export const CARD_FACE_VALUES = ["front", "back"] as const;

/** The URL parameter the compare view and the walk-through carry
 *  (`?face=back`); absent = the template's own face (lib/cards/dfc.ts
 *  faceUnderTest). */
export const FACE_PARAM = "face";

export function isCardFace(value: unknown): value is CardFace {
  return value === "front" || value === "back";
}

/** A URL value as a face, or null when it names none (the array form Next
 *  hands over for a repeated parameter reads its first value). */
export function parseCardFace(raw: string | string[] | null | undefined): CardFace | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return isCardFace(value) ? value : null;
}

/** Scryfall's index of the face: `card_faces[0]` / `card_faces[1]`. */
export function scryfallFaceIndex(face: CardFace): 0 | 1 {
  return face === "back" ? 1 : 0;
}

/** The face a download names, or the front when the request names none:
 *  the png / pdf routes' `?face=` (TODO 5.3). */
export function parseFaceParam(raw: string | string[] | null | undefined): CardFace {
  return parseCardFace(raw) ?? "front";
}

/** The slug a download of `face` is named by: the card's for the front,
 *  `<slug>-back` for the back — so `<slug>-back.png`, `<slug>-back-square.png`,
 *  `<slug>-back-mpc.png`, `<slug>-back.pdf` sit beside the front's files
 *  (TODO 5.3). */
export function faceSlug(slug: string, face: CardFace): string {
  return face === "back" ? `${slug}-back` : slug;
}

/** The `&face=back` a download link carries for the back; nothing for the
 *  front, so every front link keeps the URL it always had. */
export function faceQuery(face: CardFace | null | undefined): string {
  return face === "back" ? "&face=back" : "";
}
