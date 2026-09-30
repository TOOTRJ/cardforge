import type { ScryfallCard } from "@/lib/scryfall/client";
import {
  FRAME_TEMPLATE_VALUES,
  type CardType,
  type FrameEra,
  type FrameTemplate,
} from "@/types/card";
import {
  KIND_DEFS,
  borrowedTypeWord,
  templateIsBasicOnly,
  templateSupportsKind,
  type CardKind,
} from "@/lib/creator/card-kinds";
import { standardFrameFor } from "@/lib/creator/frame-picker";
import { describeFrame } from "@/lib/creator/frame-resolve";
import { artReachesCardEdge, getFrameProfile } from "@/lib/cards/template-layout";
import { frameAnatomyOf, twoColorDressOf } from "@/lib/cards/anatomy";

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
// families, the rest of 1.19 (Japan showcase, old tokens), 1.23's 2015-frame
// tokens (Roles, other token types, the M20 design), the rest of 1.19
// (full-art basics, textless), the look-alikes (ZNR showcase, Expeditions),
// then 1.4's general
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
  /** The frame the registry names instead once it is verified in the
   *  card's colour: a 2003-frame textless promo names the 2003 frame while
   *  the textless frame isn't verified (owner decision A9, 2026-09-29).
   *  withVerification (lib/creator/frame-resolve.ts) swaps it in. */
  onceVerified?: FrameTemplate;
  /** Set by withVerification only: the registry answered `exact`, but that
   *  frame isn't verified in the card's colour yet, so the match was
   *  downgraded to `nearest`. The frame request log files it under "Not yet
   *  verified" instead of "Missing frames" (TODO 1.6, owner decision D1
   *  2026-09-29). Never set by a registry rule. */
  unverified?: true;
  /** Every anatomy gap of the printing — a piece PipGlyph doesn't draw yet
   *  (the legendary crown, a colour indicator, the Vehicle plate, …) — most
   *  visible first: the first names `reason`. Absent when the rule that
   *  matched has none. The import dialog reads it to skip its frame chooser
   *  when the only gaps are details no PipGlyph frame draws (owner decision
   *  C1, 2026-09-29). */
  gaps?: readonly FrameGap[];
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

/** The 2023 printings of the 2022 design, with an older bar geometry
 *  (bars 6–13 px off, colours up to 43 levels: the 4.39 print review). */
const FULL_ART_BASIC_OLDER_BARS = ["one", "mom"] as const;

/** Zendikar-style split type bar with a centred medallion (4.40). */
const SPLIT_BAR_BASIC_SETS = ["bfz", "ogw", "akh", "hou", "mh1", "znr", "snc", "bro", "mid", "vow"] as const;
/** The same design on the 2003 frame (4.40 on 4.43's border). */
const SPLIT_BAR_BASIC_2003_SETS = ["zen", "j14"] as const;
/** A title bar and a plain "Basic Land — Plains" bar, no symbol (4.41). */
const PLAIN_BAR_BASIC_SETS = ["thb", "2xm", "dmu", "spm", "sos", "plg25"] as const;
/** Per-set full-art basic designs (4.11). */
const PER_SET_BASIC_SETS = ["ugl", "unh", "und", "neo", "lci"] as const;

/** The day Core Set 2020 was released. Tokens printed from then on wear the
 *  full-art token design (frames plan 4.48); the `frame: 2015` tokens before
 *  it (M15 2014-07-18 → MH1 2019-05-30) wear the 2014–19 arch that
 *  `m15token` draws (TODO 1.23). Scryfall has no field for the design:
 *  `full_art` is set on 57 of the 58 vanilla tokens of M20's first year but
 *  on only 4 token printings in all of 2024, so the date decides. */
export const M20_TOKEN_DESIGN_FROM = "2019-07-12";

/** The List (`plst`) reprints tokens and emblems under their original set's
 *  collector prefix ("TXLN-10") in that set's design, while its
 *  `released_at` is The List's own. These are the prefix sets released
 *  before M20: 11 sets, 22 of The List's 71 token and emblem printings
 *  (Scryfall 2026-09-28). tests/unit/scryfall/fixtures/
 *  plst-token-prefixes.json holds the list to Scryfall's release dates. */
export const PLST_PRE_M20_PREFIX_SETS: ReadonlySet<string> = new Set([
  "takh", "tbng", "tc17", "tgrn", "tisd", "tnph", "tori", "tshm", "tsoi", "tuma", "txln",
]);

/** True when a printing wears the design M20 introduced (TODO 1.23): released
 *  on or after 2019-07-12, or a `plst` reprint whose collector prefix names a
 *  set that isn't one of PLST_PRE_M20_PREFIX_SETS (plst TKHM-19 yes, plst
 *  TXLN-10 no). A printing with no release date (an older cached payload)
 *  isn't: it keeps the answer it had. Emblems follow the same rule (4.52). */
export function isM20DesignPrinting(
  card: Pick<ScryfallCard, "set" | "collector_number" | "released_at">,
): boolean {
  if ((card.set ?? "").trim().toLowerCase() === "plst") {
    const prefix = /^([a-z0-9]+)-/i.exec((card.collector_number ?? "").trim())?.[1];
    if (prefix) return !PLST_PRE_M20_PREFIX_SETS.has(prefix.toLowerCase());
  }
  const released = (card.released_at ?? "").trim();
  return released !== "" && released >= M20_TOKEN_DESIGN_FROM;
}

/** Nyx tokens Scryfall doesn't flag with the `enchantment` frame effect
 *  (frames plan 4.51, checked by eye 2026-09-29): Glimmer TDSK #4, Horror
 *  TDSK #10 and Shrine SLD #1835 print the starfield in their name pill. */
const NYX_TOKEN_PINS: Readonly<Record<string, readonly string[]>> = {
  tdsk: ["4", "10"],
  sld: ["1835"],
};

/** The 2014–19 arch tokens that print the TALL text box — the type pill at
 *  ~56–62 %H over a box twice the regular one's, not m15tokentext's pill at
 *  67–73.5 %H (TODO 4.55: no Card Conjurer source, P3 by the 1.6 log).
 *  Scryfall has no field for the box height and text length doesn't tell
 *  (the SOI Clue's 39 characters print tall), so they are pinned: every
 *  black-bordered pre-M20 arch token with rules text (316 printings, the
 *  List's pre-M20 prefixes included; Scryfall 2026-09-29) measured against
 *  m15tokentext's master — the regular box within 12 px, these 21 about
 *  238 px higher — and checked by eye. */
export const TALL_BOX_TOKEN_PINS: Readonly<Record<string, readonly string[]>> = {
  takh: ["1", "5", "6", "12", "15"],
  thou: ["2", "3", "4", "6"],
  tc18: ["4", "10", "19"],
  tsoi: ["11", "12", "13", "14", "15", "16"],
  tdom: ["7"],
  trix: ["1"],
  tust: ["18"],
};

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

/** The templates whose border isn't true yet, capped at `nearest` so
 *  verifying one can never make it exact:
 *   • a transparent outer ring plus an inset art slot that bakes a flat
 *     #101015 "border" (TODO 4.35): bloomanime, tarkirghostfire,
 *     tarkirdragon, lotrscroll, battle;
 *   • a transparent outer band at the bottom and lower sides, found by 7.7's
 *     edge contract (owner decision A8, 2026-09-29): avatar, bloomburrow,
 *     lotr, tarkirdraconic.
 *  Each is a known failure in lib/frames/edge-contract.ts; a test holds the
 *  two lists together, so fixing a master (and striking it from the known
 *  failures) lifts its cap here too. */
export const BORDER_PENDING_TEMPLATES: ReadonlySet<FrameTemplate> = new Set<FrameTemplate>([
  "bloomanime",
  "tarkirghostfire",
  "tarkirdragon",
  "lotrscroll",
  "battle",
  "avatar",
  "bloomburrow",
  "lotr",
  "tarkirdraconic",
]);

/** Single colour masters whose border isn't true yet (owner decision A8):
 *  expeditionland's black and green, where the black flood fill leaked
 *  through the dark stone (4.35 (3)). No printed Expedition is black or
 *  green today (ZNE and EXP checked 2026-09-29: the fetches and duals are
 *  multicolour, Ancient Tomb and Kor Haven colourless, Valakut red), so the
 *  cap guards the combos rather than a printing. */
export const BORDER_PENDING_COLOURS: ReadonlyMap<FrameTemplate, ReadonlySet<string>> = new Map<
  FrameTemplate,
  ReadonlySet<string>
>([["expeditionland", new Set(["b", "g"])]]);

/** True when `template`'s border isn't true yet in this colour key. */
export function isBorderPending(template: FrameTemplate, colorKey: string): boolean {
  return (
    BORDER_PENDING_TEMPLATES.has(template) ||
    Boolean(BORDER_PENDING_COLOURS.get(template)?.has(colorKey))
  );
}

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
  /** The printing wears the design M20 introduced (isM20DesignPrinting). */
  m20Design?: boolean;
  /** `type_line` is exactly "Card" (a double-faced substitute). */
  typeLineCard?: true;
  singleBasic?: boolean;
  flavorName?: true;
  colorIndicator?: true;
  omen?: true;
  colorCount?: { min?: number; max?: number };
  /** The front face's cost is print's HYBRID dress (twoColorDressOf, TODO
   *  4.6.0): every coloured pip a two-colour hybrid, or a nonland with no
   *  coloured pip — `false` for any other (the gold-split dress). */
  hybridCost?: boolean;
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
  /** FrameMatch.onceVerified: the frame named instead once verified. */
  onceVerified?: TemplateSpec;
};

type Rule = {
  /** Stable signature id ('borderless/standard/dark'). */
  key: string;
  /** Copy naming what the printing is. */
  exactLabel: Text;
  match: Match;
  outcome: Outcome;
  /** A gap rule's gaps (withGaps): its own first — it holds when the rule
   *  matches — then the base's later ones, which may hold too. */
  gaps?: readonly GapKey[];
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
  m20Design: boolean;
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
    m20Design: isM20DesignPrinting(card),
  };
}

const hasAny = (set: ReadonlySet<string>, list: readonly string[]) =>
  list.some((value) => set.has(value));

/** True when the front face's cost prints the hybrid two-colour dress
 *  (lib/cards/anatomy.ts twoColorDressOf — the renderers' rule). */
function isHybridCost({ card, facts }: Ctx): boolean {
  const cost = card.card_faces?.[0]?.mana_cost ?? card.mana_cost ?? null;
  const cardType = facts.kind === "land" || facts.kind === "token" ? facts.kind : "nonland";
  return twoColorDressOf(cost, cardType) === "hybrid";
}

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
  if (match.m20Design !== undefined && ctx.m20Design !== match.m20Design) return false;
  if (match.typeLineCard && (card.type_line ?? "").trim() !== "Card") return false;
  if (match.singleBasic !== undefined && facts.singleBasic !== match.singleBasic) return false;
  if (match.flavorName && !card.flavor_name) return false;
  if (match.colorIndicator && !facts.colorIndicator) return false;
  if (match.omen && !facts.omen) return false;
  if (match.hybridCost !== undefined && isHybridCost(ctx) !== match.hybridCost) return false;
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

/** True when the printing's front face prints rules or flavour text — a
 *  2014–19 token with a text box (TODO 4.49 (b): TDOM #2 "Vigilance", TXLN
 *  #7 Treasure), where a vanilla one prints none (TDOM #3 Soldier). */
export function printsTokenTextBox(card: Pick<ScryfallCard, "oracle_text" | "flavor_text" | "card_faces">): boolean {
  const face = card.card_faces?.[0];
  const text = (face ? face.oracle_text : card.oracle_text) ?? "";
  const flavor = (face ? face.flavor_text : card.flavor_text) ?? "";
  return text.trim() !== "" || flavor.trim() !== "";
}

/** The 2014–19 arch token a token printing wears: its artifact dress for an
 *  Artifact (1.3), and the text-box variation when it prints text (4.49
 *  (b)). */
function archTokenFrame(ctx: Ctx): FrameTemplate {
  const artifact = ctx.facts.cardTypes.has("artifact");
  const text = printsTokenTextBox(ctx.card);
  if (artifact) return text ? "m15tokenartifacttext" : "m15tokenartifact";
  return text ? "m15tokentext" : "m15token";
}

const FAMILIES: Record<
  Family,
  { produces: readonly FrameTemplate[]; pick: (ctx: Ctx) => FrameTemplate }
> = {
  // M15: the era standard for the kind, dressed by the printing's snow /
  // devoid effect and its artifact word (the 1.3 rules, unchanged): a snow
  // land is the snow land frame, a snow spell or snow ARTIFACT the snow frame
  // (Replicating Ring KHM #244 prints it; the Artifact kind can't take it
  // yet, so the kind check lands it on m15artifact), an Artifact Creature
  // the artifact frame, an artifact token the artifact token frame — and a
  // token that prints text the text-box token frame (4.49 (b)).
  m15: {
    produces: [
      "saga", "adventure", "split", "aftermath", "flip", "m15token",
      "m15tokenartifact", "m15tokentext", "m15tokenartifacttext", "m15land",
      "m15snowland", "m15pw", "battle", "m15snow", "m15devoid", "m15artifact",
      "m15",
    ],
    pick: (ctx) => {
      const { facts, effects } = ctx;
      const layout = layoutTemplateOf(facts.kind);
      if (layout) return layout;
      switch (facts.kind) {
        case "token":
          return archTokenFrame(ctx);
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

/** The bordered frame an edge-to-edge frame lands on, because Scryfall only
 *  has the art cropped to the classic window (1.18). Any other kind lands on
 *  its M15 standard (kindFallback): a borderless basic on the land frame,
 *  whose window fits that crop, with the borderless full-art basic OFFERED
 *  once verified (4.39) — not on m15fullartland, whose ~92 × 89 % window
 *  would blow the 626 × 457 crop up the same way. */
const BORDERED_EQUIVALENT: Partial<Record<FrameTemplate, FrameTemplate>> = {
  m15borderless: "m15",
  m15borderlessartifact: "m15artifact",
};

// ---------------------------------------------------------------------------
// Anatomy gaps: pieces of a printing PipGlyph doesn't draw yet. A rule that
// can be exact lists the gaps that make it `nearest` (owner question 1's
// default: a missing piece is not an exact match).
// ---------------------------------------------------------------------------

export type FrameGap = GapKey;

type GapKey =
  | "crown"
  | "two-colour"
  | "two-colour-hybrid"
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
  | "nyx-dress"
  | "nyx"
  | "light-box"
  | "tall-box";

const BORDER_WORD: Record<string, string> = {
  white: "white",
  silver: "silver",
  gold: "gold",
  yellow: "yellow",
};

const GAPS: Record<GapKey, { match: Match; reason: Text; blockedBy: string }> = {
  // The legendary crown and the two-colour dresses (TODO 4.6a / 4.6b): a gap
  // only where the frame the card lands on doesn't draw it — derived from the
  // profile (gapDrawnBy), never a second hand-kept list.
  crown: {
    match: { effectsAny: ["legendary"] },
    reason: "PipGlyph doesn't draw the legendary crown yet",
    blockedBy: "4.6a",
  },
  // 4.6b draws the pairs on m15 (split + hybrid), m15artifact and m15land
  // (split): there these gaps drop. What is left is wave 2 (4.6f: snow,
  // devoid, borderless, extended art, sagas / adventures) — and the tails
  // it names (the hybrid artifact dress 4.6e, token pairs 4.48, the 2003
  // frame).
  "two-colour": {
    match: { colorCount: { min: 2, max: 2 }, hybridCost: false },
    reason: "two-colour cards print a split frame, and PipGlyph uses its gold one",
    blockedBy: "4.6f",
  },
  "two-colour-hybrid": {
    match: { colorCount: { min: 2, max: 2 }, hybridCost: true },
    reason: "two-colour hybrid cards print a split hybrid frame, and PipGlyph uses its gold one",
    blockedBy: "4.6f",
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
  // A token's Nyx is a dress of the token frames (4.51: the starfield in the
  // name pill on the M20 design, a textured frame on the 2014–19 one), not
  // the non-token m15nyx frame 4.7 builds — so the token kind names 4.51.
  "nyx-dress": {
    match: {
      kinds: ["token"],
      anyOf: [{ effectsAny: ["enchantment"] }, { collectorIds: NYX_TOKEN_PINS }],
    },
    reason: "PipGlyph doesn't draw the Nyx dress on its token frames yet",
    blockedBy: "4.51",
  },
  // The arch token's tall text box (TODO 4.55, P3 — split out of 4.49 (b),
  // owner 2026-09-29): the import lands on the regular box, the text
  // shrinking to fit (3.29), and the 1.6 log counts the demand.
  "tall-box": {
    match: { kinds: ["token"], collectorIds: TALL_BOX_TOKEN_PINS },
    reason: "PipGlyph doesn't have the tall text box of this token frame yet",
    blockedBy: "4.55",
  },
  nyx: {
    match: { effectsAny: ["enchantment"], notKinds: ["token"] },
    reason: "PipGlyph doesn't draw the Nyx starfield on this frame yet",
    blockedBy: "4.7",
  },
  "light-box": {
    match: { effectsNone: ["inverted"] },
    reason: "this printing has the light text box, and PipGlyph's has the dark one",
    blockedBy: "4.37",
  },
};

/** The base rule, preceded by one `nearest` rule per gap ('era/2015+crown').
 *  A gap rule names the item that finishes the match (its `blockedBy`).
 *  When the base is itself only `nearest` (the M20 token design on the arch
 *  frame, TODO 1.23), the gap rule keeps the base's reason before its own,
 *  and records no FrameMatch.gaps: the frame is a stand-in whatever the
 *  gaps, so the import dialog must still ask (C1 reads the gaps). */
function withGaps(base: Rule, gaps: readonly GapKey[]): Rule[] {
  const exactBase = base.outcome.status === "exact";
  const baseReason = base.outcome.reason;
  return [
    ...gaps.map((gap, index): Rule => {
      const gapReason = GAPS[gap].reason;
      return {
        key: `${base.key}+${gap}`,
        exactLabel: base.exactLabel,
        match: { allOf: [base.match, GAPS[gap].match] },
        outcome: {
          ...base.outcome,
          status: exactBase ? "nearest" : base.outcome.status,
          reason:
            exactBase || baseReason === undefined
              ? gapReason
              : (ctx: Ctx) => `${textOf(baseReason, ctx)}; ${textOf(gapReason, ctx)}`,
          blockedBy: GAPS[gap].blockedBy,
        },
        // The earlier gaps didn't hold (first match wins); the later ones are
        // checked at resolve time (FrameMatch.gaps).
        ...(exactBase ? { gaps: gaps.slice(index) } : {}),
      };
    }),
    base,
  ];
}

// Most visible first: the first gap that holds names the reason.
const M15_ERA_GAPS: readonly GapKey[] = [
  "layout",
  "dfc",
  "tall-box",
  "nyx-dress",
  "nyx",
  "etched",
  "border",
  "colourshifted",
  "crown",
  "vehicle",
  "colour-indicator",
  "two-colour",
  "two-colour-hybrid",
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
  "two-colour-hybrid",
];

const showcaseLabel = ({ card, set }: Ctx) =>
  `${card.set_name ?? set.toUpperCase()} showcase`;

const LAYOUT_KINDS: readonly CardKind[] = ["saga", "adventure", "split", "aftermath", "flip"];

// ---------------------------------------------------------------------------
// The rules, in order. First match wins.
// ---------------------------------------------------------------------------

export const FRAME_SIGNATURE_RULES: readonly Rule[] = [
  // --- 1.19 steps 1–2: not a card; unsupported for good -------------------
  {
    key: "substitute-card",
    exactLabel: "Double-faced substitute card",
    match: { typeLineCard: true },
    outcome: {
      status: "unsupported",
      template: "m15",
      reason: "this is a substitute card, not a playable card",
      reject: true,
      forGood: true,
    },
  },
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
  {
    key: "frameless/slz",
    exactLabel: "The Zeta Set frameless typeset card",
    match: { sets: ["slz"] },
    outcome: {
      status: "unsupported",
      template: { family: "m15" },
      reason: "The Zeta Set's frameless typeset design",
      forGood: true,
    },
  },
  {
    key: "poster/black",
    exactLabel: "Artist-lettered poster",
    match: { promosAny: ["poster"], borders: ["black"] },
    outcome: {
      status: "unsupported",
      template: { family: "m15" },
      reason: "an artist-lettered poster is a one-off design",
      forGood: true,
    },
  },

  // --- 1.17: border_color borderless ---------------------------------------
  {
    key: "borderless/poster",
    exactLabel: "Artist-lettered borderless poster",
    match: { borders: ["borderless"], promosAny: ["poster"] },
    outcome: {
      status: "unsupported",
      template: { family: "borderless" },
      reason: "an artist-lettered poster is a one-off design",
      forGood: true,
    },
  },
  {
    key: "borderless/sourcematerial",
    exactLabel: "Source-material borderless frame (text on the art)",
    match: { borders: ["borderless"], promosAny: ["sourcematerial"] },
    outcome: {
      status: "nearest",
      template: { family: "borderless" },
      reason: "PipGlyph doesn't have the text-on-art frame yet",
      blockedBy: "4.36",
    },
  },
  {
    key: "borderless/mystical-archive",
    exactLabel: "Mystical Archive frame",
    match: { borders: ["borderless"], sets: ["sta", "soa"] },
    outcome: {
      status: "nearest",
      template: { family: "borderless" },
      reason: "PipGlyph doesn't have the Mystical Archive frame yet",
      blockedBy: "4.11",
    },
  },
  {
    key: "borderless/stellar-sights",
    exactLabel: "Stellar Sights borderless frame",
    match: { borders: ["borderless"], sets: ["eos"] },
    outcome: {
      status: "nearest",
      template: { family: "borderless" },
      reason: "PipGlyph doesn't have the Stellar Sights frame yet",
      blockedBy: "4.11",
    },
  },
  {
    key: "borderless/unsupported-set",
    exactLabel: ({ card, set }) => `${card.set_name ?? set.toUpperCase()} borderless frame`,
    // UST's five textless basics are 1.17's textless borderless basics.
    match: { borders: ["borderless"], sets: ["mp2", "ust", "bot"], singleBasic: false },
    outcome: {
      status: "unsupported",
      template: { family: "borderless" },
      reason: "this set's borderless frame is a one-off design",
    },
  },
  // Bloomburrow: ONE woodland run in WUBRG + gold order, #295–336 (checked
  // by eye 2026-09-28: #315 and #316 print the same vine frame, so 1.17's
  // split at #316 was wrong), and the raised-foil anime legends #343–355
  // (black bars with vine flourishes at their corners: the bloomanime
  // master). #282–294 are the standard borderless run.
  {
    key: "showcase/blb/woodland",
    exactLabel: "Bloomburrow woodland showcase",
    match: { borders: ["borderless"], collectors: { blb: [[295, 336]] } },
    outcome: { status: "exact", template: "bloomburrow" },
  },
  {
    key: "showcase/blb/anime",
    exactLabel: "Bloomburrow anime showcase",
    match: { borders: ["borderless"], collectors: { blb: [[343, 355]] } },
    outcome: { status: "exact", template: "bloomanime" },
  },
  {
    key: "showcase/ltr/ring",
    exactLabel: "The Lord of the Rings ring showcase",
    match: { borders: ["borderless"], collectors: { ltr: [[302, 331], [794, 823]] } },
    outcome: { status: "exact", template: "lotr" },
  },
  {
    key: "showcase/tdm/clan",
    exactLabel: "Tarkir: Dragonstorm clan showcase (text on the art)",
    match: { borders: ["borderless"], collectors: { tdm: [[327, 376]] } },
    outcome: {
      status: "nearest",
      template: { family: "borderless" },
      reason: "PipGlyph doesn't have the text-on-art frame yet",
      blockedBy: "4.36",
    },
  },
  {
    key: "showcase/tla/avatar",
    exactLabel: "Avatar: The Last Airbender elemental showcase",
    // TLE #305–317 (the Eternal-legal companion set) print the same frame,
    // including its only colourless printings (Arcane Signet TLE #315).
    match: { borders: ["borderless"], collectors: { tla: [[336, 353]], tle: [[305, 317]] } },
    outcome: { status: "exact", template: "avatar" },
  },
  {
    key: "borderless/showcase",
    exactLabel: (ctx) => `${showcaseLabel(ctx)} (borderless)`,
    match: { borders: ["borderless"], effectsAny: ["showcase"] },
    outcome: {
      status: "nearest",
      template: { family: "borderless" },
      reason: "PipGlyph doesn't have this set's showcase frame yet",
      blockedBy: "4.11",
    },
  },
  {
    key: "borderless/basic/textless",
    exactLabel: "Textless borderless basic land",
    match: { borders: ["borderless"], singleBasic: true, textless: true },
    outcome: {
      status: "nearest",
      template: "m15textlessland",
      reason: "each set prints its own textless basic design",
      blockedBy: "4.11",
    },
  },
  {
    key: "borderless/basic/two-bar",
    exactLabel: "Borderless full-art basic land (title bar + type bar)",
    match: { borders: ["borderless"], singleBasic: true, collectors: { fra: [[382, 396]] } },
    outcome: {
      status: "nearest",
      template: "fullartland",
      reason: "this printing's bars are dark, and PipGlyph's are light (owner decision)",
      blockedBy: "4.39",
    },
  },
  {
    key: "borderless/basic",
    exactLabel: "Borderless full-art basic land",
    match: { borders: ["borderless"], singleBasic: true },
    outcome: {
      status: "nearest",
      template: "fullartland",
      reason: "each set prints its own borderless basic design",
      blockedBy: "4.11",
    },
  },
  {
    key: "borderless/textless",
    exactLabel: "Textless borderless frame",
    match: { borders: ["borderless"], textless: true },
    outcome: {
      status: "nearest",
      template: { family: "textless" },
      reason: "PipGlyph's textless frame still has a black ring",
      blockedBy: "4.35",
    },
  },
  {
    key: "borderless/dfc",
    exactLabel: "Borderless double-faced card",
    match: {
      borders: ["borderless"],
      anyOf: [{ layouts: ["transform", "modal_dfc"] }, { effectsAny: DFC_EFFECTS }],
    },
    outcome: {
      status: "nearest",
      template: { family: "borderless" },
      reason: "PipGlyph doesn't have the borderless double-faced frames yet",
      blockedBy: "5.7",
    },
  },
  {
    key: "borderless/planeswalker",
    exactLabel: "Borderless planeswalker",
    match: { borders: ["borderless"], kinds: ["planeswalker"] },
    outcome: {
      status: "nearest",
      template: "m15pw",
      reason: "PipGlyph doesn't have the borderless planeswalker frame yet",
      blockedBy: "4.33",
    },
  },
  {
    key: "borderless/land",
    exactLabel: "Borderless land",
    match: { borders: ["borderless"], kinds: ["land"] },
    outcome: {
      status: "nearest",
      template: "m15land",
      reason: "PipGlyph doesn't have the borderless land frame yet",
      blockedBy: "4.34",
    },
  },
  {
    key: "borderless/layout",
    exactLabel: "Borderless layout card",
    match: {
      borders: ["borderless"],
      anyOf: [
        { kinds: LAYOUT_KINDS },
        { layouts: UNMODELLED_LAYOUTS },
        { subtypesAny: UNMODELLED_SUBTYPES },
      ],
    },
    outcome: {
      status: "nearest",
      template: { family: "borderless" },
      reason: "PipGlyph doesn't have the borderless layout frames yet",
      blockedBy: "4.38",
    },
  },
  {
    key: "borderless/token",
    exactLabel: "Borderless token",
    match: { borders: ["borderless"], kinds: ["token"] },
    outcome: {
      status: "nearest",
      // The bordered 2014–19 arch the printing's type words and text pick
      // (archTokenFrame): the artifact dress for a Treasure, the text box
      // for a token that prints text (4.49 (b), owner decision 5) — never
      // its text on the textless arch's scrim.
      template: { family: "m15" },
      reason: "PipGlyph doesn't have the borderless token frame yet",
      blockedBy: "4.37",
    },
  },
  ...withGaps(
    {
      key: "borderless/standard",
      exactLabel: "Borderless frame",
      match: { borders: ["borderless"] },
      outcome: { status: "exact", template: { family: "borderless" } },
    },
    ["etched", "nickname", "crown", "nyx", "vehicle", "colour-indicator", "two-colour", "two-colour-hybrid", "light-box"],
  ),

  // --- 1.19 steps 3–7: the other full-art and textless printings ----------
  {
    key: "japan-showcase",
    exactLabel: "Japan showcase",
    match: { promosAny: ["japanshowcase"] },
    outcome: {
      status: "nearest",
      template: { family: "m15" },
      reason: ({ border }) =>
        border === "white"
          ? "PipGlyph doesn't have the Japan showcase frame or a white border yet"
          : "PipGlyph doesn't have the Japan showcase frame yet",
      blockedBy: "4.36",
    },
  },
  {
    key: "token/old-frame",
    exactLabel: ({ frame }) => `${frame} frame token`,
    match: { frames: ["1997", "2003"], kinds: ["token"] },
    outcome: {
      status: "nearest",
      template: { family: "m15" },
      reason: "PipGlyph has no token frame for this border era yet",
      blockedBy: "4.43",
    },
  },
  // --- 1.23: the 2015-frame tokens ------------------------------------------
  // WOE's Role cards (TWOE #15–17, TWOC #1–2, plst TWOE-17) are Scryfall's
  // `flip` layout: two Roles, one upside down. The import takes the front
  // Role on the token kind (the owner's override of 1.21's B2, for Roles
  // only) and logs the printing; no two-Role layout is planned (4.51).
  {
    key: "token/role",
    exactLabel: "Role token card (two Roles, one upside down)",
    match: { kinds: ["token"], layouts: ["flip"] },
    outcome: {
      status: "unsupported",
      template: { family: "m15" },
      reason: "PipGlyph doesn't make a card with two Roles; the import takes the front Role",
    },
  },
  // Token types the token frames don't print (logged for 1.6): "Token
  // Planeswalker — Jace" (TFRA #5, loyalty abilities), "Token Land" (TDSK
  // #16, TECL #11) and "Token Land Creature" (TBRO #3, TM3C #19, TFRA #9).
  {
    key: "token/other-type",
    exactLabel: ({ facts }) =>
      facts.cardTypes.has("planeswalker") ? "Planeswalker token" : "Land token",
    match: { kinds: ["token"], typeWordsAny: ["planeswalker", "land"] },
    outcome: {
      status: "nearest",
      template: { family: "m15" },
      reason: ({ facts }) =>
        facts.cardTypes.has("planeswalker")
          ? "PipGlyph's token frames don't print a planeswalker token's loyalty yet"
          : "PipGlyph's token frames don't print a land token yet",
    },
  },
  // Every token from Core Set 2020 on wears the full-art token design, which
  // PipGlyph doesn't draw yet (4.48): the 2014–19 arch (m15token, or the
  // artifact arch for an Artifact) is the nearest. Once 4.48's templates are
  // verified this rule names them instead (`onceVerified`) and becomes exact
  // with these gaps; until then a gap only names the item that finishes the
  // match. The earlier 2015-frame tokens ARE the arch: era/2015, exact.
  ...withGaps(
    {
      key: "token/m20",
      exactLabel: "M20 full-art token frame",
      match: { frames: ["2015"], kinds: ["token"], m20Design: true },
      outcome: {
        status: "nearest",
        template: { family: "m15" },
        reason: "PipGlyph doesn't have the current full-art token frame yet",
        blockedBy: "4.48",
      },
    },
    ["nyx-dress", "border", "crown", "two-colour", "two-colour-hybrid"],
  ),
  {
    key: "fullart/basic/coloured-border",
    exactLabel: "Full-art basic land with a coloured border",
    match: { fullArt: true, singleBasic: true, borders: ["yellow", "white", "silver", "gold"] },
    outcome: {
      status: "nearest",
      template: "m15fullartland",
      reason: ({ border }) => `PipGlyph doesn't print a ${border} border yet`,
      blockedBy: "4.30",
    },
  },
  {
    key: "fullart/basic/per-set",
    exactLabel: ({ card, set }) => `${card.set_name ?? set.toUpperCase()} full-art basic land`,
    match: {
      fullArt: true,
      singleBasic: true,
      anyOf: [
        { sets: PER_SET_BASIC_SETS },
        { collectors: { unf: [[486, 490]] } },
        { frames: ["1997"] },
        { collectorIds: { plst: ["UGL-84", "UNH-139"] } },
      ],
    },
    outcome: {
      status: "nearest",
      template: "m15fullartland",
      reason: "this set prints its own full-art basic design",
      blockedBy: "4.11",
    },
  },
  {
    key: "fullart/basic/split-bar/2003",
    exactLabel: "Zendikar full-art basic land (2003 frame)",
    match: { fullArt: true, singleBasic: true, sets: SPLIT_BAR_BASIC_2003_SETS },
    outcome: {
      status: "nearest",
      template: "m15fullartland",
      reason: "PipGlyph doesn't have the split-bar full-art basic or the 2003 border yet",
      blockedBy: "4.43",
    },
  },
  {
    key: "fullart/basic/split-bar",
    exactLabel: "Zendikar-style full-art basic land (split type bar)",
    match: { fullArt: true, singleBasic: true, sets: SPLIT_BAR_BASIC_SETS },
    outcome: {
      status: "nearest",
      template: "m15fullartland",
      reason: "PipGlyph doesn't have the split-bar full-art basic yet",
      blockedBy: "4.40",
    },
  },
  {
    key: "fullart/basic/plain-bar",
    exactLabel: "Full-art basic land (plain type bar)",
    match: { fullArt: true, singleBasic: true, sets: PLAIN_BAR_BASIC_SETS },
    outcome: {
      status: "nearest",
      template: "m15fullartland",
      reason: "PipGlyph doesn't have the plain-bar full-art basic yet",
      blockedBy: "4.41",
    },
  },
  {
    key: "fullart/basic/2022/older-bars",
    exactLabel: "Full-art basic land (2023 bars)",
    match: { fullArt: true, singleBasic: true, sets: FULL_ART_BASIC_OLDER_BARS },
    outcome: {
      status: "nearest",
      template: "m15fullartland",
      reason: "the 2023 printings place their bars a little differently",
      blockedBy: "4.39",
    },
  },
  {
    key: "fullart/basic/2022",
    exactLabel: "Full-art basic land",
    match: { fullArt: true, singleBasic: true, sets: [...FULL_ART_BASIC_2022_SETS] },
    outcome: { status: "exact", template: "m15fullartland" },
  },
  {
    key: "fullart/basic",
    exactLabel: "Full-art basic land",
    match: { fullArt: true, singleBasic: true },
    outcome: {
      status: "nearest",
      template: "m15fullartland",
      reason: "this printing's full-art basic design isn't in PipGlyph yet",
      blockedBy: "4.39",
    },
  },
  {
    key: "textless/trk-lcars",
    exactLabel: "Star Trek LCARS textless land",
    match: { textless: true, collectors: { trk: [[392, 401], [487, 496]] } },
    outcome: {
      status: "unsupported",
      template: { family: "m15" },
      reason: "the LCARS lands are a one-off design",
    },
  },
  {
    key: "textless/2015",
    exactLabel: "Black-bordered textless promo",
    match: { frames: ["2015"], textless: true, notKinds: ["token"] },
    outcome: {
      status: "nearest",
      template: { family: "textless" },
      reason: "PipGlyph doesn't have the black-bordered textless promo frame yet",
      blockedBy: "4.42",
    },
  },
  // The 2003-frame textless promos (Player Rewards P05–P11, e.g. Wrath of
  // God P07 #1) name the verified 2003 frame as their nearest until the
  // textless frame is verified in their colour, then the textless frame,
  // whose no-box layout fits their tall 619×808 art_crop (owner decision A9,
  // 2026-09-29; withVerification makes the swap).
  {
    key: "textless/old-frame",
    exactLabel: "2003 frame textless promo",
    match: { frames: ["2003"], textless: true, notKinds: ["token"] },
    outcome: {
      status: "nearest",
      template: { family: "modern" },
      onceVerified: { family: "textless" },
      reason: "PipGlyph doesn't have this old-frame textless design yet",
      blockedBy: "4.43",
    },
  },
  {
    key: "textless/future",
    exactLabel: "Future Sight textless frame",
    match: { frames: ["future"], textless: true, notKinds: ["token"] },
    outcome: {
      status: "nearest",
      template: { family: "textless" },
      reason: "PipGlyph doesn't have this old-frame textless design yet",
      blockedBy: "4.43",
    },
  },
  {
    key: "fullart/one-off",
    exactLabel: "Full-art one-off",
    match: { fullArt: true, notKinds: ["token"] },
    outcome: {
      status: "nearest",
      template: { family: "m15" },
      reason: "full-art one-off",
    },
  },

  // --- Look-alikes that are never full art --------------------------------
  {
    key: "showcase/znr/hedron",
    exactLabel: "Zendikar Rising showcase (hedron)",
    match: { collectors: { znr: [[290, 313]] } },
    outcome: { status: "exact", template: "fullart" },
  },
  {
    key: "expedition",
    exactLabel: "Zendikar Expedition",
    match: { setTypes: ["masterpiece"], sets: ["zne", "exp"] },
    outcome: { status: "exact", template: "expeditionland" },
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
    ["layout", "dfc", "etched", "border", "crown", "vehicle", "two-colour", "two-colour-hybrid"],
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
    // A crowned adventure (WOE #220 Beluna, 56 printings) and a two-colour
    // saga (KHM #201, 84) print pieces the layout frames don't draw yet
    // (TODO 4.6.0; 4.6f adds them).
    ["omen", "dfc", "etched", "border", "crown", "two-colour", "two-colour-hybrid"],
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
 *   1. the kind — a frame that can't dress this kind of card (a Snow
 *      ARTIFACT on the snow frame; an Omen on the draconic frame), or a frame
 *      the kind borrows for a type the card isn't (Nyx on a creature that
 *      isn't an Enchantment Creature, owner decision A3), is at best
 *      `nearest`, and the import lands on the kind's standard (`landOn`);
 *   2. the border — a template whose border isn't true yet (4.35, and 7.7's
 *      edge contract: isBorderPending, owner decision A8) is capped at
 *      `nearest`;
 *   3. the art — an edge-to-edge frame lands on its bordered equivalent,
 *      because Scryfall's art_crop is the 626×457 window (1.18's owner
 *      decision). That holds on `full_art` borderless printings too, so the
 *      flag doesn't exempt them: measured 2026-09-28, FRA #382, CMM #702,
 *      SPG #119 and TLE #1 crop to 626×457 and MH3 #326 to 571×460 (the
 *      taller full-art crops are the black-bordered basics' and UNF's).
 */
export function resolveFrameSignature(card: ScryfallCard, facts: PrintingFacts): FrameMatch {
  const ctx = contextOf(card, facts);
  const templateOf = (candidate: Rule): FrameTemplate => {
    const spec = candidate.outcome.template;
    return typeof spec === "string" ? spec : FAMILIES[spec.family].pick(ctx);
  };
  // A gap rule is no gap where the frame it lands on draws that piece (the
  // crown, a two-colour dress — gapDrawnBy): the next rule decides.
  const rule =
    FRAME_SIGNATURE_RULES.find(
      (candidate) =>
        matches(candidate.match, ctx) &&
        !(candidate.gaps && gapDrawnBy(candidate.gaps[0], templateOf(candidate))),
    ) ?? FRAME_SIGNATURE_RULES[FRAME_SIGNATURE_RULES.length - 1];
  const template = templateOf(rule);

  let status = rule.outcome.status;
  let reason = status === "exact" ? null : textOf(rule.outcome.reason, ctx);
  let blockedBy = rule.outcome.blockedBy;
  let landOn: FrameTemplate | undefined;

  const kind = facts.kind;
  const misfit = kind ? kindMisfit(template, kind, ctx) : null;
  if (misfit) {
    landOn = kindFallback(ctx);
    reason = reason ? `${reason}; ${misfit}` : misfit;
    if (status === "exact") status = "nearest";
  }

  if (status === "exact" && isBorderPending(template, colorKeyOf(facts))) {
    status = "nearest";
    reason = `PipGlyph's ${describeFrame(template)} frame doesn't have the printed border yet`;
    blockedBy = "4.35";
  }

  if (!landOn && artReachesCardEdge(getFrameProfile(template))) {
    landOn = BORDERED_EQUIVALENT[template] ?? kindFallback(ctx);
  }

  // The frame named instead once verified: only one that dresses this card
  // as it stands, on no other frame (no kind or edge landing to redo).
  const laterSpec = rule.outcome.onceVerified;
  const later = laterSpec
    ? typeof laterSpec === "string"
      ? laterSpec
      : FAMILIES[laterSpec.family].pick(ctx)
    : undefined;
  const onceVerified =
    later &&
    later !== template &&
    !landOn &&
    !(kind && kindMisfit(later, kind, ctx)) &&
    !artReachesCardEdge(getFrameProfile(later))
      ? later
      : undefined;

  // Every anatomy gap that holds: the matched gap rule's own, then the
  // base's later ones (FrameMatch.gaps).
  const gaps = rule.gaps
    ? rule.gaps.filter(
        (gap, index) => (index === 0 || matches(GAPS[gap].match, ctx)) && !gapDrawnBy(gap, template),
      )
    : [];

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
    ...(onceVerified ? { onceVerified } : {}),
    ...(gaps.length > 0 ? { gaps } : {}),
  };
}

/** True when `template` draws the anatomy a gap names — its PROFILES entry
 *  declares the crown overlay or the two-colour dress (lib/cards/anatomy.ts,
 *  TODO 4.6.0): each gap drops where the landing frame draws it, with
 *  nothing to keep in step here (4.6b: the pairs on m15, m15artifact and
 *  m15land; the crown is 4.6a's). */
function gapDrawnBy(gap: GapKey, template: FrameTemplate): boolean {
  switch (gap) {
    case "crown":
      return frameAnatomyOf(template).crown;
    case "two-colour":
      return frameAnatomyOf(template).twoColor.includes("split");
    case "two-colour-hybrid":
      return frameAnatomyOf(template).twoColor.includes("hybrid");
    default:
      return false;
  }
}

/** Why `template` can't dress this printing's kind, or null when it can: a
 *  frame whose kind restriction leaves the kind out, a basic-only frame on
 *  anything but one basic land, or a frame the kind borrows from another
 *  type (the artifact frame, Nyx) on a card whose type line doesn't say it. */
function kindMisfit(template: FrameTemplate, kind: CardKind, ctx: Ctx): string | null {
  const { facts } = ctx;
  if (!templateSupportsKind(template, kind) || (templateIsBasicOnly(template) && !facts.singleBasic)) {
    return `PipGlyph's ${describeFrame(template)} frame doesn't dress ${kindWord(kind)} yet`;
  }
  const word = borrowedTypeWord(kind, template);
  if (word && !facts.cardTypes.has(word.toLowerCase() as CardType)) {
    const label = KIND_DEFS[kind].label.toLowerCase();
    return `PipGlyph's ${describeFrame(template)} frame dresses a ${label} only when it is an ${word.toLowerCase()}`;
  }
  return null;
}

/** The frame colour key the creator verifies this printing in — the facts'
 *  colours through pickFrameColorKey's rule (none → c, one → its letter,
 *  two or more → m). */
function colorKeyOf(facts: PrintingFacts): string {
  if (facts.colors.length === 0) return "c";
  if (facts.colors.length > 1) return "m";
  return facts.colors[0]!.toLowerCase();
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
