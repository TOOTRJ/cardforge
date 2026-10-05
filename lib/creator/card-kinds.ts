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
  type FaceContent,
  type FrameEra,
  type FrameTemplate,
} from "@/types/card";
import { resolveLoyaltyRows } from "@/lib/cards/face-content";
import { DEFAULT_DFC_ICON, DFC_FACE_TYPES, bodyFor, dfcBodyOf, type DfcLayout } from "@/lib/cards/dfc";
import {
  TOKEN_TYPE_WORDS,
  hasRulesBoxText,
  normalizeFrameTemplate,
  supertypeHasWord,
  supertypeWords,
  withSupertypeWord,
  withoutSupertypeWord,
  type TokenTypeWord,
} from "@/lib/cards/card-display";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { profileDrawsKind } from "@/lib/cards/kind-anatomy";
import {
  isM20ArtifactTokenTemplate,
  m20TokenHeightOf,
  m20TokenTemplate,
  tokenHeightForText,
} from "@/lib/cards/token-height";
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
  // The emblem (TODO 6.23): reached from the token kind's picker, never a
  // chip of its own in the kind picker (KIND_PICKER_KINDS), stored as its
  // own card type.
  "emblem",
  // Layout kinds — structural M15 layouts promoted to first-class picks.
  "saga",
  "adventure",
  "split",
  "aftermath",
  "flip",
  // The transform double-faced card (TODO 5.1a; its editor and the kind
  // picker's chip 5.2's): two printed faces, one card — the front on a
  // transform FRONT body (`m15dfcfront`, the land front), the back on the
  // body the card's icon family derives (lib/cards/dfc.ts bodyFor).
  "transform",
  // The modal double-faced card (TODO 5.2 names the kind; 5.1b brings its
  // bodies): a chip of the picker that stays dark — kindHasAvailableFrame —
  // until the modal front and back bodies exist and are verified.
  "mdfc",
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
  emblem: {
    label: "Emblem",
    cardType: "emblem",
    layoutTemplates: null,
    previewTemplate: "emblem",
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
  transform: {
    label: "Transform",
    cardType: "creature",
    layoutTemplates: ["m15dfcfront", "m15dfclandfront"],
    previewTemplate: "m15dfcfront",
  },
  // The modal kind's bodies are 5.1b's (`m15mdfcfront`, `m15mdfclandfront`;
  // the thumbnail `m15mdfcfront`): until they exist its family is EMPTY —
  // no gallery, no first available frame, so the chip is dark and
  // planKindChange keeps the card where it is — and the transform front
  // stands in for the chip's thumbnail.
  mdfc: {
    label: "Modal double-faced",
    cardType: "creature",
    layoutTemplates: [],
    previewTemplate: "m15dfcfront",
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
        inlineSecondFace: def.layoutTemplates?.[0]
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
//     master paints no box. Kamigawa's flips are creatures. WOE's Role tokens
//     ("Token Enchantment — Aura Role") are Scryfall flip cards too, but
//     since TODO 1.23 they import on the TOKEN kind, front Role only (the
//     owner's override of B2 for Roles); a token typed on the flip frame by
//     hand stays drawable.
//   • saga — Saga is an enchantment subtype; the chapter rail replaces the
//     rules box and the profile has no P/T slot (a FIN Summon, "Enchantment
//     Creature — Saga Dragon", stays the enchantment with "Creature" in
//     front: TODO 1.20).
//   • split / aftermath — both halves are spells; Scryfall has no split card
//     of another type (the Rooms are split on Scryfall but import as
//     enchantments, not this kind).
// ---------------------------------------------------------------------------

type LayoutKind = "saga" | "adventure" | "split" | "aftermath" | "flip" | "transform" | "mdfc";

export { DFC_FACE_TYPES };

export const LAYOUT_KIND_CARD_TYPES: Readonly<Record<LayoutKind, readonly CardType[]>> = {
  saga: ["enchantment"],
  adventure: ["creature", "enchantment", "artifact", "land", "instant", "sorcery"],
  split: ["instant", "sorcery"],
  aftermath: ["instant", "sorcery"],
  flip: ["creature", "enchantment", "token"],
  // The transform front (TODO 5.1a; design §4): every permanent and spell
  // type a 2015-frame transform printed — creatures, artifacts (LCI #60),
  // enchantments (XLN #22, the VOW auras), lands (INR #287 on the land
  // front), instants and sorceries; walkers wait (5.13, ask first), sagas
  // and battles are their own bodies (5.5).
  transform: DFC_FACE_TYPES,
  // The modal front (5.2 names it, 5.1b draws it): the same six — ZNR's
  // spell // land, KHM's and STX's creatures and artifacts.
  mdfc: DFC_FACE_TYPES,
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

// ---------------------------------------------------------------------------
// The emblem (TODO 6.23 + 4.52). CR 114: an emblem is its own object — no
// colour, mana cost, types, rarity or stats — and every printed one sits on
// the emblem frame. So the emblem kind wears the emblem frame and nothing
// else (no other era, skin or showcase), and the emblem frame dresses
// nothing else: its trade dress (TREATMENT_KINDS, below) names the emblem
// alone and the emblem is an EXCLUSIVE kind, so templateRefusesKind refuses
// both ways, and the server's kind gate does too.
// ---------------------------------------------------------------------------

/** The kinds the Card step's kind picker lists as chips. The emblem is not
 *  one of them (owner 2026-09-29): the token kind's picker offers it. The
 *  two double-faced kinds (TODO 5.2) are chips that kindHasAvailableFrame
 *  keeps dark until a FRONT body and the DEFAULT back body are each
 *  verified in a colour — the Transform chip after the owner's ticks (5.3),
 *  the Modal chip after 5.1b's bodies exist and are ticked. */
export const KIND_PICKER_KINDS: readonly CardKind[] = CARD_KIND_VALUES.filter(
  (kind) => kind !== "emblem",
);

/** The kind-picker chip that stands for `kind`: an emblem sits under Token. */
export function kindPickerChip(kind: CardKind): CardKind {
  return kind === "emblem" ? "token" : kind;
}

/** The token and emblem kinds hide the rarity chips (owner 2026-09-29): a
 *  token prints a black set symbol and a T, an emblem an E (4.9), never a
 *  rarity. A new one (and a remix) saves as common; a stored one keeps its
 *  rarity. */
export function kindHidesRarity(kind: CardKind): boolean {
  return kind === "token" || kind === "emblem";
}

/** What a card becomes on entering the emblem kind (TODO 6.23): an emblem
 *  has no colour (the frame is silver whatever the walker's colour), cost,
 *  supertype, stats or rarity (common, the chips hidden). Its optional
 *  subtype ("Emblem — Kaito") starts off (owner 2026-09-29): a token's
 *  "Soldier" would print "Emblem — Soldier". The name, rules, art and set
 *  icon stay. */
export const EMBLEM_ENTRY_VALUES = {
  color_identity: ["colorless"],
  cost: "",
  supertype: "",
  subtypes_text: "",
  power: "",
  toughness: "",
  loyalty: "",
  defense: "",
  rarity: "common",
} as const;

/**
 * The title a card keeps on entering the emblem kind (TODO 6.23): an emblem
 * is named after its planeswalker, so a token's name that only restates its
 * subtypes — the one the token's name-follow wrote (`lastAuto`), or any
 * title equal to its subtypes' name ("Soldier", an import's, one typed to
 * match), case and spacing aside — would stay behind as a stale "Soldier"
 * over the emblem once its subtypes clear (owner evidence 2026-09-29). It
 * goes (""), and the Identity step asks for the walker's name; any other
 * name stays.
 */
export function titleEnteringEmblem(input: {
  title: string;
  subtypes: readonly string[];
  lastAuto: string | null;
}): string {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const title = norm(input.title);
  if (!title) return input.title;
  if (input.lastAuto !== null && input.title === input.lastAuto) return "";
  const subtypeName = norm(tokenNameFromSubtypes(input.subtypes));
  return subtypeName && title === subtypeName ? "" : input.title;
}

/** The colour key a kind's frame is resolved in (the creator's kind change):
 *  an emblem's frame is silver whatever the card's colour (CR 114), so the
 *  emblem kind resolves in `c` — entering it from a red token is no "isn't
 *  available in red" colour switch. Every other kind keeps the card's. */
export function frameColorKeyForKind(kind: CardKind, colorKey: FrameColorKey): FrameColorKey {
  return kind === "emblem" ? "c" : colorKey;
}

// ---------------------------------------------------------------------------
// The kind gate (TODO 4.5.0): which kinds a template may dress. Two rules,
// and either refuses:
//
//  1. CAPABILITY — "the body draws what the kind needs"
//     (lib/cards/kind-anatomy.ts profileDrawsKind, read from the profile's
//     fields): on the showcase treatments and the Borderless skins, a
//     planeswalker needs the loyalty shield and the ability rows, a battle
//     the defense shield on the landscape card, a creature the P/T, a saga
//     the chapter rail, an adventure / split / aftermath / flip card its
//     page or second face. So the Zendikar Rising hedron (`fullart`), the
//     textless and extended-art frames (full-art research 2026-09-26, TODO
//     0.26) and the IP showcases — the Ring and Scroll (LTR), Avatar,
//     Bloomburrow woodland and anime, the three Tarkir frames (TODO 4.5a) —
//     which print P/T only, refuse planeswalkers, battles and every layout
//     kind, and a showcase added without the anatomy can't offer them
//     either. A treatment's walker is a NEW body template (TODO 4.5b:
//     `tarkirghostfirepw`, `extendedartpw`), never the anatomy added to the
//     template it has — that would re-dress every stored card of that kind
//     on it at its next bake (tests/unit/cards/kind-capability-baseline
//     .test.ts). A Ghostfire walker printing imports onto m15pw (`nearest`);
//     Anime walkers stay refused (owner decision 2026-09-29).
//     Border-era standards and layout templates are NOT judged: an off-kind
//     legacy card (an artifact on the plain m15 frame, a creature on the
//     saga frame) stays savable, and their galleries come from
//     ERA_TYPE_FRAME / the skins / a kind's layoutTemplates anyway.
//
//  2. TRADE DRESS — TREATMENT_KINDS: what a capability can't say, because
//     the body COULD draw the kind but the print is one kind's dress:
//       • real expeditions and full-art basics are land dress;
//       • the Nyx constellation frame is enchantment dress — which an
//         Enchantment Creature borrows (the Theros Beyond Death gods, owner
//         decision A3 2026-09-29; BORROWED_SHOWCASES below);
//       • the borderless M15 frame (4.32) is a SKIN of the M15 standard and
//         of the M15 artifact frame, so the gallery only offers it where
//         those are — but it is new (no legacy card sits on it), so the
//         server refuses it on any other kind: CC's pack has no token frame
//         (4.37). The artifact dress also serves an Artifact Creature,
//         borrowed like m15artifact (1.7). Its land (4.34) is a skin of the
//         M15 land frame and dresses the Land kind only;
//       • the borderless planeswalkers (4.33) are skins of m15pw, for
//         planeswalkers only;
//       • the emblem frame dresses the emblem alone, and the emblem is an
//         EXCLUSIVE kind: it wears only a template whose dress names it.
//     No row: the capability rule alone on a showcase or Borderless body,
//     no refusal anywhere else.
//
// `basicOnly` (BASIC_ONLY_TEMPLATES, below) stays its own per-card check:
// the Land kind covers basics and nonbasics alike, so no kind rule can tell
// them apart. The full-art basics' land dress is here all the same.
// ---------------------------------------------------------------------------

/** The kinds a template's trade dress lets it dress (the capability rule
 *  still applies on top on a showcase or Borderless body). */
const TREATMENT_KINDS: Partial<Record<FrameTemplate, readonly CardKind[]>> = {
  expeditionland: ["land"],
  m15fullartland: ["land"],
  fullartland: ["land"],
  m15textlessland: ["land"],
  m15borderless: ["creature", "instant", "sorcery", "enchantment", "artifact"],
  m15borderlessartifact: ["artifact", "creature"],
  m15borderlessland: ["land"],
  m15borderlesspw: ["planeswalker"],
  m15borderlesspwtall: ["planeswalker"],
  nyx: ["enchantment", "creature"],
  emblem: ["emblem"],
};

/** Kinds that wear ONLY a template whose trade dress names them. */
const EXCLUSIVE_KINDS: ReadonlySet<CardKind> = new Set<CardKind>(["emblem"]);

/** True when the capability rule judges the template: a showcase treatment
 *  or a Borderless skin — the bodies whose anatomy decides their kinds. */
function capabilityJudges(template: FrameTemplate): boolean {
  const set = FRAME_TEMPLATE_SET[template];
  return FRAME_SET_ERA[set] === "showcase" || set === "borderless";
}

/** True when the template refuses this kind: its trade dress leaves the
 *  kind out, the kind is exclusive to other templates, or — on a showcase
 *  or Borderless body — the body doesn't draw the kind's anatomy (a
 *  planeswalker on the Zendikar Rising hedron frame, an artifact on Nyx, a
 *  land on the borderless M15 frame). Unlike `!templateSupportsKind`, it
 *  never refuses a border-era standard or a layout frame, so an off-kind
 *  legacy card (an artifact on the plain m15 frame) isn't caught. The
 *  server's frame gate uses this. */
export function templateRefusesKind(
  template: FrameTemplate,
  kind: CardKind,
): boolean {
  // A double-faced BACK body (TODO 5.1a: FrameProfile.dfc role "back") is
  // the back face's template and never a card's own: it refuses every kind
  // (the server's kind gate, lib/cards/frame-kind-gate.ts, reads this too).
  if (getFrameProfile(template).dfc?.role === "back") return true;
  const dress = TREATMENT_KINDS[template];
  if (dress && !dress.includes(kind)) return true;
  if (EXCLUSIVE_KINDS.has(kind) && !dress?.includes(kind)) return true;
  return capabilityJudges(template) && !profileDrawsKind(getFrameProfile(template), kind);
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
// The "Emblem" choice sits here too (TODO 6.23, owner 2026-09-29: inside
// the Token kind, next to the types — not its own kind chip): it switches
// the card to the emblem kind (KIND_PICKER_KINDS leaves it out of the kind
// chips, kindPickerChip lights Token for it), which stores its own card
// type; turning it off returns to the token kind. It is a kind change, not a
// word: TOKEN_PICKER_WORDS stays the four type words.
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

/** The picker word `word` spells (any case), or null for a word the picker
 *  doesn't own. */
function pickerWordOf(word: string): TokenPickerWord | null {
  const lower = word.toLowerCase();
  return TOKEN_PICKER_WORDS.find((w) => w.toLowerCase() === lower) ?? null;
}

/**
 * The words of a token's supertype the picker does NOT own ("Basic", "Snow",
 * an import's "Land"), in their order — what the Identity step's free
 * Supertype field shows on the token kind, so the picker's words
 * (Legendary, Enchantment, Artifact, Creature) have one control, not two.
 */
export function tokenOtherWordsOf(supertype: string | null | undefined): string {
  return supertypeWords(supertype)
    .filter((word) => pickerWordOf(word) === null)
    .join(" ");
}

/**
 * The supertype after the token's free Supertype field is edited to
 * `typed`: `typed`'s words replace the supertype's other words, and the
 * picker's words that are on stay on, merged back in printed order
 * (withSupertypeWord) — "Snow" under Legendary + Creature → "Legendary Snow
 * Creature". A picker word typed into the field is not written while the
 * user types (the toggle is its one control); with `adoptPickerWords` (the
 * field's blur) it turns its toggle on, spelled as the picker spells it.
 */
export function withTokenOtherWords(
  supertype: string | null | undefined,
  typed: string,
  { adoptPickerWords = false }: { adoptPickerWords?: boolean } = {},
): string {
  const words = supertypeWords(typed);
  const on = new Set<TokenPickerWord>(tokenPickerWordsOf(supertype));
  if (adoptPickerWords) {
    for (const word of words) {
      const picked = pickerWordOf(word);
      if (picked) on.add(picked);
    }
  }
  const others = words.filter((word) => pickerWordOf(word) === null).join(" ");
  return TOKEN_PICKER_WORDS.filter((word) => on.has(word)).reduce(
    (acc, word) => withSupertypeWord(acc, word),
    others,
  );
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
// Nyx dress joins here with 4.51. The text-box token (4.49 (b)) has its own
// artifact dress, as the textless one does, and so does each height of the
// full-art token (4.48 / 4.50).
const TYPE_WORD_DRESSES: Partial<
  Record<CardKind, Partial<Record<FrameTemplate, { word: TokenTypeWord; template: FrameTemplate }>>>
> = {
  token: {
    m15token: { word: "Artifact", template: "m15tokenartifact" },
    m15tokentext: { word: "Artifact", template: "m15tokenartifacttext" },
    // The full-art tokens' artifact templates (TODO 4.50), one per height.
    m20token: { word: "Artifact", template: "m20tokenartifact" },
    m20tokentext: { word: "Artifact", template: "m20tokenartifacttext" },
    m20tokentall: { word: "Artifact", template: "m20tokenartifacttall" },
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

/** The base a type-word dress re-dresses (m15tokenartifact → m15token,
 *  m15tokenartifacttext → m15tokentext); any other template as it is — what
 *  the setup panel's Variations compare against, so the Artifact word never
 *  hides which variation the card wears. */
export function typeWordBaseFor(kind: CardKind, template: FrameTemplate): FrameTemplate {
  for (const [base, dress] of Object.entries(TYPE_WORD_DRESSES[kind] ?? {}) as [FrameTemplate, { template: FrameTemplate }][]) {
    if (template === dress.template) return base;
  }
  return template;
}

// The token text box follows the text (TODO 4.49 (b), owner decision 5,
// 2026-09-29): on the token kind the 2014–19 arch wears its text-box
// variation when the card has rules or flavour text (hasRulesBoxText — the
// renderers' test) and the textless one when it has none, as the prints do.
// Keyed by kind, then textless frame → its text-box variation; the Artifact
// type word dresses both (TYPE_WORD_DRESSES), so the two rules compose.
//
// Automatic until the user picks a variation by hand: the creator's follow
// (followTokenTextBox) switches the frame only while it is the one the text
// picked, the import and the AI jobs land on the one the text picks
// (lib/scryfall/frame-signatures.ts archTokenFrame, resolveGeneratedFrame,
// autoTokenTextBoxFrame), and migration 0129 moved the stored cards with text
// off the textless frames. The textless frame keeps its scrim for a card
// that carries text anyway (a manual pick, an older client's save): the
// text never lands straight on the art, nor disappears.
const TEXT_BOX_DRESSES: Partial<Record<CardKind, Partial<Record<FrameTemplate, FrameTemplate>>>> = {
  token: {
    m15token: "m15tokentext",
    m15tokenartifact: "m15tokenartifacttext",
  },
};

/** True when the template is a text-box variation the kind's text picks
 *  (m15tokentext, m15tokenartifacttext on a token). */
export function isTextBoxDress(kind: CardKind, template: FrameTemplate): boolean {
  return Object.values(TEXT_BOX_DRESSES[kind] ?? {}).includes(template);
}

/**
 * The frame the text picks for a card on `template`: on a textless frame
 * with a text-box variation, or on that variation, the variation when the
 * card has text and the textless frame otherwise; any other template (a
 * token on Alpha's frame or a showcase, every other kind) as it is. It never
 * changes the Artifact dress.
 */
export function textBoxFrameFor(kind: CardKind, template: FrameTemplate, hasText: boolean): FrameTemplate {
  for (const [textless, boxed] of Object.entries(TEXT_BOX_DRESSES[kind] ?? {}) as [FrameTemplate, FrameTemplate][]) {
    if (template !== textless && template !== boxed) continue;
    return hasText ? boxed : textless;
  }
  return template;
}

/** True when the template is the one the text picks (textBoxFrameFor) — a
 *  random or requested frame never puts a token's text on the textless arch,
 *  nor an empty text box under a vanilla token. */
export function textBoxFrameFits(kind: CardKind, template: FrameTemplate, hasText: boolean): boolean {
  return textBoxFrameFor(kind, template, hasText) === template;
}

/** A token face as far as its automatic frame goes: the type words, the
 *  text, and whether it prints a P/T (the plate keeps the rules out, so it
 *  can take a full-art token to the tall box). Unknown P/T: a Creature
 *  token prints one. */
export type TokenFrameFace = {
  supertype?: string | null;
  rulesText?: string | null;
  flavorText?: string | null;
  printsPowerToughness?: boolean;
};

/**
 * The full-art token's height (TODO 4.48, owner decisions 2026-09-29): on
 * the token kind, a full-art template at the height its text asks for
 * (tokenHeightForText — no text → no box, the regular box while it holds
 * the text at 72 px or more, else the tall box); any other template, and
 * every other kind's, as it is. It never changes the Artifact dress.
 */
export function tokenHeightFrameFor(kind: CardKind, template: FrameTemplate, face: TokenFrameFace): FrameTemplate {
  if (kind !== "token" || m20TokenHeightOf(template) === null) return template;
  const artifact = isM20ArtifactTokenTemplate(template);
  const height = tokenHeightForText({
    rulesText: face.rulesText,
    flavorText: face.flavorText,
    printsPowerToughness: face.printsPowerToughness ?? supertypeHasWord(face.supertype, "Creature"),
    artifact,
  });
  return m20TokenTemplate(height, artifact);
}

/** Every one of the token's automatic frame rules at once: the type words'
 *  dress (typeWordFrameFor), the text's box on the 2014–19 arch
 *  (textBoxFrameFor) and the text's height on the full-art design
 *  (tokenHeightFrameFor). */
export function tokenFrameFor(kind: CardKind, template: FrameTemplate, face: TokenFrameFace): FrameTemplate {
  return tokenHeightFrameFor(
    kind,
    textBoxFrameFor(kind, typeWordFrameFor(kind, template, face.supertype), hasRulesBoxText(face)),
    face,
  );
}

/** True when the template is the one the token's rules pick (tokenFrameFor)
 *  — a random or requested frame never puts a token on another dress, box
 *  or height than its words and text ask for. Every other kind: true. */
export function tokenFrameFits(kind: CardKind, template: FrameTemplate, face: TokenFrameFace): boolean {
  return tokenFrameFor(kind, template, face) === template;
}

/** True when the template is one of the full-art token's text heights (the
 *  regular or the tall box, plain or artifact): the text picks it, as it
 *  picks the arch's text box (isTextBoxDress) — a frame list that lets the
 *  text decide leaves them out. */
export function isTokenHeightDress(kind: CardKind, template: FrameTemplate): boolean {
  const height = kind === "token" ? m20TokenHeightOf(template) : null;
  return height === "regular" || height === "tall";
}

/**
 * The creator's text-box follow (owner decision 5): when the card's text
 * comes or goes (`hasText` is the new state), the frame the text now picks,
 * or null to leave the frame alone. It follows only while the frame is the
 * one the text picked before the edit: a frame that disagreed with the text
 * (the textless arch over text, an empty text box) is a choice the user
 * made, and it sticks — so does one made by hand this session (`manual`),
 * which the caller remembers.
 */
export function followTokenTextBox(input: {
  kind: CardKind;
  template: FrameTemplate;
  hasText: boolean;
  manual: boolean;
}): FrameTemplate | null {
  const { kind, template, hasText, manual } = input;
  if (manual) return null;
  if (textBoxFrameFor(kind, template, !hasText) !== template) return null;
  const next = textBoxFrameFor(kind, template, hasText);
  return next === template ? null : next;
}

// The borderless planeswalker's tall box follows the ability rows (frames
// plan 4.33): Card Conjurer's 'Tall Borderless' master moves the type bar
// and the ability window's top 138 px up for FOUR rows, as the prints do
// (Teferi, Master of Time M21 #281; Liliana, Dreadhorde General FDN #359;
// Ajani, Sleeper Agent DMU #375), and three or fewer print on the regular
// one. The rows are the PRINTED ones (walkerRowCount): every loyalty
// ability is a row, and a run of static abilities shares one — The
// Wandering Emperor NEO #303 (Flash + a static + three abilities) prints
// four rows on the tall frame, Jace, Mirror Mage ZNR #281 and Vivien,
// Monsters' Advocate IKO #277 (two statics + two abilities) three on the
// regular one (checked on the scans of all 210 printings the registry's
// borderless/planeswalker rule matches, 2026-09-29: 206 print the box this
// count picks; Gideon Blackblade MED #WS2 sets its two statics in two rows
// and Comet UNF #275 / #526 its die-roll table on the tall box, and Nicol
// Bolas, Dragon-God PS19 #207 four rows on the regular one — the registry's
// WALKER_ROW_BOX_PINS, `nearest`). Keyed by kind, then the regular frame →
// its tall dress.
//
// Always automatic, in every path: the tall frame is no choice of its own
// (the picker's one Borderless Planeswalker chip stands for both, like the
// Artifact type word's token frame), the creator follows the rows as they
// change (followWalkerRows), a Frame or Variations pick lands on the one
// the rows pick, and the import (lib/scryfall/frame-signatures.ts), the
// import chooser (frameFitsImport) and the AI's frame pick
// (lib/creator/frame-random.ts) take the same rule. An unverified tall
// frame never replaces a verified one: the card keeps its frame and the
// creator says so, as the token text box does.
export const TALL_WALKER_MIN_ROWS = 4;
const ROW_DRESSES: Partial<Record<CardKind, Partial<Record<FrameTemplate, FrameTemplate>>>> = {
  planeswalker: { m15borderlesspw: "m15borderlesspwtall" },
};

/** The ability rows a planeswalker PRINTS: one per loyalty ability, and one
 *  for each run of static abilities (the prints set consecutive statics in
 *  one row). The abilities are the renderers' own (resolveLoyaltyRows: the
 *  structured rows when there are any, else a line of the rules text each);
 *  `editorRows` are the creator's row editor (liveFaceContent: the rows with
 *  text, when there are any). */
export function walkerRowCount(input: {
  faceContent?: FaceContent | null;
  rulesText?: string | null;
  editorRows?: readonly { cost?: string | null; text: string }[] | null;
}): number {
  const edited = (input.editorRows ?? []).filter((row) => row.text.trim());
  const abilities =
    edited.length > 0
      ? edited.map((row) => ({ cost: row.cost?.trim() ? row.cost : null }))
      : resolveLoyaltyRows(input.faceContent, input.rulesText);
  let rows = 0;
  let inStatics = false;
  for (const ability of abilities) {
    const isStatic = !ability.cost;
    if (!isStatic || !inStatics) rows += 1;
    inStatics = isStatic;
  }
  return rows;
}

/** True when the template is a frame the kind wears by its row count (the
 *  tall borderless planeswalker): the pickers don't offer it. */
export function isRowDress(kind: CardKind, template: FrameTemplate): boolean {
  return Object.values(ROW_DRESSES[kind] ?? {}).includes(template);
}

/** True when the template has a row dress (the regular borderless
 *  planeswalker): the Variations section says the box follows the rows. */
export function hasRowDress(kind: CardKind, template: FrameTemplate): boolean {
  return ROW_DRESSES[kind]?.[template] !== undefined;
}

/** The frame a row dress re-dresses (m15borderlesspwtall →
 *  m15borderlesspw); any other template as it is — what the Variations
 *  chips compare against. */
export function rowDressBaseFor(kind: CardKind, template: FrameTemplate): FrameTemplate {
  for (const [base, tall] of Object.entries(ROW_DRESSES[kind] ?? {}) as [FrameTemplate, FrameTemplate][]) {
    if (template === tall) return base;
  }
  return template;
}

/**
 * The frame the ability rows pick for a card on `template`: on the regular
 * borderless planeswalker or its tall dress, the tall one for
 * TALL_WALKER_MIN_ROWS rows or more (walkerRowCount) and the regular one
 * otherwise; any other template (m15pw, a showcase, every other kind) as it
 * is.
 */
export function walkerRowsFrameFor(kind: CardKind, template: FrameTemplate, rows: number): FrameTemplate {
  for (const [base, tall] of Object.entries(ROW_DRESSES[kind] ?? {}) as [FrameTemplate, FrameTemplate][]) {
    if (template !== base && template !== tall) continue;
    return rows >= TALL_WALKER_MIN_ROWS ? tall : base;
  }
  return template;
}

/** True when the template is the one the rows pick (walkerRowsFrameFor). */
export function walkerRowsFrameFits(kind: CardKind, template: FrameTemplate, rows: number): boolean {
  return walkerRowsFrameFor(kind, template, rows) === template;
}

/**
 * The creator's row follow: when the walker's rows change, the frame they
 * now pick, or null to leave the frame alone (not a row-dressed frame, or
 * already the right one). Unlike the token text box there is no manual pick
 * to respect — the tall box has no chip of its own.
 */
export function followWalkerRows(input: {
  kind: CardKind;
  template: FrameTemplate;
  rows: number;
}): FrameTemplate | null {
  const next = walkerRowsFrameFor(input.kind, input.template, input.rows);
  return next === input.template ? null : next;
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
  // The emblem (TODO 6.23) comes out of this loop as the M15 era's one
  // emblem frame alone: no other era prints today's emblem, it has no
  // skins, and as an exclusive kind it refuses every showcase.
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
  // Showcase treatments dress a standard kind their body draws (stats still
  // gate on type), except where their trade dress says otherwise; the
  // emblem, an exclusive kind, takes none (templateRefusesKind).
  for (const t of SHOWCASE_TEMPLATES) {
    if (templateRefusesKind(t, kind)) continue;
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
 *  chips' enable/disable in the creator. A double-faced kind (TODO 5.1a)
 *  needs a colour verified on a FRONT body AND on the DEFAULT back body
 *  the kind's default family derives (bodyFor with DEFAULT_DFC_ICON — a
 *  front with no verified back could not be saved with its back): until
 *  both are ticked the chip stays dark ("Frames awaiting verification"). */
export function kindHasAvailableFrame(
  kind: CardKind,
  verifiedKeys: ReadonlySet<string>,
): boolean {
  if (firstAvailableFrame(kind, verifiedKeys) === null) return false;
  const dfc = DFC_KIND_LAYOUT[kind];
  if (!dfc) return true;
  const back = bodyFor(dfc, "back", "creature", DEFAULT_DFC_ICON);
  return back !== null && templateHasAvailableColor(back, verifiedKeys);
}

/** The double-faced kinds and their layout (lib/cards/dfc.ts): the
 *  Transform kind (5.1a) and the Modal kind (named by 5.2; its bodies are
 *  5.1b's, so bodyFor answers null for its faces until then). */
const DFC_KIND_LAYOUT: Partial<Record<CardKind, DfcLayout>> = { transform: "transform", mdfc: "modal" };

/** The layout of a double-faced kind, or null for every other kind — the
 *  ONE place the creator asks "does this kind have a back face of its own"
 *  (the forced back face, the back-face panel, the derived back body). */
export function dfcLayoutForKind(kind: CardKind): DfcLayout | null {
  return DFC_KIND_LAYOUT[kind] ?? null;
}

/** The front BODY a double-faced kind's card wears for a face type (the
 *  land front for a land, the spell front otherwise), or null when the kind
 *  has no bodies yet (the modal kind until 5.1b) — what the Card step's
 *  face-type row writes beside the type. */
export function dfcFrontBodyFor(kind: CardKind, cardType: CardType | "" | null | undefined): FrameTemplate | null {
  const layout = dfcLayoutForKind(kind);
  return layout ? bodyFor(layout, "front", cardType || null) : null;
}

/** True when a double-faced FRONT body (TODO 5.1a) dresses a card of
 *  `kind` as that kind's card type: the Transform kind draws the types in
 *  LAYOUT_KIND_CARD_TYPES.transform (a creature, an artifact, an
 *  enchantment, a land, an instant, a sorcery — a 2015-frame transform
 *  printing's front face as kindFromScryfall reads it today), on the land
 *  front only a land, on the spell front everything else. The creator's
 *  gallery never lists the body under those kinds (a card on it IS the
 *  Transform kind, kindFromCard), so templateSupportsKind says no; the
 *  signature registry and the reference pin check ask this instead. */
export function dfcFrontDressesKind(template: FrameTemplate, kind: CardKind): boolean {
  const body = dfcBodyOf(template);
  if (body?.role !== "front") return false;
  const dfcKind = dfcKindFor(template);
  if (!dfcKind || !KIND_DEFS[dfcKind].layoutTemplates?.includes(template)) return false;
  const cardType = KIND_DEFS[kind].cardType;
  if (KIND_DEFS[kind].layoutTemplates) return false;
  if (!(LAYOUT_KIND_CARD_TYPES[dfcKind as LayoutKind] ?? []).includes(cardType)) return false;
  return body.land ? cardType === "land" : cardType !== "land";
}

/** The double-faced kind a BODY belongs to — a front body's own kind, or
 *  the kind whose cards a BACK body dresses the back of (a back body is
 *  never a card's template, so templateSupportsKind says no: the
 *  walkthrough and the admin tools start a back body's card on this kind
 *  and flip to the back, TODO 5.0b). Null for every other template. */
export function dfcKindFor(template: FrameTemplate): CardKind | null {
  const layout = dfcBodyOf(template)?.layout;
  if (!layout) return null;
  return (Object.entries(DFC_KIND_LAYOUT) as [CardKind, DfcLayout][]).find(([, l]) => l === layout)?.[0] ?? null;
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

  // Layout kinds are deterministic — one template family. A kind whose
  // family is still EMPTY (the modal kind until 5.1b's bodies) keeps the
  // card's own template: its chip is dark, and a programmatic pick lands
  // on "frames not published" in the creator rather than on nothing.
  if (def.layoutTemplates) {
    return {
      action: "apply",
      patch: {
        card_type: def.cardType,
        template: def.layoutTemplates[0] ?? normalizeFrameTemplate(current.template),
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
