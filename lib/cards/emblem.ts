import { templateHasBackFace } from "@/lib/cards/dfc";
import type { CardType, ColorIdentity } from "@/types/card";

// ---------------------------------------------------------------------------
// The emblem's stored shape (TODO 6.23). CR 114: an emblem has no colour,
// mana cost, supertype, power / toughness, loyalty or defense — the frame is
// silver whatever the planeswalker's colour (4.52). The creator's emblem
// kind hides those inputs and clears them on entry (EMBLEM_ENTRY_VALUES in
// lib/creator/card-kinds.ts); the card actions enforce the same shape on
// every save, whoever sent it (the form, an import, a crafted payload).
// Pure: no I/O.
// ---------------------------------------------------------------------------

/** The fields an emblem stores as they are fixed, in the payload's terms:
 *  undefined = "no value" (the actions write null for it). */
export const EMBLEM_FIXED_FIELDS = {
  cost: undefined,
  color_identity: ["colorless"] as ColorIdentity[],
  supertype: undefined,
  // No Types text either: the line is "Emblem" (TODO 3b.16).
  printed_types: undefined,
  power: undefined,
  toughness: undefined,
  loyalty: undefined,
  defense: undefined,
} as const;

type EmblemFixedKey = keyof typeof EMBLEM_FIXED_FIELDS;

type EmblemShaped = {
  card_type?: CardType | null;
  cost?: string | null;
  color_identity?: ColorIdentity[];
  supertype?: string | null;
  printed_types?: string | null;
  power?: string | null;
  toughness?: string | null;
  loyalty?: string | null;
  defense?: string | null;
};

/** A create payload with an emblem's fixed fields enforced (unchanged for
 *  any other card type). */
export function withEmblemShape<T extends EmblemShaped>(data: T): T {
  if (data.card_type !== "emblem") return data;
  return { ...data, ...EMBLEM_FIXED_FIELDS, color_identity: [...EMBLEM_FIXED_FIELDS.color_identity] };
}

/**
 * An update patch with an emblem's fixed fields enforced, for the card as
 * it will be stored (`storedCardType` when the patch leaves the type): a
 * patch that turns a card into an emblem clears every fixed field; a patch
 * to an emblem that names one of them gets the fixed value instead. Null
 * clears a column in an update, so the fixed "no value" is null here.
 */
export function withEmblemUpdateShape<T extends EmblemShaped>(
  data: T,
  storedCardType: string | null | undefined,
): T {
  const cardType = data.card_type !== undefined ? data.card_type : storedCardType;
  if (cardType !== "emblem") return data;
  const becoming = data.card_type === "emblem" && storedCardType !== "emblem";
  const out: EmblemShaped = { ...data };
  for (const key of Object.keys(EMBLEM_FIXED_FIELDS) as EmblemFixedKey[]) {
    if (!becoming && data[key] === undefined) continue;
    if (key === "color_identity") out.color_identity = [...EMBLEM_FIXED_FIELDS.color_identity];
    else out[key] = null;
  }
  return out as T;
}

/**
 * Whether a card of this type has a rarity to name. An emblem has none (CR
 * 114): the "common" it stores only inks its set symbol, so the card page's
 * Card details and its JSON-LD (caption, keywords) leave the rarity out.
 */
export function cardTypeHasRarity(cardType: string | null | undefined): boolean {
  return cardType !== "emblem";
}

/** The faces a card's page name may join (TODO 5.3): the card's FRONT
 *  template and its back face's title, as the row stores them. */
export type CardPageFaces = {
  frameTemplate: string | null | undefined;
  backTitle: string | null | undefined;
};

/**
 * The name a card goes by on its web page (owner decision 2026-09-29): an
 * emblem is "<its planeswalker's name> Emblem", as Scryfall names it ("Kaito,
 * Cunning Infiltrator Emblem") — its address (the slug a new one is given,
 * …-emblem), its <title>, OG / Twitter title, JSON-LD name, breadcrumb and
 * heading. The card itself prints the walker's name in the bar and "Emblem"
 * on the type line: the render is unchanged. A title that already ends in
 * "Emblem" isn't doubled; an empty one is "Emblem". Any other card type:
 * the title as it is.
 *
 * A DOUBLE-FACED card (TODO 5.3, design 2026-10-02 §3.4) is "Front // Back",
 * Scryfall's spelling — ONLY when its front template is a DFC body
 * (templateHasBackFace) and the back has a name: the 8 legacy two-faced
 * pages keep their front's name until their owner moves them onto the
 * bodies. The slug stays the front's (createCardAction passes no faces).
 */
export function cardPageName(
  title: string | null | undefined,
  cardType: string | null | undefined,
  faces?: CardPageFaces | null,
): string {
  const front = emblemPageName(title, cardType);
  const back = (faces?.backTitle ?? "").trim().replace(/\s+/g, " ");
  if (!faces || !back || !templateHasBackFace(faces.frameTemplate)) return front;
  return `${front} // ${back}`;
}

function emblemPageName(title: string | null | undefined, cardType: string | null | undefined): string {
  if (cardType !== "emblem") return title ?? "";
  const name = (title ?? "").trim().replace(/\s+/g, " ");
  if (!name) return "Emblem";
  return /(^|\s)emblem$/i.test(name) ? name : `${name} Emblem`;
}

/** The faces of a stored row for cardPageName: its front template and its
 *  back face's title (the jsonb columns as the queries return them). */
export function cardPageFacesOf(row: { frame_style: unknown; back_face: unknown }): CardPageFaces {
  const frameStyle = row.frame_style as { template?: unknown } | null | undefined;
  const back = row.back_face as { title?: unknown } | null | undefined;
  return {
    frameTemplate: typeof frameStyle?.template === "string" ? frameStyle.template : null,
    backTitle: typeof back?.title === "string" ? back.title : null,
  };
}
