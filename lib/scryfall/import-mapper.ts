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
import { describeFrame } from "@/lib/creator/frame-resolve";

// ---------------------------------------------------------------------------
// Map a Scryfall card into the shape the CardCreatorForm expects.
//
// The output is a patch — the form keeps any fields the user has already
// filled and only overwrites the fields the user explicitly imports. None
// of this writes the artwork; that's a separate explicit step via the
// `/api/scryfall/import-art` endpoint so users can choose to bring their
// own art instead.
// ---------------------------------------------------------------------------

// Words left of the "—" that the creator keeps as SUPERTYPE words, never as
// the card type (card-type words other than the chosen card_type ride along
// with them — parseTypeLine). Unknown words (Emblem, Scheme, Conspiracy, …)
// are dropped.
//
// Kindred (Scryfall renamed Tribal → Kindred in 2024; both spellings appear
// in type lines) is a card type in the Comprehensive Rules, but PipGlyph has
// no Kindred CardType: a "Kindred Instant — Elf" is an instant with the word
// Kindred in front, so it stays a supertype word (TODO 1.14).
const KNOWN_SUPERTYPES = new Set([
  "Legendary",
  "Basic",
  "Snow",
  "World",
  "Ongoing",
  "Tribal",
  "Kindred",
  "Host",
  "Elite",
]);

// Scryfall's type words → our CardType enum. Every canonical MTG card type
// PipGlyph models maps 1:1; the legacy "spell" CardType is never produced by
// an import.
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
};

// Which card-type word becomes `card_type` when a type line carries several
// (TODO 1.3). The card type picks the kind and so the frame, so the order is
// the order of frames that can draw the card:
//   • token first — a "Token Artifact Creature — Thopter" is a token (the
//     token frames print P/T);
//   • land beats creature — Dryad Arbor ("Land Creature — Forest Dryad") is
//     dressed as a land, and an "Artifact Land" stays a land;
//   • creature beats the rest — an Artifact or Enchantment Creature needs
//     the P/T box, which the form gates on card_type;
//   • artifact beats enchantment — a "Legendary Enchantment Artifact"
//     (Bident of Thassa) prints on the artifact frame.
// The other words are NOT lost: they ride in `supertype`, in printed order,
// so the type line still reads "Artifact Creature — Golem".
const CARD_TYPE_PRECEDENCE: readonly CardType[] = [
  "token",
  "land",
  "creature",
  "planeswalker",
  "battle",
  "artifact",
  "enchantment",
  "instant",
  "sorcery",
];

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
  /** Display-only: the printing's treatment that `frame_template` does NOT
   *  reproduce (borderless / showcase / extended art / full art /
   *  textless). The form names it in a toast after the frame lands, so the
   *  import never passes for an exact match (TODO 1.16 stopgap). */
  printing_treatment?: PrintingTreatment;
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

type ScryfallImportBackFacePatch = {
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

/** One word left of a type line's dash that the importer keeps. */
type TypeWord = { word: string; cardType?: CardType };

/**
 * Split the FRONT face of a type line into the words left of the dash that
 * the importer keeps (supertype words and card-type words, printed order)
 * and the subtypes. Double-faced type lines use "//"; only the part before
 * it is read.
 */
export function typeLineWords(typeLine: string | null | undefined): {
  words: TypeWord[];
  subtypes: string[];
} {
  if (!typeLine) return { words: [], subtypes: [] };
  const front = typeLine.split("//")[0]?.trim() ?? typeLine.trim();
  // The em-dash "—" (U+2014) separates type from subtypes. Some Scryfall
  // payloads use a plain hyphen; tolerate both.
  const [leftRaw, rightRaw] = front.split(/\s+[—-]\s+/);
  const words: TypeWord[] = [];
  for (const word of (leftRaw ?? "").split(/\s+/).filter(Boolean)) {
    if (KNOWN_SUPERTYPES.has(word)) {
      words.push({ word });
      continue;
    }
    const cardType = TYPE_WORD_TO_CARD_TYPE[word.toLowerCase()];
    if (cardType) words.push({ word, cardType });
  }
  return { words, subtypes: (rightRaw ?? "").split(/\s+/).filter(Boolean) };
}

/**
 * Parse Scryfall's type_line ("Legendary Artifact Creature — Golem") into
 * supertype / card_type / subtypes. `card_type` is the highest card-type
 * word by CARD_TYPE_PRECEDENCE (TODO 1.3) — or `options.cardType` when the
 * caller already knows the card type (a layout kind: Urza's Saga is an
 * "Enchantment Land" on the saga frame) and the line carries that word.
 * Every other kept word — the supertypes and the remaining card-type words —
 * stays in `supertype` in printed order, so "Artifact Creature" imports as
 * the creature card type with "Artifact" in front (TODO 1.7) instead of
 * losing the word.
 */
export function parseTypeLine(
  typeLine: string | null | undefined,
  options: { cardType?: CardType } = {},
): {
  supertype?: string;
  card_type?: CardType;
  subtypes_text?: string;
} {
  if (!typeLine) return {};
  const { words, subtypes } = typeLineWords(typeLine);
  const present = new Set(
    words.flatMap((w) => (w.cardType ? [w.cardType] : [])),
  );
  const cardType =
    options.cardType && present.has(options.cardType)
      ? options.cardType
      : CARD_TYPE_PRECEDENCE.find((t) => present.has(t));

  // Drop the ONE word that became card_type; keep the rest in order.
  let taken = false;
  const supers = words
    .filter((w) => {
      if (!taken && w.cardType !== undefined && w.cardType === cardType) {
        taken = true;
        return false;
      }
      return true;
    })
    .map((w) => w.word);

  return {
    supertype: supers.length > 0 ? supers.join(" ") : undefined,
    card_type: cardType,
    subtypes_text: subtypes.length > 0 ? subtypes.join(", ") : undefined,
  };
}

/** The front face's type line: the first face of a multi-face card, else
 *  the card's own. */
function frontTypeLine(card: ScryfallCard): string | null | undefined {
  return card.card_faces?.[0]?.type_line ?? card.type_line;
}

/** True when the card is a Room (Duskmourn): Scryfall files Rooms under
 *  layout "split", but a Room is ONE enchantment with two doors, not a
 *  split card. */
function isRoomCard(card: ScryfallCard): boolean {
  return typeLineWords(frontTypeLine(card)).subtypes.includes("Room");
}

/**
 * Derive the card KIND from a Scryfall card. Multi-signal by necessity —
 * `layout` alone can't do it (verified against the live API):
 *   • planeswalkers are layout "normal" (no planeswalker layout exists)
 *   • every printed battle is layout "transform" (layout "battle" matches
 *     zero cards); the Battle type lives on the front face's type_line
 *   • aftermath is layout "split" + keywords ["Aftermath"]
 *   • a transforming Saga (Fable of the Mirror-Breaker) is layout
 *     "transform": the front face's Saga subtype makes it a saga (TODO 1.3)
 *   • Rooms are layout "split" but are not split cards: the first door
 *     imports as the standard kind of its type line (an enchantment) and the
 *     second door rides along as the back face, until 4.27's Room template
 *   • Omens (Tarkir: Dragonstorm) are layout "adventure" on Scryfall: the
 *     omen spell is the storybook page, the nearest frame until 4.27's Omen
 *     template. A future "omen" layout value lands there too.
 * Class, Case and the other unmodeled layouts (leveler, prototype, prepare,
 * meld, …) take the standard kind of the front face's type line, so an
 * exotic import degrades to a standard kind instead of failing.
 */
export function kindFromScryfall(card: ScryfallCard): CardKind | undefined {
  const layout = (card.layout ?? "").toLowerCase();
  if (layout === "saga" || typeLineWords(frontTypeLine(card)).subtypes.includes("Saga")) {
    return "saga";
  }
  if (layout === "split" && !isRoomCard(card)) {
    const keywords = (card.keywords ?? []).map((k) => k.toLowerCase());
    return keywords.includes("aftermath") ? "aftermath" : "split";
  }
  if (layout === "flip") return "flip";
  if (layout === "adventure" || layout === "omen") return "adventure";

  const { card_type } = parseTypeLine(frontTypeLine(card));
  if (!card_type) return undefined;
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
 * the derived kind, dressed by the rest of the front face's type line
 * (TODO 1.3) and the printing's snow/devoid treatment. Returns undefined for
 * layout kinds (their template is fixed by the kind — saga is saga in every
 * era) and for unmappable cards. Falls forward to the M15 standard when the
 * printing's era can't frame the type (e.g. 2003-frame Lorwyn
 * planeswalkers).
 *
 * On the M15 era:
 *   • snow/devoid printings re-dress the plain spell frame (a frame effect
 *     is a fact about the printing, so it wins over the type words);
 *   • an Artifact Creature is a creature on the artifact frame (TODO 1.7 —
 *     Solemn Simulacrum M21 #239 is the curated m15artifact/c reference);
 *   • an artifact token is the artifact token frame (Treasure).
 * An Artifact Land is a land (land outranks artifact), and every other
 * artifact is the Artifact kind, whose standard is already m15artifact.
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

  const artifact = typeLineWords(frontTypeLine(card)).words.some(
    (w) => w.cardType === "artifact",
  );
  if (base === "m15") {
    const effects = (card.frame_effects ?? []).map((e) => e.toLowerCase());
    if (effects.includes("snow")) return "m15snow";
    if (effects.includes("devoid")) return "m15devoid";
    if (artifact && kind === "creature") return "m15artifact";
  }
  if (base === "m15token" && artifact) return "m15tokenartifact";
  return base;
}

/**
 * A printing treatment the importer can't reproduce yet. The frame the
 * import lands on is still the era/skin template above — this only names
 * what the printing had, so the creator can say so (TODO 1.16) instead of
 * reporting a silent exact match. The signature registry (1.4/1.17/1.19)
 * replaces it by resolving these printings to real templates.
 */
export type PrintingTreatment =
  | "borderless"
  | "showcase"
  | "extendedart"
  | "fullart"
  | "textless";

/**
 * The treatment of THIS PRINTING that its imported frame drops, or
 * undefined when the plain frame is the printing's own look. One label per
 * printing, most visible first: a border change beats a frame change beats
 * an art change (BLB #316 is borderless AND showcase → borderless; DSK #389,
 * a Japan showcase, is showcase AND full art → showcase). Full-art and
 * textless tokens on the 2015 frame are skipped: they land on `m15token`,
 * which is that family's own frame (T2XM #4).
 */
export function printingTreatmentFromScryfall(
  card: ScryfallCard,
): PrintingTreatment | undefined {
  if ((card.border_color ?? "").toLowerCase() === "borderless") {
    return "borderless";
  }
  const effects = (card.frame_effects ?? []).map((e) => e.toLowerCase());
  if (effects.includes("showcase")) return "showcase";
  if (effects.includes("extendedart")) return "extendedart";
  const textless = card.textless === true;
  if (!textless && card.full_art !== true && !effects.includes("fullart")) {
    return undefined;
  }
  if ((card.frame ?? "").trim() === "2015" && kindFromScryfall(card) === "token") {
    return undefined;
  }
  return textless ? "textless" : "fullart";
}

const PRINTING_TREATMENT_PHRASES: Record<PrintingTreatment, string> = {
  borderless: "is borderless",
  showcase: "has a showcase frame",
  extendedart: "has extended art",
  fullart: "is full art",
  textless: "is textless",
};

/**
 * The creator's toast once an import has landed: "This printing is
 * borderless — PipGlyph used the bordered M15 (2015) Standard frame."
 * `landed` is the template the card actually got (after the published-frame
 * resolution), so the copy never names a frame the card isn't on.
 */
export function printingTreatmentNotice(
  treatment: PrintingTreatment,
  landed: FrameTemplate,
): string {
  const frame = describeFrame(landed);
  return `This printing ${PRINTING_TREATMENT_PHRASES[treatment]} — PipGlyph used the ${
    treatment === "borderless" ? `bordered ${frame}` : frame
  } frame.`;
}

/**
 * The import dialog's heads-up before the user commits, while they can
 * still pick another printing. The final frame isn't known yet (it is
 * resolved against the published frames in the form), so it isn't named.
 */
export function printingTreatmentHint(treatment: PrintingTreatment): string {
  return `This printing ${PRINTING_TREATMENT_PHRASES[treatment]}, which PipGlyph doesn't offer yet — the import uses ${
    treatment === "borderless" ? "a bordered" : "the regular"
  } frame instead.`;
}

/**
 * Best-effort: pull a normalized color identity from either Scryfall's
 * `color_identity` (preferred — accounts for lands and hybrid mana) or
 * `colors` as a fallback. Two or more colors collapse to ["multicolor"] —
 * the creator's color model is single-select (one frame dress per card).
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
  if (out.length > 1) return ["multicolor"];
  // Empty identity means "colorless" — surface that so the form picks it up.
  if (out.length === 0) out.push("colorless");
  return out.filter((v) =>
    (COLOR_IDENTITY_VALUES as readonly string[]).includes(v),
  );
}

/**
 * The identity /admin/frame-compare renders a REAL printing with: like
 * parseColorIdentity, except a two-colour printing keeps both colours, so a
 * split-frame template (Dragon Wing, FrameProfile.twoColorSplit) draws the
 * split wings the scan shows — MUL #60 Taigam is W/U — instead of the
 * creator's single "multicolor" dress. Every other frame resolves a
 * two-colour identity to the same "m" frame, so nothing else changes.
 */
export function referenceColorIdentity(card: ScryfallCard): ColorIdentity[] {
  const collapsed = parseColorIdentity(card);
  if (collapsed[0] !== "multicolor") return collapsed;
  const colors = [...new Set(card.color_identity ?? card.colors ?? [])]
    .map((code) => SCRYFALL_COLOR_TO_IDENTITY[code])
    .filter(Boolean);
  return colors.length === 2 ? colors : collapsed;
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

  // A layout kind fixes the card type the form writes (a Saga is an
  // enchantment): read the type line against it, so Urza's Saga ("Enchantment
  // Land") keeps "Land" in front instead of printing "Enchantment
  // Enchantment".
  const kind = kindFromScryfall(card);
  const typeParts = parseTypeLine(pick(front?.type_line, card.type_line), {
    cardType: kind ? KIND_DEFS[kind].cardType : undefined,
  });
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
    kind,
    frame_template: frameTemplateFromScryfall(card),
    printing_treatment: printingTreatmentFromScryfall(card),
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
