import type { ScryfallCard } from "@/lib/scryfall/client";
import {
  CARD_TYPE_VALUES,
  COLOR_IDENTITY_VALUES,
  RARITY_VALUES,
  type CardType,
  type ColorIdentity,
  type FrameEra,
  type FrameTemplate,
  type Rarity,
} from "@/types/card";
import {
  KIND_DEFS,
  kindFromCard,
  type CardKind,
} from "@/lib/creator/card-kinds";
import { standardFrameFor } from "@/lib/creator/frame-picker";

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

// Scryfall's type words → our CardType enum. The data model now supports
// every canonical MTG type directly (creature / instant / sorcery / artifact
// / enchantment / land / planeswalker / battle / token), so imports preserve
// the source type instead of collapsing it. "Tribal" isn't a separate
// CardType in our schema — it folds back to the legacy "spell" so we still
// import the card without losing it.
const TYPE_WORD_TO_CARD_TYPE: Record<string, CardType> = {
  creature: "creature",
  instant: "instant",
  sorcery: "sorcery",
  artifact: "artifact",
  enchantment: "enchantment",
  land: "land",
  token: "token",
  planeswalker: "planeswalker",
  battle: "battle",
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
  /** The derived card KIND (layout-aware: saga / adventure / split /
   *  aftermath / flip, else the type-mapped standard kind). The form routes
   *  this through planKindChange so the frame follows the import in one
   *  synchronous pass. */
  kind?: CardKind;
  /** The frame matching THIS PRINTING's border era (1993→classic,
   *  1997→retro, 2003→modern, 2015/future→m15; snow/devoid frame_effects
   *  map onto the skin templates). Standard kinds only — layout kinds'
   *  templates are fixed by the kind. The form applies it after the kind
   *  patch, falling back to the era standard when a skin combo isn't
   *  published yet. */
  frame_template?: FrameTemplate;
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
  // remainder picks the card_type. "Creature" outranks the other type
  // words — an Artifact Creature or Enchantment Creature renders with a
  // P/T box, and the form gates the P/T inputs on card_type — except
  // "token", which keeps precedence so "Token Creature — Goblin" stays a
  // token (token frames render P/T too). Otherwise the first recognized
  // word wins.
  const supers: string[] = [];
  let cardType: CardType | undefined;
  for (const word of leftWords) {
    if (KNOWN_SUPERTYPES.has(word)) {
      supers.push(word);
      continue;
    }
    const mapped = TYPE_WORD_TO_CARD_TYPE[word.toLowerCase()];
    if (!mapped) continue;
    if (!cardType || (mapped === "creature" && cardType !== "token")) {
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
 * Derive the card KIND from a Scryfall card. Multi-signal by necessity —
 * `layout` alone can't do it (verified against the live API):
 *   • planeswalkers are layout "normal" (no planeswalker layout exists)
 *   • every printed battle is layout "transform" (layout "battle" matches
 *     zero cards); the Battle type lives on the front face's type_line
 *   • aftermath is layout "split" + keywords ["Aftermath"]
 * Unmodeled layouts (class, case, leveler, prototype, prepare, meld, …)
 * deliberately fall through to the type-line mapping so an exotic import
 * degrades to a standard kind instead of failing.
 */
export function kindFromScryfall(card: ScryfallCard): CardKind | undefined {
  const layout = (card.layout ?? "").toLowerCase();
  if (layout === "split") {
    const keywords = (card.keywords ?? []).map((k) => k.toLowerCase());
    return keywords.includes("aftermath") ? "aftermath" : "split";
  }
  if (layout === "flip") return "flip";
  if (layout === "adventure") return "adventure";
  if (layout === "saga") return "saga";

  const front = card.card_faces?.[0];
  const { card_type } = parseTypeLine(front?.type_line ?? card.type_line);
  if (!card_type) return undefined;
  // kindFromCard folds legacy "spell" to sorcery and maps 1:1 otherwise.
  return kindFromCard(card_type, undefined);
}

// Scryfall's border-generation values → our frame eras. "future" (the
// Future Sight frame) isn't converted yet, so it lands on m15.
const SCRYFALL_FRAME_TO_ERA: Record<string, FrameEra> = {
  "1993": "classic",
  "1997": "retro",
  "2003": "modern",
  "2015": "m15",
  future: "m15",
};

/**
 * The frame template matching THIS PRINTING: its border era's standard for
 * the derived kind, upgraded to the snow/devoid skin when the printing
 * carries that treatment. Returns undefined for layout kinds (their
 * template is fixed by the kind — saga is saga in every era) and for
 * unmappable cards. Falls forward to the M15 standard when the printing's
 * era can't frame the type (e.g. 2003-frame Lorwyn planeswalkers).
 */
export function frameTemplateFromScryfall(
  card: ScryfallCard,
): FrameTemplate | undefined {
  const kind = kindFromScryfall(card);
  if (!kind) return undefined;
  const def = KIND_DEFS[kind];
  // Layout kinds: the kind itself decides the template; nothing to adopt.
  if (def.layoutTemplates) return undefined;

  const era = SCRYFALL_FRAME_TO_ERA[(card.frame ?? "").trim()] ?? "m15";
  const base =
    standardFrameFor(era, def.cardType) ??
    standardFrameFor("m15", def.cardType) ??
    undefined;

  // Snow/devoid printings re-dress the plain m15 spell frame — only
  // meaningful where that IS the era standard for the kind.
  if (base === "m15") {
    const effects = (card.frame_effects ?? []).map((e) => e.toLowerCase());
    if (effects.includes("snow")) return "m15snow";
    if (effects.includes("devoid")) return "m15devoid";
  }
  return base;
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
  // Split / adventure / room / transform cards carry combined-or-absent data at
  // the top level (name is "Foo // Bar", oracle/cost/PT live on the faces). For
  // those, seed the FRONT face consistently instead of mixing top-level combined
  // text with face data. Single-faced cards keep reading the top level first.
  const isMultiFace = (card.card_faces?.length ?? 0) >= 2;
  const pick = (
    faceVal: string | null | undefined,
    cardVal: string | null | undefined,
  ): string | undefined =>
    (isMultiFace ? faceVal ?? cardVal : cardVal ?? faceVal) ?? undefined;

  const typeParts = parseTypeLine(pick(front?.type_line, card.type_line));
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
    // For a multi-face card, the front face's own name ("Fire", not "Fire //
    // Ice") is the right seed for the front we're populating.
    title: (isMultiFace && front?.name) || card.name,
    cost: pick(front?.mana_cost, card.mana_cost),
    kind: kindFromScryfall(card),
    frame_template: frameTemplateFromScryfall(card),
    card_type: cardType,
    supertype: typeParts.supertype,
    subtypes_text: typeParts.subtypes_text,
    rarity: rarityChecked,
    color_identity: colorIdentity.length > 0 ? colorIdentity : undefined,
    rules_text: pick(front?.oracle_text, card.oracle_text),
    flavor_text: pick(front?.flavor_text, card.flavor_text),
    power: pick(front?.power, card.power),
    toughness: pick(front?.toughness, card.toughness),
    // Faces carry these on real cards (battle fronts hold defense; Origins
    // walker backs hold loyalty) — prefer the face on multiface cards.
    loyalty: pick(front?.loyalty, card.loyalty),
    defense: pick(front?.defense, card.defense),
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
    flavor_text: back.flavor_text ?? undefined,
    power: back.power ?? undefined,
    toughness: back.toughness ?? undefined,
    // Present on real faces: loyalty on DFC planeswalker backs (Origins
    // walkers), defense on battle faces.
    loyalty: back.loyalty ?? undefined,
    defense: back.defense ?? undefined,
    // Per-face artist is the same person in practice; reuse the front's
    // artist credit so the user has something to start from.
    artist_credit: card.artist ?? undefined,
    imported_art_url: null,
  };
}
