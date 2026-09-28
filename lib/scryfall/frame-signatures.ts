import type { ScryfallCard } from "@/lib/scryfall/client";
import {
  FRAME_TEMPLATE_VALUES,
  type CardType,
  type FrameEra,
  type FrameTemplate,
} from "@/types/card";
import {
  KIND_DEFS,
  templateIsBasicOnly,
  templateSupportsKind,
  type CardKind,
} from "@/lib/creator/card-kinds";
import { standardFrameFor } from "@/lib/creator/frame-picker";
import { describeFrame } from "@/lib/creator/frame-resolve";
import { artReachesCardEdge, getFrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// The frame signature registry (TODO 1.4, with 1.17's borderless families and
// 1.19's full-art / textless families). Every Scryfall printing has a
// SIGNATURE — its frame year, border colour, frame effects, promo types, set
// and collector number — and this table says which PipGlyph frame reproduces
// it (`exact`), which one comes nearest and why (`nearest`), or that PipGlyph
// has no frame for it (`unsupported`, with the nearest one to offer).
//
// One ORDERED rule table; the first rule whose match holds wins. The order
// is the TODO's: 1.19's substitutes and for-good refusals, 1.17's borderless
// families, the rest of 1.19 (Japan showcase, old tokens, full-art basics,
// textless), the look-alikes (ZNR showcase, Expeditions), then 1.4's general
// signatures (pinned showcase runs, Future Sight, extended art, Nyx, coloured
// artifacts on the old frames, layout kinds, and each border era with its
// anatomy gaps).
//
// Static: `exact` means a template reproduces the signature. Whether that
// template is VERIFIED in the card's colour is the creator's question
// (withVerification in lib/creator/frame-resolve.ts); an unverified frame
// is never exact to a user.
//
// Pure and client-safe: a type-only import of ScryfallCard, no `server-only`.
// The facts that need the importer's type-line and colour rules
// (PrintingFacts) come from lib/scryfall/import-mapper.ts, which owns them.
// ---------------------------------------------------------------------------

export type FrameMatchStatus = "exact" | "nearest" | "unsupported";

/** What the importer knows about THIS printing's frame (ScryfallImportPatch
 *  .frame_match). */
export type FrameMatch = {
  status: FrameMatchStatus;
  /** The PipGlyph frame that reproduces the printing (exact), or the nearest
   *  one (nearest / unsupported). */
  template: FrameTemplate;
  /** Copy naming what the printing IS ("Bloomburrow anime showcase"). */
  exactLabel: string;
  /** Why it is not exact, in copy; null when exact. */
  reason: string | null;
  /** The signature id of the rule that matched (FRAME_SIGNATURE_KEYS). */
  signature: string;
  /** Where the import lands instead of `template`: a bordered frame when the
   *  matched frame's art reaches the card edge and Scryfall only has the
   *  window-cropped art (1.18's owner decision), or the kind's standard when
   *  PipGlyph's frame can't dress this kind of card yet. */
  landOn?: FrameTemplate;
  /** Not a playable card (a double-faced substitute): refuse the import. */
  reject?: true;
  /** PipGlyph will never build this frame (artist-lettered posters, The
   *  Zeta Set's frameless cards). */
  forGood?: true;
  /** The TODO item that would make this exact ("4.35", "4.6", …). */
  blockedBy?: string;
};

/** The facts the registry reads that need the importer's own rules — the
 *  kind (kindFromScryfall), the front face's type words and its frame
 *  colours (frontFaceColors). Built by printingFacts in
 *  lib/scryfall/import-mapper.ts. */
export type PrintingFacts = {
  /** The derived kind; undefined when the type line has no card type
   *  PipGlyph makes (an Emblem, a Plane, a Scheme). */
  kind: CardKind | undefined;
  /** Every card-type word on the front face's type line. */
  cardTypes: ReadonlySet<CardType>;
  /** The front face's supertype words ("Legendary", "Basic", "Snow"). */
  supertypes: ReadonlySet<string>;
  /** The front face's subtypes ("Plains", "Vehicle", "Room"). */
  subtypes: readonly string[];
  /** The front face is ONE basic land (isSingleBasicLand). */
  singleBasic: boolean;
  /** The front face's frame colours as WUBRG letters (frontFaceColors). */
  colors: readonly string[];
  /** The front face prints a colour-indicator dot. */
  colorIndicator: boolean;
  /** The second face is an Omen (Tarkir: Dragonstorm, layout "adventure"). */
  omen: boolean;
};

// ---------------------------------------------------------------------------
// Set lists and runs, each checked on Scryfall (searches 2026-09-28, and the
// borderless / full-art surveys of 2026-09-25/26).
// ---------------------------------------------------------------------------

/** Sets whose black-bordered full-art basics print the 2022 design — a
 *  title bar, then "Basic Land — Plains" with the symbol in a disc at its
 *  left end (frames plan 4.39's list, checked by eye; pinned by set, never
 *  by date: SPM and SOS (2025–26) print the plain bar, 4.41). ONE and MOM
 *  (2023) print an older bar geometry and resolve `nearest`. */
export const FULL_ART_BASIC_2022_SETS: ReadonlySet<string> = new Set([
  "one", "mom", "ltr", "woe", "mkm", "otj", "mh3", "acr", "pip", "blb", "dsk",
  "fdn", "dft", "tdm", "fin", "fic", "tla", "ecl", "tmt", "msh", "hob", "p23",
  "pl24", "pl25", "pl26", "pss4", "slp",
]);

/** The double-faced frame marks (Phase 5). */
const DFC_EFFECTS = [
  "sunmoondfc",
  "compasslanddfc",
  "originpwdfc",
  "mooneldrazidfc",
  "waxingandwaningmoondfc",
  "fandfc",
  "upsidedowndfc",
  "convertdfc",
] as const;

/** Frame marks PipGlyph doesn't draw (4.7's marks). */
const MARK_EFFECTS = ["miracle", "companion", "lesson", "spree", "tombstone", "draft"] as const;

/** Layouts PipGlyph has no layout for yet; they import as a standard kind. */
const UNMODELLED_LAYOUTS = ["class", "case", "leveler", "prototype", "mutate", "meld", "prepare", "host", "augment"] as const;
const UNMODELLED_SUBTYPES = ["Room", "Class", "Case"] as const;

/** The templates whose border isn't true yet: a transparent outer ring plus
 *  an inset art slot that bakes a flat #101015 "border" (TODO 4.35). Capped
 *  at `nearest` so verifying one can never make it exact. */
export const BORDER_PENDING_TEMPLATES: ReadonlySet<FrameTemplate> = new Set<FrameTemplate>([
  "bloomanime",
  "tarkirghostfire",
  "tarkirdragon",
  "lotrscroll",
  "battle",
]);

// ---------------------------------------------------------------------------
// Rule shape
// ---------------------------------------------------------------------------

type Range = readonly [number, number];

/** A declarative match. Every constraint given must hold. */
type Match = {
  /** `frame` in the list ("1993" | "1997" | "2003" | "2015" | "future"). */
  frames?: readonly string[];
  /** `border_color` in the list. */
  borders?: readonly string[];
  effectsAll?: readonly string[];
  effectsAny?: readonly string[];
  effectsNone?: readonly string[];
  promosAny?: readonly string[];
  sets?: readonly string[];
  notSets?: readonly string[];
  setTypes?: readonly string[];
  /** Per-set collector ranges on the leading number; the set must be a key. */
  collectors?: Readonly<Record<string, readonly Range[]>>;
  /** Per-set exact collector numbers ("UGL-84" on The List). */
  collectorIds?: Readonly<Record<string, readonly string[]>>;
  kinds?: readonly CardKind[];
  notKinds?: readonly CardKind[];
  /** The kind is undefined (no card type PipGlyph makes). */
  noKind?: true;
  typeWordsAny?: readonly CardType[];
  subtypesAny?: readonly string[];
  layouts?: readonly string[];
  /** `full_art`, or the `fullart` frame effect. */
  fullArt?: boolean;
  textless?: boolean;
  /** `type_line` is exactly "Card" (a double-faced substitute). */
  typeLineCard?: true;
  singleBasic?: boolean;
  flavorName?: true;
  colorIndicator?: true;
  omen?: true;
  colorCount?: { min?: number; max?: number };
  anyOf?: readonly Match[];
  allOf?: readonly Match[];
};

/** A family of templates picked by kind (and dress). */
type Family = "m15" | "borderless" | "modern" | "retro" | "alpha" | "textless";

type TemplateSpec = FrameTemplate | { family: Family };

type Text = string | ((ctx: Ctx) => string);

type Outcome = {
  status: FrameMatchStatus;
  template: TemplateSpec;
  reason?: Text;
  reject?: true;
  forGood?: true;
  blockedBy?: string;
};

type Rule = {
  /** Stable signature id ('borderless/standard/dark'). */
  key: string;
  /** Copy naming what the printing is. */
  exactLabel: Text;
  match: Match;
  outcome: Outcome;
};

type Ctx = {
  card: ScryfallCard;
  facts: PrintingFacts;
  frame: string;
  border: string;
  set: string;
  setType: string;
  effects: ReadonlySet<string>;
  promos: ReadonlySet<string>;
  collector: string;
  collectorNumber: number | null;
  fullArt: boolean;
};

const lower = (list: readonly string[] | null | undefined) =>
  new Set((list ?? []).map((value) => value.toLowerCase()));

function contextOf(card: ScryfallCard, facts: PrintingFacts): Ctx {
  const effects = lower(card.frame_effects);
  const collector = (card.collector_number ?? "").trim();
  const leading = /^(\d+)/.exec(collector);
  return {
    card,
    facts,
    frame: (card.frame ?? "").trim().toLowerCase(),
    border: (card.border_color ?? "").trim().toLowerCase(),
    set: (card.set ?? "").trim().toLowerCase(),
    setType: (card.set_type ?? "").trim().toLowerCase(),
    effects,
    promos: lower(card.promo_types),
    collector,
    collectorNumber: leading ? Number(leading[1]) : null,
    fullArt: card.full_art === true || effects.has("fullart"),
  };
}

const hasAny = (set: ReadonlySet<string>, list: readonly string[]) =>
  list.some((value) => set.has(value));

function matches(match: Match, ctx: Ctx): boolean {
  const { card, facts } = ctx;
  if (match.frames && !match.frames.includes(ctx.frame)) return false;
  if (match.borders && !match.borders.includes(ctx.border)) return false;
  if (match.effectsAll && !match.effectsAll.every((e) => ctx.effects.has(e))) return false;
  if (match.effectsAny && !hasAny(ctx.effects, match.effectsAny)) return false;
  if (match.effectsNone && hasAny(ctx.effects, match.effectsNone)) return false;
  if (match.promosAny && !hasAny(ctx.promos, match.promosAny)) return false;
  if (match.sets && !match.sets.includes(ctx.set)) return false;
  if (match.notSets && match.notSets.includes(ctx.set)) return false;
  if (match.setTypes && !match.setTypes.includes(ctx.setType)) return false;
  if (match.collectors) {
    const ranges = match.collectors[ctx.set];
    const n = ctx.collectorNumber;
    if (!ranges || n === null || !ranges.some(([lo, hi]) => n >= lo && n <= hi)) return false;
  }
  if (match.collectorIds) {
    const ids = match.collectorIds[ctx.set];
    if (!ids || !ids.includes(ctx.collector)) return false;
  }
  if (match.noKind && facts.kind !== undefined) return false;
  if (match.kinds && (!facts.kind || !match.kinds.includes(facts.kind))) return false;
  if (match.notKinds && facts.kind && match.notKinds.includes(facts.kind)) return false;
  if (match.typeWordsAny && !match.typeWordsAny.some((t) => facts.cardTypes.has(t))) return false;
  if (match.subtypesAny && !match.subtypesAny.some((s) => facts.subtypes.includes(s))) return false;
  if (match.layouts && !match.layouts.includes((card.layout ?? "").toLowerCase())) return false;
  if (match.fullArt !== undefined && ctx.fullArt !== match.fullArt) return false;
  if (match.textless !== undefined && (card.textless === true) !== match.textless) return false;
  if (match.typeLineCard && (card.type_line ?? "").trim() !== "Card") return false;
  if (match.singleBasic !== undefined && facts.singleBasic !== match.singleBasic) return false;
  if (match.flavorName && !card.flavor_name) return false;
  if (match.colorIndicator && !facts.colorIndicator) return false;
  if (match.omen && !facts.omen) return false;
  if (match.colorCount) {
    const n = facts.colors.length;
    if (match.colorCount.min !== undefined && n < match.colorCount.min) return false;
    if (match.colorCount.max !== undefined && n > match.colorCount.max) return false;
  }
  if (match.allOf && !match.allOf.every((m) => matches(m, ctx))) return false;
  if (match.anyOf && !match.anyOf.some((m) => matches(m, ctx))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Families: the template a kind takes inside one trade dress.
// ---------------------------------------------------------------------------

const layoutTemplateOf = (kind: CardKind | undefined): FrameTemplate | null =>
  kind ? (KIND_DEFS[kind].layoutTemplates?.[0] ?? null) : null;

const isArtifactCreature = (facts: PrintingFacts) =>
  facts.kind === "creature" && facts.cardTypes.has("artifact");

const FAMILIES: Record<
  Family,
  { produces: readonly FrameTemplate[]; pick: (ctx: Ctx) => FrameTemplate }
> = {
  // M15: the era standard for the kind, dressed by the printing's snow /
  // devoid effect and its artifact word (the 1.3 rules, unchanged): a snow
  // land is the snow land frame, a snow spell or snow ARTIFACT the snow frame
  // (Replicating Ring KHM #244 prints it; the Artifact kind can't take it
  // yet, so the kind check lands it on m15artifact), an Artifact Creature
  // the artifact frame, an artifact token the artifact token frame.
  m15: {
    produces: [
      "saga", "adventure", "split", "aftermath", "flip", "m15token",
      "m15tokenartifact", "m15land", "m15snowland", "m15pw", "battle",
      "m15snow", "m15devoid", "m15artifact", "m15",
    ],
    pick: ({ facts, effects }) => {
      const layout = layoutTemplateOf(facts.kind);
      if (layout) return layout;
      switch (facts.kind) {
        case "token":
          return facts.cardTypes.has("artifact") ? "m15tokenartifact" : "m15token";
        case "land":
          return effects.has("snow") ? "m15snowland" : "m15land";
        case "planeswalker":
          return "m15pw";
        case "battle":
          return "battle";
        default:
          break;
      }
      if (effects.has("snow")) return "m15snow";
      if (facts.kind === "artifact") return "m15artifact";
      if (effects.has("devoid")) return "m15devoid";
      if (isArtifactCreature(facts)) return "m15artifact";
      return "m15";
    },
  },
  // The 2019+ borderless dress (4.32) where it exists; the bordered M15
  // standard for the kinds it can't dress yet (4.33–4.38).
  borderless: {
    produces: [
      "saga", "adventure", "split", "aftermath", "flip", "m15token", "m15land",
      "m15pw", "battle", "m15borderlessartifact", "m15borderless",
    ],
    pick: ({ facts }) => {
      const layout = layoutTemplateOf(facts.kind);
      if (layout) return layout;
      switch (facts.kind) {
        case "token":
          return "m15token";
        case "land":
          return "m15land";
        case "planeswalker":
          return "m15pw";
        case "battle":
          return "battle";
        default:
          break;
      }
      return facts.kind === "artifact" || isArtifactCreature(facts)
        ? "m15borderlessartifact"
        : "m15borderless";
    },
  },
  modern: {
    produces: ["saga", "adventure", "split", "aftermath", "flip", "modernland", "m15token", "m15pw", "battle", "modern"],
    pick: ({ facts }) => eraPick(facts, "modern", "modernland"),
  },
  retro: {
    produces: ["saga", "adventure", "split", "aftermath", "flip", "retroland", "m15token", "m15pw", "battle", "retro"],
    pick: ({ facts }) => eraPick(facts, "retro", "retroland"),
  },
  alpha: {
    produces: ["saga", "adventure", "split", "aftermath", "flip", "alphaland", "alphatoken", "m15pw", "battle", "agclassic"],
    pick: ({ facts }) =>
      facts.kind === "token" ? "alphatoken" : eraPick(facts, "agclassic", "alphaland"),
  },
  textless: {
    produces: ["m15textlessland", "m15textless"],
    pick: ({ facts }) => (facts.kind === "land" ? "m15textlessland" : "m15textless"),
  },
};

function eraPick(
  facts: PrintingFacts,
  standard: FrameTemplate,
  land: FrameTemplate,
): FrameTemplate {
  const layout = layoutTemplateOf(facts.kind);
  if (layout) return layout;
  switch (facts.kind) {
    case "land":
      return land;
    case "token":
      return "m15token";
    case "planeswalker":
      return "m15pw";
    case "battle":
      return "battle";
    default:
      return standard;
  }
}

const ERA_OF_FRAME: Record<string, FrameEra> = {
  "1993": "classic",
  "1997": "retro",
  "2003": "modern",
  "2015": "m15",
};

/** Where a card lands when the matched frame can't take its kind: the
 *  kind's standard in the printing's own era, else the M15 standard (an
 *  Artifact Creature the M15 artifact frame); a layout kind its layout. */
function kindFallback(ctx: Ctx): FrameTemplate {
  const { facts } = ctx;
  const layout = layoutTemplateOf(facts.kind);
  if (layout) return layout;
  const cardType = facts.kind ? KIND_DEFS[facts.kind].cardType : "creature";
  const era = ERA_OF_FRAME[ctx.frame] ?? "m15";
  const standard =
    standardFrameFor(era, cardType) ?? standardFrameFor("m15", cardType) ?? "m15";
  return standard === "m15" && isArtifactCreature(facts) ? "m15artifact" : standard;
}

/** The bordered frame an edge-to-edge frame lands on when Scryfall only has
 *  the art cropped to the classic window (1.18). */
const BORDERED_EQUIVALENT: Partial<Record<FrameTemplate, FrameTemplate>> = {
  m15borderless: "m15",
  m15borderlessartifact: "m15artifact",
  fullartland: "m15fullartland",
};

// ---------------------------------------------------------------------------
// Anatomy gaps: pieces of a printing PipGlyph doesn't draw yet. A rule that
// can be exact lists the gaps that make it `nearest` (owner question 1's
// default: a missing piece is not an exact match).
// ---------------------------------------------------------------------------

type GapKey =
  | "crown"
  | "two-colour"
  | "colour-indicator"
  | "vehicle"
  | "dfc"
  | "layout"
  | "omen"
  | "etched"
  | "border"
  | "marks"
  | "colourshifted"
  | "nickname"
  | "nyx"
  | "light-box";

const BORDER_WORD: Record<string, string> = {
  white: "white",
  silver: "silver",
  gold: "gold",
  yellow: "yellow",
};

const GAPS: Record<GapKey, { match: Match; reason: Text; blockedBy: string }> = {
  crown: {
    match: { effectsAny: ["legendary"] },
    reason: "PipGlyph doesn't draw the legendary crown yet",
    blockedBy: "4.6",
  },
  "two-colour": {
    match: { colorCount: { min: 2, max: 2 } },
    reason: "two-colour cards print a split frame, and PipGlyph uses its gold one",
    blockedBy: "4.6",
  },
  "colour-indicator": {
    match: { colorIndicator: true },
    reason: "PipGlyph doesn't draw the colour indicator yet",
    blockedBy: "4.6",
  },
  vehicle: {
    match: { subtypesAny: ["Vehicle"] },
    reason: "PipGlyph doesn't draw the Vehicle P/T plate yet",
    blockedBy: "4.6",
  },
  dfc: {
    match: {
      anyOf: [{ layouts: ["transform", "modal_dfc"] }, { effectsAny: DFC_EFFECTS }],
    },
    reason: "PipGlyph doesn't draw the double-faced marks yet",
    blockedBy: "Phase 5",
  },
  layout: {
    match: {
      anyOf: [{ layouts: UNMODELLED_LAYOUTS }, { subtypesAny: UNMODELLED_SUBTYPES }],
    },
    reason: ({ card, facts }) => {
      const room = facts.subtypes.find((s) => (UNMODELLED_SUBTYPES as readonly string[]).includes(s));
      return `PipGlyph has no ${room ?? card.layout ?? "layout"} layout yet`;
    },
    blockedBy: "4.27",
  },
  omen: {
    match: { omen: true },
    reason: "an Omen prints its own layout, and PipGlyph uses the Adventure one",
    blockedBy: "4.27",
  },
  etched: {
    match: { effectsAny: ["etched"] },
    reason: "PipGlyph doesn't have the foil-etched frame yet",
    blockedBy: "4.28",
  },
  border: {
    match: { borders: Object.keys(BORDER_WORD) },
    reason: ({ border }) => `PipGlyph doesn't print a ${BORDER_WORD[border] ?? border} border yet`,
    blockedBy: "4.30",
  },
  marks: {
    match: { effectsAny: MARK_EFFECTS },
    reason: "PipGlyph doesn't draw this printing's frame mark yet",
    blockedBy: "4.7",
  },
  colourshifted: {
    match: { effectsAny: ["colorshifted"] },
    reason: "PipGlyph doesn't have the colour-shifted frame",
    blockedBy: "4.11",
  },
  nickname: {
    match: { flavorName: true },
    reason: "PipGlyph doesn't print the nickname line yet",
    blockedBy: "6.3",
  },
  nyx: {
    match: { effectsAny: ["enchantment"] },
    reason: "PipGlyph doesn't draw the Nyx starfield on this frame yet",
    blockedBy: "4.7",
  },
  "light-box": {
    match: { effectsNone: ["inverted"] },
    reason: "this printing has the light text box, and PipGlyph's has the dark one",
    blockedBy: "4.37",
  },
};

/** The base rule, preceded by one `nearest` rule per gap ('era/2015+crown'). */
function withGaps(base: Rule, gaps: readonly GapKey[]): Rule[] {
  return [
    ...gaps.map((gap): Rule => ({
      key: `${base.key}+${gap}`,
      exactLabel: base.exactLabel,
      match: { allOf: [base.match, GAPS[gap].match] },
      outcome: {
        ...base.outcome,
        status: base.outcome.status === "exact" ? "nearest" : base.outcome.status,
        reason: GAPS[gap].reason,
        blockedBy: GAPS[gap].blockedBy,
      },
    })),
    base,
  ];
}

// Most visible first: the first gap that holds names the reason.
const M15_ERA_GAPS: readonly GapKey[] = [
  "layout",
  "dfc",
  "nyx",
  "etched",
  "border",
  "colourshifted",
  "crown",
  "vehicle",
  "colour-indicator",
  "two-colour",
  "marks",
];

const OLD_ERA_GAPS: readonly GapKey[] = [
  "layout",
  "dfc",
  "etched",
  "border",
  "colourshifted",
  "marks",
  "two-colour",
];

const showcaseLabel = ({ card, set }: Ctx) =>
  `${card.set_name ?? set.toUpperCase()} showcase`;

const LAYOUT_KINDS: readonly CardKind[] = ["saga", "adventure", "split", "aftermath", "flip"];

// ---------------------------------------------------------------------------
// The rules, in order. First match wins.
// ---------------------------------------------------------------------------

export const FRAME_SIGNATURE_RULES: readonly Rule[] = [
  // --- Not a card PipGlyph makes ------------------------------------------
  {
    key: "art-series",
    exactLabel: "Art card",
    match: { layouts: ["art_series"] },
    outcome: {
      status: "unsupported",
      template: "m15",
      reason: "this is an art card, not a playable card",
      reject: true,
      forGood: true,
    },
  },
  {
    key: "no-card-type",
    exactLabel: "Card without a PipGlyph card type",
    match: { noKind: true },
    outcome: {
      status: "unsupported",
      template: "m15",
      reason: "PipGlyph doesn't make this kind of card (emblems, planes, schemes)",
    },
  },

  // --- 1.4: pinned showcase runs -------------------------------------------
  {
    key: "showcase/ltr/scroll",
    exactLabel: "The Lord of the Rings scroll showcase",
    match: { collectors: { ltr: [[452, 712], [723, 730]] } },
    outcome: { status: "exact", template: "lotrscroll" },
  },
  {
    key: "showcase/tdm/draconic",
    exactLabel: "Tarkir: Dragonstorm draconic showcase",
    match: { collectors: { tdm: [[292, 326]] } },
    outcome: { status: "exact", template: "tarkirdraconic" },
  },
  {
    key: "showcase/tdm/ghostfire",
    exactLabel: "Tarkir: Dragonstorm ghostfire showcase",
    match: { collectors: { tdm: [[399, 408]] } },
    outcome: { status: "exact", template: "tarkirghostfire" },
  },
  {
    key: "showcase/tdm/ghostfire/white",
    exactLabel: "Tarkir: Dragonstorm ghostfire showcase (white border)",
    match: { collectors: { tdm: [[409, 418]] } },
    outcome: {
      status: "nearest",
      template: "tarkirghostfire",
      reason: "PipGlyph doesn't print a white border yet",
      blockedBy: "4.30",
    },
  },
  {
    key: "showcase/mul/tarkir",
    exactLabel: "Multiverse Legends Tarkir showcase (Dragon Wing)",
    match: { collectors: { mul: [[1, 1], [60, 60], [131, 131], [190, 190]] } },
    outcome: { status: "exact", template: "tarkirdragon" },
  },
  {
    key: "showcase/thb/constellation",
    exactLabel: "Theros Beyond Death constellation showcase",
    match: { collectors: { thb: [[258, 268]] } },
    outcome: { status: "exact", template: "nyx" },
  },
  {
    key: "showcase/mul",
    exactLabel: "Multiverse Legends showcase",
    match: { sets: ["mul"] },
    outcome: {
      status: "nearest",
      template: { family: "m15" },
      reason: "PipGlyph doesn't have this plane's Multiverse Legends frame yet",
      blockedBy: "4.11",
    },
  },
  {
    key: "masterpiece",
    exactLabel: ({ card, set }) => `${card.set_name ?? set.toUpperCase()} masterpiece`,
    match: { setTypes: ["masterpiece"] },
    outcome: {
      status: "nearest",
      template: { family: "m15" },
      reason: "PipGlyph doesn't have this masterpiece frame yet",
      blockedBy: "4.11",
    },
  },
  {
    key: "showcase",
    exactLabel: showcaseLabel,
    match: { effectsAny: ["showcase"] },
    outcome: {
      status: "nearest",
      template: { family: "m15" },
      reason: ({ border }) =>
        border === "white"
          ? "PipGlyph doesn't have this set's showcase frame or a white border yet"
          : "PipGlyph doesn't have this set's showcase frame yet",
      blockedBy: "4.11",
    },
  },

  // --- 1.4: Future Sight, extended art, Nyx, coloured artifacts -----------
  {
    key: "future",
    exactLabel: "Future Sight frame",
    match: { frames: ["future"] },
    outcome: {
      status: "unsupported",
      template: { family: "m15" },
      reason: "PipGlyph doesn't have the Future Sight frame",
      blockedBy: "4.15",
    },
  },
  ...withGaps(
    {
      key: "extendedart",
      exactLabel: "Extended-art frame",
      match: { effectsAny: ["extendedart"] },
      outcome: { status: "exact", template: "extendedart" },
    },
    ["layout", "dfc", "etched", "border", "crown", "vehicle", "two-colour"],
  ),
  {
    key: "nyx/2003",
    exactLabel: "Nyx frame (2003)",
    match: { frames: ["2003"], effectsAny: ["enchantment"] },
    outcome: {
      status: "nearest",
      template: "nyx",
      reason: "PipGlyph's Nyx frame is the 2015 constellation showcase",
      blockedBy: "4.7",
    },
  },
  {
    key: "era/1997/coloured-artifact",
    exactLabel: "Coloured artifact frame (1997)",
    match: {
      frames: ["1997"],
      typeWordsAny: ["artifact"],
      kinds: ["artifact", "creature"],
      colorCount: { min: 1 },
    },
    outcome: {
      status: "nearest",
      template: "m15artifact",
      reason: "PipGlyph has no coloured artifact frame for this border era",
      blockedBy: "4.10",
    },
  },
  {
    key: "era/2003/coloured-artifact",
    exactLabel: "Coloured artifact frame (2003)",
    match: {
      frames: ["2003"],
      typeWordsAny: ["artifact"],
      kinds: ["artifact", "creature"],
      colorCount: { min: 1 },
    },
    outcome: {
      status: "nearest",
      template: "m15artifact",
      reason: "PipGlyph has no coloured artifact frame for this border era",
      blockedBy: "4.10",
    },
  },

  // --- 1.4: layout kinds ---------------------------------------------------
  ...withGaps(
    {
      key: "layout/2015",
      exactLabel: ({ facts }) => `${facts.kind ? KIND_DEFS[facts.kind].label : "Layout"} frame`,
      match: { frames: ["2015"], kinds: LAYOUT_KINDS },
      outcome: { status: "exact", template: { family: "m15" } },
    },
    ["omen", "dfc", "etched", "border"],
  ),
  {
    key: "layout/older",
    exactLabel: ({ facts, frame }) =>
      `${facts.kind ? KIND_DEFS[facts.kind].label : "Layout"} frame (${frame})`,
    match: { kinds: LAYOUT_KINDS },
    outcome: {
      status: "nearest",
      template: { family: "m15" },
      reason: "PipGlyph's layout frames are M15-era",
      blockedBy: "4.10",
    },
  },

  // --- 1.4: the border eras, with their anatomy gaps -----------------------
  ...withGaps(
    {
      key: "era/1993",
      exactLabel: "Alpha (1993) frame",
      match: { frames: ["1993"] },
      outcome: { status: "exact", template: { family: "alpha" } },
    },
    ["border", "marks"],
  ),
  {
    key: "era/1997/planeswalker",
    exactLabel: "Planeswalker (1997 frame)",
    match: { frames: ["1997"], kinds: ["planeswalker", "battle"] },
    outcome: {
      status: "nearest",
      template: { family: "retro" },
      reason: "PipGlyph has no planeswalker frame for this border era",
      blockedBy: "4.10",
    },
  },
  ...withGaps(
    {
      key: "era/1997",
      exactLabel: "Retro (1997) frame",
      match: { frames: ["1997"] },
      outcome: { status: "exact", template: { family: "retro" } },
    },
    OLD_ERA_GAPS,
  ),
  {
    key: "era/2003/planeswalker",
    exactLabel: "Planeswalker (2003 frame)",
    match: { frames: ["2003"], kinds: ["planeswalker", "battle"] },
    outcome: {
      status: "nearest",
      template: { family: "modern" },
      reason: "PipGlyph has no planeswalker frame for this border era",
      blockedBy: "4.10",
    },
  },
  ...withGaps(
    {
      key: "era/2003",
      exactLabel: "Modern (2003) frame",
      match: { frames: ["2003"] },
      outcome: { status: "exact", template: { family: "modern" } },
    },
    OLD_ERA_GAPS,
  ),
  ...withGaps(
    {
      key: "era/2015",
      exactLabel: "M15 (2015) frame",
      match: { frames: ["2015"] },
      outcome: { status: "exact", template: { family: "m15" } },
    },
    M15_ERA_GAPS,
  ),
  {
    key: "unknown-frame",
    exactLabel: ({ frame }) => (frame ? `${frame} frame` : "Unknown frame"),
    match: {},
    outcome: {
      status: "nearest",
      template: { family: "m15" },
      reason: "Scryfall reports a frame PipGlyph doesn't know",
    },
  },
];

/** Every signature id, in rule order — the vocabulary 1.6's request log
 *  stores. */
export const FRAME_SIGNATURE_KEYS: readonly string[] = FRAME_SIGNATURE_RULES.map((r) => r.key);

const SIGNATURE_KEY_SET: ReadonlySet<string> = new Set(FRAME_SIGNATURE_KEYS);

export function isKnownFrameSignature(key: string | null | undefined): boolean {
  return typeof key === "string" && SIGNATURE_KEY_SET.has(key);
}

/** The templates a rule can produce (for the completeness check). */
export function templatesOfRule(rule: Rule): readonly FrameTemplate[] {
  const spec = rule.outcome.template;
  return typeof spec === "string" ? [spec] : FAMILIES[spec.family].produces;
}

/** Templates no printed signature resolves to exact or nearest. Empty today:
 *  every PipGlyph frame is some printing's frame. */
export const TEMPLATES_WITHOUT_PRINTED_SIGNATURE: readonly FrameTemplate[] = [];

const textOf = (text: Text | undefined, ctx: Ctx): string | null =>
  text === undefined ? null : typeof text === "string" ? text : text(ctx);

const kindWord = (kind: CardKind) => {
  const label = KIND_DEFS[kind].label.toLowerCase();
  return label.endsWith("y") ? `${label.slice(0, -1)}ies` : `${label}s`;
};

/**
 * Resolve a printing's frame signature: the first matching rule's outcome,
 * then three checks the table can't express by itself:
 *   1. the kind — a frame that can't dress this kind of card (a Theros god,
 *      an Enchantment CREATURE, on the Nyx showcase frame; a Snow ARTIFACT on
 *      the snow frame; an Omen on the draconic frame) is at best `nearest`,
 *      and the import lands on the kind's standard (`landOn`);
 *   2. the border — a template whose border isn't true yet (4.35) is capped
 *      at `nearest`;
 *   3. the art — an edge-to-edge frame on a printing that isn't full art
 *      lands on its bordered equivalent, because Scryfall's art_crop is the
 *      626×457 window (1.18's owner decision).
 */
export function resolveFrameSignature(card: ScryfallCard, facts: PrintingFacts): FrameMatch {
  const ctx = contextOf(card, facts);
  const rule =
    FRAME_SIGNATURE_RULES.find((candidate) => matches(candidate.match, ctx)) ??
    FRAME_SIGNATURE_RULES[FRAME_SIGNATURE_RULES.length - 1];
  const spec = rule.outcome.template;
  const template = typeof spec === "string" ? spec : FAMILIES[spec.family].pick(ctx);

  let status = rule.outcome.status;
  let reason = status === "exact" ? null : textOf(rule.outcome.reason, ctx);
  let blockedBy = rule.outcome.blockedBy;
  let landOn: FrameTemplate | undefined;

  const kind = facts.kind;
  if (
    kind &&
    (!templateSupportsKind(template, kind) ||
      (templateIsBasicOnly(template) && !facts.singleBasic))
  ) {
    landOn = kindFallback(ctx);
    const kindReason = `PipGlyph's ${describeFrame(template)} frame doesn't dress ${kindWord(kind)} yet`;
    reason = reason ? `${reason}; ${kindReason}` : kindReason;
    if (status === "exact") status = "nearest";
  }

  if (status === "exact" && BORDER_PENDING_TEMPLATES.has(template)) {
    status = "nearest";
    reason = `PipGlyph's ${describeFrame(template)} frame doesn't have the printed border yet`;
    blockedBy = "4.35";
  }

  if (!landOn && card.full_art !== true && artReachesCardEdge(getFrameProfile(template))) {
    landOn = BORDERED_EQUIVALENT[template] ?? kindFallback(ctx);
  }

  return {
    status,
    template,
    exactLabel: textOf(rule.exactLabel, ctx) ?? rule.key,
    reason: status === "exact" ? null : reason,
    signature: rule.key,
    ...(landOn && landOn !== template ? { landOn } : {}),
    ...(rule.outcome.reject ? { reject: true as const } : {}),
    ...(rule.outcome.forGood ? { forGood: true as const } : {}),
    ...(status !== "exact" && blockedBy ? { blockedBy } : {}),
  };
}

/** Every template the registry can resolve to, for the completeness test. */
export function templatesReachedByRegistry(): ReadonlySet<FrameTemplate> {
  return new Set(FRAME_SIGNATURE_RULES.flatMap((rule) => templatesOfRule(rule)));
}

/** True when every FrameTemplate is reachable or listed as having no
 *  printed signature. */
export function registryCoversEveryTemplate(): boolean {
  const reached = templatesReachedByRegistry();
  return FRAME_TEMPLATE_VALUES.every(
    (t) => reached.has(t) || TEMPLATES_WITHOUT_PRINTED_SIGNATURE.includes(t),
  );
}

// ---------------------------------------------------------------------------
// Land frame colours the data can't predict (TODO 1.2's LAND_FRAME_OVERRIDES,
// moved here with 1.4). Scryfall has no field for a land's frame colour; the
// importer reads the mana a land PRODUCES (landFrameColors in the mapper),
// and these are the lands where that rule is wrong, each checked on its scan.
// ---------------------------------------------------------------------------

const WUBRG = ["W", "U", "B", "R", "G"] as const;

// By Oracle name (Scryfall's `name`, English on every printing):
//   • "identity" — the Vivid lands tap for their colour plus, with a charge
//     counter, any colour, and print their own colour (Vivid Crag LRW #275
//     and C17 #289 red, Vivid Meadow NCC #446 white), unlike the Thriving
//     lands and the CLB Gates, which print gold for the same mana;
//   • "colorless" — produced_mana lists colours these print grey for: a
//     one-shot or conditional any-colour ability beside a {C} tap (Crumbling
//     Vestige OGW #170, Gemstone Caverns TSP #274, Mirrex ONE #254,
//     Springjack Pasture C13 #326), and Urborg UMA #254, whose Swamp-granting
//     text Scryfall counts as {B} (Yavimaya MH2 #261, its Forest twin, does
//     print green);
//   • "gold" — fetch lands for "a basic land card" that print the gold land
//     frame although Scryfall lists no mana and no identity (Fabled Passage
//     ELD #244, Prismatic Vista MH1 #244; checked 2026-09-28). Evolving Wilds
//     (MSC #240) prints the grey colourless frame and needs no entry.
const LAND_FRAME_OVERRIDES: ReadonlyMap<string, "identity" | "colorless" | "gold"> = new Map([
  ["Vivid Crag", "identity"],
  ["Vivid Creek", "identity"],
  ["Vivid Grove", "identity"],
  ["Vivid Marsh", "identity"],
  ["Vivid Meadow", "identity"],
  ["Crumbling Vestige", "colorless"],
  ["Gemstone Caverns", "colorless"],
  ["Mirrex", "colorless"],
  ["Springjack Pasture", "colorless"],
  ["Urborg, Tomb of Yawgmoth", "colorless"],
  ["Fabled Passage", "gold"],
  ["Prismatic Vista", "gold"],
]);

const BASIC_TYPE_LETTER: Record<string, string> = {
  Plains: "W",
  Island: "U",
  Swamp: "B",
  Mountain: "R",
  Forest: "G",
};

// "Search your library for a Plains or Island card" (the Onslaught /
// Zendikar / Khans fetch lands and their reprints).
const FETCH_TWO_TYPES =
  /search your library for an? (?:basic )?(Plains|Island|Swamp|Mountain|Forest) or (Plains|Island|Swamp|Mountain|Forest) card/i;

/**
 * The land frame colours the produced-mana rule can't read, as WUBRG
 * letters, or "identity" (dress by colour identity), or null (no override).
 *   • LAND_FRAME_OVERRIDES by Oracle name;
 *   • a fetch land — no produced mana and no identity, Oracle text searching
 *     for two basic land types — prints those two colours (Flooded Strand
 *     KTK #233 prints white and blue; Arid Mesa ZEN #211 red and white).
 * The 1993/1997 frames never reach this: they dress every land by identity.
 */
export function landFrameColorRule(card: ScryfallCard): readonly string[] | "identity" | null {
  const override = LAND_FRAME_OVERRIDES.get(card.name);
  if (override === "identity") return "identity";
  if (override === "colorless") return [];
  if (override === "gold") return WUBRG;
  const producesNothing = !card.produced_mana || card.produced_mana.length === 0;
  const noIdentity = !card.color_identity || card.color_identity.length === 0;
  if (producesNothing && noIdentity) {
    const fetch = FETCH_TWO_TYPES.exec(card.oracle_text ?? "");
    if (fetch) {
      const letters = [BASIC_TYPE_LETTER[fetch[1]!], BASIC_TYPE_LETTER[fetch[2]!]];
      return WUBRG.filter((letter) => letters.includes(letter));
    }
  }
  return null;
}
