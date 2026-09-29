// Pure, React-free model for the KIND-FIRST creator flow: the user picks what
// they're making (a "card kind"), then a frame from every era that can dress
// that kind, then the frame's color.
//
// A kind is a WIZARD-LEVEL concept and is never persisted. Cards keep storing
// `card_type` + `frame_style.template`; `kindFromCard()` re-derives the kind
// on load, so drafts, edit mode, and legacy rows work with no migration and
// there is no second source of truth to fall out of sync.
//
// Standard kinds mirror CardType (minus the legacy "spell"). Layout kinds
// promote the structural M15 layouts (Saga, Adventure, Split, Aftermath,
// Flip) to first-class choices — they change the card's anatomy, so they ARE
// what the user is making. Skins (m15snow/m15devoid) are NOT kinds: a snow
// creature is still a creature; the gallery offers them as variants.
//
// Kept side-effect free + dependency-light so it's unit-testable and shared
// by the form, panels, and import mappers.

import {
  TEMPLATE_SKIN_VARIANTS,
  ERA_TYPE_FRAME,
  FRAME_ERA_LABELS,
  FRAME_ERA_VALUES,
  FRAME_SET_ERA,
  FRAME_TEMPLATE_SET,
  FRAME_TEMPLATE_VALUES,
  type CardType,
  type FrameEra,
  type FrameTemplate,
} from "@/types/card";
import {
  TOKEN_TYPE_WORDS,
  normalizeFrameTemplate,
  supertypeHasWord,
  withSupertypeWord,
  withoutSupertypeWord,
  type TokenTypeWord,
} from "@/lib/cards/card-display";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { isFrameComboAvailable } from "@/lib/cards/frame-availability";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import {
  BASIC_LAND_NAME_BY_KEY,
  basicLandManaKey,
  basicLandNameForColorKey,
  basicSubtypeManaKey,
  hasBasicSupertype,
  isBasicLandTitle,
  type BasicLandFace,
} from "@/lib/cards/watermark";
import { eraForTemplate, standardFrameFor } from "@/lib/creator/frame-picker";

// ---------------------------------------------------------------------------
// Kind taxonomy
// ---------------------------------------------------------------------------

export const CARD_KIND_VALUES = [
  // Standard kinds — mirror CardType, minus the legacy "spell".
  "creature",
  "instant",
  "sorcery",
  "artifact",
  "enchantment",
  "land",
  "planeswalker",
  "battle",
  "token",
  // Layout kinds — structural M15 layouts promoted to first-class picks.
  "saga",
  "adventure",
  "split",
  "aftermath",
  "flip",
] as const;
export type CardKind = (typeof CARD_KIND_VALUES)[number];

export type KindDef = {
  label: string;
  /** The card_type written when this kind is chosen. */
  cardType: CardType;
  /** Exact template family for layout kinds; null → standard kind whose
   *  frames come from ERA_TYPE_FRAME per era (+ skins + showcase). */
  layoutTemplates: readonly FrameTemplate[] | null;
  /** The frame paints an intrinsic second face (Adventure's storybook page,
   *  a flip/split/aftermath half) → the wizard force-enables has_back_face.
   *  DERIVED from the frame profile (templatePaintsSecondFace) — never
   *  hand-kept, so it can't drift from what the renderer actually paints. */
  inlineSecondFace: boolean;
  /** Representative template for the kind chip's thumbnail. */
  previewTemplate: FrameTemplate;
};

/** True when the template's profile paints an intrinsic second face drawn
 *  from back-face content (Adventure's storybook page, a flip/split/
 *  aftermath half). The ONE source of truth — steps.ts hasInlineBackFace and
 *  KIND_DEFS.inlineSecondFace both resolve through it. */
export function templatePaintsSecondFace(
  template: FrameTemplate | string | undefined,
): boolean {
  const p = getFrameProfile(normalizeFrameTemplate(template));
  return p.adventure != null || p.secondFace != null;
}

const RAW_KIND_DEFS: Record<CardKind, Omit<KindDef, "inlineSecondFace">> = {
  creature: {
    label: "Creature",
    cardType: "creature",
    layoutTemplates: null,
    previewTemplate: "m15",
  },
  instant: {
    label: "Instant",
    cardType: "instant",
    layoutTemplates: null,
    previewTemplate: "m15",
  },
  sorcery: {
    label: "Sorcery",
    cardType: "sorcery",
    layoutTemplates: null,
    previewTemplate: "m15",
  },
  artifact: {
    label: "Artifact",
    cardType: "artifact",
    layoutTemplates: null,
    previewTemplate: "m15artifact",
  },
  enchantment: {
    label: "Enchantment",
    cardType: "enchantment",
    layoutTemplates: null,
    previewTemplate: "m15",
  },
  land: {
    label: "Land",
    cardType: "land",
    layoutTemplates: null,
    previewTemplate: "m15land",
  },
  planeswalker: {
    label: "Planeswalker",
    cardType: "planeswalker",
    layoutTemplates: null,
    previewTemplate: "m15pw",
  },
  battle: {
    label: "Battle",
    cardType: "battle",
    layoutTemplates: null,
    previewTemplate: "battle",
  },
  token: {
    label: "Token",
    cardType: "token",
    layoutTemplates: null,
    previewTemplate: "m15token",
  },
  saga: {
    label: "Saga",
    cardType: "enchantment",
    layoutTemplates: ["saga"],
    previewTemplate: "saga",
  },
  adventure: {
    label: "Adventure",
    cardType: "creature",
    layoutTemplates: ["adventure"],
    previewTemplate: "adventure",
  },
  split: {
    label: "Split",
    cardType: "instant",
    layoutTemplates: ["split"],
    previewTemplate: "split",
  },
  aftermath: {
    label: "Aftermath",
    cardType: "sorcery",
    layoutTemplates: ["aftermath"],
    previewTemplate: "aftermath",
  },
  flip: {
    label: "Flip",
    cardType: "creature",
    layoutTemplates: ["flip"],
    previewTemplate: "flip",
  },
};

export const KIND_DEFS: Record<CardKind, KindDef> = Object.fromEntries(
  (Object.entries(RAW_KIND_DEFS) as [CardKind, Omit<KindDef, "inlineSecondFace">][]).map(
    ([kind, def]) => [
      kind,
      {
        ...def,
        // Standard kinds never paint a second face; layout kinds ask their
        // template's profile (saga's chapter rail is NOT a second face).
        inlineSecondFace: def.layoutTemplates
          ? templatePaintsSecondFace(def.layoutTemplates[0])
          : false,
      },
    ],
  ),
) as Record<CardKind, KindDef>;

// ---------------------------------------------------------------------------
// The card types a layout kind's template can draw (TODO 1.21). A layout kind
// writes its own card type (KIND_DEFS[kind].cardType) on a kind change, but a
// real card on that layout may be another type: Virtue of Loyalty WOE #38 is
// an Enchantment adventurer, Commit // Memory AKH #211 an Instant aftermath,
// Beck // Call DGM #123 a Sorcery split card. The import keeps the printed
// type when the template can draw it (importedCardTypeForKind), so the P/T,
// loyalty and watermark gating follow the real card. The kind never changes:
// kindFromCard reads the layout template first, whatever the card type.
//
// Decided from the profiles and the masters (tests/unit/creator/
// layout-kind-card-types.test.ts holds the table to the profiles):
//   • adventure — the master (m15 + the storybook pages) paints no P/T box;
//     the P/T plate is M15's overlay, drawn only when the card type shows
//     P/T, and the cost hides only for a land (the FIN Towns have none). No
//     loyalty or defense slot. So every permanent and spell type draws:
//     Scryfall prints 22 non-creature adventurers (captured 2026-09-28) — 8
//     enchantments (the WOE Virtues), 8 artifacts (Equipment, a Book), 5 FIN
//     Town lands and 1 sorcery (Twice Upon a Time).
//   • flip — the P/T is ink on the cream band, drawn only for a P/T type; the
//     master paints no box. Kamigawa's flips are creatures; WOE's Role tokens
//     ("Token Enchantment — Aura Role") are tokens.
//   • saga — Saga is an enchantment subtype; the chapter rail replaces the
//     rules box and the profile has no P/T slot (a FIN Summon, "Enchantment
//     Creature — Saga Dragon", stays the enchantment with "Creature" in
//     front: TODO 1.20).
//   • split / aftermath — both halves are spells; Scryfall has no split card
//     of another type (the Rooms are split on Scryfall but import as
//     enchantments, not this kind).
// ---------------------------------------------------------------------------

type LayoutKind = "saga" | "adventure" | "split" | "aftermath" | "flip";

export const LAYOUT_KIND_CARD_TYPES: Readonly<Record<LayoutKind, readonly CardType[]>> = {
  saga: ["enchantment"],
  adventure: ["creature", "enchantment", "artifact", "land", "instant", "sorcery"],
  split: ["instant", "sorcery"],
  aftermath: ["instant", "sorcery"],
  flip: ["creature", "enchantment", "token"],
};

/** The card type an import writes for its kind (TODO 1.21): a layout kind
 *  keeps the printed card type when its template can draw it
 *  (LAYOUT_KIND_CARD_TYPES), else its own; a standard kind is its own card
 *  type. */
export function importedCardTypeForKind(
  kind: CardKind,
  patchCardType: CardType | null | undefined,
): CardType {
  const own = KIND_DEFS[kind].cardType;
  if (!patchCardType || !KIND_DEFS[kind].layoutTemplates) return own;
  const drawable = LAYOUT_KIND_CARD_TYPES[kind as LayoutKind] ?? [];
  return drawable.includes(patchCardType) ? patchCardType : own;
}

// Reverse map: layout template → its kind (saga → saga, adventure →
// adventure, …). Skins and standards are deliberately absent — they resolve
// through the card_type branch of kindFromCard.
const TEMPLATE_KIND: ReadonlyMap<FrameTemplate, CardKind> = new Map(
  (Object.entries(KIND_DEFS) as [CardKind, KindDef][]).flatMap(
    ([kind, def]) => (def.layoutTemplates ?? []).map((t) => [t, kind] as const),
  ),
);

/** Derive the kind from persisted/form state. The template wins (a saga
 *  frame IS the saga kind, whatever card_type says); otherwise card_type
 *  maps 1:1. Legacy "spell" displays as sorcery WITHOUT rewriting the stored
 *  card_type — writes only happen on an explicit kind change. */
export function kindFromCard(
  cardType: CardType | "" | null | undefined,
  template: FrameTemplate | string | null | undefined,
): CardKind {
  const byTemplate = TEMPLATE_KIND.get(normalizeFrameTemplate(template));
  if (byTemplate) return byTemplate;
  const ct = (cardType || "creature") as CardType;
  return ct === "spell" ? "sorcery" : (ct as CardKind);
}

// ---------------------------------------------------------------------------
// Frame gallery — every frame that can dress a kind, across all eras
// ---------------------------------------------------------------------------

/** The 7-color PNG contract every template ships (frame-layer.tsx maps a
 *  ColorIdentity[] onto one of these via pickFrameColorKey). A template may
 *  ship an extra type-dressed master too — agclassic's colourless artifact
 *  card "a" (frameMasterKey) — which is not a colour and has no chip. */
export const FRAME_COLOR_KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;
export type FrameColorKey = (typeof FRAME_COLOR_KEYS)[number];

export type FrameChoice = {
  template: FrameTemplate;
  /** Groups/labels the gallery section this frame renders under. */
  era: FrameEra;
  group: "standard" | "skin" | "layout" | "showcase";
  /** Color keys the verification gate has published for this template.
   *  Empty → render the tile disabled with a Soon badge. */
  availableColorKeys: FrameColorKey[];
};

const SHOWCASE_TEMPLATES: readonly FrameTemplate[] =
  FRAME_TEMPLATE_VALUES.filter(
    (t) => FRAME_SET_ERA[FRAME_TEMPLATE_SET[t]] === "showcase",
  );

// Kinds a frame can only draw through a stat overlay its profile must carry:
// a planeswalker needs the loyalty shield and the ability rows
// (`loyaltyRows`), a battle its defense shield. Of the frames that dress
// every kind, only m15pw and battle have them; 4.5's overlay model brings
// them to the showcase frames.
const STAT_OVERLAY_KINDS: readonly CardKind[] = ["planeswalker", "battle"];
const KINDS_WITHOUT_STAT_OVERLAY: readonly CardKind[] = CARD_KIND_VALUES.filter(
  (kind) =>
    RAW_KIND_DEFS[kind].layoutTemplates === null &&
    !STAT_OVERLAY_KINDS.includes(kind),
);

// Type-specific showcase treatments: real expeditions / full-art basics are
// land trade dress, Nyx constellation is enchantment dress — which an
// Enchantment Creature borrows (the Theros Beyond Death gods, owner decision
// A3 2026-09-29; see BORROWED_SHOWCASES below). The Zendikar
// Rising hedron (`fullart`), textless and extended-art frames have no
// loyalty or defense slot, so a planeswalker would print no loyalty and
// plain ability lines, and a battle no defense (full-art research
// 2026-09-26, TODO 0.26) — they take every kind but those two until 4.5.
// Absent = any standard kind (stats still gate on type).
//
// The borderless M15 frame (4.32) is a SKIN of the M15 standard and of the
// M15 artifact frame, so the gallery only offers it where those are — but
// it is new (no legacy card sits on it), so it carries a restriction too and
// the server refuses it on any other kind: CC's pack has no planeswalker,
// land, token or battle frame (those are 4.33 / 4.34 / 4.37). The artifact
// dress also serves an Artifact Creature, borrowed like m15artifact (1.7).
const SHOWCASE_KIND_RESTRICTION: Partial<
  Record<FrameTemplate, readonly CardKind[]>
> = {
  expeditionland: ["land"],
  m15fullartland: ["land"],
  fullartland: ["land"],
  m15textlessland: ["land"],
  m15borderless: ["creature", "instant", "sorcery", "enchantment", "artifact"],
  m15borderlessartifact: ["artifact", "creature"],
  nyx: ["enchantment", "creature"],
  fullart: KINDS_WITHOUT_STAT_OVERLAY,
  m15textless: KINDS_WITHOUT_STAT_OVERLAY,
  extendedart: KINDS_WITHOUT_STAT_OVERLAY,
};

/** True when a showcase treatment's kind restriction leaves this kind out
 *  (a planeswalker on the Zendikar Rising hedron frame, an artifact on Nyx,
 *  a land on the borderless M15 frame). Unlike `!templateSupportsKind`, it
 *  never refuses a border-era standard or a layout frame, so an off-kind
 *  legacy card (an artifact on the plain m15 frame) isn't caught. The
 *  server's frame gate uses this. */
export function templateRefusesKind(
  template: FrameTemplate,
  kind: CardKind,
): boolean {
  const allowed = SHOWCASE_KIND_RESTRICTION[template];
  return allowed !== undefined && !allowed.includes(kind);
}

// ---------------------------------------------------------------------------
// Basic-only frames (TODO 0.26). `fullartland` paints a name bar and a type
// bar over edge-to-edge art and nothing else: on a nonbasic land (a
// shockland) the rules print in cream straight on the art with no backdrop.
// The kind restriction above can't catch that, because the Land kind covers
// basics and nonbasics alike, so these frames carry a per-template flag.
// Nonbasic edge-to-edge lands are 4.34's; the full-art basics of 4.39–4.41
// join this set (4.39's black-bordered m15fullartland is the first).
// ---------------------------------------------------------------------------

const BASIC_ONLY_TEMPLATES: ReadonlySet<FrameTemplate> = new Set<FrameTemplate>([
  "m15fullartland",
  "fullartland",
]);

/** Why a basic-only frame's chip is disabled on any other card. */
export const BASIC_ONLY_FRAME_REASON = "Full-art basic frames are for basic lands";

/** True when the template dresses basic lands only. */
export function templateIsBasicOnly(template: FrameTemplate): boolean {
  return BASIC_ONLY_TEMPLATES.has(template);
}

/** True when the face is ONE basic land: the renderers' basic-land rule
 *  (`basicLandManaKey` — the big symbol, no rules text) with at most one
 *  basic land type, so a dual typed "Plains Island" stays out (3b.4).
 *  Wastes has none. */
export function isSingleBasicLand(face: BasicLandFace): boolean {
  if (basicLandManaKey(face) === null) return false;
  const basicTypes = (face.subtypes ?? []).filter(
    (subtype) => basicSubtypeManaKey([subtype]) !== null,
  );
  return basicTypes.length <= 1;
}

// ---------------------------------------------------------------------------
// Borrowed variations (TODO 1.7). A frame that is one kind's standard can
// also dress another kind as a variation of that kind's standard, when both
// share the geometry. The M15 artifact frame is the Artifact kind's
// standard; an Artifact Creature is a CREATURE (the P/T box and inputs are
// gated on card_type) printed on the artifact frame — Solemn Simulacrum M21
// #239 is the curated m15artifact/c reference. m15artifact is the M15
// profile with its own P/T plates, so it dresses a creature as a skin of
// m15. Keyed by kind, then by the base frame the variation re-dresses.
// ---------------------------------------------------------------------------

const BORROWED_VARIATIONS: Partial<
  Record<CardKind, Partial<Record<FrameTemplate, readonly FrameTemplate[]>>>
> = {
  // …and the borderless artifact dress (4.32), a skin of m15artifact that
  // an Artifact Creature borrows the same way.
  creature: { m15: ["m15artifact", "m15borderlessartifact"] },
};

// Showcase frames a kind borrows the same way (owner decision A3,
// 2026-09-29): the Nyx constellation frame is the Enchantment kind's
// showcase, and an ENCHANTMENT Creature — the Theros Beyond Death
// constellation gods, THB #258–268 — prints on it. NYX is the M15 profile
// with its P/T plate, so it dresses a creature as it is; the Variations
// section lists it with the other showcase treatments.
const BORROWED_SHOWCASES: Partial<Record<CardKind, readonly FrameTemplate[]>> = {
  creature: ["nyx"],
};

/** The card-type word a borrowed frame dresses the card as. */
export type BorrowedTypeWord = "Artifact" | "Enchantment";

const BORROWED_TYPE_WORD: Partial<Record<FrameTemplate, BorrowedTypeWord>> = {
  m15artifact: "Artifact",
  m15borderlessartifact: "Artifact",
  nyx: "Enchantment",
};

/** The variations the Variations section offers under `base` for this
 *  kind: the base's skins (TEMPLATE_SKIN_VARIANTS) plus the frames the kind
 *  borrows for it (the artifact frame under a creature's M15 standard). */
export function skinVariantsFor(
  kind: CardKind,
  base: FrameTemplate,
): FrameTemplate[] {
  return [
    ...(TEMPLATE_SKIN_VARIANTS[base] ?? []),
    ...(BORROWED_VARIATIONS[kind]?.[base] ?? []),
  ];
}

/** True when the template is a frame this kind borrows from another kind
 *  (the artifact frame or the Nyx showcase on a creature). It dresses the
 *  card as that other type too, so a RANDOM frame pick skips it unless the
 *  card says so (resolveGeneratedFrame). */
export function isBorrowedVariation(
  kind: CardKind,
  template: FrameTemplate,
): boolean {
  return (
    Object.values(BORROWED_VARIATIONS[kind] ?? {}).some((list) =>
      (list ?? []).includes(template),
    ) || (BORROWED_SHOWCASES[kind] ?? []).includes(template)
  );
}

/** The word a frame this kind borrows dresses the card as ("Artifact" for
 *  the artifact frame on a creature, "Enchantment" for Nyx), or null when
 *  the kind doesn't borrow the template. */
export function borrowedTypeWord(
  kind: CardKind,
  template: FrameTemplate,
): BorrowedTypeWord | null {
  return isBorrowedVariation(kind, template)
    ? (BORROWED_TYPE_WORD[template] ?? null)
    : null;
}

/** True when the type line says `word`: the card type itself, or the word
 *  among the supertype words (an "Enchantment Creature — God" is the
 *  creature type with "Enchantment" in its supertype, as the importer and
 *  the creator write it). */
export function typeLineHasWord(
  type: { cardType?: string | null; supertype?: string | null },
  word: BorrowedTypeWord,
): boolean {
  const lower = word.toLowerCase();
  if (type.cardType === lower) return true;
  return (type.supertype ?? "")
    .split(/\s+/)
    .some((part) => part.toLowerCase() === lower);
}

/** True when this card may wear the template as far as borrowing goes: the
 *  kind doesn't borrow it, or the type line says the word it dresses (an
 *  Artifact Creature on the artifact frame, an Enchantment Creature on
 *  Nyx) — never Llanowar Elves on either. */
export function borrowedFrameFits(
  kind: CardKind,
  template: FrameTemplate,
  type: { cardType?: string | null; supertype?: string | null },
): boolean {
  const word = borrowedTypeWord(kind, template);
  return word === null || typeLineHasWord(type, word);
}

/** A creature's supertype once it takes a frame it borrows: `word` after
 *  its other words ("Legendary" → "Legendary Artifact"), so the type line
 *  reads "Legendary Artifact Creature". A supertype that already says the
 *  word is returned unchanged. */
export function withTypeWord(
  supertype: string | null | undefined,
  word: BorrowedTypeWord,
): string {
  const words = (supertype ?? "").split(/\s+/).filter(Boolean);
  if (words.some((part) => part.toLowerCase() === word.toLowerCase())) return words.join(" ");
  return [...words, word].join(" ");
}

/** The supertype without `word` (every other word kept, in order) — undoes
 *  withTypeWord. */
export function withoutTypeWord(
  supertype: string | null | undefined,
  word: BorrowedTypeWord,
): string {
  return (supertype ?? "")
    .split(/\s+/)
    .filter((part) => part && part.toLowerCase() !== word.toLowerCase())
    .join(" ");
}

// ---------------------------------------------------------------------------
// The token kind's type picker (TODO 3b.15). A token's card types are words
// in its supertype ("Token Artifact Creature — Thopter", the importer's 1.3
// rule), and the picker toggles them: Creature · Artifact · Enchantment, plus
// Legendary. Each toggle writes or removes only its own word, in printed
// order (withSupertypeWord), and keeps every other word (Snow, Land, an
// import's Basic). None on is allowed — the bare "Token" of a Copy (TFDN
// #26, owner 2026-09-29). Creature is on for a new token.
//
// Seam for 6.23: an "Emblem" choice sits here too (owner 2026-09-29: inside
// the Token kind, next to the types — not its own kind chip), switching the
// card to the emblem kind, which stores its own card type. It is not built
// until that kind exists: no dead button.
// ---------------------------------------------------------------------------

/** The picker's toggles, in display order (the type chips, then Legendary). */
export const TOKEN_PICKER_WORDS = ["Creature", "Artifact", "Enchantment", "Legendary"] as const;
export type TokenPickerWord = (typeof TOKEN_PICKER_WORDS)[number];

/** Which picker toggles the supertype lights (an import lights its own). */
export function tokenPickerWordsOf(
  supertype: string | null | undefined,
): TokenPickerWord[] {
  return TOKEN_PICKER_WORDS.filter((word) => supertypeHasWord(supertype, word));
}

/** The supertype after a picker toggle: `word` added in printed order when
 *  `on`, removed otherwise; nothing else moves. */
export function toggleTokenWord(
  supertype: string | null | undefined,
  word: TokenPickerWord,
  on: boolean,
): string {
  return on ? withSupertypeWord(supertype, word) : withoutSupertypeWord(supertype, word);
}

/** The supertype a card carries INTO the token kind: "Creature" is on for a
 *  new token (a creature turned token stays a creature). */
export function supertypeEnteringToken(supertype: string | null | undefined): string {
  return withSupertypeWord(supertype, "Creature");
}

/** The supertype a token carries OUT of the token kind: the picker's type
 *  words are the token's own ("Creature" on a creature card would print
 *  "Creature Creature"), so they go; Legendary and every other word stay. */
export function supertypeLeavingToken(supertype: string | null | undefined): string {
  return TOKEN_TYPE_WORDS.reduce<string>(
    (acc, word) => withoutSupertypeWord(acc, word),
    supertype ?? "",
  );
}

/** A printed token's name follows its subtypes ("Soldier", "Rabbit
 *  Knight") unless it has a proper name (TMKM #13 Voja Fenstalker). */
export function tokenNameFromSubtypes(subtypes: readonly string[]): string {
  return subtypes.map((s) => s.trim()).filter(Boolean).join(" ");
}

/**
 * The title a token's name-follow writes (TODO 3b.15), or null to leave it:
 * the name follows the subtypes while it is empty or still the last name it
 * wrote (`lastAuto`); once the user types their own, it stops.
 */
export function followTokenName(input: {
  title: string;
  lastAuto: string | null;
  subtypes: readonly string[];
}): string | null {
  const following = input.title.trim() === "" || input.title === input.lastAuto;
  if (!following) return null;
  const next = tokenNameFromSubtypes(input.subtypes);
  return next === input.title ? null : next;
}

// Frames a kind wears BY TYPE WORD rather than as a pick (TODO 3b.15, 4.50):
// the artifact token frame dresses an Artifact token — the picker's Artifact
// toggle writes the word and the frame follows — so the "Artifact Token"
// chip is no longer a choice of its own (stored cards keep their template).
// Keyed by kind, then by the base frame the word re-dresses. Enchantment's
// Nyx dress joins here with 4.51; the full-art family's artifact templates
// with 4.48 / 4.50. The text-box token (4.49 (b)) has its own artifact
// dress, as the textless one does.
const TYPE_WORD_DRESSES: Partial<
  Record<CardKind, Partial<Record<FrameTemplate, { word: TokenTypeWord; template: FrameTemplate }>>>
> = {
  token: {
    m15token: { word: "Artifact", template: "m15tokenartifact" },
    m15tokentext: { word: "Artifact", template: "m15tokenartifacttext" },
  },
};

/** True when the template is a frame this kind wears by type word (the
 *  artifact token frame on a token): the frame pickers don't offer it. */
export function isTypeWordDress(kind: CardKind, template: FrameTemplate): boolean {
  return Object.values(TYPE_WORD_DRESSES[kind] ?? {}).some(
    (dress) => dress?.template === template,
  );
}

/**
 * The frame the type words pick for a card on `template`: on a base with a
 * type-word dress (m15token, m15tokentext) or on the dress itself, the dress
 * when the supertype says its word (an Artifact token → m15tokenartifact,
 * m15tokenartifacttext) and the base otherwise; any other template is
 * returned as it is (a token on the Classic or a showcase frame keeps it).
 */
export function typeWordFrameFor(
  kind: CardKind,
  template: FrameTemplate,
  supertype: string | null | undefined,
): FrameTemplate {
  const dresses = TYPE_WORD_DRESSES[kind] ?? {};
  for (const [base, dress] of Object.entries(dresses) as [FrameTemplate, { word: TokenTypeWord; template: FrameTemplate }][]) {
    if (template !== base && template !== dress.template) continue;
    return supertypeHasWord(supertype, dress.word) ? dress.template : base;
  }
  return template;
}

/** True when the template is the one the type words pick (typeWordFrameFor)
 *  — a random or requested frame never dresses a creature token as an
 *  artifact, nor a Treasure on the plain token frame. */
export function typeWordFrameFits(
  kind: CardKind,
  template: FrameTemplate,
  supertype: string | null | undefined,
): boolean {
  return typeWordFrameFor(kind, template, supertype) === template;
}

/** withTypeWord for the artifact frame a creature borrows (TODO 1.7). */
export function withArtifactWord(supertype: string | null | undefined): string {
  return withTypeWord(supertype, "Artifact");
}

/** withoutTypeWord for the artifact frame — undoes withArtifactWord. */
export function withoutArtifactWord(supertype: string | null | undefined): string {
  return withoutTypeWord(supertype, "Artifact");
}

/** All frames offered for a kind, across every era, in gallery display
 *  order: border-era standards (+ their skin variants) oldest→newest, then
 *  layout templates, then showcase treatments. There is deliberately NO
 *  fallback here — an era with no frame for the kind simply doesn't appear,
 *  which removes the picker's dead ends by construction. */
export function framesForKind(
  kind: CardKind,
  verifiedKeys: ReadonlySet<string>,
): FrameChoice[] {
  const def = KIND_DEFS[kind];
  const colors = (t: FrameTemplate) =>
    FRAME_COLOR_KEYS.filter((k) => isFrameComboAvailable(t, k, verifiedKeys));

  // Layout kinds are exactly their template family (all M15-era today).
  if (def.layoutTemplates) {
    return def.layoutTemplates.map((t) => ({
      template: t,
      era: eraForTemplate(t),
      group: "layout" as const,
      availableColorKeys: colors(t),
    }));
  }

  const out: FrameChoice[] = [];
  for (const era of FRAME_ERA_VALUES) {
    if (era === "showcase") continue; // appended below, after border eras
    const standard = ERA_TYPE_FRAME[era]?.[def.cardType];
    if (!standard) continue;
    out.push({
      template: standard,
      era,
      group: "standard",
      availableColorKeys: colors(standard),
    });
    // Skins re-dress a specific BASE frame with identical geometry
    // (m15snow → m15, m15snowland → m15land, m15tokenartifact → m15token),
    // so each era standard brings exactly its own variants — plus the
    // frames this kind borrows for it (m15artifact under a creature's m15).
    for (const skin of skinVariantsFor(kind, standard)) {
      out.push({
        template: skin,
        era,
        group: "skin",
        availableColorKeys: colors(skin),
      });
    }
  }
  // Showcase treatments dress any standard kind (stats still gate on type),
  // except the type-restricted premium dresses above.
  for (const t of SHOWCASE_TEMPLATES) {
    const restriction = SHOWCASE_KIND_RESTRICTION[t];
    if (restriction && !restriction.includes(kind)) continue;
    out.push({
      template: t,
      era: "showcase",
      group: "showcase",
      availableColorKeys: colors(t),
    });
  }
  return out;
}

// Reverse skin map: variant → its base (m15snow → m15). Built from
// TEMPLATE_SKIN_VARIANTS so the two can't drift.
const SKIN_BASE: ReadonlyMap<FrameTemplate, FrameTemplate> = new Map(
  (Object.entries(TEMPLATE_SKIN_VARIANTS) as [FrameTemplate, FrameTemplate[]][]).flatMap(
    ([base, skins]) => (skins ?? []).map((s) => [s, base] as const),
  ),
);

/** The FRAME-section template a stored template maps to: a skin resolves to
 *  its base, a frame the kind borrows to the standard it re-dresses (the
 *  artifact frame on a creature → m15; on an artifact it IS the standard), a
 *  showcase treatment to the kind's M15 standard (showcase is M15-era trade
 *  dress), everything else to itself. The Variations section owns the
 *  difference between this and the actual template. */
export function baseFrameFor(
  kind: CardKind,
  template: FrameTemplate,
): FrameTemplate {
  // A frame the kind borrows maps to the standard it re-dresses FIRST: the
  // borderless artifact dress is m15artifact's skin, but a creature borrows
  // it under its own M15 standard.
  for (const [base, borrowed] of Object.entries(BORROWED_VARIATIONS[kind] ?? {})) {
    if ((borrowed ?? []).includes(template)) return base as FrameTemplate;
  }
  const skinBase = SKIN_BASE.get(template);
  if (skinBase) return skinBase;
  if (FRAME_SET_ERA[FRAME_TEMPLATE_SET[template]] === "showcase") {
    return standardFrameFor("m15", KIND_DEFS[kind].cardType) ?? template;
  }
  return template;
}

// Every (template, colour) key — the "everything is published" set used to
// ask which kinds a template can dress at all, independent of verification.
const ALL_COMBO_KEYS: ReadonlySet<string> = new Set(
  FRAME_TEMPLATE_VALUES.flatMap((t) =>
    FRAME_COLOR_KEYS.map((k) => frameComboKey(t, k)),
  ),
);

/** True when the template is in the kind's gallery at all (any era, skin
 *  or showcase treatment), ignoring the verification gate. Used to refuse a
 *  reference printing whose kind the frame can't render (a creature pinned
 *  on the saga frame). */
export function templateSupportsKind(
  template: FrameTemplate,
  kind: CardKind,
): boolean {
  return framesForKind(kind, ALL_COMBO_KEYS).some(
    (choice) => choice.template === template,
  );
}

/** True when the template has at least one PUBLISHED color. */
export function templateHasAvailableColor(
  template: FrameTemplate,
  verifiedKeys: ReadonlySet<string>,
): boolean {
  return FRAME_COLOR_KEYS.some((k) =>
    isFrameComboAvailable(template, k, verifiedKeys),
  );
}

/** The first gallery frame for a kind with any published color, or null when
 *  the whole kind is unpublished. Kind selection falls back through this so
 *  picking a card type can never land on an unverified frame. */
export function firstAvailableFrame(
  kind: CardKind,
  verifiedKeys: ReadonlySet<string>,
): FrameChoice | null {
  return (
    framesForKind(kind, verifiedKeys).find(
      (f) => f.availableColorKeys.length > 0,
    ) ?? null
  );
}

/** True when the kind has at least one published frame — drives the kind
 *  chips' enable/disable in the creator. */
export function kindHasAvailableFrame(
  kind: CardKind,
  verifiedKeys: ReadonlySet<string>,
): boolean {
  return firstAvailableFrame(kind, verifiedKeys) !== null;
}

// ---------------------------------------------------------------------------
// Basic-land auto-identity — picking the Land kind starts you on a real
// basic (name + Basic supertype + subtype), which is what makes the big
// mana symbol render immediately. The seed follows the frame color while
// untouched and is cleared when the user leaves the Land kind, so it can
// never overwrite a name the user typed.
//
// The seed must never OUTLIVE the user's intent either: a land renamed to
// anything but a basic's name becomes a nonbasic (the Basic supertype and
// the seed's subtype are dropped so the rules text box appears), and an
// import always writes its own supertype/subtypes over the seed. Before
// this, "Command Tower" typed over a seeded Plains kept "Basic — Plains"
// and printed a big symbol with no text (feedback, 2026-09-14).
// ---------------------------------------------------------------------------

export type BasicLandSeed = {
  title: string;
  supertype: string;
  subtypes_text: string;
};

/** The identity the creator seeds for a land of the given frame color
 *  ("c" → Wastes, which is "Basic Land" with NO land type). "m" has no
 *  basic — multicolor lands are nonbasics the user names themselves — so it
 *  returns null. */
export function basicLandSeedForColorKey(key: string): BasicLandSeed | null {
  const name = basicLandNameForColorKey(key);
  if (!name) return null;
  return {
    title: name,
    supertype: "Basic",
    subtypes_text: name === "Wastes" ? "" : name,
  };
}

/** True when the identity fields are untouched (all empty) or still exactly
 *  match one of the auto-seeds — the only states the creator is allowed to
 *  rewrite (color-follow, or cleanup on leaving the Land kind). */
export function isSeedableLandIdentity(v: BasicLandSeed): boolean {
  const title = v.title.trim();
  const supertype = v.supertype.trim();
  const subtypes = v.subtypes_text.trim();
  if (!title && !supertype && !subtypes) return true;
  return Object.values(BASIC_LAND_NAME_BY_KEY).some(
    (name) =>
      title === name &&
      supertype === "Basic" &&
      // Wastes seeds no subtype; a legacy draft may still carry "Wastes".
      (subtypes === name || (name === "Wastes" && subtypes === "")),
  );
}

/** Split the creator's comma/newline subtype field (mirrors parseSubtypes
 *  without the React-free module needing to import it). */
function splitSubtypes(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((piece) => piece.trim())
    .filter(Boolean);
}

/** True when the identity still carries the seed's basic-ness — a Basic
 *  supertype with, at most, ONE subtype that is itself a basic land type
 *  (the seed's own). A user-typed "Forest Island" or "Legendary" is not a
 *  seed residue and is left alone. */
export function landIdentityHasBasicSeed(v: BasicLandSeed): boolean {
  if (!hasBasicSupertype(v.supertype)) return false;
  const parts = splitSubtypes(v.subtypes_text);
  if (parts.length === 0) return true;
  return parts.length === 1 && basicSubtypeManaKey(parts) !== null;
}

/** The identity of the same card as a NONBASIC land: "Basic" leaves the
 *  supertype, and a lone seed subtype (Plains/…/Wastes) is dropped —
 *  anything the user typed themselves survives. */
export function toNonbasicLandIdentity(v: BasicLandSeed): BasicLandSeed {
  const supertype = v.supertype
    .replace(/\bbasic\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = splitSubtypes(v.subtypes_text);
  const subtypes_text =
    parts.length === 1 && basicSubtypeManaKey(parts) !== null
      ? ""
      : parts.join(", ");
  return { title: v.title, supertype, subtypes_text };
}

/** The identity of the same card as a BASIC land of the given frame color:
 *  "Basic" joins the supertype and, when no basic land type is present yet,
 *  the color's basic type becomes the subtype (none for Wastes). Returns
 *  null for the multicolor key — no basic is multicolor. */
export function toBasicLandIdentity(
  v: BasicLandSeed,
  colorKey: string,
): BasicLandSeed | null {
  const name = basicLandNameForColorKey(colorKey);
  if (!name) return null;
  const supertype = hasBasicSupertype(v.supertype)
    ? v.supertype.trim()
    : ["Basic", v.supertype.trim()].filter(Boolean).join(" ");
  const parts = splitSubtypes(v.subtypes_text);
  const subtypes_text =
    basicSubtypeManaKey(parts) !== null || name === "Wastes"
      ? parts.join(", ")
      : [name, ...parts].join(", ");
  return { title: v.title, supertype, subtypes_text };
}

/** Should the creator drop the seed because the user renamed the land?
 *  Only for a non-empty title that isn't a basic's name, on an identity
 *  that still carries the seed. */
export function shouldClearBasicSeedForTitle(v: BasicLandSeed): boolean {
  if (!v.title.trim() || isBasicLandTitle(v.title)) return false;
  return landIdentityHasBasicSeed(v);
}

// ---------------------------------------------------------------------------
// Kind changes — the ONLY writer of frame_style.template in the new flow
// ---------------------------------------------------------------------------

export type KindChangePatch = {
  card_type: CardType;
  template: FrameTemplate;
  /** Present (true) when entering a kind whose frame paints an intrinsic
   *  second face — the form force-enables the back-face editor. */
  has_back_face?: true;
};

export type KindChangePlan =
  | { action: "apply"; patch: KindChangePatch }
  | {
      action: "confirm";
      reason: "era-lacks-kind";
      /** User-facing prompt copy for the confirm dialog. */
      message: string;
      patch: KindChangePatch;
    };

/** Plan the state transition for an explicit kind change. Stays in the
 *  current frame's era when it has an equivalent frame for the new kind
 *  (m15 creature → m15pw); otherwise returns a CONFIRM plan that falls
 *  forward to the M15 era only if the user accepts — never silently.
 *  Everything not in the patch is untouched by design: title, text, art,
 *  cost, and colors always survive a kind change. */
export function planKindChange(
  next: CardKind,
  current: {
    cardType: CardType | "" | null | undefined;
    template: FrameTemplate | string | null | undefined;
  },
): KindChangePlan {
  const def = KIND_DEFS[next];
  const backFace = def.inlineSecondFace ? { has_back_face: true as const } : {};

  // Layout kinds are deterministic — one template family.
  if (def.layoutTemplates) {
    return {
      action: "apply",
      patch: {
        card_type: def.cardType,
        template: def.layoutTemplates[0],
        ...backFace,
      },
    };
  }

  const era = eraForTemplate(normalizeFrameTemplate(current.template));
  const sameEra = standardFrameFor(era, def.cardType);
  if (sameEra) {
    return {
      action: "apply",
      patch: { card_type: def.cardType, template: sameEra, ...backFace },
    };
  }

  // The era can't frame this kind (Classic has no planeswalker; showcase has
  // no type mapping). M15 frames every kind — but switching era is the
  // user's call, not ours.
  const fallback = standardFrameFor("m15", def.cardType);
  return {
    action: "confirm",
    reason: "era-lacks-kind",
    message: `${FRAME_ERA_LABELS[era]} has no ${def.label} frame — switch to the M15 ${def.label} frame?`,
    // M15 covers every card type, so fallback can't be null; the ?? only
    // satisfies the type system.
    patch: {
      card_type: def.cardType,
      template: fallback ?? "m15",
      ...backFace,
    },
  };
}
