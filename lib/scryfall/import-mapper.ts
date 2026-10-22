import type { ScryfallCard, ScryfallSet } from "@/lib/scryfall/client";
import { frameGateColors, partColorFromCost } from "@/lib/cards/part-color";
import { resolvePrintedTypes } from "@/lib/cards/type-line-field";
import { oracleSelfNamesAsTokens } from "@/lib/cards/self-name";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { subtypeFrameFor } from "@/lib/creator/card-kinds";
import { listSymbols, undrawableSymbols } from "@/lib/validation/card-glyphs";
import {
  DEFAULT_CARD_LANG,
  isCardLang,
  isValidCollectorNumber,
  isValidSetCode,
  normalizeSetCode,
  type CardLang,
} from "@/lib/cards/collector-fields";
import type { CollectorSwitch } from "@/lib/cards/collector-line";
import type { HoloStampSwitch } from "@/lib/cards/holo-stamp";
import {
  CARD_TYPE_VALUES,
  COLOR_IDENTITY_VALUES,
  FRAME_TEMPLATE_SET,
  RARITY_VALUES,
  type CardType,
  type ColorIdentity,
  type FrameTemplate,
  type Rarity,
} from "@/types/card";
import {
  KIND_DEFS,
  dfcLayoutForKind,
  isSingleBasicLand,
  kindFromCard,
  templateRefusesKind,
  walkerRowCount,
  walkerRowsFrameFor,
  type CardKind,
} from "@/lib/creator/card-kinds";
import {
  DEFAULT_DFC_ICON,
  bodyFor,
  sagaBackBodyFor,
  colorlessFaceAllowed,
  dfcBodyOf,
  dfcIconFamilyFromEffects,
  isDfcFaceType,
  type DfcIconFamily,
  type DfcLayout,
  type DfcLook,
} from "@/lib/cards/dfc";
import { isFrameComboAvailable } from "@/lib/cards/frame-availability";
import { tokenBackBodyFor } from "@/lib/creator/token-back";
import { isArtifactFrameType, pickFrameColorKey } from "@/components/cards/frame-layer";
import { describeFrame, finalizeImportMatch, withVerification } from "@/lib/creator/frame-resolve";
import { isTreatmentBody } from "@/lib/creator/frame-picker";
import { qualifiesForCrown, twoColorDressOf, twoColorPairOf, type TwoColorPair } from "@/lib/cards/anatomy";
import { supertypeHasWord } from "@/lib/cards/card-display";
import {
  FULL_ART_BASIC_2022_SETS,
  isM20DesignPrinting,
  landFrameColorRule,
  twoColourLandOnPlainFrame,
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
// so "Artifact Creature — Golem" keeps its "Artifact". The renderers put the
// card type's word back among them in printed order (buildTypeLine /
// typeLineWords, TODO 1.20), so a line whose card type isn't its last word —
// "Land Creature", "Enchantment Land" under a layout kind, "Legendary
// Enchantment Artifact" — prints as the printing does, and a land whose words
// say Creature keeps its P/T (showsPowerToughness). A token prints "Token"
// first, then its words — "Token Artifact Creature — Thopter" — and the token
// picker reads the same words: TODO 3b.15.
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
  /** The words the PRINTING sets left of the dash, in its own order — named
   *  only where they read differently from the line the card builds from
   *  `supertype` + `card_type` (TODO 3b.16, printedTypesOfPrinting). The
   *  creator pours it into the Types field. */
  printed_types?: string;
  /** The printing's nickname (Scryfall `flavor_name`, the front face's on a
   *  multi-face card — TODO 6.3): what it prints in the title bar over the
   *  card's own name. Named only where the printing has one; the creator
   *  clears a nickname typed before an import that names none. */
  nickname?: string;
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
  /** The holofoil stamp THIS printing carries (TODO 4.9c, owner 2026-09-29:
   *  imports follow the printing): Scryfall's `security_stamp` oval →
   *  "oval", triangle → "triangle", anything else → "none"
   *  (stampOfPrinting). The save drops it where the landed frame has no
   *  notch (a stamped SLD token, a UB emblem). */
  printed_stamp?: HoloStampSwitch;
  /** `"white"` for a white-bordered printing (TODO 4.30; `border_color`),
   *  else absent: the card's border switch follows the printing. The save
   *  keeps it only where the landed frame draws the white border (the 1997
   *  and 2003 frames). */
  printed_border?: "white";
  /** The FIRST part's own frame colour (TODO 4.26, M2;
   *  ImportedAnatomyFacts): a split or aftermath half's, from its cost,
   *  where it is not the card's whole colour. */
  printed_first_part_color?: ColorIdentity[];
  /** `false`: the parts can't be drawn in their own colours where the
   *  card lands (finalizeImportMatch — a part's colour not verified there);
   *  the card saves with the look off. */
  printed_part_color?: false;
  /** `true` for a two-colour Zendikar Expedition (TODO 4.11, owner
   *  2026-10-22; twoColourLandOnPlainFrame): its frame draws the plain land
   *  master `c` (FrameStyle.plainLandMaster) while `color_identity` stays
   *  the card's colour. Absent otherwise. */
  printed_plain_land_master?: true;
  /** The transform icon FAMILY this printing wears (TODO 5.4, owner Q5:
   *  imports follow the printing's family) — `frame_style.dfcIcon`, from
   *  the printing's `frame_effects` (dfcIconFamilyFromEffects): sun / moon,
   *  moon / Emrakul, compass / land, the fans, else `arrows`. Named only on
   *  a printing that LANDS on a double-faced body (dfcImportOf); the save
   *  drops the key on any other frame. */
  printed_dfc_icon?: DfcIconFamily;
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
   *  option on /api/scryfall/import-art. On a printing that lands on the
   *  double-faced bodies (TODO 5.4: `kind` transform / mdfc) it also
   *  carries the back's own BODY and COLOUR. */
  back_face?: ScryfallImportBackFacePatch;
  /** Display-only: the second face this import left out (TODO 1.23 / 5.4)
   *  — a double-faced token, a Role card or a printing with a planeswalker
   *  face imports its front face with no `back_face`, and the creator says
   *  so (droppedFaceNotice). */
  dropped_face?: DroppedFace;
};

export type ScryfallImportBackFacePatch = {
  title?: string;
  cost?: string;
  card_type?: CardType;
  supertype?: string;
  /** As the front's `printed_types`, for this face. */
  printed_types?: string;
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
  /** The back's own frame colour (TODO 5.4): the back face's printed
   *  colours in the creator's single-select model
   *  (backFrameColorsFromScryfall) — colourless on the TRANSFORM land back,
   *  whose body has one master verified on `c` alone; a modal land back's
   *  is its mana's (one tint per colour). Only on a printing that lands on
   *  the double-faced bodies; a legacy back carries none. */
  color_identity?: ColorIdentity[];
  /** The back's BODY: `bodyFor(layout, "back", back type, family)` — what
   *  the server's gate derives and stores (lib/cards/dfc-gate.ts); named
   *  here so the creator, the compare tools and the AI deck remix read the
   *  same body. Only on a printing that lands on the bodies. */
  frame_style?: { template: FrameTemplate };
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

/**
 * The Types text an import pours into the creator's field (TODO 3b.16,
 * owner 2026-10-09: "imports write the printing's order into the field"):
 * the words the printing sets left of its dash — the ones the importer
 * keeps, in the printing's order, a token's without its "Token" — or
 * undefined when that is exactly the line the card builds from `supertype`
 * and `card_type` (nearly every printing: the built order IS the printed
 * one, TODO 1.20) and on an emblem, whose line is fixed.
 */
export function printedTypesOfPrinting(
  typeLine: string | null | undefined,
  face: { cardType?: CardType; supertype?: string },
): string | undefined {
  if (!typeLine || !face.cardType || face.cardType === "emblem") return undefined;
  const printed = typeLineWords(typeLine)
    .words.filter((w) => !(face.cardType === "token" && w.cardType === "token"))
    .map((w) => w.word)
    .join(" ");
  return resolvePrintedTypes({ cardType: face.cardType, supertype: face.supertype, printedTypes: printed }) ?? undefined;
}

/**
 * A TOKEN's supertype with "Legendary" first where the printing makes it
 * legendary without printing the word — Scryfall's `legendary` frame effect
 * (the crown is printed) on a token whose type line has no Legendary (T2XM
 * #28 Tuktuk the Returned, owner Round 69): the word drives the crown; the
 * type line still prints as the card does through `printed_types`
 * (printedTypesOfPrinting reads the printing's words against this
 * supertype). Every other printing: the supertype as parsed.
 */
export function legendaryTokenSupertype(
  card: Pick<ScryfallCard, "frame_effects">,
  cardType: CardType | undefined,
  supertype: string | undefined,
): string | undefined {
  if (cardType !== "token") return supertype;
  if (!(card.frame_effects ?? []).some((e) => e.toLowerCase() === "legendary")) return supertype;
  if (supertypeHasWord(supertype, "Legendary")) return supertype;
  return supertype ? `Legendary ${supertype}` : "Legendary";
}

/** The patch key for a printing's own word order — absent, never
 *  `undefined`, when the printing reads as the built line. */
function printedTypesKey(printed: string | undefined): { printed_types?: string } {
  return printed === undefined ? {} : { printed_types: printed };
}

/**
 * Whether EVERY frame a flavour-name import may end up on prints the
 * nickname plate (TODO 6.2, independent checks S1 and the re-check): the
 * landing, the printing's own frame, each frame the match names once it is
 * verified (`onceVerified`, its fallback, `landOnOnceVerified`, `landOn`)
 * and the subtype dress a new card follows onto (a Spacecraft onto the
 * station frame, which prints none). Only then may a legendary's short form
 * be written as `~`: anywhere else `~` would draw the full name.
 */
function everyLandingPrintsNickname(
  landing: FrameTemplate | undefined,
  match: FrameMatch | null | undefined,
  subtypesText: string | undefined,
): boolean {
  // No static landing (the creator picks one later): unknown — keep the
  // short form as typed.
  if (!landing) return false;
  const subtypes = (subtypesText ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  const candidates = [
    landing,
    match?.template,
    match?.landOn,
    match?.onceVerified,
    match?.onceVerifiedFallback?.template,
    match?.landOnOnceVerified?.template,
    subtypeFrameFor(landing, subtypes, () => true),
  ].filter((template): template is FrameTemplate => Boolean(template));
  return candidates.every((template) => Boolean(getFrameProfile(template).nickname));
}

/** The patch's nickname key (TODO 6.3): only a printing with one names it,
 *  so every other import's patch is, key for key, what it was. */
function nicknameKey(nickname: string | null | undefined): { nickname?: string } {
  const text = nickname?.trim();
  return text ? { nickname: text } : {};
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

/** The second face an import leaves out (TODO 1.23 / 5.4), or undefined: a
 *  double-faced token (TMOM #16 Incubator // Phyrexian) imports its front
 *  face until two-sided tokens exist (5.5); a Role card (TWOE #15) its front
 *  Role, for good (no two-Role layout is planned); a transform or modal
 *  printing with a PLANESWALKER face (ORI's Kytheon // Gideon, KHM's Valki
 *  // Tibalt, MH3's Ajani, STX's Rowan // Will) imports its front alone
 *  until the walker bodies exist (owner 2026-10-02, Q2: they wait — 5.13,
 *  ask first), and the request log counts the ask (the registry's
 *  `dfc/walker` signature). */
export type DroppedFace = "double-faced-token" | "role" | "walker-face" | "helper-front";

/** What a `double_faced_token` printing is (TODO 5.5 (c), owner Round 76):
 *  • `pair` — two tokens back to back (GK1 #4 Goblin // Soldier, F17 #11
 *    Dinosaur // Treasure, MOM #16 Incubator // Phyrexian): both faces
 *    import, the back on the token template its words and text derive in the
 *    front's design (lib/creator/token-back.ts) — once both faces' combos are
 *    verified, else the front alone as before (finalizeImportMatch);
 *  • `helper-front` — a reminder card backed by a token (F18 #2 City's
 *    Blessing // Elemental): the TOKEN face imports by itself;
 *  • `front-only` — everything else, imported as before 5.5 (c) with the
 *    toast: a token backed by a helper card (L17 #1 Gremlin // Energy
 *    Reserve), Unstable's art-only backs (the back's type line is a bare
 *    "Token": the art with no frame), the folded Contortionist
 *    (TOKEN_FOLD_BACK_PINS), and every helper card (Punchcards, Day // Night,
 *    the minigames, The Ring…).
 *  Null for any other layout. */
export type DoubleFacedTokenShape = "pair" | "helper-front" | "front-only";

/** The double-sided tokens whose back is the FRONT folded (UNF #4
 *  Contortionist): front-only (owner Round 76). */
const TOKEN_FOLD_BACK_PINS: Readonly<Record<string, readonly string[]>> = { tunf: ["4"] };

export function doubleFacedTokenShapeOf(card: ScryfallCard): DoubleFacedTokenShape | null {
  if ((card.layout ?? "").toLowerCase() !== "double_faced_token") return null;
  const [front, back] = card.card_faces ?? [];
  if (!front || !back) return "front-only";
  const frontToken = isTokenTypeLine(front.type_line);
  // A back that says "Token" and nothing else is Unstable's art-only back.
  const backToken = isTokenTypeLine(back.type_line) && (back.type_line ?? "").trim().toLowerCase() !== "token";
  if (!frontToken) return backToken ? "helper-front" : "front-only";
  if (!backToken) return "front-only";
  const set = (card.set ?? "").trim().toLowerCase();
  if (TOKEN_FOLD_BACK_PINS[set]?.includes((card.collector_number ?? "").trim())) return "front-only";
  return "pair";
}

/** True when either face of a transform / modal printing is a planeswalker. */
function hasWalkerFace(card: ScryfallCard): boolean {
  const layout = (card.layout ?? "").toLowerCase();
  if (layout !== "transform" && layout !== "modal_dfc") return false;
  return (card.card_faces ?? []).some((face) =>
    typeLineWords(face.type_line).words.some((w) => w.cardType === "planeswalker"),
  );
}

export function droppedFaceOf(card: ScryfallCard): DroppedFace | undefined {
  const layout = (card.layout ?? "").toLowerCase();
  if (layout === "double_faced_token") {
    // Two tokens back to back bring both faces (TODO 5.5 (c)); a helper
    // front gives way to its token face (the patch is that face's).
    const shape = doubleFacedTokenShapeOf(card);
    return shape === "pair" ? undefined : shape === "helper-front" ? "helper-front" : "double-faced-token";
  }
  if (layout === "flip" && isTokenTypeLine(frontTypeLine(card))) return "role";
  if (hasWalkerFace(card)) return "walker-face";
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
    case "helper-front":
      return `${cardName} pairs a reminder card with a token — PipGlyph imported its token face, ${patch.title ?? "the token"}.`;
    case "walker-face":
      return `${cardName} has a planeswalker face — PipGlyph imported the front face, ${patch.title ?? "the front"}, on its own. Double-faced planeswalkers aren't supported yet.`;
    default:
      return null;
  }
}

/** The toast (and the import dialog's note) for the symbols a printing uses
 *  that the card can't draw — a generic past the font's last number, a
 *  half-mana or Un-set symbol ({1/2}, {CHAOS}): the import keeps the
 *  printing's cost and text as printed, and both renderers leave such a
 *  pip out (lib/cards/mana-gem.ts). The hybrid Phyrexian {G/W/P} of Ajani,
 *  Sleeper Agent (DMU) and {G/U/P} of Tamiyo, Compleated Sage (NEO) draw
 *  since layout v49 and are no longer named. Read from the patch — what the form is
 *  about to hold — by the creator's own check (undrawableSymbols), so the
 *  toast and the creator's notice never disagree. Null when every symbol
 *  draws. */
export function undrawableSymbolsNotice(
  patch: Pick<ScryfallImportPatch, "cost" | "rules_text" | "back_face">,
  cardName: string,
): string | null {
  const symbols: string[] = [];
  for (const text of [patch.cost, patch.rules_text, patch.back_face?.cost, patch.back_face?.rules_text]) {
    for (const symbol of undrawableSymbols(text)) {
      if (!symbols.includes(symbol)) symbols.push(symbol);
    }
  }
  if (symbols.length === 0) return null;
  return `${cardName} uses ${listSymbols(symbols)}, which PipGlyph can't draw yet — ${
    symbols.length === 1 ? "it" : "they"
  } will be left off the card.`;
}

// ---------------------------------------------------------------------------
// Double-faced printings (TODO 5.4; design 2026-10-02 §2.4, §4, §5; owner
// Q2, Q5): where a transform / modal printing lands.
// ---------------------------------------------------------------------------

/** Why a transform / modal printing does NOT land on the double-faced
 *  bodies — today's landing instead (the front's standard kind with a legacy
 *  back), with the registry naming the item:
 *   • "walker-face" — either face is a planeswalker (5.13; the back is
 *     dropped, droppedFaceOf);
 *   • "face-type" — a face is not one of wave 1's six face types, or is a
 *     Saga with no body yet (the saga fronts land on theirs and MOM's / LCI's
 *     Saga backs on the double-faced saga back, 5.5 (b); FIN's saga CREATURE
 *     backs are 4.5d's; a battle front stays a battle, 4.21b / 5.5);
 *   • "no-body" — the layout has no body for a face (none since 5.1b's
 *     modal pair; a later layout's rows turn a printing onto them by
 *     themselves once `bodyFor` answers);
 *   • "colourless-face" — a colourless face whose type line has no Artifact
 *     word (EMN's Eldrazi backs, STX #6 Wandering Archaic's front): the
 *     body's `c` is the artifact master standing in (design D2), and the
 *     see-through frame is 5.11 — the printing keeps today's landing rather
 *     than a colour the print doesn't have;
 *   • "dress" — a devoid or snow printing (MH3's five devoid MDFCs, KHM
 *     #179 Jorn): no double-faced body carries that dress (5.11), so the
 *     printing keeps today's landing — the era's devoid / snow frame with a
 *     legacy back — rather than lose the dress on the plain body
 *     (`dfc/devoid`, `dfc/snow`: nearest on the body, `landOn` the dress). */
export type DfcImportBlock = "walker-face" | "face-type" | "no-body" | "colourless-face" | "dress";

export type DfcImportFacts = {
  layout: DfcLayout;
  /** The printing's icon family (dfcIconFamilyFromEffects). */
  family: DfcIconFamily;
  /** The look of the bodies below (TODO 5.7): `borderless` when the
   *  printing wears the dark borderless look (`border_color: borderless` +
   *  the `inverted` effect — dfcPrintedLookOf) AND both faces have a
   *  borderless body; `bordered` otherwise (the M15 bodies — today's
   *  landing for a borderless printing whose face has no borderless body
   *  yet: a land face, a sun / moon back, the light look). */
  look: DfcLook;
  /** The look the printing WEARS, whether or not its bodies exist. */
  printedLook: DfcLook;
  frontType: CardType | undefined;
  backType: CardType | undefined;
  /** Null when the printing lands on the bodies. */
  blocked: DfcImportBlock | null;
  /** The kind — set only when nothing blocks the landing: `battle` for a
   *  battle front with a back of its own (TODO 5.5 — the battle frame and
   *  the ▼ back), `saga` for a transforming Saga (5.5 (b) — the
   *  double-faced saga front and its transform back), else the Transform /
   *  Modal kind. */
  kind: "transform" | "mdfc" | "battle" | "saga" | null;
  /** The bodies each face WOULD wear (by type and family) — set whenever
   *  they exist, blocked or not: a blocked printing's frame is still the
   *  body (the registry names it; the import lands on the standard instead,
   *  `landOn`); null while no body exists for a face ("no-body"), or when a
   *  face isn't a wave-1 face type. */
  frontBody: FrameTemplate | null;
  backBody: FrameTemplate | null;
};

/** A face's type words as the gate reads them (lib/cards/dfc.ts
 *  colorlessFaceAllowed → isArtifactFrameType). */
function faceTypeInfo(typeLine: string | null | undefined): { cardType: CardType | undefined; supertype: string | undefined; saga: boolean } {
  const parsed = parseTypeLine(typeLine);
  return {
    cardType: parsed.card_type,
    supertype: parsed.supertype,
    saga: typeLineWords(typeLine).subtypes.includes("Saga"),
  };
}

/**
 * The double-faced landing of a printing (TODO 5.4), or null for any other
 * layout: the layout, the family, each face's type and — when nothing blocks
 * it — the kind (`transform` / `mdfc`) and the bodies each face wears
 * (`bodyFor`: the land front / back for a land face, the spell bodies
 * otherwise, the transform back by family). The ONE place the mapper, the
 * registry (printingFacts) and the creator read this from.
 */
export function dfcImportOf(card: ScryfallCard): DfcImportFacts | null {
  const scryfallLayout = (card.layout ?? "").toLowerCase();
  const layout: DfcLayout | null =
    scryfallLayout === "transform" ? "transform" : scryfallLayout === "modal_dfc" ? "modal" : null;
  if (!layout) return null;
  const faces = card.card_faces ?? [];
  const front = faceTypeInfo(faces[0]?.type_line ?? card.type_line);
  const back = faceTypeInfo(faces[1]?.type_line);
  const family = dfcIconFamilyFromEffects(card.frame_effects);
  const printedLook = dfcPrintedLookOf(card);
  const facts: DfcImportFacts = {
    layout,
    family,
    look: "bordered",
    printedLook,
    frontType: front.cardType,
    backType: back.cardType,
    blocked: null,
    kind: null,
    frontBody: null,
    backBody: null,
  };
  const blocked = (why: DfcImportBlock): DfcImportFacts => ({ ...facts, blocked: why });
  if (hasWalkerFace(card)) return blocked("walker-face");
  // A battle (TODO 5.5; every MOM battle is a transform printing): the
  // battle frame is its front body, its back the ▼ back its type derives —
  // a battle wears no family (every one printed is the plain ▲ / ▼). A Saga
  // back or a face of no wave-1 type keeps today's landing (a legacy back).
  if (layout === "transform" && front.cardType === "battle") {
    if (faces.length < 2 || !isDfcFaceType(back.cardType) || back.saga) return blocked("face-type");
    const battleBack = bodyFor(layout, "back", back.cardType, DEFAULT_DFC_ICON);
    if (!battleBack) return blocked("no-body");
    if (
      backFaceColors(card).length === 0 &&
      !colorlessFaceAllowed(battleBack, { cardType: back.cardType, supertype: back.supertype })
    ) {
      return { ...blocked("colourless-face"), frontBody: "battle", backBody: battleBack };
    }
    return { ...facts, family: DEFAULT_DFC_ICON, kind: "battle", frontBody: "battle", backBody: battleBack };
  }
  // A transforming SAGA (TODO 5.5 (b); NEO's 23 and their promos, TLA's
  // five): the double-faced saga front, its back the transform back the
  // printing's family and the back's type derive (NEO's fans → the 2016–22
  // back, TLA's arrows → the ▼ back). A Saga BACK (the MOM praetors, LCI
  // Huatli, FIN's summons) has no body yet: today's landing, a legacy back.
  if (layout === "transform" && front.saga && front.cardType === "enchantment") {
    if (faces.length < 2 || !isDfcFaceType(back.cardType) || back.saga) return blocked("face-type");
    const sagaBack = bodyFor(layout, "back", back.cardType, family);
    if (!sagaBack) return blocked("no-body");
    if (
      backFaceColors(card).length === 0 &&
      !colorlessFaceAllowed(sagaBack, { cardType: back.cardType, supertype: back.supertype })
    ) {
      // TLA's Avatars: a colourless back with no Artifact word (5.11).
      return { ...blocked("colourless-face"), frontBody: "sagadfcfront", backBody: sagaBack };
    }
    return { ...facts, kind: "saga", frontBody: "sagadfcfront", backBody: sagaBack };
  }
  // A Saga BACK (TODO 5.5 (b), PR 2: MOM's five praetors and their promos,
  // LCI #189 / #296 — an enchantment back on today's ▼) wears the
  // double-faced saga back; a saga CREATURE back (FIN's summons, 4.5d) or a
  // Saga back of another family has no body: today's landing.
  const sagaBack = back.saga ? sagaBackBodyFor(layout, back.cardType, ["Saga"], family, "bordered") : null;
  if (faces.length < 2 || !isDfcFaceType(front.cardType) || !isDfcFaceType(back.cardType) || front.saga || (back.saga && !sagaBack)) {
    return blocked("face-type");
  }
  // The borderless bodies (TODO 5.7) where the printing wears that look and
  // both faces have one; else the bordered bodies, as before. (The saga
  // back has no borderless body: such a printing lands on the bordered
  // ones, as a borderless land face does.)
  const borderlessFront = printedLook === "borderless" && !sagaBack ? bodyFor(layout, "front", front.cardType, family, "borderless") : null;
  const borderlessBack = printedLook === "borderless" && !sagaBack ? bodyFor(layout, "back", back.cardType, family, "borderless") : null;
  const look: DfcLook = borderlessFront && borderlessBack ? "borderless" : "bordered";
  facts.look = look;
  const frontBody = borderlessFront && borderlessBack ? borderlessFront : bodyFor(layout, "front", front.cardType, family);
  const backBody = borderlessFront && borderlessBack ? borderlessBack : (sagaBack ?? bodyFor(layout, "back", back.cardType, family));
  if (!frontBody || !backBody) return blocked("no-body");
  // A colourless face wears the body's `c` only with an Artifact word (D2);
  // a land face's colour is its body's one master (always allowed). The
  // bodies stay on the facts: they ARE the printing's frame (the registry
  // names them); the import lands on the standard meanwhile.
  const frontColourless = frontFaceColors(card).length === 0;
  const backColourless = backFaceColors(card).length === 0;
  if (
    (frontColourless && !colorlessFaceAllowed(frontBody, { cardType: front.cardType, supertype: front.supertype })) ||
    (backColourless && !colorlessFaceAllowed(backBody, { cardType: back.cardType, supertype: back.supertype }))
  ) {
    return { ...blocked("colourless-face"), frontBody, backBody };
  }
  // A devoid or snow dress (5.1b skeptic): the bodies don't carry it, and
  // the plain body would be a look the print doesn't have — today's landing
  // (the era's dress frame, a legacy back) until a dressed body exists.
  const effects = new Set((card.frame_effects ?? []).map((e) => e.toLowerCase()));
  if (effects.has("devoid") || effects.has("snow")) return { ...blocked("dress"), frontBody, backBody };
  return { ...facts, kind: layout === "transform" ? "transform" : "mdfc", frontBody, backBody };
}

/** The look a double-faced printing WEARS (TODO 5.7): the dark borderless
 *  look — `border_color: borderless` with Scryfall's `inverted` effect (98
 *  of the 134 plain borderless transform / modal printings; the other 36
 *  print the light look, which PipGlyph doesn't draw yet) — else the
 *  bordered M15 look. */
export function dfcPrintedLookOf(card: Pick<ScryfallCard, "border_color" | "frame_effects" | "promo_types" | "set">): DfcLook {
  const borderless = (card.border_color ?? "").toLowerCase() === "borderless";
  const effects = new Set((card.frame_effects ?? []).map((e) => e.toLowerCase()));
  if (!borderless || !effects.has("inverted")) return "bordered";
  // A showcase, a shattered-glass or one-off set's frame and an artist-
  // lettered poster are their own designs (the registry's borderless rules
  // before `borderless/dfc`): they keep the bordered bodies' landing.
  if (effects.has("showcase") || effects.has("shatteredglass")) return "bordered";
  if ((card.promo_types ?? []).some((p) => p.toLowerCase() === "poster")) return "bordered";
  if (DFC_BORDERLESS_ONE_OFF_SETS.has((card.set ?? "").toLowerCase())) return "bordered";
  return "borderless";
}

/** The sets whose borderless frame is a one-off design (the registry's
 *  `borderless/unsupported-set`: BOT's shattered glass). */
const DFC_BORDERLESS_ONE_OFF_SETS: ReadonlySet<string> = new Set(["mp2", "ust", "bot"]);

/** A face's STORED colour on a double-faced body: colourless on the
 *  TRANSFORM land bodies (the 5.1a land pair has one master under every
 *  key, verified on `c` alone — the editor's and the Q3 move's rule,
 *  lib/cards/dfc-adopt.ts adoptedBackColorIdentity), else the face's own
 *  frame colour — a MODAL land face's is the colour its mana ability adds
 *  (the 5.1b land pair is one land tint per colour, verified per colour:
 *  Emeria's back is white, a Pathway's faces each their own). */
function dfcFaceColorIdentity(body: FrameTemplate, faceType: CardType | undefined, colors: ColorIdentity[]): ColorIdentity[] {
  const profile = dfcBodyOf(body);
  return faceType === "land" && profile?.land && profile.layout === "transform" ? ["colorless"] : colors;
}

/** True when the card is a Room (Duskmourn): Scryfall files Rooms under
 *  layout "split", but a Room is ONE enchantment with two doors, not a
 *  split card. */
function isRoomCard(card: ScryfallCard): boolean {
  return typeLineWords(frontTypeLine(card)).subtypes.includes("Room");
}

/** The layouts whose two parts each print their own colour, read from the
 *  parts' own costs (TODO 4.26): split and aftermath — each half its own
 *  colour's frame — and Prepare — the spell's page in the spell's colour
 *  (its creature's colours are Scryfall's card `colors` already). A Room
 *  (layout split) is read by isRoomCard first. */
const PART_COLOUR_LAYOUTS: ReadonlySet<string> = new Set(["split", "aftermath", "prepare"]);
function isPartColourLayout(card: ScryfallCard): boolean {
  // (A Room — layout split, TODO 4.27 — is no split card: its doors are
  // its own frame's, never a part colour; L1.)
  return PART_COLOUR_LAYOUTS.has((card.layout ?? "").toLowerCase()) && !isRoomCard(card);
}

/**
 * The FIRST part's own frame colour of a split or aftermath printing (TODO
 * 4.26, owner decision M2), from its own cost (partColorFromCost — Fire //
 * Ice's Fire is red, DMR #215), where it is not what the card's whole
 * colour paints: the card's `color_identity` stays both halves' (Fire //
 * Ice is red and blue — the gold "multicolor" of the single-select model),
 * so the card page, the filters and the deck stats are unchanged, and this
 * names the master its first half paints with each part in its own colour.
 * Undefined for any other printing (a Prepare card's creature IS the
 * card's colour; a Room is no split card).
 */
function firstPartColorOf(card: ScryfallCard, wholeColors: readonly ColorIdentity[]): ColorIdentity[] | undefined {
  const layout = (card.layout ?? "").toLowerCase();
  if (layout === "prepare" || !isPartColourLayout(card)) return undefined;
  const first = partColorFromCost(card.card_faces?.[0]?.mana_cost);
  if (first.length === 0) return undefined;
  // The same master either way: no key to store.
  return pickFrameColorKey(first) === pickFrameColorKey([...wholeColors]) ? undefined : first;
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
 *   • a Prepare card (Secrets of Strixhaven, layout "prepare") is the
 *     Prepare kind (TODO 4.27): the creature front, its spell the page —
 *     the second face rides along as the back face, which the frame draws.
 *     A TEXTLESS printing (FRA #402, SOS #306: art over the whole card)
 *     keeps the creature kind, on the textless frame its look is.
 * Class, Case and the other unmodeled layouts (leveler, prototype, meld, …)
 * take the standard kind of the front face's type line, so an exotic import
 * degrades to a standard kind instead of failing.
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
  if (layout === "prepare" && card.textless !== true) return "prepare";
  // A transform or modal printing lands on the double-faced bodies (TODO
  // 5.4) when both faces can wear one: the Transform / Modal kind. A
  // planeswalker face, a battle or token front (their own kinds), a Saga
  // face, a face with no body yet (the modal bodies until 5.1b) or a
  // colourless face without the Artifact word keeps the front face's
  // standard kind — today's landing (dfcImportOf says which).
  const dfc = dfcImportOf(card);
  if (dfc?.kind) return dfc.kind;

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
  const backWords = typeLineWords(back?.type_line);
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
    omen: backWords.subtypes.includes("Omen"),
    // The second face, for the double-faced rules (TODO 5.4): its card type
    // and subtypes, and where the printing lands (dfcImportOf).
    backType: back ? parseTypeLine(back.type_line).card_type : undefined,
    backSubtypes: backWords.subtypes,
    dfc: dfcImportOf(card),
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
  const kind = kindFromScryfall(card);
  // (…and a transforming Saga on the double-faced saga front, TODO 5.5 (b).)
  if (kind && (dfcLayoutForKind(kind) || kind === "battle" || (kind === "saga" && dfcImportOf(card)?.kind === "saga"))) {
    // A double-faced landing is verified on BOTH faces (TODO 5.4): the
    // front body in the front's colour and the back body in the back's —
    // the same finalization the import's patch gets (finalizeImportMatch),
    // so the printings grid and the import agree.
    return finalizeImportMatch({ ...mapScryfallToFormPatch(card), frame_match: match }, verifiedKeys).frame_match ?? match;
  }
  // (A two-colour Expedition is verified in its plain land master `c`,
  // TODO 4.11 — frameGateColors, the save's rule.)
  return withVerification(
    match,
    pickFrameColorKey(
      frameGateColors(match.landOn ?? match.template, { plainLandMaster: twoColourLandOnPlainFrame(card, frontFaceColors(card)) || undefined }, frameColorsFromScryfall(card)),
    ),
    verifiedKeys,
  );
}

/**
 * The frame an import of THIS PRINTING lands on — the signature registry's
 * `landOn ?? template` (a thin wrapper kept for older callers and tests).
 * Undefined for layout kinds (their template is fixed by the kind — saga is
 * saga in every era) and for cards with no card type PipGlyph makes — but
 * NAMED for a double-faced kind (TODO 5.4): the front body follows the
 * front face's type (the land front for a land), so the kind alone doesn't
 * fix it.
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
  if (!kind) return undefined;
  // (A transforming Saga that lands on the double-faced saga front — TODO
  // 5.5 (b) — names it, as a double-faced kind names its front body.)
  if (KIND_DEFS[kind].layoutTemplates && !dfcLayoutForKind(kind) && dfcImportOf(card)?.kind !== "saga") return undefined;
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

/**
 * The holofoil stamp a printing carries (ScryfallImportPatch.printed_stamp,
 * TODO 4.9c): "oval" for Scryfall's `security_stamp` oval (every 2015-frame
 * rare and mythic, the SLD and promo tokens), "triangle" for the Universes
 * Beyond triangle (LTR on every rarity, the four UB emblems), and "none" for
 * no stamp or any other mark (acorn, circle, heart, arena) — never absent:
 * a printing always says whether it carries one, so an unstamped common
 * imported onto a rare's frame stays unstamped and never gets "auto".
 */
export function stampOfPrinting(card: Pick<ScryfallCard, "security_stamp">): HoloStampSwitch {
  const stamp = (card.security_stamp ?? "").trim().toLowerCase();
  if (stamp === "oval") return "oval";
  if (stamp === "triangle") return "triangle";
  return "none";
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
  const bordered =
    treatment === "borderless" && FRAME_TEMPLATE_SET[landed] !== "borderless" && !isTreatmentBody(landed);
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
 * The colours the printing's BACK FACE is dressed in, as WUBRG letters
 * (TODO 5.0b: what the compare view draws a back body in, and what a pin
 * on a back body is checked against) — frontFaceColors' rule read on
 * `card_faces[1]`: its printed colours (`colors` + `color_indicator`); a
 * colourless back stays colourless (Tergrid's Lantern KHM #15, an artifact)
 * except a LAND back, dressed by its own mana symbols and basic land types
 * (Agadeem, the Undercrypt ZNR #90 is black; identity and produced_mana
 * cover both faces, so the card-level fields are never read). Empty when the
 * printing has no second face. The import carries no back colour yet (5.4
 * stores it); until then a legacy back draws in the front's.
 */
export function backFaceColors(card: ScryfallCard): string[] {
  const faces = card.card_faces ?? [];
  const back = faces.length >= 2 ? faces[1] : undefined;
  if (!back) return [];
  const colors = wubrgLetters([...(back.colors ?? []), ...(back.color_indicator ?? [])]);
  if (colors.length > 0) return colors;
  const backType = typeLineWords(back.type_line);
  if (!backType.words.some((w) => w.cardType === "land")) return [];
  return wubrgLetters([
    ...manaSymbolColors(back.mana_cost),
    ...manaSymbolColors(back.oracle_text),
    ...backType.subtypes.map((subtype) => BASIC_LAND_TYPE_COLOR[subtype]),
  ]);
}

/**
 * The BACK face's colour in the creator's single-select model (TODO 5.4 —
 * frameColorsFromScryfall's sibling, read on `card_faces[1]`): the back's
 * own printed colours (backFaceColors), none → ["colorless"], two or more →
 * ["multicolor"] (the gold backs never split — MOM #43; a two-colour back
 * prints gold, 5.12). What `back_face.color_identity` stores for a printing
 * that lands on the double-faced bodies — except a TRANSFORM land back,
 * which the patch stores colourless (its body has one master, verified on
 * `c`; dfcFaceColorIdentity — a modal land back keeps its mana's colour).
 * Empty when the printing has no second face.
 */
export function backFrameColorsFromScryfall(card: ScryfallCard): ColorIdentity[] {
  if (!card.card_faces || card.card_faces.length < 2) return [];
  const colors = backFaceColors(card).map((code) => SCRYFALL_COLOR_TO_IDENTITY[code]);
  if (colors.length > 1) return ["multicolor"];
  if (colors.length === 0) return ["colorless"];
  return colors.filter((v) => (COLOR_IDENTITY_VALUES as readonly string[]).includes(v));
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
 *     Rainbow Vale FEM, Path of Ancestry and Command Tower BRC). On the
 *     1997 frame a TWO-colour land wears its colours only where the prints
 *     do (TODO 4.6h): it taps for both and was printed from 1999 on, or it
 *     is an Onslaught fetch land; any other prints the plain land.
 *   • The lands the data can't predict, by Oracle name (the signature
 *     registry's LAND_FRAME_OVERRIDES, lib/scryfall/frame-signatures.ts); a
 *     "colorless" override wins in every era, as it always did.
 */
function landFrameColors(card: ScryfallCard): string[] {
  const rule = landFrameColorRule(card);
  if (Array.isArray(rule) && rule.length === 0) return [];
  const frame = (card.frame ?? "").trim();
  const identityEra = IDENTITY_DRESSED_LAND_ERAS.has(frame);
  if (identityEra || rule === "identity") {
    const identity = wubrgLetters(card.color_identity ?? []);
    // The 1997 frame's two-colour lands (TODO 4.6h): only a land that TAPS
    // for both colours, printed from 1999 on, wears them (the blended box of
    // Sixth Edition 1999 → Torment 2002). Every other two-colour land of
    // the frame prints the plain land's orange box — Fifth Edition, Tempest
    // and Anthologies (1997–98), and the lands whose colours are only in
    // their abilities (JUD #142 / #143, ONS #314 / #323 / #325).
    if (frame === "1997") {
      // …and the Onslaught fetch lands (2002; no mana, no identity) print
      // the two basic land types they fetch the same way (5 of 5).
      const released = (card.released_at ?? "").trim();
      if (Array.isArray(rule) && rule.length === 2 && (released === "" || released >= TWO_COLOUR_1997_LAND_FROM)) return [...rule];
      if (identity.length === 2 && !printsTwoColour1997Land(card, identity)) return [];
    }
    return identity;
  }
  if (rule !== null) return [...rule];
  if (card.produced_mana == null) return wubrgLetters(card.color_identity ?? []);
  return wubrgLetters(card.produced_mana);
}

/** True when a 1997-frame land of two identity colours prints them (see
 *  landFrameColors). */
function printsTwoColour1997Land(card: ScryfallCard, identity: readonly string[]): boolean {
  const produced = wubrgLetters(card.produced_mana ?? []);
  const released = (card.released_at ?? "").trim();
  return identity.every((letter) => produced.includes(letter)) && (released === "" || released >= TWO_COLOUR_1997_LAND_FROM);
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

/** The showcase frames of the registry that DO print the standard legendary
 *  crown, and whose template draws it: the Theros Beyond Death constellation
 *  showcase (THB #258–268 — all eleven legendary, each under the 2015 crown
 *  in its colour with the Nyx starfield strip inside; owner 2026-10-13,
 *  NYX_CONSTELLATION_CROWN in lib/cards/template-layout.ts). A printing with
 *  one of these signatures imports as its scan with the crown ON. */
const CROWNED_SHOWCASE_SIGNATURES: ReadonlySet<string> = new Set(["showcase/thb/constellation"]);

/** Whether a printing prints the STANDARD legendary crown (see
 *  ScryfallImportPatch.printed_crown): the `legendary` frame effect, on a
 *  printing that isn't a showcase — neither Scryfall's `showcase` effect nor
 *  a showcase frame of the registry (`match`, THIS printing's signature),
 *  which prints its own frame and no standard crown (owner decision
 *  2026-09-29: showcase printings import with the crown off, as the scan) —
 *  or on one of the showcases that print it (CROWNED_SHOWCASE_SIGNATURES). */
export function printsStandardCrown(
  card: ScryfallCard,
  match: FrameMatch = frameMatchFromScryfall(card),
): boolean {
  const effects = (card.frame_effects ?? []).map((e) => e.toLowerCase());
  if (!effects.includes("legendary")) return false;
  if (CROWNED_SHOWCASE_SIGNATURES.has(match.signature)) return true;
  return !effects.includes("showcase") && !isShowcaseSignature(match.signature);
}

/** The first day a two-colour GOLD card of the 2003 frame printed its two
 *  colours (TODO 4.6h): Ravnica, October 2005 — and Salvat's 2005 reprints
 *  of its cards, which Scryfall dates 2005-08-22. Before it the frame's one
 *  two-colour gold card, Iname as One (SOK #151, June 2005), printed plain
 *  gold, and so did Unhinged's three (November 2004) and the textless
 *  Psychatog of Magic Player Rewards 2005 (P05 #1, gold pinline all round —
 *  looked at 2026-10-08). The 2005 promos carry Scryfall's placeholder date
 *  2005-01-01, so the date cannot tell that Psychatog from the one earlier
 *  printing that DOES print the split: Arena League 2005's Skyknight
 *  Legionnaire (PAL05 #8, a Ravnica card) — named by its set
 *  (TWO_COLOUR_2003_GOLD_EARLY_SETS). Those seven are every non-hybrid
 *  two-colour gold printing of the frame Scryfall dates before the day. */
export const TWO_COLOUR_2003_GOLD_FROM = "2005-08-01";
/** Sets Scryfall dates before TWO_COLOUR_2003_GOLD_FROM whose two-colour
 *  gold cards print the split all the same (see there). */
export const TWO_COLOUR_2003_GOLD_EARLY_SETS: ReadonlySet<string> = new Set(["pal05"]);
/** The first day a two-colour LAND of the 1997 frame printed its two
 *  colours (TODO 4.6h): Sixth Edition, April 1999 (36 of 36 measured from
 *  then to Onslaught 2002, Battle Royale and Deckmasters included). Fifth
 *  Edition and Tempest 1997 and Anthologies 1998 print the plain land's
 *  orange box (11 of 11). */
export const TWO_COLOUR_1997_LAND_FROM = "1999-01-01";

/** Whether a printing's own frame is two-coloured (see
 *  ScryfallImportPatch.printed_two_color), for a front face of exactly two
 *  colours:
 *   • the 2015 frame — always;
 *   • the 2003 frame (TODO 4.6h) — a land always (Eighth Edition 2003 on:
 *     its colours are the mana it produces), a gold card from Ravnica on
 *     (TWO_COLOUR_2003_GOLD_FROM), never a HYBRID card (its print splits
 *     the frame body: another look, not drawn);
 *   • the 1997 frame — a land only (the frame's gold cards print one
 *     gold), and only one landFrameColors dresses as a pair (it taps for
 *     both colours and was printed from 1999 on). */
export function printsTwoColorFrame(card: ScryfallCard): boolean {
  if (frontFacePairFromScryfall(card) === null) return false;
  const frame = (card.frame ?? "").trim();
  if (frame === "2015") return true;
  const land = typeLineWords(frontTypeLine(card)).words.some((w) => w.cardType === "land");
  if (frame === "1997") return land;
  if (frame !== "2003") return false;
  if (land) return true;
  const cost = card.card_faces?.[0]?.mana_cost ?? card.mana_cost ?? null;
  if (twoColorDressOf(cost, "nonland") === "hybrid") return false;
  const released = (card.released_at ?? "").trim();
  return TWO_COLOUR_2003_GOLD_EARLY_SETS.has((card.set ?? "").trim().toLowerCase()) || released === "" || released >= TWO_COLOUR_2003_GOLD_FROM;
}

/**
 * The crown switch an import writes (ScryfallImportPatch.printed_crown) —
 * printing-only (owner round 17, 2026-09-30):
 *   • a SHOWCASE printing: `false` when the card is Legendary (Q6 → b: it
 *     prints no standard crown, and imports as its scan), and nothing when it
 *     isn't (owner 2026-09-30, pick (b): like any nonlegendary printing, so
 *     the card gets the new-card default if it is made Legendary later) —
 *     but for the showcases that print the standard crown
 *     (CROWNED_SHOWCASE_SIGNATURES: the THB constellation frame), which
 *     follow the next two rules like any 2015-frame printing;
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
  // A showcase that prints the standard crown (the THB constellation frame)
  // follows its printing like any crowned card.
  if (CROWNED_SHOWCASE_SIGNATURES.has(match.signature)) {
    if (printsStandardCrown(card, match)) return true;
    return qualifiesForCrown(face) ? false : undefined;
  }
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

/** The same for the printing's BACK face (TODO 5.0b): backFaceColors in the
 *  creator's model — two colours stay two, none is colourless, three or
 *  more "multicolor". Empty when the printing has no second face. */
export function referenceBackColorIdentity(card: ScryfallCard): ColorIdentity[] {
  const colors = backFaceColors(card).map((code) => SCRYFALL_COLOR_TO_IDENTITY[code]);
  if (!card.card_faces || card.card_faces.length < 2) return [];
  if (colors.length > 2) return ["multicolor"];
  if (colors.length === 0) return ["colorless"];
  return colors;
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
    /** Oracle's rules text as written — never the flavour-name printing's
     *  `~` (TODO 6.2): the AI deck remix drops the nickname and renames the
     *  card's self-references itself (applyRemixNames, the short name
     *  included), so a `~` there would draw the new FULL title where the
     *  short one belongs (independent re-check, SLD #1186). */
    oracleRules?: boolean;
  } = {},
): ScryfallImportPatch {
  // A reminder card backed by a token (TODO 5.5 (c): F18 #2 City's Blessing
  // // Elemental): the TOKEN face imports by itself, as the one-faced token
  // it is — the printing's own fields, that face's content.
  if (doubleFacedTokenShapeOf(card) === "helper-front") {
    return { ...mapScryfallToFormPatch(tokenFaceAlone(card, 1), options), dropped_face: "helper-front" };
  }
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

  // A token the printing makes legendary without the word (owner Round 69:
  // T2XM #28 Tuktuk the Returned — "Token Artifact Creature — Goblin Golem",
  // the crown printed, its rules text "is legendary"): Legendary in the
  // supertype, which is what draws the crown, and the printed words kept
  // as the card prints them through printed_types (printedTypesOfPrinting →
  // resolvePrintedTypes: "Artifact Creature").
  const supertype = legendaryTokenSupertype(card, cardType, typeParts.supertype);

  // A transform / modal printing on the double-faced bodies (TODO 5.4): the
  // front's colour is its own — colourless on the TRANSFORM land front,
  // whose body has one master verified on `c`; a modal land front's is its
  // mana's — and the family rides as `printed_dfc_icon`.
  const dfc = dfcImportOf(card);
  const dfcLanding = dfc?.kind ? dfc : null;
  const frontColorIdentity =
    dfcLanding && dfcLanding.frontBody ? dfcFaceColorIdentity(dfcLanding.frontBody, dfcLanding.frontType, colorIdentity) : colorIdentity;
  // The printing's nickname (TODO 6.3) — its rules then write `~` (6.2).
  const frontNickname = emblem ? null : (pick(front?.flavor_name, card.flavor_name)?.trim() || null);
  // The frame the import lands on (static: the creator / the named route
  // finalize it against the verified combos).
  const landingTemplate = frameTemplateFromScryfall(card, frameMatch);

  return {
    // For a multi-face card, the front face's own name ("Fire", not "Fire //
    // Ice") is the right seed for the front we're populating.
    title: emblem
      ? emblemTitleFromName((isMultiFace && front?.name) || card.name)
      : (isMultiFace && front?.name) || card.name,
    // The printing's nickname (TODO 6.3): the front face's own, else the
    // card's (an emblem prints its walker's name, never one).
    ...nicknameKey(frontNickname),
    cost: emblem ? undefined : pick(front?.mana_cost, card.mana_cost),
    kind,
    frame_template: landingTemplate,
    frame_match: frameMatch,
    printing_treatment: printingTreatmentFromScryfall(card),
    printing_detail: printingDetailFromScryfall(card),
    card_type: cardType,
    supertype: emblem ? undefined : supertype,
    ...printedTypesKey(
      emblem
        ? undefined
        : printedTypesOfPrinting(pick(front?.type_line, card.type_line), { cardType, supertype }),
    ),
    subtypes_text: emblem && !emblemPrintsSubtype(card) ? undefined : typeParts.subtypes_text,
    rarity: emblem ? "common" : rarityChecked,
    color_identity: emblem
      ? ["colorless"]
      : frontColorIdentity.length > 0
        ? frontColorIdentity
        : undefined,
    color_pair: frontFacePairFromScryfall(card) ?? undefined,
    // The transform icon family the printing wears (TODO 5.4, owner Q5),
    // only where the printing lands on a TRANSFORM body (the modal housing
    // has no family).
    // (A battle wears none: TODO 5.5.)
    ...(dfcLanding?.layout === "transform" && dfcLanding.kind !== "battle" ? { printed_dfc_icon: dfcLanding.family } : {}),
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
    // …and the holofoil stamp it carries (TODO 4.9c).
    printed_stamp: stampOfPrinting(card),
    // …and its border (TODO 4.30): white, or no key at all.
    ...((card.border_color ?? "").trim().toLowerCase() === "white" ? { printed_border: "white" as const } : {}),
    // …and its first part's own colour (TODO 4.26, M2): a split or
    // aftermath half's, where it is not the card's whole colour.
    ...(() => {
      const first = firstPartColorOf(card, frontColorIdentity);
      return first ? { printed_first_part_color: first } : {};
    })(),
    // …and a two-colour Expedition's plain-land frame (TODO 4.11): frame
    // data beside its unchanged colour.
    ...(twoColourLandOnPlainFrame(card, frontFaceColors(card)) ? { printed_plain_land_master: true as const } : {}),
    // A flavour-name printing (TODO 6.2, owner Round 80) writes its own
    // name as `~`, which draws the nickname its title bar prints — as the
    // printing sets its rules. Every other import keeps Oracle's name.
    // The short form only where the frame prints the nickname (independent
    // check S1) — BOTH the frame the import lands on and the one that
    // reproduces the printing (a borderless printing lands on a bordered
    // frame until its own is verified, then moves): elsewhere `~` draws the
    // full name where Oracle reads the short one.
    rules_text:
      frontNickname && !options.oracleRules
        ? oracleSelfNamesAsTokens(pick(front?.oracle_text, card.oracle_text), (isMultiFace && front?.name) || card.name, {
            supertype,
            shortForm: everyLandingPrintsNickname(landingTemplate, frameMatch, typeParts.subtypes_text),
          })
        : pick(front?.oracle_text, card.oracle_text),
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
    // A double-sided token's back (TODO 5.5 (c)) is a token of its own,
    // on the token template its words and text derive in the front's
    // design — finalizeImportMatch derives it again for the front it lands
    // on and keeps it only once both faces are verified.
    back_face:
      !droppedFace && card.card_faces && card.card_faces.length >= 2
        ? doubleFacedTokenShapeOf(card) === "pair"
          ? mapTokenBackFacePatch(card, frameTemplateFromScryfall(card, frameMatch))
          : mapScryfallBackFacePatch(card, dfcLanding)
        : undefined,
    dropped_face: droppedFace,
  };
}

/** One face of a multi-face printing as a single-faced TOKEN printing: the
 *  printing's own fields (set, number, frame, release, promos…) with that
 *  face's name, type line, text, colours, stats, artist and images. */
function tokenFaceAlone(card: ScryfallCard, index: number): ScryfallCard {
  const face = card.card_faces?.[index];
  const { card_faces: _faces, ...rest } = card;
  void _faces;
  return { ...rest, ...face, layout: "token" } as ScryfallCard;
}

/**
 * A double-sided token's BACK (TODO 5.5 (c)): `card_faces[1]` read as a token
 * (its "Token" word is the card type, the rest its type words), in its own
 * colour, on the token template `tokenBackBodyFor` derives under the
 * front's `frontTemplate`. finalizeImportMatch derives the body again for
 * the front the import lands on.
 */
function mapTokenBackFacePatch(
  card: ScryfallCard,
  frontTemplate: FrameTemplate | undefined,
): ScryfallImportBackFacePatch | undefined {
  const back = card.card_faces?.[1];
  if (!back) return undefined;
  const typeParts = parseTypeLine(back.type_line, { cardType: "token" });
  const supertype = typeParts.supertype;
  const colour = backFrameColorsFromScryfall(card);
  const body = tokenBackBodyFor(frontTemplate, {
    supertype,
    subtypes: typeParts.subtypes_text,
    rulesText: back.oracle_text,
    flavorText: back.flavor_text,
    power: back.power,
    toughness: back.toughness,
    colorIdentity: colour,
  });
  return {
    ...(body ? { color_identity: colour, frame_style: { template: body } } : {}),
    title: back.name ?? undefined,
    card_type: "token",
    supertype,
    ...printedTypesKey(printedTypesOfPrinting(back.type_line, { cardType: "token", supertype })),
    subtypes_text: typeParts.subtypes_text,
    rules_text: back.oracle_text ?? undefined,
    flavor_text: back.flavor_text ?? undefined,
    power: back.power ?? undefined,
    toughness: back.toughness ?? undefined,
    artist_credit: scryfallFaceArtist(card, 1),
    imported_art_url: null,
  };
}

/**
 * Build the back-face patch from `card.card_faces[1]`. Mirrors the front
 * mapper's field-by-field defensiveness — invalid card_types and missing
 * fields are simply omitted rather than guessed. On a printing that lands
 * on the double-faced bodies (TODO 5.4) the back carries its BODY and its
 * own COLOUR too; a legacy back (every other two-faced printing) neither.
 * Exported for the admin compare view, which shows a face the import DROPS
 * (a walker back, 5.13) as the legacy back a stored card still has.
 */
export function mapScryfallBackFacePatch(
  card: ScryfallCard,
  dfc: DfcImportFacts | null = null,
): ScryfallImportBackFacePatch | undefined {
  const back = card.card_faces?.[1];
  if (!back) return undefined;

  const typeParts = parseTypeLine(back.type_line);
  const cardType =
    typeParts.card_type &&
    (CARD_TYPE_VALUES as readonly string[]).includes(typeParts.card_type)
      ? typeParts.card_type
      : undefined;

  const body = dfc?.kind && dfc.backBody ? dfc.backBody : null;

  return {
    // The back's own frame colour and body, on the double-faced bodies only
    // (the server's gate derives the same body; the colour is stored).
    ...(body
      ? {
          color_identity: dfcFaceColorIdentity(body, dfc!.backType, backFrameColorsFromScryfall(card)),
          frame_style: { template: body },
        }
      : // The second part's own colour (TODO 4.26): a split or aftermath
        // half, a Prepare spell — what its cost says (partColorFromCost: a
        // colour, a pair, gold for three or more); none on a colourless
        // part, which prints the card's.
        isPartColourLayout(card) && partColorFromCost(back.mana_cost).length > 0
        ? { color_identity: partColorFromCost(back.mana_cost) }
        : {}),
    title: back.name ?? undefined,
    cost: back.mana_cost ?? undefined,
    card_type: cardType,
    supertype: typeParts.supertype,
    ...printedTypesKey(printedTypesOfPrinting(back.type_line, { cardType, supertype: typeParts.supertype })),
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
