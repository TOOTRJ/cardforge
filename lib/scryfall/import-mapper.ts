import type { ScryfallCard } from "@/lib/scryfall/client";
import {
  CARD_TYPE_VALUES,
  COLOR_IDENTITY_VALUES,
  RARITY_VALUES,
  type CardType,
  type ColorIdentity,
  type Rarity,
} from "@/types/card";

// ---------------------------------------------------------------------------
// Map a Scryfall card into the shape the CardCreatorForm expects.
//
// The output is a patch — the form keeps any fields the user has already
// filled and only overwrites the fields the user explicitly imports. None
// of this writes the artwork; that's a separate explicit step via the
// `/api/scryfall/import-art` endpoint so users can choose to bring their
// own art instead.
// ---------------------------------------------------------------------------

// Known supertypes from Magic's type system. Anything else we encounter on
// the left side of "—" gets folded into card_type or supertype based on
// the type-line-position heuristic below.
const KNOWN_SUPERTYPES = new Set([
  "Legendary",
  "Basic",
  "Snow",
  "World",
  "Ongoing",
  "Tribal",
  "Host",
  "Elite",
]);

// Scryfall's type words → our CardType enum. Several Scryfall types
// collapse into our generic "spell" since the data model deliberately
// keeps a small enum (creature/spell/artifact/enchantment/land/token).
const TYPE_WORD_TO_CARD_TYPE: Record<string, CardType> = {
  creature: "creature",
  instant: "spell",
  sorcery: "spell",
  artifact: "artifact",
  enchantment: "enchantment",
  land: "land",
  token: "token",
  // Less common — best-effort mapping so we don't lose them entirely.
  planeswalker: "spell",
  battle: "spell",
  tribal: "spell",
};

const SCRYFALL_COLOR_TO_IDENTITY: Record<string, ColorIdentity> = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
};

// Scryfall's rarity vocabulary includes "special"/"bonus" beyond our
// common/uncommon/rare/mythic. Specials collapse to mythic so they don't
// look out of place; everything unknown falls back to common.
const SCRYFALL_RARITY: Record<string, Rarity> = {
  common: "common",
  uncommon: "uncommon",
  rare: "rare",
  mythic: "mythic",
  special: "mythic",
  bonus: "mythic",
};

export type ScryfallImportPatch = {
  title?: string;
  cost?: string;
  card_type?: CardType;
  supertype?: string;
  subtypes_text?: string;
  rarity?: Rarity;
  color_identity?: ColorIdentity[];
  rules_text?: string;
  flavor_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  artist_credit?: string;
  /** The Scryfall card id — kept on the patch so the form can request an
   *  art import for the same card via /api/scryfall/import-art. */
  source_scryfall_id?: string;
  /** Display-only preview URL. NOT written to the form's `art_url` — the
   *  user has to explicitly opt in to importing the art. */
  preview_art_url?: string | null;
  /** When present, the Scryfall card has two faces and the back-face
   *  content should be seeded into the form's back_face fields. The
   *  back-face art is imported separately via the `mode: "art-back"`
   *  option on /api/scryfall/import-art. */
  back_face?: ScryfallImportBackFacePatch;
};

export type ScryfallImportBackFacePatch = {
  title?: string;
  cost?: string;
  card_type?: CardType;
  supertype?: string;
  subtypes_text?: string;
  rules_text?: string;
  flavor_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  artist_credit?: string;
  /** Public URL of the imported back-face artwork. When set, the form
   *  writes this into `back_face.art_url`. Set only when the user opted
   *  to also import artwork on the front face — the back-face import is
   *  triggered in the same flow. */
  imported_art_url?: string | null;
};

/**
 * Parse Scryfall's type_line ("Legendary Creature — Dragon, Elder") into
 * supertype / card_type / subtypes. Double-faced cards use "//"; we read
 * only the front face when present.
 */
export function parseTypeLine(typeLine: string | null | undefined): {
  supertype?: string;
  card_type?: CardType;
  subtypes_text?: string;
} {
  if (!typeLine) return {};
  // For DFCs, take the front face's type line.
  const front = typeLine.split("//")[0]?.trim() ?? typeLine.trim();
  // The em-dash "—" (U+2014) separates type from subtypes. Some Scryfall
  // payloads use a plain hyphen; tolerate both.
  const [leftRaw, rightRaw] = front.split(/\s+[—-]\s+/);
  const leftWords = (leftRaw ?? "").split(/\s+/).filter(Boolean);
  const subtypes = (rightRaw ?? "").split(/\s+/).filter(Boolean);

  // Walk the left words: known supertypes go into `supertype`, the
  // remainder picks the first recognized card_type.
  const supers: string[] = [];
  let cardType: CardType | undefined;
  for (const word of leftWords) {
    if (KNOWN_SUPERTYPES.has(word)) {
      supers.push(word);
      continue;
    }
    const mapped = TYPE_WORD_TO_CARD_TYPE[word.toLowerCase()];
    if (mapped && !cardType) {
      cardType = mapped;
    }
  }

  return {
    supertype: supers.length > 0 ? supers.join(" ") : undefined,
    card_type: cardType,
    subtypes_text: subtypes.length > 0 ? subtypes.join(", ") : undefined,
  };
}

/**
 * Best-effort: pull a normalized color identity list from either Scryfall's
 * `color_identity` (preferred — accounts for lands and hybrid mana) or
 * `colors` as a fallback.
 */
export function parseColorIdentity(
  card: ScryfallCard,
): ColorIdentity[] {
  const raw = card.color_identity ?? card.colors ?? [];
  const out: ColorIdentity[] = [];
  for (const code of raw) {
    const mapped = SCRYFALL_COLOR_TO_IDENTITY[code];
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  // Empty identity means "colorless" — surface that so the form picks it up.
  if (out.length === 0) out.push("colorless");
  return out.filter((v) =>
    (COLOR_IDENTITY_VALUES as readonly string[]).includes(v),
  );
}

/**
 * Convert a Scryfall card into a patch the form can merge in. Falls back
 * to undefined fields when the Scryfall data is missing — we never invent
 * values just to fill a slot.
 */
export function mapScryfallToFormPatch(
  card: ScryfallCard,
  options: { artPreviewUrl?: string | null } = {},
): ScryfallImportPatch {
  const front = card.card_faces?.[0];
  const typeParts = parseTypeLine(card.type_line ?? front?.type_line);
  const colorIdentity = parseColorIdentity(card);
  const rarity =
    card.rarity && SCRYFALL_RARITY[card.rarity]
      ? SCRYFALL_RARITY[card.rarity]
      : undefined;

  // Validate the mapped card_type against our enum just in case.
  const cardType =
    typeParts.card_type &&
    (CARD_TYPE_VALUES as readonly string[]).includes(typeParts.card_type)
      ? typeParts.card_type
      : undefined;

  // Likewise rarity defensively.
  const rarityChecked =
    rarity && (RARITY_VALUES as readonly string[]).includes(rarity)
      ? rarity
      : undefined;

  return {
    title: card.name,
    cost: card.mana_cost ?? front?.mana_cost ?? undefined,
    card_type: cardType,
    supertype: typeParts.supertype,
    subtypes_text: typeParts.subtypes_text,
    rarity: rarityChecked,
    color_identity: colorIdentity.length > 0 ? colorIdentity : undefined,
    rules_text: card.oracle_text ?? front?.oracle_text ?? undefined,
    flavor_text: card.flavor_text ?? undefined,
    power: card.power ?? front?.power ?? undefined,
    toughness: card.toughness ?? front?.toughness ?? undefined,
    loyalty: card.loyalty ?? undefined,
    defense: card.defense ?? undefined,
    artist_credit: card.artist ?? undefined,
    source_scryfall_id: card.id,
    preview_art_url: options.artPreviewUrl ?? null,
    // DFC detection: any card with two faces (Delver, Werewolves, etc.)
    // emits a back_face patch the form will seed when the user imports.
    back_face: card.card_faces && card.card_faces.length >= 2
      ? mapScryfallBackFace(card)
      : undefined,
  };
}

/**
 * Build the back-face patch from `card.card_faces[1]`. Mirrors the front
 * mapper's field-by-field defensiveness — invalid card_types and missing
 * fields are simply omitted rather than guessed.
 */
function mapScryfallBackFace(
  card: ScryfallCard,
): ScryfallImportBackFacePatch | undefined {
  const back = card.card_faces?.[1];
  if (!back) return undefined;

  const typeParts = parseTypeLine(back.type_line);
  const cardType =
    typeParts.card_type &&
    (CARD_TYPE_VALUES as readonly string[]).includes(typeParts.card_type)
      ? typeParts.card_type
      : undefined;

  return {
    title: back.name ?? undefined,
    cost: back.mana_cost ?? undefined,
    card_type: cardType,
    supertype: typeParts.supertype,
    subtypes_text: typeParts.subtypes_text,
    rules_text: back.oracle_text ?? undefined,
    // Scryfall flavor_text is generally on the top-level card object, not
    // per-face. Leave undefined; the user can fill in their own.
    flavor_text: undefined,
    power: back.power ?? undefined,
    toughness: back.toughness ?? undefined,
    // The ScryfallCardFace schema doesn't include loyalty/defense today.
    loyalty: undefined,
    defense: undefined,
    // Per-face artist is the same person in practice; reuse the front's
    // artist credit so the user has something to start from.
    artist_credit: card.artist ?? undefined,
    imported_art_url: null,
  };
}
