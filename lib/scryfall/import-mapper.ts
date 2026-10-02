import type { ScryfallCard, ScryfallSet } from "@/lib/scryfall/client";
import {
  DEFAULT_CARD_LANG,
  isCardLang,
  isValidCollectorNumber,
  isValidSetCode,
  normalizeSetCode,
  type CardLang,
} from "@/lib/cards/collector-fields";
import type { CollectorSwitch } from "@/lib/cards/collector-line";
import {
  CARD_TYPE_VALUES,
  COLOR_IDENTITY_VALUES,
  FRAME_SET_ERA,
  FRAME_TEMPLATE_SET,
  RARITY_VALUES,
  type CardType,
  type ColorIdentity,
  type FrameTemplate,
  type Rarity,
} from "@/types/card";
import {
  KIND_DEFS,
  isSingleBasicLand,
  kindFromCard,
  templateRefusesKind,
  walkerRowCount,
  walkerRowsFrameFor,
  type CardKind,
} from "@/lib/creator/card-kinds";
import { isFrameComboAvailable } from "@/lib/cards/frame-availability";
import { isArtifactFrameType, pickFrameColorKey } from "@/components/cards/frame-layer";
import { describeFrame, withVerification } from "@/lib/creator/frame-resolve";
import { qualifiesForCrown, twoColorPairOf, type TwoColorPair } from "@/lib/cards/anatomy";
import { supertypeHasWord } from "@/lib/cards/card-display";
import {
  FULL_ART_BASIC_2022_SETS,
  isM20DesignPrinting,
  landFrameColorRule,
  resolveFrameSignature,
  type FrameMatch,
  type PrintingFacts,
} from "@/lib/scryfall/frame-signatures";

export { FULL_ART_BASIC_2022_SETS };
export type { FrameMatch };

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
// with them — parseTypeLine). Unknown words (Scheme, Conspiracy, Plane, …)
// are dropped; "Emblem" is the emblem card type (TODO 6.23).
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
  // CR 114 (TODO 6.23): "Emblem" / "Emblem — Vivien" is the emblem card type.
  emblem: "emblem",
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
//   • enchantment beats artifact — a "Legendary Enchantment Artifact"
//     (Bident of Thassa THS #42, the Theros god weapons) prints on the
//     enchantment frame (Nyx), never the artifact frame.
// The other words are NOT lost: they ride in `supertype`, in printed order,
// so "Artifact Creature — Golem" keeps its "Artifact". (The renderers print
// the supertype BEFORE the card type, so a line whose card type isn't its
// last word — "Land Creature", "Enchantment Land" under a layout kind — reads
// the words in another order: a renderer item, TODO 1.20. A token prints
// "Token" first, then its words — "Token Artifact Creature — Thopter" — so
// its line round-trips, and the token picker reads the same words: TODO
// 3b.15.)
const CARD_TYPE_PRECEDENCE: readonly CardType[] = [
  // An emblem's line carries no other card type ("Emblem — Ajani").
  "emblem",
  "token",
  "land",
  "creature",
  "planeswalker",
  "battle",
  "enchantment",
  "artifact",
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
  /** The frame the import lands on: the signature registry's match
   *  (`frame_match.landOn ?? frame_match.template`). Standard kinds only —
   *  layout kinds' templates are fixed by the kind. Kept beside frame_match
   *  for older readers (the AI deck remix, cached patches). The form applies
   *  it after the kind patch, falling back to the era standard when the
   *  combo isn't published yet. */
  frame_template?: FrameTemplate;
  /** THIS PRINTING's frame signature (TODO 1.4, lib/scryfall/
   *  frame-signatures.ts): which PipGlyph frame reproduces it (`exact`),
   *  which comes nearest and why, or that none does. Static here — the
   *  /api/scryfall/named route downgrades an exact match whose combo isn't
   *  verified in the card's colour (withVerification). */
  frame_match?: FrameMatch;
  card_type?: CardType;
  supertype?: string;
  subtypes_text?: string;
  rarity?: Rarity;
  /** The card's COLOUR as the creator models it — the one frame dress the
   *  card wears (single-select: two or more colours → ["multicolor"]). It is
   *  the printed FRONT FACE's colour (frameColorsFromScryfall, TODO 1.2),
   *  never Scryfall's Commander `color_identity`: a DFC whose back is
   *  another colour (Ajani, Nacatl Pariah) imports as its white front, and
   *  Westvale Abbey as the colourless land it is. The field never held
   *  Commander identity — it collapses two colours to "multicolor" — and
   *  nothing reads it as such: a deck entry's identity is
   *  deck_cards.color_identity, which the deck importer copies from
   *  Scryfall directly (lib/decks/import-resolution.ts), not through this
   *  mapper. */
  color_identity?: ColorIdentity[];
  /** The front face's colour PAIR when it is exactly two colours, in
   *  printed order (TODO 4.6b, lib/cards/anatomy.ts). The creator and the
   *  AI deck remix store it as the card's color_identity where the frame
   *  the card lands on draws the two-colour frame (importedAnatomy);
   *  elsewhere `color_identity`'s "multicolor" stands. */
  color_pair?: TwoColorPair;
  /** THIS printing's crown (TODO 4.6a, owner decisions 2026-09-29 and
   *  round 17, 2026-09-30: printing-only) — the import's value for the
   *  card's crown switch (crownSwitchFromPrinting):
   *   • `true` — it prints the standard legendary crown: Scryfall's
   *     `legendary` frame effect (DOM 2018 on);
   *   • `false` — a Legendary SHOWCASE printing (the LTR ring and scroll,
   *     TDM draconic, BLB woodland, TLA avatar, MUL's etched run …), which
   *     prints no standard crown ("match scan"), or a Legendary card printed
   *     without one (the M15–RIX legendaries, the List / playtest reprints);
   *   • absent — a nonlegendary printing, a showcase one included (owner
   *     2026-09-30, pick (b)): nothing to follow, so the card gets the
   *     new-card default (on) if it is made Legendary later. */
  printed_crown?: boolean;
  /** `true` when THIS printing's own frame is two-coloured (TODO 4.6b): a
   *  2015-frame printing whose front face is exactly two colours
   *  (color_pair) — the import then switches the two-colour frame on and
   *  stores the pair. Absent otherwise, never `false` (owner round 17,
   *  2026-09-30: printing-only), so a card given a pair later starts with
   *  the switch on like any new card. */
  printed_two_color?: true;
  /** The collector line THIS printing prints (TODO 4.9b, owner 2026-09-29:
   *  imports follow the printing): "2015" or "2023" for a 2015-frame
   *  printing (collectorStyleOfPrinting), "off" for an older frame, which
   *  prints "Illus." in its box and no collector line. */
  printed_collector?: CollectorSwitch;
  /** `true` for a foil-only printing (`finishes` = ["foil"]: the ★
   *  separator, KLD #265 "KLD★EN" — also an etched-only one, ONC #29
   *  "ONC★EN"), else absent. */
  printed_star?: true;
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
  /** Display-only, beside printing_treatment: the facts about THIS printing
   *  that name the nearest PipGlyph frame for it (printingTreatmentOffer) —
   *  a borderless basic with bars (FRA #382) and a textless one (UNF #235)
   *  share one treatment, and so do the 2022 full-art basic design and
   *  Zendikar's split bar. */
  printing_detail?: PrintingDetail;
  /** The Scryfall card id — kept on the patch so the form can request an
   *  art import for the same card via /api/scryfall/import-art. */
  source_scryfall_id?: string;
  /** Log-only: WHICH printing this is and the facts that shape its
   *  art_crop, for the frame request row an inexact import writes (TODO
   *  1.6 / 1.18, lib/frames/frame-requests.ts). Never written to the form. */
  printing?: ImportedPrinting;
  /** The printing's collector fields (TODO 4.9a; owner 2026-09-29: imports
   *  follow the printing) — the PRINTED set code, the number in the style
   *  the printing shows (a 2015-era expansion's "107/281", a 2023-era
   *  "1") and the language, for cards.set_code / collector_number / lang
   *  (collectorFieldsFromPrinting). Absent when the printing's SET data
   *  was needed (a token set's parent, a 2015-era size) and the caller had
   *  none: the form keeps its fields and the editor offers "Fill from the
   *  printing". No frame_style key travels here (4.9b / 4.9c write theirs). */
  collector?: ImportedCollectorFields;
  /** Display-only preview URL. NOT written to the form's `art_url` — the
   *  user has to explicitly opt in to importing the art. */
  preview_art_url?: string | null;
  /** When present, the Scryfall card has two faces and the back-face
   *  content should be seeded into the form's back_face fields. The
   *  back-face art is imported separately via the `mode: "art-back"`
   *  option on /api/scryfall/import-art. */
  back_face?: ScryfallImportBackFacePatch;
  /** Display-only: the second face this import left out (TODO 1.23) — a
   *  double-faced token or a Role card imports its front face with no
   *  `back_face`, and the creator says so (droppedFaceNotice). */
  dropped_face?: DroppedFace;
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
   *  to also import artwork on the front face and the printing's second
   *  face has its own image (the named route's `has_back_image`, TODO 1.8)
   *  — the back-face import is triggered in the same flow. */
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

/** True when a type line's front face says Token. */
function isTokenTypeLine(typeLine: string | null | undefined): boolean {
  return typeLineWords(typeLine).words.some((w) => w.cardType === "token");
}

/** The second face an import leaves out (TODO 1.23), or undefined: a
 *  double-faced token (TMOM #16 Incubator // Phyrexian) imports its front
 *  face until two-sided tokens exist (5.5); a Role card (TWOE #15) its front
 *  Role, for good (no two-Role layout is planned). */
export type DroppedFace = "double-faced-token" | "role";

export function droppedFaceOf(card: ScryfallCard): DroppedFace | undefined {
  const layout = (card.layout ?? "").toLowerCase();
  if (layout === "double_faced_token") return "double-faced-token";
  if (layout === "flip" && isTokenTypeLine(frontTypeLine(card))) return "role";
  return undefined;
}

/** The toast (and the import dialog's note) for a face the import left out:
 *  "Incubator // Phyrexian is a double-faced token — PipGlyph imported its
 *  front face, Incubator." */
export function droppedFaceNotice(
  patch: Pick<ScryfallImportPatch, "dropped_face" | "title">,
  cardName: string,
): string | null {
  switch (patch.dropped_face) {
    case "double-faced-token":
      return `${cardName} is a double-faced token — PipGlyph imported its front face, ${patch.title ?? "the front"}. Two-sided tokens aren't supported yet.`;
    case "role":
      return `${cardName} holds two Roles — PipGlyph imported the front one, ${patch.title ?? "the front Role"}.`;
    default:
      return null;
  }
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
  // WOE's Role cards are Scryfall's `flip` layout but tokens: the front Role
  // imports on the token kind (TODO 1.23, the owner's override of 1.21's B2
  // for Roles only; Kamigawa's flip cards keep the flip kind).
  if (layout === "flip") return isTokenTypeLine(frontTypeLine(card)) ? "token" : "flip";
  if (layout === "adventure" || layout === "omen") return "adventure";

  const { card_type } = parseTypeLine(frontTypeLine(card));
  if (!card_type) return undefined;
  return kindFromCard(card_type, undefined);
}

/**
 * What the signature registry (lib/scryfall/frame-signatures.ts) reads of a
 * printing beyond Scryfall's own fields: the kind, the front face's type
 * words, whether it is one basic land, and its frame colours — the
 * importer's own rules (TODO 1.2 / 1.3), so the registry and the import
 * agree on every card.
 */
export function printingFacts(card: ScryfallCard): PrintingFacts {
  const front = card.card_faces?.[0];
  const typeLine = frontTypeLine(card);
  const { words, subtypes } = typeLineWords(typeLine);
  const parsed = parseTypeLine(typeLine);
  const multiFace = (card.card_faces?.length ?? 0) >= 2;
  const indicator = (multiFace ? front?.color_indicator : card.color_indicator) ?? [];
  const back = card.card_faces?.[1];
  return {
    kind: kindFromScryfall(card),
    cardTypes: new Set(words.flatMap((w) => (w.cardType ? [w.cardType] : []))),
    supertypes: new Set(words.filter((w) => !w.cardType).map((w) => w.word)),
    subtypes,
    singleBasic: isSingleBasicLand({
      cardType: parsed.card_type,
      supertype: parsed.supertype,
      subtypes,
      title: front?.name ?? card.name,
      rulesText: front?.oracle_text ?? card.oracle_text,
    }),
    colors: frontFaceColors(card),
    colorIndicator: indicator.length > 0,
    omen: typeLineWords(back?.type_line).subtypes.includes("Omen"),
  };
}

/** THIS PRINTING's frame signature: the registry's static match (TODO 1.4).
 *  withVerification (lib/creator/frame-resolve.ts) finalizes it against the
 *  verified combos. */
export function frameMatchFromScryfall(card: ScryfallCard): FrameMatch {
  return resolveFrameSignature(card, printingFacts(card));
}

/** THIS PRINTING's match as the user sees it: the registry's static match
 *  finalized against the verified combos in the card's frame colour (an
 *  unverified `exact` is only `nearest`). /api/scryfall/named puts it on the
 *  patch; /api/scryfall/printings on every printing of the grid (TODO 1.5). */
export function verifiedFrameMatchFromScryfall(
  card: ScryfallCard,
  verifiedKeys: ReadonlySet<string>,
  match: FrameMatch = frameMatchFromScryfall(card),
): FrameMatch {
  return withVerification(match, pickFrameColorKey(frameColorsFromScryfall(card)), verifiedKeys);
}

/**
 * The frame an import of THIS PRINTING lands on — the signature registry's
 * `landOn ?? template` (a thin wrapper kept for older callers and tests).
 * Undefined for layout kinds (their template is fixed by the kind — saga is
 * saga in every era) and for cards with no card type PipGlyph makes.
 *
 * The registry keeps 1.3's dress rules on the M15 era: snow/devoid
 * printings re-dress the plain spell frame and a snow land the land frame
 * (Snow-Covered Island KHM #278); an Artifact Creature is a creature on the
 * artifact frame (Solemn Simulacrum M21 #239); an artifact token is the
 * artifact token frame (Treasure). An Artifact Land is a land.
 */
export function frameTemplateFromScryfall(
  card: ScryfallCard,
  match: FrameMatch = frameMatchFromScryfall(card),
): FrameTemplate | undefined {
  const kind = kindFromScryfall(card);
  if (!kind || KIND_DEFS[kind].layoutTemplates) return undefined;
  return match.landOn ?? match.template;
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
 * textless 2014–19 tokens on the 2015 frame are skipped: they land on
 * `m15token`, which is that design's own frame. A token from M20 on
 * (isM20DesignPrinting: T2XM #4, TM20 #2) is not: it wears the full-art
 * design PipGlyph doesn't draw yet (4.48), so it is named like any other
 * nearest (TODO 1.23).
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
  if (
    (card.frame ?? "").trim() === "2015" &&
    kindFromScryfall(card) === "token" &&
    !isM20DesignPrinting(card)
  ) {
    return undefined;
  }
  return textless ? "textless" : "fullart";
}

/** What printingTreatmentOffer reads of a printing besides its treatment. */
export type PrintingDetail = {
  /** Scryfall set code, lower case ("fdn"). */
  set: string | null;
  /** `full_art`, or the `fullart` frame effect. */
  fullArt: boolean;
  textless: boolean;
};

/** The printing facts for printing_detail, or undefined for a printing the
 *  import reproduces (no treatment, nothing to offer). */
export function printingDetailFromScryfall(card: ScryfallCard): PrintingDetail | undefined {
  if (!printingTreatmentFromScryfall(card)) return undefined;
  const effects = (card.frame_effects ?? []).map((e) => e.toLowerCase());
  return {
    set: card.set ? card.set.toLowerCase() : null,
    fullArt: card.full_art === true || effects.includes("fullart"),
    textless: card.textless === true,
  };
}

/** A printing's identity and art-relevant facts (ScryfallImportPatch
 *  .printing), in Scryfall's own field names. */
export type ImportedPrinting = {
  /** Scryfall set code, lower case ("dmu"). */
  set: string | null;
  collector_number: string | null;
  /** `border_color`, lower case ("black", "borderless"). */
  border_color: string | null;
  /** `full_art`, or the `fullart` frame effect. */
  full_art: boolean;
  textless: boolean;
};

export function importedPrintingFromScryfall(card: ScryfallCard): ImportedPrinting {
  const effects = (card.frame_effects ?? []).map((e) => e.toLowerCase());
  const set = (card.set ?? "").trim().toLowerCase();
  const collector = (card.collector_number ?? "").trim();
  const border = (card.border_color ?? "").trim().toLowerCase();
  return {
    set: set || null,
    collector_number: collector || null,
    border_color: border || null,
    full_art: card.full_art === true || effects.includes("fullart"),
    textless: card.textless === true,
  };
}

// ---------------------------------------------------------------------------
// The collector fields (TODO 4.9a, 4.9 design §4.3): what a printing's
// collector line SAYS, read from the Scryfall card and — only when needed —
// its set object (getScryfallSet, ≤ 1 extra call per import). Every value
// is the printed one or nothing: never invented.
// ---------------------------------------------------------------------------

/** Scryfall set codes whose printings print another code — scan-verified:
 *  PW23 #3 prints "PRM★PH". Fixtures add rows. */
export const PRINTED_SET_CODE_EXCEPTIONS: Readonly<Record<string, string>> = {
  pw23: "PRM",
};

/** The first release date from which EVERY printing prints the "2023"
 *  collector style (the letter first, the number padded to four, no set
 *  size: "R 1242"), judged on `released_at`. Pinned by the scans of every
 *  2015-frame paper printing released between ONE / ONC (2023-02-10, the
 *  last expansion and commander sets in the 2015 style: "019/271 R",
 *  "114 R") and 2023-03-26 (TODO 4.9b, 2026-09-30, scratchpad
 *  collector-line/boundary): the two styles overlap by PRODUCT for six
 *  weeks — the 2023 style is already on PL23 #1 (2023-02-10, "P 0001"),
 *  SLD #8001 (02-17, "M 8001"), SLP #1 (02-19, "P 0001") and SLD #1243–1246
 *  (02-20, "R 1243"), while the Secret Lair bonus cards SLD #685 (02-20,
 *  "685 R"), #716 (02-21, "716 P") and #681 (03-16, "681 R"), PRCQ #1
 *  (02-25, "001/003 P"), SCH #7 (02-25, "007 P"), PW23 #1 (03-10,
 *  "001/001 P") and P30H #1 (03-21, "001/005 P") still print the 2015
 *  style. P30H #1 is the last 2015-style printing; from SLD #728 / #1237–
 *  1242 (03-26) on every scan is 2023-style (SLD #1207 04-14, PMOM / MOM /
 *  MOC 04-21, PW23 #3 05-25). The early 2023-style products before the
 *  date are COLLECTOR_2023_STYLE_EARLY. The date also decides the STORED
 *  number's form (storedCollectorNumber: "N/size" before it, the number
 *  alone from it), which the early products never contest — a promo's or
 *  box set's number is alone in either style. */
export const COLLECTOR_2023_FROM = "2023-03-26";

/** Printings that print the "2023" collector style before
 *  COLLECTOR_2023_FROM (scan-verified, above): the 2023 Lunar New Year
 *  promo, the Secret Lair Showdown prizes, and the Secret Lair drops
 *  numbered from 1243 (the February 2023 drops) and 8001 (the Secret Lair
 *  Prize) on — never the bonus-card reprints numbered below them. */
export const COLLECTOR_2023_STYLE_EARLY: Readonly<Record<string, { fromNumber?: number }>> = {
  pl23: {},
  slp: {},
  sld: { fromNumber: 1243 },
};

/** The first release day of an early 2023-style product (PL23 #1,
 *  2023-02-10): COLLECTOR_2023_STYLE_EARLY never reaches back before it.
 *  Secret Lair has numbers past 1243 that are a year older — SLD #9995–9999
 *  (2022-04-12, the mirrored "left-handed" drop) print the 2015 style, the
 *  number alone at the edge and the letter in its column ("M      9995",
 *  mirrored; scans 2026-10-02). */
export const COLLECTOR_2023_STYLE_EARLY_FROM = "2023-02-10";

/**
 * The collector line a printing draws (TODO 4.9b, ScryfallImportPatch
 * .printed_collector): "off" for any frame but 2015 (the 1993 / 1997 / 2003
 * / future frames print "Illus." inside the box — the line is never drawn on
 * a card imported from one, whatever frame it lands on); else the style by
 * release date (COLLECTOR_2023_FROM), or "2023" early for the products in
 * COLLECTOR_2023_STYLE_EARLY released from COLLECTOR_2023_STYLE_EARLY_FROM
 * on. A printing with no release date takes the current style, as
 * storedCollectorNumber does.
 */
export function collectorStyleOfPrinting(
  card: Pick<ScryfallCard, "frame" | "released_at" | "set" | "collector_number">,
): CollectorSwitch {
  if ((card.frame ?? "").trim() !== "2015") return "off";
  if (isCollector2023Style(card.released_at)) return "2023";
  // Before the first early product nothing prints the 2023 style, whatever
  // its set and number (SLD #9995–9999, 2022).
  if ((card.released_at ?? "").trim() < COLLECTOR_2023_STYLE_EARLY_FROM) return "2015";
  const early = COLLECTOR_2023_STYLE_EARLY[(card.set ?? "").trim().toLowerCase()];
  if (!early) return "2015";
  if (early.fromNumber === undefined) return "2023";
  const number = Number.parseInt((card.collector_number ?? "").trim(), 10);
  return Number.isFinite(number) && number >= early.fromNumber ? "2023" : "2015";
}

/** The ★ of a foil-only printing (ScryfallImportPatch.printed_star): every
 *  finish Scryfall lists is a foil one (KLD #265 ["foil"]; ONC #29
 *  ["etched"] prints "ONC★EN" too), else undefined — a nonfoil printing, or
 *  one that comes in both. */
export function starOfPrinting(card: Pick<ScryfallCard, "finishes">): true | undefined {
  const finishes = (card.finishes ?? []).map((finish) => finish.toLowerCase());
  return finishes.length > 0 && finishes.every((finish) => finish === "foil" || finish === "etched")
    ? true
    : undefined;
}

/** Set types whose printings print their PARENT set's code (TDOM #1 prints
 *  "DOM • EN", TFDN #24 "FDN • EN"). */
const PARENT_CODE_SET_TYPES: ReadonlySet<string> = new Set(["token", "memorabilia", "promo"]);

/** Set types whose 2015-era printings print `N/printed_size` after the
 *  number (DMU #107 "107/281"). Tokens print `N/card_count` (TDOM #1
 *  "001/016", TELD #1 "001/020"); commander deck sets print the size
 *  `deckSetPrintedSize` reads; promo, box and every other type print the
 *  number alone (SLD #134 "134", 2020). Scryfall's `printed_size` is
 *  missing on some sets that print one (ELD, THB, M20, CMR): those store
 *  the number alone — never an invented size. Scans 2026-09-30. */
const PRINTED_SIZE_SET_TYPES: ReadonlySet<string> = new Set([
  "expansion",
  "core",
  "masters",
  "draft_innovation",
]);

/** The first release date from which a number PAST the printed size prints
 *  alone: ELD (2019-10-04), the first set whose collector-booster variants
 *  are numbered past the main set (scans: ELD #270 "270", THB #255, ZNR
 *  #281 "281", DMU #282 "282", DMU #330, ONE #272; the same on commander
 *  sets: ONC #29 "029", C21 #82, AFC #63, DMC #49). Before it the size
 *  stays on an over-size number: KLD #265 "265/264", WAR #265, M19 #281,
 *  MH1 #255 "255/254", M20 #281 "281/280" (2019-07-12, the last). So Card
 *  Conjurer's `N ≤ size` guard is right from ELD on and wrong before. */
export const OVERSIZE_NUMBER_ALONE_FROM = "2019-10-04";

/** Commander deck sets released before ZNC (2020-09-25) print the WHOLE
 *  deck set's count after the number — C15 "001/342", CMA "001/320", C17
 *  "001/309", C18 "001/307", C19 "001/302", C20 "001/322" (2020-04-17, the
 *  last): Scryfall's `card_count`, its `printed_size` being absent on them.
 *  ZNC and KHC print the number alone ("001"); from C21 (2021-04-23) the
 *  NEW-card count, which Scryfall holds as `printed_size` (C21 "001/081",
 *  AFC "001/062", MIC / VOC / NEC "001/038", NCC "001/093", ONC "001/028").
 *  DMC prints "001/048" but Scryfall lacks the count: it stores the number
 *  alone. */
export const DECK_SET_COUNT_PRINTED_BEFORE = "2020-09-25";

export type ImportedCollectorFields = {
  /** The PRINTED set code, upper-case, or null when none fits the column. */
  set_code: string | null;
  /** The number as stored ("107/281", "1", "237a"), or null. */
  collector_number: string | null;
  /** The printing's language (one of the 18 the column takes). */
  lang: CardLang;
};

/** True for a printing released on or after COLLECTOR_2023_FROM — and for
 *  one with no release date, whose set size is unknowable: it stores the
 *  number alone rather than an invented size. */
export function isCollector2023Style(releasedAt: string | null | undefined): boolean {
  const date = (releasedAt ?? "").trim();
  return !date || date >= COLLECTOR_2023_FROM;
}

/** Whether the collector fields of this printing need its SET object: the
 *  parent code of a token / memorabilia / promo set (unless an exception
 *  names the printed code), or the size of a 2015-era expansion-type,
 *  token or commander printing. A 2023-era expansion, a promo or a box set
 *  needs no call at all. */
export function needsScryfallSet(card: ScryfallCard): boolean {
  const set = (card.set ?? "").trim().toLowerCase();
  const setType = (card.set_type ?? "").trim().toLowerCase();
  const needsParent = PARENT_CODE_SET_TYPES.has(setType) && !PRINTED_SET_CODE_EXCEPTIONS[set];
  const needsSize =
    !isCollector2023Style(card.released_at) &&
    (PRINTED_SIZE_SET_TYPES.has(setType) || setType === "token" || setType === "commander");
  return needsParent || needsSize;
}

function printedSetCode(card: ScryfallCard, set: ScryfallSet | null): string | null {
  const scryfallCode = (card.set ?? "").trim().toLowerCase();
  if (!scryfallCode) return null;
  const setType = (card.set_type ?? "").trim().toLowerCase();
  const parent = PARENT_CODE_SET_TYPES.has(setType) ? set?.parent_set_code?.trim() : undefined;
  const printed = PRINTED_SET_CODE_EXCEPTIONS[scryfallCode] ?? (parent || scryfallCode);
  const normalized = normalizeSetCode(printed);
  // Clamped to the column's CHECK, else nothing.
  return isValidSetCode(normalized) ? normalized : null;
}

function storedCollectorNumber(card: ScryfallCard, set: ScryfallSet | null): string | null {
  const number = (card.collector_number ?? "").trim();
  if (!number) return null;
  const stored = isCollector2023Style(card.released_at)
    ? number
    : withPrintedSize(number, card, set);
  return isValidCollectorNumber(stored) ? stored : null;
}

function positiveCount(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/** The size a commander deck set prints after its numbers: the new-card
 *  count Scryfall holds as `printed_size` (C21 on); before ZNC the whole
 *  deck set's `card_count`; otherwise none (ZNC, KHC — and DMC, whose
 *  count Scryfall lacks). */
function deckSetPrintedSize(card: ScryfallCard, set: ScryfallSet | null): number | null {
  const printed = positiveCount(set?.printed_size);
  if (printed) return printed;
  const released = (card.released_at ?? "").trim();
  return released && released < DECK_SET_COUNT_PRINTED_BEFORE
    ? positiveCount(set?.card_count)
    : null;
}

/** The size a 2015-era printing's set type prints after the number, or
 *  null where the type prints none or Scryfall doesn't hold it. */
function printedSizeFor(card: ScryfallCard, set: ScryfallSet | null): number | null {
  const setType = (card.set_type ?? "").trim().toLowerCase();
  if (PRINTED_SIZE_SET_TYPES.has(setType)) return positiveCount(set?.printed_size);
  if (setType === "token") return positiveCount(set?.card_count);
  if (setType === "commander") return deckSetPrintedSize(card, set);
  return null;
}

/** A 2015-era number with the size its set type prints after it. A
 *  non-numeric number ("237a", "H13", "XLN-117") is stored as printed; a
 *  number past the size is stored alone from ELD on
 *  (OVERSIZE_NUMBER_ALONE_FROM) and with the size before. */
function withPrintedSize(number: string, card: ScryfallCard, set: ScryfallSet | null): string {
  if (!/^[0-9]+$/.test(number)) return number;
  const size = printedSizeFor(card, set);
  if (!size) return number;
  const oversize = Number(number) > size;
  const released = (card.released_at ?? "").trim();
  if (oversize && released >= OVERSIZE_NUMBER_ALONE_FROM) return number;
  return `${number}/${size}`;
}

/**
 * The collector fields a Scryfall printing fills (cards.set_code /
 * collector_number / lang). `set` is the printing's set object when the
 * caller fetched one (the /named route does when needsScryfallSet says
 * so); undefined when the fields NEED it and it is missing — the caller
 * then writes nothing, never a guessed parent or size.
 */
export function collectorFieldsFromPrinting(
  card: ScryfallCard,
  set: ScryfallSet | null | undefined,
): ImportedCollectorFields | undefined {
  if (needsScryfallSet(card) && !set) return undefined;
  return {
    set_code: printedSetCode(card, set ?? null),
    collector_number: storedCollectorNumber(card, set ?? null),
    lang: isCardLang(card.lang) ? card.lang : DEFAULT_CARD_LANG,
  };
}

const PRINTING_TREATMENT_PHRASES: Record<PrintingTreatment, string> = {
  borderless: "is borderless",
  showcase: "has a showcase frame",
  extendedart: "has extended art",
  fullart: "is full art",
  textless: "is textless",
};

/**
 * The deck-remix pre-fill's toast for an older patch that carries no
 * `frame_match` (the import dialog asks with its frame chooser instead, and
 * a current patch is named by importSubstitutionMessage,
 * lib/creator/import-frame-choice.ts): "This printing is
 * borderless — PipGlyph used the bordered M15 (2015) Standard frame."
 * `landed` is the template the card actually got (after the published-frame
 * resolution), so the copy never names a frame the card isn't on. "Bordered"
 * only for a plain border-era frame: since the signature registry (1.4) a
 * borderless printing can land on a borderless or showcase frame (a FRA
 * full-art basic on the Borderless Full-Art Basic Land, a poster on
 * Borderless), and "the bordered Borderless frame" contradicts itself.
 */
export function printingTreatmentNotice(
  treatment: PrintingTreatment,
  landed: FrameTemplate,
): string {
  const frame = describeFrame(landed);
  const set = FRAME_TEMPLATE_SET[landed];
  const bordered =
    treatment === "borderless" && set !== "borderless" && FRAME_SET_ERA[set] !== "showcase";
  return `This printing ${PRINTING_TREATMENT_PHRASES[treatment]} — PipGlyph used the ${
    bordered ? `bordered ${frame}` : frame
  } frame.`;
}

/** A PipGlyph frame the creator can OFFER for an imported printing's
 *  treatment — see printingTreatmentOffer. */
export type PrintingTreatmentOffer = {
  template: FrameTemplate;
  /** The frame's name in copy ("Borderless", "Full-Art Basic"). */
  frameLabel: string;
  /** The toast action ("Use Borderless"). */
  actionLabel: string;
};

/**
 * The PipGlyph frame that dresses an imported printing's treatment, when one
 * exists AND is published in the card's colour (frames plan 4.32 / 4.39;
 * TODO 1.16's "Use Borderless" / "Use Full-Art Basic"), for a printing the
 * import lands on another frame for. Since the signature registry (1.4 /
 * 1.17 / 1.19) the import itself lands a full-art basic on its full-art
 * frame and a borderless basic on the borderless one once verified, so
 * those need no offer: none is made when the offer is the patch's own frame
 * (`frame_template`). A borderless card lands on the bordered frame (1.18),
 * so Borderless stays an offer. An unverified frame is never offered:
 *   • borderless → the borderless M15 frame for a creature, instant, sorcery
 *     or enchantment, its artifact dress for an artifact or an Artifact
 *     Creature, and its land (4.34) for a nonbasic land that prints text;
 *     the borderless planeswalker (4.33) for a planeswalker, its tall box
 *     for four printed ability rows or more (walkerRowsFrameFor). Nothing
 *     for tokens, battles or layout cards (4.35–4.38).
 *   • a borderless full-art basic that prints text → the borderless full-art
 *     basic (`fullartland`): FRA #382–396 print its bars (dark ones, so the
 *     nearest look), and 1.17 sends every other such basic to it as the
 *     nearest. A TEXTLESS borderless basic (UNF, EOE, UST, SLD, ONE
 *     #365–369) belongs to `m15textlessland` (4.35) and gets no offer.
 *   • full art (black border) → the black-bordered full-art basic, for one
 *     basic land of the 2022 design (FULL_ART_BASIC_2022_SETS).
 * Null otherwise (showcase, extended art, textless …). A patch without
 * printing_detail (an older payload) gets no full-art offer.
 */
export function printingTreatmentOffer(
  patch: Pick<
    ScryfallImportPatch,
    | "printing_treatment"
    | "printing_detail"
    | "kind"
    | "card_type"
    | "supertype"
    | "subtypes_text"
    | "title"
    | "rules_text"
    | "color_identity"
    | "frame_template"
  >,
  verifiedKeys: ReadonlySet<string>,
): PrintingTreatmentOffer | null {
  const treatment = patch.printing_treatment;
  if (!treatment) return null;
  const kind = patch.kind ?? (patch.card_type ? kindFromCard(patch.card_type, undefined) : null);
  if (!kind) return null;
  const detail = patch.printing_detail;
  const singleBasic = () =>
    isSingleBasicLand({
      cardType: patch.card_type,
      supertype: patch.supertype,
      subtypes: (patch.subtypes_text ?? "")
        .split(/[,\n]/)
        .map((part) => part.trim())
        .filter(Boolean),
      title: patch.title,
      rulesText: patch.rules_text,
    });
  const offer = (() => {
    if (treatment === "borderless") {
      if (kind === "land") {
        if (singleBasic()) {
          return detail?.fullArt && !detail.textless
            ? { template: "fullartland" as const, frameLabel: "Borderless Full-Art Basic" }
            : null;
        }
        // A nonbasic land: the borderless land frame (4.34), unless the
        // printing is textless (m15textless*, 4.35).
        return detail?.textless ? null : { template: "m15borderlessland" as const, frameLabel: "Borderless Land" };
      }
      if (kind === "planeswalker") {
        const template = walkerRowsFrameFor(
          "planeswalker",
          "m15borderlesspw",
          walkerRowCount({ rulesText: patch.rules_text }),
        );
        return { template, frameLabel: "Borderless Planeswalker" };
      }
      const artifact = isArtifactFrameType({ cardType: patch.card_type, supertype: patch.supertype });
      if (kind === "artifact" || (kind === "creature" && artifact)) {
        return { template: "m15borderlessartifact" as const, frameLabel: "Borderless Artifact" };
      }
      if (!templateRefusesKind("m15borderless", kind)) {
        return { template: "m15borderless" as const, frameLabel: "Borderless" };
      }
      return null;
    }
    if (
      treatment === "fullart" &&
      kind === "land" &&
      detail?.set &&
      FULL_ART_BASIC_2022_SETS.has(detail.set) &&
      singleBasic()
    ) {
      return { template: "m15fullartland" as const, frameLabel: "Full-Art Basic" };
    }
    return null;
  })();
  if (!offer || offer.template === patch.frame_template) return null;
  const colorKey = pickFrameColorKey(patch.color_identity ? [...patch.color_identity] : undefined);
  if (!isFrameComboAvailable(offer.template, colorKey, verifiedKeys)) return null;
  return { ...offer, actionLabel: `Use ${offer.frameLabel}` };
}

// A basic land type's intrinsic mana ability (rule 305.6): a face typed
// Plains taps for {W} with no text saying so.
const BASIC_LAND_TYPE_COLOR: Record<string, string> = {
  Plains: "W",
  Island: "U",
  Swamp: "B",
  Mountain: "R",
  Forest: "G",
};

const WUBRG_LETTERS: ReadonlySet<string> = new Set(
  Object.keys(SCRYFALL_COLOR_TO_IDENTITY),
);

/** The WUBRG letters of a list, in order, once each (drops C and junk). */
function wubrgLetters(codes: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const code of codes) {
    if (code && WUBRG_LETTERS.has(code) && !out.includes(code)) {
      out.push(code);
    }
  }
  return out;
}

/** The colours of every mana symbol in the text: {W}, {W/U}, {2/W},
 *  {W/P}, {G/U/P}. */
function manaSymbolColors(text: string | null | undefined): string[] {
  const letters: string[] = [];
  for (const [, symbol] of (text ?? "").matchAll(/\{([^}]+)\}/g)) {
    letters.push(...symbol.toUpperCase().split("/"));
  }
  return wubrgLetters(letters);
}

/**
 * The colours the printing's FRONT FACE is dressed in, as WUBRG letters
 * (TODO 1.2) — the frame colour, never Scryfall's Commander colour identity:
 *   1. The face's printed colours (`colors` + `color_indicator`). Transform,
 *      modal DFC and battle faces carry their own: Ajani, Nacatl Pariah MH3
 *      #237 is its white front, although its identity is R/W. Faces that
 *      share one card (split, flip, adventure) use the card's `colors` —
 *      Scryfall gives an adventurer its creature's colours (Callous
 *      Sell-Sword WOE #221 is black), and a split card both halves' (one
 *      frame paints both until 4.26). A Room's doors carry no colours of
 *      their own and the card's are both doors', so its first door is read
 *      from its mana cost.
 *   2. A colourless front stays colourless (Thought-Knot Seer, Solemn
 *      Simulacrum, a Talisman whose rules mention coloured mana) — except
 *      a LAND or a DEVOID card, which is dressed by its mana:
 *        • a devoid card: its `color_identity` (Eldrazi Displacer is white);
 *        • a single-faced land: the mana it PRODUCES (landFrameColors);
 *        • a multi-faced land front: the front face's own symbols and basic
 *          land types, because identity and produced_mana cover both faces
 *          — Westvale Abbey SOI #281 is a colourless land whose identity is
 *          its back face's black. A reversible card is the same card on
 *          both sides, so it reads as single-faced (Command Tower SLD #2794).
 * An older cached shape with no `colors` anywhere falls back to the
 * identity, as the importer always did.
 */
export function frontFaceColors(card: ScryfallCard): string[] {
  const faces = card.card_faces ?? [];
  const front = faces.length >= 2 ? faces[0] : undefined;
  let printed: (string | null | undefined)[] | undefined;
  if (front?.colors) {
    printed = [...front.colors, ...(front.color_indicator ?? [])];
  } else if (front && isRoomCard(card)) {
    printed = [...manaSymbolColors(front.mana_cost), ...(front.color_indicator ?? [])];
  } else if (card.colors) {
    printed = [...card.colors, ...(card.color_indicator ?? [])];
  }
  if (printed === undefined) return wubrgLetters(card.color_identity ?? []);

  const colors = wubrgLetters(printed);
  if (colors.length > 0) return colors;

  const frontType = typeLineWords(frontTypeLine(card));
  const isLand = frontType.words.some((w) => w.cardType === "land");
  const isDevoid =
    (card.frame_effects ?? []).some((e) => e.toLowerCase() === "devoid") ||
    (card.keywords ?? []).some((k) => k.toLowerCase() === "devoid");
  if (!isLand && !isDevoid) return [];
  const reversible = (card.layout ?? "").toLowerCase() === "reversible_card";
  if (front && !reversible) {
    return wubrgLetters([
      ...manaSymbolColors(front.mana_cost),
      ...manaSymbolColors(front.oracle_text),
      ...frontType.subtypes.map((subtype) => BASIC_LAND_TYPE_COLOR[subtype]),
    ]);
  }
  if (!isLand) return wubrgLetters(card.color_identity ?? []);
  return landFrameColors(card);
}

/**
 * A single-faced land's frame colour (TODO 1.2). Scryfall has no field for
 * it, so this is a heuristic checked on Scryfall's scans — the land frame
 * follows the mana the land PRODUCES, not every symbol on it:
 *   • 2003 frame and later: `produced_mana`'s colours. Rootbound Crag M10
 *     #227 taps for {R}/{G} and prints R/G; a land that taps for any colour
 *     prints gold (Command Tower MSC #233, the curated m15land/m reference;
 *     Thriving Bluff JMP #33, Cliffgate CLB #350, Nykthos THS #223); a
 *     utility land that taps for {C} prints colourless although its
 *     activation costs are coloured (Kessig Wolf Run ISD #243, Gavony
 *     Township ISD #239, Hanweir Battlements EMN #204). A land Scryfall
 *     lists no produced mana for falls back to its identity — except a
 *     fetch land for two basic land types, which prints those two colours
 *     (Flooded Strand KTK #233 white and blue; landFrameColorRule).
 *   • 1993 and 1997 frames: the identity only — those frames print an
 *     any-colour land on the plain land frame (City of Brass ARN / 7ED,
 *     Rainbow Vale FEM, Path of Ancestry and Command Tower BRC).
 *   • The lands the data can't predict, by Oracle name (the signature
 *     registry's LAND_FRAME_OVERRIDES, lib/scryfall/frame-signatures.ts); a
 *     "colorless" override wins in every era, as it always did.
 */
function landFrameColors(card: ScryfallCard): string[] {
  const rule = landFrameColorRule(card);
  if (Array.isArray(rule) && rule.length === 0) return [];
  const identityEra = IDENTITY_DRESSED_LAND_ERAS.has((card.frame ?? "").trim());
  if (identityEra || rule === "identity") {
    return wubrgLetters(card.color_identity ?? []);
  }
  if (rule !== null) return [...rule];
  if (card.produced_mana == null) return wubrgLetters(card.color_identity ?? []);
  return wubrgLetters(card.produced_mana);
}

// Border eras whose lands are dressed by their identity, never by the mana
// they produce (landFrameColors).
const IDENTITY_DRESSED_LAND_ERAS: ReadonlySet<string> = new Set(["1993", "1997"]);

/**
 * The imported card's colour in the creator's single-select model (one
 * frame dress per card): the front face's colours (frontFaceColors), with
 * none → ["colorless"] and two or more → ["multicolor"]. This is what the
 * import writes into the card's `color_identity` field — the frame colour,
 * not Commander identity (see ScryfallImportPatch.color_identity).
 */
export function frameColorsFromScryfall(card: ScryfallCard): ColorIdentity[] {
  const colors = frontFaceColors(card).map((code) => SCRYFALL_COLOR_TO_IDENTITY[code]);
  if (colors.length > 1) return ["multicolor"];
  if (colors.length === 0) return ["colorless"];
  return colors.filter((v) =>
    (COLOR_IDENTITY_VALUES as readonly string[]).includes(v),
  );
}

/** The front face's colour pair (frontFaceColors, exactly two colours), in
 *  printed order, or null. */
export function frontFacePairFromScryfall(card: ScryfallCard): TwoColorPair | null {
  const colors = frontFaceColors(card);
  return colors.length === 2
    ? twoColorPairOf(colors.map((code) => SCRYFALL_COLOR_TO_IDENTITY[code]))
    : null;
}

/** The registry's showcase signatures that carry no `showcase` frame effect
 *  on every printing: MUL's etched run (#66–130: `legendary` + `etched`,
 *  the Multiverse Legends frames) and the Japan showcase promos. */
function isShowcaseSignature(signature: string): boolean {
  return signature === "showcase" || signature.startsWith("showcase/") || signature === "japan-showcase";
}

/** Whether a printing prints the STANDARD legendary crown (see
 *  ScryfallImportPatch.printed_crown): the `legendary` frame effect, on a
 *  printing that isn't a showcase — neither Scryfall's `showcase` effect nor
 *  a showcase frame of the registry (`match`, THIS printing's signature),
 *  which prints its own frame and no standard crown (owner decision
 *  2026-09-29: showcase printings import with the crown off, as the scan). */
export function printsStandardCrown(
  card: ScryfallCard,
  match: FrameMatch = frameMatchFromScryfall(card),
): boolean {
  const effects = (card.frame_effects ?? []).map((e) => e.toLowerCase());
  return effects.includes("legendary") && !effects.includes("showcase") && !isShowcaseSignature(match.signature);
}

/** Whether a printing's own frame is two-coloured (see
 *  ScryfallImportPatch.printed_two_color): the 2015 frame, and a front face
 *  of exactly two colours. */
export function printsTwoColorFrame(card: ScryfallCard): boolean {
  return (card.frame ?? "").trim() === "2015" && frontFacePairFromScryfall(card) !== null;
}

/**
 * The crown switch an import writes (ScryfallImportPatch.printed_crown) —
 * printing-only (owner round 17, 2026-09-30):
 *   • a SHOWCASE printing: `false` when the card is Legendary (Q6 → b: it
 *     prints no standard crown, and imports as its scan), and nothing when it
 *     isn't (owner 2026-09-30, pick (b): like any nonlegendary printing, so
 *     the card gets the new-card default if it is made Legendary later);
 *   • `true` for a printing with the standard crown (printsStandardCrown);
 *   • `false` for a Legendary card printed without one (owner 2026-09-29:
 *     "OFF for M15–RIX legendaries"; the List reprints too — kept as built,
 *     owner 2026-09-30, pick (a));
 *   • nothing for any other printing — a card the crown doesn't print on
 *     (qualifiesForCrown: not Legendary, or a planeswalker, token, battle or
 *     emblem), whose switch is left to the new-card default.
 */
export function crownSwitchFromPrinting(
  card: ScryfallCard,
  match: FrameMatch,
  face: { cardType?: string | null; supertype?: string | null },
): boolean | undefined {
  const effects = (card.frame_effects ?? []).map((e) => e.toLowerCase());
  if (effects.includes("showcase") || isShowcaseSignature(match.signature)) {
    return supertypeHasWord(face.supertype, "Legendary") ? false : undefined;
  }
  if (printsStandardCrown(card, match)) return true;
  return qualifiesForCrown(face) ? false : undefined;
}

/**
 * The colours /admin/frame-compare renders a REAL printing with: like
 * frameColorsFromScryfall, except a two-colour printing keeps both colours,
 * so a split-frame template (Dragon Wing, FrameProfile.twoColorSplit) draws
 * the split wings the scan shows — MUL #60 Taigam is W/U — instead of the
 * creator's single "multicolor" dress. Every other frame resolves a
 * two-colour identity to the same "m" frame, so nothing else changes.
 */
export function referenceColorIdentity(card: ScryfallCard): ColorIdentity[] {
  const colors = frontFaceColors(card);
  return colors.length === 2
    ? colors.map((code) => SCRYFALL_COLOR_TO_IDENTITY[code])
    : frameColorsFromScryfall(card);
}

/**
 * One face's artist credit (TODO 1.8). A multi-face card credits each face
 * on its own — Fire // Ice DMR #215 is David Martin (Fire) and Franz
 * Vohwinkel (Ice) — while its card-level `artist` joins them ("David Martin &
 * Franz Vohwinkel"), so the card-level name is only the fallback for a face
 * Scryfall gives none. A single-faced card has only its card-level artist
 * (and no second face).
 */
export function scryfallFaceArtist(
  card: ScryfallCard,
  face: 0 | 1,
): string | undefined {
  const faces = card.card_faces ?? [];
  if (faces.length >= 2) return faces[face]?.artist ?? card.artist ?? undefined;
  return face === 0 ? (card.artist ?? undefined) : undefined;
}

/**
 * An emblem's name as its title bar prints it (TODO 1.23 / 6.23): the
 * source's name, without Scryfall's trailing " Emblem" ("Kaito, Cunning
 * Infiltrator Emblem" → "Kaito, Cunning Infiltrator"). A name without the
 * suffix (The Ring, MB2's Essence of Ajani) is kept.
 */
export function emblemTitleFromName(name: string): string {
  const trimmed = name.trim();
  const stripped = trimmed.replace(/\s+Emblem$/, "");
  return stripped || trimmed;
}

/**
 * Whether THIS emblem printing prints a subtype (TODO 1.23): the 2014–19
 * look ("Emblem — Ajani": `frame: 2015` before M20, a List reprint by its
 * pre-M20 collector prefix — isM20DesignPrinting, the tokens' rule) and AFR
 * ("Emblem — Ellywick", TAFR #16). Every other M20+ emblem prints "Emblem"
 * alone, whatever Scryfall's Oracle type line says (TFDN #25 Vivien Reid
 * prints "Emblem"; Scryfall says "Emblem — Vivien"), and the 2003 plaque
 * prints no type line at all.
 */
export function emblemPrintsSubtype(
  card: Pick<ScryfallCard, "frame" | "set" | "collector_number" | "released_at">,
): boolean {
  if ((card.frame ?? "").trim() !== "2015") return false;
  if ((card.set ?? "").trim().toLowerCase() === "tafr") return true;
  return !isM20DesignPrinting(card);
}

/**
 * Convert a Scryfall card into a patch the form can merge in. Falls back
 * to undefined fields when the Scryfall data is missing — we never invent
 * values just to fill a slot.
 */
export function mapScryfallToFormPatch(
  card: ScryfallCard,
  options: {
    artPreviewUrl?: string | null;
    /** The printing's set object (getScryfallSet), when the caller fetched
     *  one for the collector fields (needsScryfallSet). */
    set?: ScryfallSet | null;
  } = {},
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
  const frameMatch = frameMatchFromScryfall(card);
  const droppedFace = droppedFaceOf(card);
  const typeParts = parseTypeLine(pick(front?.type_line, card.type_line), {
    cardType: kind ? KIND_DEFS[kind].cardType : undefined,
  });
  const colorIdentity = frameColorsFromScryfall(card);
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

  // An emblem (TODO 1.23 / 6.23): the source's name, no colour (its frame is
  // silver whatever the walker's colour), cost, supertype or stats, common,
  // and a subtype only where the printing prints one.
  const emblem = kind === "emblem";

  return {
    // For a multi-face card, the front face's own name ("Fire", not "Fire //
    // Ice") is the right seed for the front we're populating.
    title: emblem
      ? emblemTitleFromName((isMultiFace && front?.name) || card.name)
      : (isMultiFace && front?.name) || card.name,
    cost: emblem ? undefined : pick(front?.mana_cost, card.mana_cost),
    kind,
    frame_template: frameTemplateFromScryfall(card, frameMatch),
    frame_match: frameMatch,
    printing_treatment: printingTreatmentFromScryfall(card),
    printing_detail: printingDetailFromScryfall(card),
    card_type: cardType,
    supertype: emblem ? undefined : typeParts.supertype,
    subtypes_text: emblem && !emblemPrintsSubtype(card) ? undefined : typeParts.subtypes_text,
    rarity: emblem ? "common" : rarityChecked,
    color_identity: emblem
      ? ["colorless"]
      : colorIdentity.length > 0
        ? colorIdentity
        : undefined,
    color_pair: frontFacePairFromScryfall(card) ?? undefined,
    // The printing's own anatomy (TODO 4.6.0): the import's values for the
    // card's crown and two-colour switches, named only where the printing
    // says something (owner round 17: printing-only). The save keeps only
    // what the frame the card lands on draws (lib/cards/anatomy.ts).
    printed_crown: crownSwitchFromPrinting(card, frameMatch, {
      cardType,
      supertype: typeParts.supertype,
    }),
    printed_two_color: printsTwoColorFrame(card) ? true : undefined,
    // The collector line as the printing prints it (TODO 4.9b): its style
    // (or "off" for a pre-2015 frame) and the ★ of a foil-only printing.
    printed_collector: collectorStyleOfPrinting(card),
    printed_star: starOfPrinting(card),
    rules_text: pick(front?.oracle_text, card.oracle_text),
    flavor_text: pick(front?.flavor_text, card.flavor_text),
    power: emblem ? undefined : pick(front?.power, card.power),
    toughness: emblem ? undefined : pick(front?.toughness, card.toughness),
    // Faces carry these on real cards (battle fronts hold defense; Origins
    // walker backs hold loyalty) — prefer the face on multiface cards.
    loyalty: emblem ? undefined : pick(front?.loyalty, card.loyalty),
    defense: emblem ? undefined : pick(front?.defense, card.defense),
    // The front face's own artist on a multi-face card (TODO 1.8).
    artist_credit: scryfallFaceArtist(card, 0),
    source_scryfall_id: card.id,
    printing: importedPrintingFromScryfall(card),
    // The printing's collector line, as data (TODO 4.9a): the printed set
    // code, the number in its era's style and the language.
    collector: collectorFieldsFromPrinting(card, options.set),
    preview_art_url: options.artPreviewUrl ?? null,
    // DFC detection: any card with two faces (Delver, Werewolves, etc.)
    // emits a back_face patch the form will seed when the user imports —
    // except a double-faced token or a Role card, which import their front
    // face only (TODO 1.23) and say so.
    back_face:
      !droppedFace && card.card_faces && card.card_faces.length >= 2
        ? mapScryfallBackFace(card)
        : undefined,
    dropped_face: droppedFace,
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
    // The second face's own artist (TODO 1.8): Ice is Franz Vohwinkel's,
    // not "David Martin & Franz Vohwinkel".
    artist_credit: scryfallFaceArtist(card, 1),
    imported_art_url: null,
  };
}
