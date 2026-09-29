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
