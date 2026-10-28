import type { ScryfallCard } from "@/lib/scryfall/client";
import type { DfcImportBlock, DfcImportFacts } from "@/lib/scryfall/import-mapper";
import {
  FRAME_TEMPLATE_VALUES,
  type CardType,
  type FrameEra,
  type FrameTemplate,
} from "@/types/card";
import {
  KIND_DEFS,
  borrowedTypeWord,
  dfcFrontDressesKind,
  isEnchantmentDress,
  subtypeDressOf,
  subtypeFrameFits,
  templateIsBasicOnly,
  templateSupportsKind,
  walkerRowCount,
  walkerRowsFrameFor,
  type CardKind,
} from "@/lib/creator/card-kinds";
import { standardFrameFor } from "@/lib/creator/frame-picker";
import { describeFrame } from "@/lib/creator/frame-resolve";
import { artReachesCardEdge, getFrameProfile } from "@/lib/cards/template-layout";
import { frameAnatomyOf, twoColorDressOf } from "@/lib/cards/anatomy";
import { templateHasBackFace } from "@/lib/cards/dfc";
import { isArchTallTokenTemplate, isM20NyxTokenTemplate, m20TokenTemplate, m20TokenTwinWithoutNyx, tokenHeightForText } from "@/lib/cards/token-height";

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
  /** What the match says once `onceVerified` takes over, when that differs
   *  from the answer before it: the M20 token design (TODO 1.23 / 4.48) is
   *  `nearest` on the 2014–19 arch until its own template is verified in the
   *  card's colour, then `exact` on it — or `nearest` for a gap the full-art
   *  template doesn't draw either (the crown, two colours, the Nyx dress),
   *  its reason, item and gaps (C1 applies: it is the printing's own frame
   *  by then). withVerification applies it with the swap. Absent: the
   *  swap keeps the status, reason and item (a 2003-frame textless promo,
   *  A9: nearest either way). */
  onceVerifiedMatch?: {
    status: FrameMatchStatus;
    reason: string | null;
    blockedBy?: string;
    gaps?: readonly FrameGap[];
  };
  /** The frame the import LANDS on instead once it is verified in the card's
   *  colour, the match still naming the printing's own frame (`template`)
   *  and still `nearest`: a borderless or extended-art Vehicle prints the
   *  brown plate on a dress PipGlyph has no Vehicle plate for, and lands on
   *  the silver artifact frame until the bordered Vehicle frame is verified
   *  in its colour, then on that (TODO 4.5c, owner 2026-10-12, round 48).
   *  Only ever a stand-in landing's replacement: withVerification
   *  (lib/creator/frame-resolve.ts) leaves a printing on its OWN frame where
   *  that one is verified in the colour and its art fits it. `reason` is
   *  what the match says after the swap — null keeps the reason it had (a
   *  gap named before the plate: the nickname line). `overOwnFrame`: the
   *  landing replaces the printing's own frame too, verified or not — the
   *  station frame's stand-in (TODO 4.27a step 2, owner Round 66): the
   *  extended-art frame draws a Spacecraft's tiers as plain lines, so a
   *  verified `extendedart` is no landing for one. */
  landOnOnceVerified?: { template: FrameTemplate; reason: string | null; overOwnFrame?: true };
  /** The frame named once verified when `onceVerified` itself isn't yet,
   *  with what the match is there (TODO 4.51): an M20+ Nyx token names the
   *  Nyx dress of its full-art template; until that dress is verified in
   *  the card's colour the plain full-art template stands in where IT is —
   *  nearest, the starfield its gap — as it did before the dress existed.
   *  withVerification applies it only when `onceVerified` isn't verified. */
  onceVerifiedFallback?: {
    template: FrameTemplate;
    match: NonNullable<FrameMatch["onceVerifiedMatch"]>;
  };
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
  /** The second face's card type (the back of a transform / modal printing,
   *  the second half of a two-part layout), or undefined with one face. */
  backType: CardType | undefined;
  /** The second face's subtypes ("Vehicle" on a BOT back). */
  backSubtypes: readonly string[];
  /** Where a transform / modal printing lands (TODO 5.4, the mapper's
   *  dfcImportOf): the bodies each face wears, or what blocks the landing;
   *  null for any other layout. */
  dfc: DfcImportFacts | null;
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

/** Zendikar-style split type bar with a centred medallion (4.40), by look —
 *  each checked on every printing (Scryfall PNGs, 2026-10-14):
 *  the stone ring (`m15fullartlandzen`'s own: 52 printings), */
const SPLIT_BAR_STONE_BASIC_SETS = ["bfz", "ogw", "akh", "hou", "znr"] as const;
/** …the same design with snow-covered bars, "Basic Snow Land" (MH1 #250–254), */
const SPLIT_BAR_SNOW_BASIC_SETS = ["mh1"] as const;
/** …the white ring round the art, no stone (`m15fullartlandsnc`'s own: SNC
 *  #272–281), */
const SPLIT_BAR_RING_BASIC_SETS = ["snc"] as const;
/** …BRO's (#278–287): the art to the black border with no ring and the bars
 *  ~80 px lower, */
const SPLIT_BAR_BRO_BASIC_SETS = ["bro"] as const;
/** …and Innistrad's dark "Eternal Night" bars on the ring's shape (MID
 *  #268–277, VOW #268–277 and #408–412). */
const SPLIT_BAR_DARK_BASIC_SETS = ["mid", "vow"] as const;
/** The same design on the 2003 frame (4.40 on 4.43's border). */
const SPLIT_BAR_BASIC_2003_SETS = ["zen", "j14"] as const;
/** A title bar and a plain "Basic Land — Plains" bar, no symbol (4.41;
 *  `m15fullartlandthb`'s own: 31 printings). */
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

/** Nyx printings whose frame is their own, not the starfield of their
 *  colour key (the "nyx-own-frame" gap; owner decision 4, Round 56):
 *  Faceless One, CLB #1 — a tan frame on a colourless card. */
export const NYX_OWN_FRAME_PINS: Readonly<Record<string, readonly string[]>> = {
  clb: ["1"],
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

/** What each pinned tall-box printing wears on the tall box (TODO 4.55,
 *  measured 2026-10-18): the template — the artifact dress for the Clues —
 *  and the colour key. Read by the request log (legacyTallBoxAnswered): a
 *  row logged as `era/2015+tall-box` before 4.55 is answered once the tall
 *  box is verified in every colour its set's pins print. A unit test holds
 *  it to TALL_BOX_TOKEN_PINS key for key. */
export const TALL_BOX_TOKEN_PIN_COMBOS: Readonly<Record<string, Readonly<Record<string, readonly [FrameTemplate, string]>>>> = {
  takh: { "1": ["m15tokentall", "w"], "5": ["m15tokentall", "w"], "6": ["m15tokentall", "w"], "12": ["m15tokentall", "w"], "15": ["m15tokentall", "w"] },
  thou: { "2": ["m15tokentall", "b"], "3": ["m15tokentall", "b"], "4": ["m15tokentall", "b"], "6": ["m15tokentall", "b"] },
  tc18: { "4": ["m15tokentall", "w"], "10": ["m15tokentall", "r"], "19": ["m15tokenartifacttall", "c"] },
  tsoi: Object.fromEntries(["11", "12", "13", "14", "15", "16"].map((n) => [n, ["m15tokenartifacttall", "c"] as const])),
  tdom: { "7": ["m15tokentall", "b"] },
  trix: { "1": ["m15tokentall", "r"] },
  tust: { "18": ["m15tokenartifacttall", "c"] },
};

/** Whether a request-log row logged as `era/2015+tall-box` (before TODO 4.55
 *  drew the tall box) is answered today: its set's pinned printings import
 *  EXACT on the tall box — the tall box is verified in every colour (and
 *  dress) that set's pins print. Rows are per signature and set, so the
 *  set's combos decide (TC18: white, red and the Clue's colourless artifact
 *  dress). Any other signature, or a set with no pin: false. */
export function legacyTallBoxAnswered(signature: string, setCode: string | null | undefined, verifiedKeys: ReadonlySet<string>): boolean {
  if (signature !== "era/2015+tall-box" || !setCode) return false;
  const pins = TALL_BOX_TOKEN_PIN_COMBOS[setCode.toLowerCase()];
  if (!pins) return false;
  return Object.values(pins).every(([template, colour]) => verifiedKeys.has(`${template}/${colour}`));
}

/** Borderless nonbasic lands that print the SPELLS' look — the colour's
 *  title bar over a DARK type bar and text box, m15borderless's master —
 *  not the tinted type bar and box of 4.34's m15borderlessland. Scryfall
 *  can't tell the two apart (both carry `inverted`), so they are pinned:
 *  every borderless nonbasic land the registry resolved `exact` (117
 *  printings, Scryfall 2026-09-29) was read against its print by eye (31
 *  are dark), plus the two-colour runs of the sets that print the dark look
 *  throughout (ACR, WOE: a grey title bar over a dark type bar and box —
 *  re-read on 2026-10-06 for 4.56, type-bar luminance 16–70 against the
 *  title bar's 103–157). FRA #397–401 left this list with 4.56: their type
 *  bar is the title bar's grey and only the box is dark
 *  (BORDERLESS_LAND_SHADOW_BOX_PINS). Not pinned: the crowned and
 *  nicknamed LTC / LTR / HOC lands, most of them dark too — their crown and
 *  nickname gaps already make them `nearest` (4.6 / 6.3 re-check them). */
export const BORDERLESS_LAND_DARK_PINS: Readonly<Record<string, readonly string[]>> = {
  acr: ["111", "112", "114", "115", "116"],
  eoe: ["316"],
  fic: ["462"],
  fra: ["379"],
  hob: ["207"],
  hoc: ["8", "97"],
  lci: ["410a", "410b", "410c", "410d", "410e", "410f"],
  pmei: ["2026-13"],
  sld: ["914", "917", "1994", "2310", "2626", "2652", "2699", "2818", "7063", "7064", "7067", "7097", "7104"],
  tdm: ["393", "394", "395", "396", "397"],
  woe: ["303", "304", "305", "306", "307"],
};

/** Borderless nonbasic lands that print a third look: the colour's title
 *  bar and TINTED text box of 4.34's m15borderlessland, but a DARK type bar
 *  between them (a black gradient under the colour's pinline). Found by the
 *  second skeptic pass (2026-09-29), reading the title, type and box bands
 *  of every `exact` borderless nonbasic land side by side: Roiling Canopy
 *  FRA #380, Theorist's Sanctum FRA #381 (both had been references), Path
 *  of Ancestry SLD #250, Command Tower SLD #1989, Mystic Sanctuary SLD
 *  #2143 and the bonus Rogue's Passage SLD #7112. Pinned like the others:
 *  Scryfall carries `inverted` on all three looks. */
export const BORDERLESS_LAND_DARK_TYPE_BAR_PINS: Readonly<Record<string, readonly string[]>> = {
  fra: ["380", "381"],
  sld: ["250", "1989", "2143", "7112"],
};

/** Borderless nonbasic lands that print the SHORT text box (4.37's short
 *  and mid boxes: the type bar at ~70 %H, not 56 %H) among the ones the
 *  registry resolved `exact` (checked by eye, 2026-09-29): the SNC triomes
 *  and SLD #469–472 — and, since the two-colour gap closed (TODO 4.56,
 *  read by eye and measured 2026-10-06: the type bar's top ring about 1459
 *  of 2100 px down, the regular box's at 1175), the 25 two-colour ones:
 *  Unfinity's shock lands (#277–286 and their galaxy-foil twins #528–537,
 *  which print dark bars too) and the Secret Lair check lands SLD #456–460. */
export const BORDERLESS_LAND_SHORT_BOX_PINS: Readonly<Record<string, readonly string[]>> = {
  snc: ["291", "292", "293", "294", "295"],
  sld: ["456", "457", "458", "459", "460", "469", "470", "471", "472"],
  unf: [
    "277", "278", "279", "280", "281", "282", "283", "284", "285", "286",
    "528", "529", "530", "531", "532", "533", "534", "535", "536", "537",
  ],
};

/** Borderless nonbasic lands that print a FOURTH look, 2025's: the title
 *  and type bars of the land (grey on a two-colour land), the split pinline
 *  — and a SEE-THROUGH text box with a dark shadow behind the text (a soft
 *  glow in the frame's colours at its rim, a smoky centre), where 4.34's
 *  master and 4.56's pair masters draw a flat tinted box. Found reading
 *  the title, type and box bands of all 192 two-colour borderless nonbasic
 *  lands side by side before the two-colour gap closed (TODO 4.56, Scryfall
 *  2026-10-06): every two-colour run released from Tarkir: Dragonstorm's
 *  Special Guests on — the SPG fetch lands #109–118, the ECL shock lands
 *  #347–351, SOS #301–305, MSH #380–384, the Secret Lair SLD #2440 — and
 *  FRA #397–401, pinned as "dark" until 4.56 (their type bar is the title
 *  bar's grey: luminance 104–150 on the 31, where ACR and WOE's dark type
 *  bars read 16–70). The box's centre reads half as bright as its edges on
 *  them (median 0.5; luminance 12–45 on SPG, ECL, SOS and FRA) against as
 *  bright (1.1; 48–128) on the 119 that print the flat tinted box. No
 *  Scryfall field tells the looks apart (`inverted` on all of them). Two
 *  prints on a SINGLE master — both five-colour lands on the gold `m` —
 *  wear the same box and still resolve exact, the owner's call:
 *  Multiversal Passage SPM #206 and Avengers Tower MSH #334, `m`'s second
 *  reference (4.37; the only exact ones among the 87 printings on this
 *  rule released since 2025-04 beside FIN #355, which prints the flat
 *  box). The four lists are held to a census fixture
 *  (tests/unit/scryfall/borderless-land-census.test.ts): a pin added or
 *  removed here changes it. */
export const BORDERLESS_LAND_SHADOW_BOX_PINS: Readonly<Record<string, readonly string[]>> = {
  ecl: ["347", "348", "349", "350", "351"],
  fra: ["397", "398", "399", "400", "401"],
  msh: ["380", "381", "382", "383", "384"],
  sld: ["2440"],
  sos: ["301", "302", "303", "304", "305"],
  spg: ["109", "110", "111", "112", "113", "114", "115", "116", "117", "118"],
};

/** Posters Scryfall doesn't flag `poster`: The Lonely Mountain HOB #284 is
 *  the surge-foil twin of HOB #248's artist-lettered book cover (checked by
 *  eye 2026-09-29), which carries the promo type. */
const UNFLAGGED_POSTER_PINS: Readonly<Record<string, readonly string[]>> = {
  hob: ["284"],
};

/** The mono-black borderless planeswalkers that print Card Conjurer's
 *  light black dress — light grey name and type bars with dark ink, the
 *  m15borderlesspw / m15borderlesspwtall `b` masters (4.33). Most black
 *  borderless walkers print dark bars with white ink instead (M21 #282, DMU
 *  #373, VOW #278, INR #322, FDN #359, FRA #303, 2X2 #333, WOE #297, SOS
 *  #282; checked by eye on the Scryfall scans 2026-09-29), and no Scryfall
 *  field tells them apart (`inverted` doesn't: FDN #359 and M21 #282 carry
 *  none), so the light ones are pinned and every other mono-black walker is
 *  the `dark-bars` gap. Every mono-black borderless walker's title ink was
 *  checked on the scans (2026-09-29): these six print dark ink on light
 *  bars. BLC #78 is NOT one — its dark bars print white ink over pale art,
 *  so they only look light. SLD #1593 is the nickname gap's either way. */
export const LIGHT_BLACK_WALKER_PINS: Readonly<Record<string, readonly string[]>> = {
  afr: ["284"],
  stx: ["276"],
  cmr: ["512"],
  med: ["RA3", "GR2"],
  sld: ["1593"],
};

/** Vehicles on the plain 2015 frame that do NOT print the brown plate with
 *  white digits (TODO 4.5c; owner 2026-10-12: the silver plate is not
 *  offered): Dominaria's Weatherlight — the bronze frame with a SILVER plate
 *  and dark digits, the one exception among the plain Vehicle prints read
 *  (KLD 2016 → 2026; DOM #237, its prerelease stamp and its List reprint
 *  are the same plate). They stay off `vehicle/2015`: the Vehicle frame is
 *  never "exact" for them, and the import lands where it did before the
 *  frame shipped (the artifact frame, `nearest`, the `vehicle` gap). */
export const SILVER_PLATE_VEHICLE_PINS: Readonly<Record<string, readonly string[]>> = {
  dom: ["237"],
  pdom: ["237s"],
  plst: ["DOM-237"],
};

/** Borderless planeswalkers outside mono-black that print the dark dress —
 *  dark name and type bars with white ink — with no `inverted` flag: the
 *  SDCC 2019 Nicol Bolas, Dragon-God (PS19 #207, gold rims). Found by a
 *  title- and type-bar luminance sweep of every borderless walker scan,
 *  checked by eye (4.33 skeptic, 2026-09-29). */
export const DARK_BAR_WALKER_PINS: Readonly<Record<string, readonly string[]>> = {
  ps19: ["207"],
};

/** Borderless planeswalkers whose PRINTED ability box is not the one their
 *  rows pick (walkerRowCount, TALL_WALKER_MIN_ROWS): Gideon Blackblade MED
 *  #WS2 sets its two statics in two rows on the tall box, Comet, Stellar
 *  Pup UNF #275 / #526 its die-roll table on the tall box, and Nicol Bolas,
 *  Dragon-God PS19 #207 four rows (a static + three abilities) on the
 *  regular one. The type-bar height of every borderless walker scan was
 *  checked against the pick (4.33 skeptic, 2026-09-29): 206 of the 210 the
 *  borderless/planeswalker rule matches print the box it picks; these four
 *  don't. The creator follows the rows (no pick to pin), so they are
 *  `nearest`, never a pinned box. */
export const WALKER_ROW_BOX_PINS: Readonly<Record<string, readonly string[]>> = {
  med: ["WS2"],
  unf: ["275", "526"],
  ps19: ["207"],
};

/** Borderless planeswalkers that letter the card's name across the art in
 *  place of a name bar (Secret Lair: Tezzeret the Seeker SLD #1619, Nicol
 *  Bolas, Planeswalker SLD #1622) — no Scryfall field says so (no `poster`
 *  promo, no frame effect). */
export const LETTERED_NAME_WALKER_PINS: Readonly<Record<string, readonly string[]>> = {
  sld: ["1619", "1622"],
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

/** Layouts PipGlyph has no layout for yet; they import as a standard kind.
 *  (`prepare` left with TODO 4.27: its printings are the Prepare kind — but
 *  a TEXTLESS one, FRA #402 / SOS #306, keeps the creature kind on the
 *  textless frames, whose own gap names it, as on main.) */
const UNMODELLED_LAYOUTS = ["class", "case", "leveler", "prototype", "mutate", "meld", "host", "augment"] as const;
const UNMODELLED_SUBTYPES = ["Room", "Class", "Case"] as const;

/** The templates whose border isn't true yet, capped at `nearest` so
 *  verifying one can never make it exact:
 *   • a transparent outer ring plus an inset art slot that bakes a flat
 *     #101015 "border" (TODO 4.35): bloomanime (battle left the list with
 *     TODO 4.21b, and lotrscroll and tarkirdragon with TODO 4.11: their Card
 *     Conjurer masters have the printed black border — and tarkirghostfire
 *     with 4.11's layout v68: the ring MSE paints at render time is painted
 *     under its masters);
 *   • a transparent outer band at the bottom and lower sides, found by 7.7's
 *     edge contract (owner decision A8, 2026-09-29): avatar, bloomburrow
 *     (lotr left with TODO 4.11: Card Conjurer's 'Ring' masters are opaque
 *     to every edge — the frame field's design edges and the black border's
 *     shoulders; and tarkirdraconic with v68, its border painted the same
 *     way).
 *  Each is a known failure in lib/frames/edge-contract.ts; a test holds the
 *  two lists together, so fixing a master (and striking it from the known
 *  failures) lifts its cap here too. */
export const BORDER_PENDING_TEMPLATES: ReadonlySet<FrameTemplate> = new Set<FrameTemplate>([
  // (bloomanime left with TODO 4.11 / 4.35's layout v70: one master in
  // print's look, its footer drawn, full-bleed art. None today.)
]);

/** Single colour masters whose border isn't true yet (owner decision A8).
 *  None today: expeditionland's black and green, where the black flood fill
 *  leaked through the MSE master's dark stone (4.35 (3)), left with TODO
 *  4.11 wave 1 — Card Conjurer's masters print the black border on every
 *  colour. */
export const BORDER_PENDING_COLOURS: ReadonlyMap<FrameTemplate, ReadonlySet<string>> = new Map<
  FrameTemplate,
  ReadonlySet<string>
>([]);

/** True when `template`'s border isn't true yet in this colour key. */
export function isBorderPending(template: FrameTemplate, colorKey: string): boolean {
  return (
    borderPending.templates.has(template) ||
    Boolean(borderPending.colours.get(template)?.has(colorKey))
  );
}

/** What isBorderPending reads: the two tables above, unless a test swaps
 *  them (setBorderPendingForTests). */
let borderPending: {
  templates: ReadonlySet<FrameTemplate>;
  colours: ReadonlyMap<FrameTemplate, ReadonlySet<string>>;
} = { templates: BORDER_PENDING_TEMPLATES, colours: BORDER_PENDING_COLOURS };

/** Tests only: cap these templates / colours as border-pending, so the cap's
 *  paths stay covered while both tables are empty (since the Bloomburrow
 *  anime's layout v70, TODO 4.11 / 4.35). Returns the restore function. */
export function setBorderPendingForTests(
  templates: Iterable<FrameTemplate>,
  colours: ReadonlyMap<FrameTemplate, ReadonlySet<string>> = new Map(),
): () => void {
  const before = borderPending;
  borderPending = { templates: new Set(templates), colours };
  return () => {
    borderPending = before;
  };
}

// ---------------------------------------------------------------------------
// Rule shape
// ---------------------------------------------------------------------------

type Range = readonly [number, number];

/** A declarative match. Every constraint given must hold. */
type Match = {
  /** `frame` in the list ("1993" | "1997" | "2003" | "2015" | "future"). */
  frames?: readonly string[];
  /** The SECOND face's page prints another colour than the card (TODO
   *  4.26's per-part colour; partColourDiffers): a hybrid spell's grey page,
   *  or a spell of other colours. */
  partColourDiffers?: boolean;
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
  /** …and the printings NOT among these. */
  notCollectorIds?: Readonly<Record<string, readonly string[]>>;
  /** The front face's frame colours are exactly these WUBRG letters. */
  colorsExactly?: readonly string[];
  kinds?: readonly CardKind[];
  notKinds?: readonly CardKind[];
  /** The kind is undefined (no card type PipGlyph makes). */
  noKind?: true;
  typeWordsAny?: readonly CardType[];
  subtypesAny?: readonly string[];
  /** Scryfall's `keywords` holds one of these ("Station"), whatever the
   *  case. */
  keywordsAny?: readonly string[];
  layouts?: readonly string[];
  /** Scryfall's `security_stamp` is in the list ("triangle": the
   *  Universes Beyond stamp, TODO 4.25). */
  stamps?: readonly string[];
  /** `full_art`, or the `fullart` frame effect. */
  fullArt?: boolean;
  textless?: boolean;
  /** The printing wears the design M20 introduced (isM20DesignPrinting). */
  m20Design?: boolean;
  /** `released_at` is this day or later ("2021-01-01"); a printing with no
   *  date never matches. */
  releasedFrom?: string;
  /** `released_at` is BEFORE this day; a printing with no date never
   *  matches. */
  releasedBefore?: string;
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
  /** The second face's card type is in the list (a transform printing with
   *  a LAND back). */
  backTypes?: readonly CardType[];
  /** The second face carries one of these subtypes ("Vehicle"). */
  backSubtypesAny?: readonly string[];
  /** A transform / modal printing that does NOT land on the double-faced
   *  bodies for one of these reasons (PrintingFacts.dfc.blocked, TODO 5.4). */
  dfcBlocked?: readonly DfcImportBlock[];
  /** The look of the bodies the printing lands on (PrintingFacts.dfc.look,
   *  TODO 5.7): `bordered` also for a printing that isn't double-faced. */
  dfcLook?: "bordered" | "borderless";
  /** The kind the printing lands on as a double-faced card
   *  (PrintingFacts.dfc.kind): `saga` for a transforming Saga on the
   *  double-faced saga front (TODO 5.5 (b)). */
  dfcKinds?: readonly NonNullable<DfcImportFacts["kind"]>[];
  anyOf?: readonly Match[];
  allOf?: readonly Match[];
};

/** A family of templates picked by kind (and dress). */
type Family = "m15" | "ub" | "borderless" | "modern" | "retro" | "alpha" | "textless" | "extended" | "m20" | "dfc" | "station" | "tokentall";

type TemplateSpec = FrameTemplate | { family: Family };

type Text = string | ((ctx: Ctx) => string);

/** The TODO item that would make a match exact — a string, or a function of
 *  the frame the printing lands on where the item depends on it (the layout
 *  frames' two-colour gap: 4.26's per-part colour on split and aftermath,
 *  4.6f's dress on the rest). The request log resolves it by the logged
 *  row's template (lib/frames/frame-requests.ts signatureBlockedBy). */
export type BlockedBy = string | ((template: FrameTemplate | null) => string);

/** `blockedBy` for the frame a match landed on. */
export function blockedByOn(item: BlockedBy | undefined, template: FrameTemplate | null): string | undefined {
  return typeof item === "function" ? item(template) : item;
}

type Outcome = {
  status: FrameMatchStatus;
  template: TemplateSpec;
  reason?: Text;
  reject?: true;
  forGood?: true;
  blockedBy?: BlockedBy;
  /** FrameMatch.landOn, named by the rule: where the import lands instead
   *  of `template` — a double-faced printing whose colourless face can't
   *  wear its body yet (5.11) is the body's frame, landing on the standard. */
  landOn?: TemplateSpec;
  /** FrameMatch.onceVerified: the frame named instead once verified. */
  onceVerified?: TemplateSpec;
  /** Once `onceVerified` takes over the match is `exact` on it — `nearest`
   *  only for a gap that frame doesn't draw either (FrameMatch
   *  .onceVerifiedMatch; the M20 token design, TODO 4.48). */
  exactOnceVerified?: true;
  /** FrameMatch.landOnOnceVerified: the frame the import lands on once it is
   *  verified, for the printings `match` holds on — `template` stays the
   *  printing's own frame and the status its own. A match whose reason is
   *  `gap`'s (the piece that landing draws) says `reason` after the swap;
   *  one a gap before it named keeps its reason. */
  landOnOnceVerified?: { template: FrameTemplate; match: Match; gap: GapKey; reason: Text; overOwnFrame?: true };
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
  /** The same list on a gap rule whose `nearest` base becomes exact once its
   *  `onceVerified` frame is verified (Outcome.exactOnceVerified): the gaps
   *  the match records after the swap. */
  gapsOnceVerified?: readonly GapKey[];
  /** The item a gap waits on for this family's frames, where it isn't the
   *  gap's own (withGaps' `blockedByOverride`: the token crown is 4.48's pill
   *  crown, not 4.6f; the layout frames' two-colour gap follows the frame
   *  the printing lands on) — named after the swap too. */
  gapBlockedBy?: Partial<Record<GapKey, BlockedBy>>;
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

/** The coloured letters of a cost, and whether any symbol is a two-colour
 *  hybrid ({W/B}; {2/W} and Phyrexian {W/P} are one colour). */
function costColours(cost: string | null | undefined): { letters: Set<string>; hybrid: boolean } {
  const letters = new Set<string>();
  let hybrid = false;
  for (const [, sym] of (cost ?? "").matchAll(/\{([^}]*)\}/g)) {
    const coloured = sym.toUpperCase().split("/").filter((part) => "WUBRG".includes(part) && part.length === 1);
    if (coloured.length >= 2) hybrid = true;
    for (const c of coloured) letters.add(c);
  }
  return { letters, hybrid };
}

/** A two-part printing whose second face's page prints another colour than
 *  the card's frame (TODO 4.26's per-part colour). Print colours the Prepare
 *  page by its SPELL (SOS #170 Abigale: a W/B creature, a {W/B} hybrid spell
 *  on a grey page; FRA #3: a white creature, a {G/W} spell on a grey page);
 *  PipGlyph paints it in the card's one colour. */
function partColourDiffers({ card }: Ctx): boolean {
  const front = costColours(card.card_faces?.[0]?.mana_cost);
  const back = costColours(card.card_faces?.[1]?.mana_cost);
  if (back.hybrid && !front.hybrid) return true;
  if (back.letters.size === 0) return false;
  return back.letters.size !== front.letters.size || [...back.letters].some((c) => !front.letters.has(c));
}

function matches(match: Match, ctx: Ctx): boolean {
  const { card, facts } = ctx;
  if (match.frames && !match.frames.includes(ctx.frame)) return false;
  if (match.partColourDiffers !== undefined && partColourDiffers(ctx) !== match.partColourDiffers) return false;
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
  if (match.notCollectorIds?.[ctx.set]?.includes(ctx.collector)) return false;
  if (match.colorsExactly) {
    const want = [...match.colorsExactly].sort().join("");
    if ([...facts.colors].sort().join("") !== want) return false;
  }
  if (match.noKind && facts.kind !== undefined) return false;
  if (match.kinds && (!facts.kind || !match.kinds.includes(facts.kind))) return false;
  if (match.notKinds && facts.kind && match.notKinds.includes(facts.kind)) return false;
  if (match.typeWordsAny && !match.typeWordsAny.some((t) => facts.cardTypes.has(t))) return false;
  if (match.subtypesAny && !match.subtypesAny.some((s) => facts.subtypes.includes(s))) return false;
  if (match.keywordsAny) {
    const keywords = lower(card.keywords);
    if (!match.keywordsAny.some((keyword) => keywords.has(keyword.toLowerCase()))) return false;
  }
  if (match.layouts && !match.layouts.includes((card.layout ?? "").toLowerCase())) return false;
  if (match.stamps && !match.stamps.includes((card.security_stamp ?? "").trim().toLowerCase())) return false;
  if (match.fullArt !== undefined && ctx.fullArt !== match.fullArt) return false;
  if (match.textless !== undefined && (card.textless === true) !== match.textless) return false;
  if (match.m20Design !== undefined && ctx.m20Design !== match.m20Design) return false;
  if (match.releasedFrom !== undefined) {
    const released = (card.released_at ?? "").trim();
    if (released === "" || released < match.releasedFrom) return false;
  }
  if (match.releasedBefore !== undefined) {
    const released = (card.released_at ?? "").trim();
    if (released === "" || released >= match.releasedBefore) return false;
  }
  if (match.typeLineCard && (card.type_line ?? "").trim() !== "Card") return false;
  if (match.singleBasic !== undefined && facts.singleBasic !== match.singleBasic) return false;
  if (match.flavorName && !card.flavor_name) return false;
  if (match.colorIndicator && !facts.colorIndicator) return false;
  if (match.omen && !facts.omen) return false;
  if (match.hybridCost !== undefined && isHybridCost(ctx) !== match.hybridCost) return false;
  if (match.backTypes && (!facts.backType || !match.backTypes.includes(facts.backType))) return false;
  if (match.backSubtypesAny && !match.backSubtypesAny.some((s) => facts.backSubtypes.includes(s))) return false;
  if (match.dfcBlocked && (!facts.dfc?.blocked || !match.dfcBlocked.includes(facts.dfc.blocked))) return false;
  if (match.dfcLook && (facts.dfc?.look ?? "bordered") !== match.dfcLook) return false;
  if (match.dfcKinds && (!facts.dfc?.kind || !match.dfcKinds.includes(facts.dfc.kind))) return false;
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

/** The template a layout kind fixes: a double-faced kind's FRONT BODY for
 *  the printing's front type (the land front for a land — TODO 5.4, the
 *  mapper's dfcImportOf), else the kind's one layout template. */
const layoutTemplateOf = (facts: PrintingFacts): FrameTemplate | null => {
  if (facts.dfc?.kind) return facts.dfc.frontBody;
  return facts.kind ? (KIND_DEFS[facts.kind].layoutTemplates?.[0] ?? null) : null;
};

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

/** The front face's rules text (a planeswalker's ability rows, 4.33). */
function frontOracleText(card: Pick<ScryfallCard, "oracle_text" | "card_faces">): string {
  const face = card.card_faces?.[0];
  return (face ? face.oracle_text : card.oracle_text) ?? "";
}

/** The full-art token template a printing wears (TODO 4.48 / 4.50): the
 *  artifact template for an Artifact, at the height its text asks for —
 *  Scryfall has no field for the printed height, so 4.48's rule decides it
 *  from the front face's rules and flavour text and its P/T
 *  (lib/cards/token-height.ts: the regular box while it holds the text at
 *  M20_TOKEN_REGULAR_MIN_PX (72 px) or more, the tall box otherwise, no box
 *  without text). */
function m20TokenFrame(ctx: Ctx): FrameTemplate {
  const face = ctx.card.card_faces?.[0];
  const power = face ? face.power : ctx.card.power;
  const toughness = face ? face.toughness : ctx.card.toughness;
  const artifact = ctx.facts.cardTypes.has("artifact");
  const height = tokenHeightForText({
    rulesText: face ? face.oracle_text : ctx.card.oracle_text,
    flavorText: face ? face.flavor_text : ctx.card.flavor_text,
    printsPowerToughness: Boolean(power || toughness),
    artifact,
  });
  // The Nyx dress (TODO 4.51): a printing the `nyx-dress` gap names — the
  // `enchantment` frame effect, or one of NYX_TOKEN_PINS — wears the
  // starfield pill of the same height.
  return m20TokenTemplate(height, artifact, matches(GAPS["nyx-dress"].match, ctx));
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

/** The kinds the Universes Beyond spell frame dresses (TODO 4.25). */
const UB_SPELL_KINDS: readonly CardKind[] = ["creature", "instant", "sorcery", "enchantment"];

const FAMILIES: Record<
  Family,
  { produces: readonly FrameTemplate[]; pick: (ctx: Ctx) => FrameTemplate }
> = {
  // The 2014–19 arch's tall text box (TODO 4.55): its artifact dress for an
  // Artifact (a Clue), the plain one otherwise.
  tokentall: {
    produces: ["m15tokentall", "m15tokenartifacttall"],
    pick: ({ facts }) => (facts.cardTypes.has("artifact") ? "m15tokenartifacttall" : "m15tokentall"),
  },
  // The station frame (TODO 4.27a): a Planet's is the land master's, every
  // other station card's (a Spacecraft) the artifact master's.
  station: {
    produces: ["m15station", "m15stationland"],
    pick: ({ facts }) => (facts.kind === "land" ? "m15stationland" : "m15station"),
  },
  // M15: the era standard for the kind, dressed by the printing's snow /
  // devoid effect and its artifact word (the 1.3 rules, unchanged): a snow
  // land is the snow land frame, a snow spell or snow ARTIFACT the snow frame
  // (Replicating Ring KHM #244 prints it; the Artifact kind can't take it
  // yet, so the kind check lands it on m15artifact), an Artifact Creature
  // the artifact frame, an artifact token the artifact token frame — and a
  // token that prints text the text-box token frame (4.49 (b)).
  m15: {
    produces: [
      "saga", "adventure", "prepare", "split", "aftermath", "flip", "m15token",
      "m15tokenartifact", "m15tokentext", "m15tokenartifacttext", "m15land",
      "m15snowland", "m15pw", "battle", "m15snow", "m15devoid", "m15artifact",
      "m15",
    ],
    pick: (ctx) => {
      const { facts, effects } = ctx;
      const layout = layoutTemplateOf(facts);
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
  // The Universes Beyond frames (TODO 4.25): the land frame for a land, the
  // artifact frame for an artifact or an Artifact Creature, the spell frame
  // for the rest — named only by the rule whose match keeps to those kinds
  // (`ub/2015`); anything else takes its M15 frame.
  ub: {
    produces: ["m15ubland", "m15ubartifact", "m15ub"],
    pick: (ctx) => {
      const { facts } = ctx;
      if (facts.kind === "land") return "m15ubland";
      if (facts.kind === "artifact" || isArtifactCreature(facts)) return "m15ubartifact";
      if (facts.kind && UB_SPELL_KINDS.includes(facts.kind) && !layoutTemplateOf(facts)) return "m15ub";
      return FAMILIES.m15.pick(ctx);
    },
  },
  // The 2019+ borderless dress (4.32, the planeswalkers 4.33, and 4.34's
  // land) where it exists; the bordered M15 standard for the kinds it can't
  // dress yet (4.35–4.38). A planeswalker takes the tall box for four
  // ability rows or more (walkerRowsFrameFor), as the prints do.
  borderless: {
    produces: [
      "saga", "adventure", "prepare", "split", "aftermath", "flip", "m15token",
      "m15borderlessland", "m15borderlesspwtall", "m15borderlesspw", "battle",
      "m15borderlessartifact", "m15borderless",
    ],
    pick: ({ card, facts }) => {
      const layout = layoutTemplateOf(facts);
      if (layout) return layout;
      switch (facts.kind) {
        case "token":
          return "m15token";
        case "land":
          return "m15borderlessland";
        case "planeswalker":
          return walkerRowsFrameFor(
            "planeswalker",
            "m15borderlesspw",
            walkerRowCount({ rulesText: frontOracleText(card) }),
          );
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
    produces: ["saga", "adventure", "prepare", "split", "aftermath", "flip", "modernland", "m15token", "m15pw", "battle", "modern"],
    pick: ({ facts }) => eraPick(facts, "modern", "modernland"),
  },
  retro: {
    produces: ["saga", "adventure", "prepare", "split", "aftermath", "flip", "retroland", "m15token", "m15pw", "battle", "retro"],
    pick: ({ facts }) => eraPick(facts, "retro", "retroland"),
  },
  alpha: {
    // No 1993-frame token was ever printed, and PipGlyph's own "alphatoken"
    // was retired (TODO 4.54): a token is `token/old-frame`'s, on the M15
    // family, before this family is asked — eraPick's token answer is the
    // same frame.
    produces: ["saga", "adventure", "prepare", "split", "aftermath", "flip", "alphaland", "m15token", "m15pw", "battle", "agclassic"],
    pick: ({ facts }) => eraPick(facts, "agclassic", "alphaland"),
  },
  textless: {
    produces: ["m15textlessland", "m15textless"],
    pick: ({ facts }) => (facts.kind === "land" ? "m15textlessland" : "m15textless"),
  },
  // The extended-art frame and its land dress (TODO 4.7, owner Round 63):
  // a land prints the pack's land frames (FDN #487, NEO #501–505), every
  // other kind the spell frame.
  extended: {
    produces: ["extendedartland", "extendedart"],
    pick: ({ facts }) => (facts.kind === "land" ? "extendedartland" : "extendedart"),
  },
  // The full-art token design, M20 → today (TODO 4.48 / 4.50).
  m20: {
    produces: [
      "m20token", "m20tokentext", "m20tokentall",
      "m20tokenartifact", "m20tokenartifacttext", "m20tokenartifacttall",
      // …and their Nyx dress (TODO 4.51).
      "m20tokennyx", "m20tokennyxtext", "m20tokennyxtall",
      "m20tokenartifactnyx", "m20tokenartifactnyxtext", "m20tokenartifactnyxtall",
    ],
    pick: (ctx) => m20TokenFrame(ctx),
  },
  // The double-faced FRONT bodies (TODO 5.1a / 5.4; lib/cards/dfc.ts
  // bodyFor): the body the mapper's dfcImportOf put the printing's front
  // face on — the land front for a land, the spell front for every other;
  // the transform bodies (5.1a) and the modal bodies (5.1b) alike (the back
  // body rides on the patch: the printing's family and the back's type
  // through bodyFor). A printing that doesn't land on the bodies (a blocked
  // face) takes its kind's standard instead, as kindFallback does.
  dfc: {
    produces: ["m15dfclandfront", "m15dfcfront", "m15mdfclandfront", "m15mdfcfront", "m15borderlessdfcfront", "m15borderlessmdfcfront", "sagadfcfront"],
    pick: (ctx) => ctx.facts.dfc?.frontBody ?? kindFallback(ctx),
  },
};

function eraPick(
  facts: PrintingFacts,
  standard: FrameTemplate,
  land: FrameTemplate,
): FrameTemplate {
  const layout = layoutTemplateOf(facts);
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
  const layout = layoutTemplateOf(facts);
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
  m15borderlessland: "m15land",
  // The bordered walker has the regular rows' window; with four rows or
  // more its rows are just shorter (3.13).
  m15borderlesspw: "m15pw",
  m15borderlesspwtall: "m15pw",
};

// ---------------------------------------------------------------------------
// Anatomy gaps: pieces of a printing PipGlyph doesn't draw yet. A rule that
// can be exact lists the gaps that make it `nearest` (owner question 1's
// default: a missing piece is not an exact match).
// ---------------------------------------------------------------------------

export type FrameGap = GapKey;

/** A printing in the Universes Beyond dress (TODO 4.25; see the
 *  `universes-beyond` gap): the triangle stamp, from the 2021-11 drops on
 *  (the 2020 Secret Lair prints with the stamp wear the M15 frame). */
const UB_DRESS: Match = { stamps: ["triangle"], releasedFrom: "2021-11-01" };

type GapKey =
  | "crown"
  | "two-colour"
  | "two-colour-hybrid"
  | "colour-indicator"
  | "vehicle"
  | "station"
  | "universes-beyond"
  | "dfc"
  | "parchment-land-back"
  | "layout"
  | "omen"
  | "etched"
  | "border"
  | "marks"
  | "colourshifted"
  | "timeshifted-frame"
  | "reprint-colours"
  | "two-line-footer"
  | "nickname"
  | "nyx-dress"
  | "nyx"
  | "nyx-inverted"
  | "nyx-own-frame"
  | "light-box"
  | "dark-type-and-box"
  | "dark-type-bar"
  | "shadow-box"
  | "short-box"
  | "inverted"
  | "dark-bars"
  | "lettered-name"
  | "row-box"
  | "tall-box"
  | "znr-type-line"
  | "borderless-dfc-face"
  | "marvel-variant-face"
  | "nyx-saga-front"
  | "dfc-token-transform"
  | "part-colour";

const BORDER_WORD: Record<string, string> = {
  white: "white",
  silver: "silver",
  gold: "gold",
  yellow: "yellow",
};

/** The first day a printing on the 1997 frame counts as a REPRINT in the
 *  reprints' colours (the "reprint-colours" gap): 2021 — Time Spiral
 *  Remastered was released on 2021-03-19; nothing on the frame was printed
 *  between Time Spiral (2006) and it but for promos in the old colours. */
export const RETRO_REPRINT_COLOURS_FROM = "2021-01-01";

/** The first day a printing on the 1997 frame counts as a REDRAWN old frame
 *  (the "timeshifted-frame" gap): 2006 — Time Spiral's timeshifted sheet was
 *  released on 2006-10-06; the last original, Scourge, on 2003-05-26. */
export const RETRO_TIMESHIFTED_FROM = "2006-01-01";

/** The first day a printing on the 1993 frame counts as its LATER printing
 *  (the "two-line-footer" gap), INCLUSIVE — and it must stay Scryfall's own
 *  date for Fallen Empires, `released_at` 1994-11-01 (the set reached the
 *  shops on 1994-11-15, but an import reads Scryfall's field): a later day
 *  here would land every Fallen Empires printing as `exact`. The last set
 *  with the one-line credit, The Dark, is Scryfall's 1994-08-01. */
export const ALPHA_TWO_LINE_FOOTER_FROM = "1994-11-01";

const GAPS: Record<GapKey, { match: Match; reason: Text; blockedBy: string }> = {
  // The legendary crown and the two-colour dresses (TODO 4.6a / 4.6b): a gap
  // only where the frame the card lands on doesn't draw it — derived from the
  // profile (gapDrawnBy), never a second hand-kept list.
  // The STANDARD crown: a showcase printing (LTR ring, TDM draconic, BLB
  // woodland …) carries Scryfall's `legendary` effect but prints no standard
  // crown, and imports with the crown off (crownSwitchFromPrinting) — no gap.
  // m15, m15artifact and m15land draw it (TODO 4.6a), m15borderless and
  // m15borderlessartifact the floating crown (4.6f, wave 2a), extendedart
  // its band (wave 2b), m15snow and m15snowland the standard band (wave
  // 2c); devoid draws none by the owner's call (round 20: the one crowned
  // devoid printing, M3C #4, is another frame); every other frame's crown —
  // adventure, saga, the borderless land (no crowned twin of its masters) —
  // is still 4.6f's.
  crown: {
    match: { effectsAny: ["legendary"], effectsNone: ["showcase"] },
    reason: "PipGlyph doesn't draw the legendary crown on this frame yet",
    blockedBy: "4.6f",
  },
  // 4.6b draws the pairs on m15 (split + hybrid), m15artifact and m15land
  // (split), 4.6f (wave 2a) on m15borderless (split + hybrid) and
  // m15borderlessartifact (split), wave 2c on m15snow and m15snowland
  // (split): there these gaps drop — and on m15devoid the gold-split gap
  // is no gap at all (GOLD_PAIR_TEMPLATES: its two-colour printings ARE the
  // gold frame); 4.56 draws the borderless land's (m15borderlessland: the
  // grey bars, the pinline and box split); 4.6h draws the old frames'
  // (modern: the 2003 gold card of Ravnica 2005 on; modernland and
  // retroland: the two-colour lands of 2003 and of 1999 on — a printing
  // from before its look began imports without the switch, or as the plain
  // land: lib/scryfall/import-mapper.ts printsTwoColorFrame /
  // landFrameColors) and `retro`'s gold-split is no gap at all (the 1997
  // frame printed one gold card: GOLD_PAIR_TEMPLATES). What is left is the
  // rest of wave 2 (4.6f: extended art, sagas / adventures) — and the tails
  // it names (the hybrid artifact dress 4.6e, token pairs 4.48, the 2003
  // frame's HYBRID cards, whose print splits the frame body).
  "two-colour": {
    match: { colorCount: { min: 2, max: 2 }, hybridCost: false },
    reason: "two-colour cards print a split frame, and PipGlyph uses its gold one",
    blockedBy: "4.6f",
  },
  "two-colour-hybrid": {
    match: { colorCount: { min: 2, max: 2 }, hybridCost: true },
    // Where this gap holds the frame draws either plain gold (wave 2, 4.6f)
    // or — m15artifact, with its switch on — the gold two-colour pair (no
    // hybrid plate yet): "uses its gold one" was wrong there (4.6 review).
    reason: "two-colour hybrid cards print a split hybrid frame, which PipGlyph doesn't draw on this frame yet",
    blockedBy: "4.6f",
  },
  // The Prepare page's own colour (TODO 4.27 → 4.26): print colours the
  // spell's page by the SPELL — a hybrid spell's grey page, another
  // colour's page — and PipGlyph paints it in the card's one colour. The
  // adventure's storybook page too (WOE #221: a red page beside a black
  // frame) — drawn since 4.26's adventure pages, so no gap on the frame.
  "part-colour": {
    match: { layouts: ["prepare", "adventure"], partColourDiffers: true },
    reason: "its spell's page prints the spell's own colour, and PipGlyph paints it in the card's",
    blockedBy: "4.26",
  },
  "colour-indicator": {
    match: { colorIndicator: true },
    reason: "PipGlyph doesn't draw the colour indicator yet",
    blockedBy: "4.6",
  },
  // The Universes Beyond dress (TODO 4.25): the smooth, streaked frame
  // Universes Beyond printed from the 2021-11 Secret Lair drops and 40K
  // (2022-10) to Final Fantasy (2025-06), always with the triangle stamp —
  // Scryfall's `security_stamp` is the one field that names it (219 of 224
  // triangle-stamped plain prints read wear it; from Marvel's Spider-Man,
  // 2025-09, Universes Beyond prints the M15 frame with the oval or no
  // stamp). PipGlyph draws it on the plain spell, artifact and land frames
  // (`ub/2015`); on any other body — a saga, an adventure, a Vehicle, a
  // double-faced card, extended art — the printing keeps its frame as the
  // nearest.
  "universes-beyond": {
    match: UB_DRESS,
    reason: "this printing wears the Universes Beyond dress, which PipGlyph draws on its plain spell, artifact and land frames only",
    blockedBy: "4.25",
  },
  vehicle: {
    // On either face: a BOT convert's Vehicle back (5.10) prints the plate
    // the back body doesn't draw either.
    match: { anyOf: [{ subtypesAny: ["Vehicle"] }, { backSubtypesAny: ["Vehicle"] }] },
    reason: "PipGlyph doesn't draw the Vehicle P/T plate yet",
    blockedBy: "4.6",
  },
  // The station frame (TODO 4.27a, step 0): Edge of Eternities' Spacecraft
  // and Planets print a frame of their own — the picture under the whole
  // card, a see-through text box cut into bands, a "N+" badge per tier and a
  // black P/T plate inside the tier that makes the card a creature. Scryfall
  // has no layout for it (`layout: normal`): the Station keyword is the one
  // field that names it, on every such printing and on nothing else (91 of
  // 91, Scryfall 2026-10-13 — Doctor Who's "Plane — Spacecraft" cards carry
  // no keyword and no PipGlyph card type). The gap is the DRESSES': the
  // bordered printings have their own rule (`station/2015`, below); the
  // extended-art ones a frame of their own once verified, the borderless and
  // showcase ones the bordered frame as their landing (stationDress; TODO
  // 4.27a step 2) — "this printing's" frame is the dress PipGlyph lacks.
  station: {
    match: { keywordsAny: ["Station"] },
    reason: "PipGlyph doesn't draw this printing's Station frame yet",
    blockedBy: "4.27a",
  },
  // The double-faced marks on a frame that isn't a double-faced body (TODO
  // 5.4): what is left once the transform / modal printings land on their
  // bodies — the saga fronts (NEO's transforming Sagas) and backs (the MOM
  // praetors), the battle fronts and the double-faced tokens (5.5). A
  // walker face (5.13), a colourless face without the Artifact word (5.11)
  // and a modal printing before 5.1b have rules of their own.
  dfc: {
    match: {
      anyOf: [{ layouts: ["transform", "modal_dfc"] }, { effectsAny: DFC_EFFECTS }],
    },
    reason: "PipGlyph doesn't draw the double-faced marks on this frame yet",
    blockedBy: "5.5",
  },
  // The Ixalan parchment land back (TODO 5.8): XLN / RIX / LCI's transform
  // land backs print their own frame (uppercase name, a banner type line,
  // the "(Transforms from …)" line); PipGlyph's land back is the plain one,
  // so the import lands nearest on it (design 2026-10-02, 5.8).
  // A dark borderless double-faced printing (TODO 5.7) whose face has no
  // borderless body yet — a land face (SLD #1502, SLD #2655's backs) or a
  // sun / moon back (VOW #332–341) — lands on the bordered bodies.
  // Marvel Super Heroes' variant borderless legends (TODO 5.7, the #578
  // check): #355–363 print no title bar (the name floats on the art) and
  // #388–399's backs are comic covers — neither is the borderless title bar
  // the bodies draw; #328–350 are.
  "marvel-variant-face": {
    match: { collectors: { msh: [[355, 363], [388, 399]] } },
    reason: "this Marvel printing's faces aren't the borderless title bar (a floating name, a comic-cover back)",
    blockedBy: "5.7d",
  },
  // Avatar: the Last Airbender's transforming Sagas (TLA #27 / #61 / #117 /
  // #145 / #186 and their promos) print the double-faced saga front under
  // the Nyx starfield (TODO 5.5 (b), measured 2026-10-16); Kamigawa: Neon
  // Dynasty's — which Scryfall marks `enchantment` too — print it plain.
  "nyx-saga-front": {
    match: { sets: ["tla", "ptla"], effectsAny: ["enchantment"] },
    reason: "this saga's front wears the Nyx starfield, which PipGlyph's double-faced saga front doesn't draw",
    blockedBy: "5.5",
  },
  // The transforming double-sided token (TODO 5.5 (c), owner Round 76):
  // MOM's Incubator // Phyrexian (TMOM #16–18, TEOC #15, TFRC #13) prints
  // the ▲ well on its front, the ▼ on its back and the back's 0/0 on the
  // front's text box — PipGlyph draws the plain full-art pair (two tokens
  // back to back) meanwhile; the transform-token body is TODO 5.5 (d).
  "dfc-token-transform": {
    match: { layouts: ["double_faced_token"], subtypesAny: ["Incubator"] },
    reason: "this token transforms: its faces print the transform icons and the back's power and toughness on the front, which PipGlyph's token frames don't draw",
    blockedBy: "5.5d",
  },
  "borderless-dfc-face": {
    match: { dfcLook: "bordered" },
    reason: "PipGlyph's borderless double-faced frames don't have this face yet (a land face, or the 2016–22 icons), so it lands on the bordered frame",
    blockedBy: "5.7",
  },
  "parchment-land-back": {
    match: {
      layouts: ["transform"],
      backTypes: ["land"],
      anyOf: [{ effectsAny: ["compasslanddfc"] }, { sets: ["xln", "rix", "lci"] }],
    },
    reason: "the Ixalan land back prints its own parchment frame, and PipGlyph draws the plain land back",
    blockedBy: "5.8",
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
  // The border (TODO 4.30): white is drawn on the 1997 and 2003 frames — no
  // gap there (gapDrawnBy) — and nowhere else yet; silver, gold and yellow
  // are 4.15's.
  border: {
    match: { borders: Object.keys(BORDER_WORD) },
    reason: ({ border }) =>
      border === "white"
        ? "PipGlyph doesn't print a white border on this frame yet"
        : `PipGlyph doesn't print a ${BORDER_WORD[border] ?? border} border yet`,
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
  // The 1997 frame is the ORIGINAL cards' (TODO 4.10a; owner 2026-10-07, era
  // design D14): from Time Spiral Remastered (2021-03) on, the printings on
  // it carry lighter colours (a white frame at 208 luma against the
  // originals' 157; red, green, artifact and land likewise) on a frame box
  // 3–6 px wider — sixteen white reprints of eight sets, 2021 → 2025.
  // Time Spiral's timeshifted cards (2006) are a REDRAWING of the old frame,
  // not the originals' (21 prints, three per key, against the 4.10a masters:
  // the art window's top sits 9–11 px lower on every key and the text box
  // ends 5–14 px higher, where the originals are within 1–2 px; white, black
  // and green keep the old colours — ΔE 2–3 — but blue is a different,
  // violet blue — ΔE 13 — and red and gold are 7 off). So they land on the
  // frame as its NEAREST, like the 2021+ reprints, and say why.
  "timeshifted-frame": {
    match: { frames: ["1997"], releasedFrom: RETRO_TIMESHIFTED_FROM, releasedBefore: RETRO_REPRINT_COLOURS_FROM },
    reason: "PipGlyph's 1997 frame is the original 1996–2003 printing; the timeshifted frame is a later redrawing (its art sits lower, its blue differs)",
    blockedBy: "4.10e",
  },
  "reprint-colours": {
    match: { frames: ["1997"], releasedFrom: RETRO_REPRINT_COLOURS_FROM },
    reason: "PipGlyph's 1997 frame is the original 1996–2003 printing; this reprint's frame is lighter",
    blockedBy: "4.10e",
  },
  // The 1993 frame is the printing of Alpha → The Dark (TODO 4.10c, proof
  // 3): ONE line in the strip — `Illus. © <artist>` at 70 px beside the P/T
  // — the 1993 symbol drawings and no tap symbol before Revised's tilted T.
  // From Fallen Empires (1994-11) the strip holds two lines, a smaller
  // credit over a Wizards © line (FEM, 4ED, ICE, CHR, HML, ALL read), and
  // from Fourth Edition (1995-04) the sun is today's and {T} the turned
  // arrow. Those printings — and every later one on the frame — land on it
  // as its NEAREST and say why.
  "two-line-footer": {
    match: { frames: ["1993"], releasedFrom: ALPHA_TWO_LINE_FOOTER_FROM },
    reason: "PipGlyph's 1993 frame is the 1993–94 printing (Alpha to The Dark); from Fallen Empires on the frame prints a smaller credit over a second line, and from Fourth Edition today's symbols",
    blockedBy: "4.10h",
  },
  nickname: {
    match: { flavorName: true },
    reason: "PipGlyph doesn't print the borderless nickname plate yet",
    blockedBy: "6.3a",
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
  // owner 2026-09-29): until 4.55 the import landed on the regular box, the
  // text shrinking to fit (3.29), and the 1.6 log counted the demand. The
  // tall box draws it now (gapDrawnBy) and the `token/tall-box` rule names
  // it once verified; the gap stays for the rows the log holds.
  // Zendikar Rising's full-art basics (TODO 4.40, owner Round 64): the
  // stone-ring design, but every ZNR printing sets its subtype 22–28 px
  // further right than `m15fullartlandzen` (BFZ's) and its bars and name
  // 3–5 px off — NEAREST on that frame even once it is verified.
  "znr-type-line": {
    match: { sets: ["znr"] },
    reason: "Zendikar Rising sets this design's type line further right than PipGlyph's Zendikar full-art basic",
    blockedBy: "4.40",
  },
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
  // Two groups of Nyx printings the Nyx frame (`m15nyx`) doesn't match
  // (owner decision 4, Round 56, 2026-10-13): gaps of the frame the match
  // takes ONCE VERIFIED (nyxOnceVerified), so they land on it, with the
  // starfield, as its NEAREST and say why. Neither is a gap rule of its own
  // (no signature key) and neither is listed before the swap.
  //   • Scryfall's `inverted` effect beside `enchantment` on the plain 2015
  //     frame: ten printings on 2026-10-13 with no other gap — seven promo
  //     packs (THB #353, NEO #508 / #510, DSK #415, TDM #420 / #421 / #424),
  //     PRM #79863, SLD #340 and SCH #45 — and nine more a gap before it
  //     already names (six foil-etched, three yellow-bordered). The flags
  //     suffice: no id is pinned.
  "nyx-inverted": {
    match: { effectsAll: ["enchantment", "inverted"], notKinds: ["token"] },
    reason: "Scryfall marks this printing's frame inverted, which PipGlyph's Nyx frame doesn't claim to match yet",
    blockedBy: "4.7",
  },
  //   • Faceless One (CLB #1, its one printing) prints a tan frame of its
  //     own (189/173/127 on the scan) where the frame's colourless key is
  //     the silver starfield Eldrazi Conscription wears (SOC #131). No
  //     Scryfall field tells the two apart — both colourless, black-
  //     bordered, `enchantment` — so it is pinned.
  "nyx-own-frame": {
    match: { collectorIds: NYX_OWN_FRAME_PINS },
    reason: "this printing has a Nyx frame of its own colour, and PipGlyph's Nyx frame draws the silver one for a colourless card",
    blockedBy: "4.7",
  },
  "light-box": {
    match: { effectsNone: ["inverted"] },
    reason: "this printing has the light text box, and PipGlyph's has the dark one",
    blockedBy: "4.37",
  },
  // The borderless land's print variations the registry can't read from
  // Scryfall's fields (4.34's skeptic passes): pinned.
  "dark-type-and-box": {
    match: { kinds: ["land"], collectorIds: BORDERLESS_LAND_DARK_PINS },
    reason: "this printing's type bar and text box are dark, and PipGlyph's Borderless Land tints them",
    blockedBy: "4.37",
  },
  "dark-type-bar": {
    match: { kinds: ["land"], collectorIds: BORDERLESS_LAND_DARK_TYPE_BAR_PINS },
    reason: "this printing's type bar is dark, and PipGlyph's Borderless Land tints it",
    blockedBy: "4.37",
  },
  "shadow-box": {
    match: { kinds: ["land"], collectorIds: BORDERLESS_LAND_SHADOW_BOX_PINS },
    reason: "this printing's text box is see-through with a shadow behind the text, and PipGlyph's Borderless Land tints it",
    blockedBy: "4.37",
  },
  "short-box": {
    match: { kinds: ["land"], collectorIds: BORDERLESS_LAND_SHORT_BOX_PINS },
    reason: "this printing has the short text box, and PipGlyph's has the regular one",
    blockedBy: "4.37",
  },
  // The borderless planeswalker's two (4.33). `inverted` (46 of the 245
  // non-showcase printings) stays the light frame's nearest, as the owner
  // decided on 2026-09-26 — although the scans checked (WOE #297, ECL
  // #284, FRA #291 / #300 / #303, SOS #282, 2X2 #333, MKM #335, DSK #328,
  // TDM #398, EOE #287) print the same light rows as the rest; BLC's
  // raised-foil inverted walkers (#93 blue, #94 black, #96 green) print dark
  // name and type bars with white ink in any colour. And a mono-black
  // walker off the pinned light ones prints dark name and type bars with
  // white ink (LIGHT_BLACK_WALKER_PINS).
  inverted: {
    match: { effectsAny: ["inverted"] },
    reason: "Scryfall marks this printing's frame inverted, which PipGlyph's borderless planeswalker doesn't claim to match yet",
    blockedBy: "4.33",
  },
  "dark-bars": {
    match: {
      anyOf: [
        { colorsExactly: ["B"], notCollectorIds: LIGHT_BLACK_WALKER_PINS },
        { collectorIds: DARK_BAR_WALKER_PINS },
      ],
    },
    reason: "this printing has dark name and type bars with white ink, and PipGlyph's borderless planeswalker has light ones",
    blockedBy: "4.33",
  },
  // Two more the scans found that no Scryfall field names: a name lettered
  // across the art (LETTERED_NAME_WALKER_PINS), and an ability box that
  // isn't the one the rows pick (WALKER_ROW_BOX_PINS).
  "lettered-name": {
    match: { collectorIds: LETTERED_NAME_WALKER_PINS },
    reason: "this printing letters its name across the art, and PipGlyph's borderless planeswalker has a name bar",
    blockedBy: "4.33",
  },
  "row-box": {
    match: { collectorIds: WALKER_ROW_BOX_PINS },
    reason: "this printing sets its abilities on the other ability box (regular or tall) than the one PipGlyph picks for its rows",
    blockedBy: "4.33",
  },
};

/** The base rule, preceded by one `nearest` rule per gap ('era/2015+crown').
 *  A gap rule names the item that finishes the match (its `blockedBy`).
 *  When the base is itself only `nearest` (the M20 token design on the arch
 *  frame, TODO 1.23), the gap rule keeps the base's reason before its own,
 *  and records no FrameMatch.gaps: the frame is a stand-in whatever the
 *  gaps, so the import dialog must still ask (C1 reads the gaps). */
function withGaps(
  base: Rule,
  gaps: readonly GapKey[],
  /** A gap this family's frames wait on another item for (the token
   *  crown: 4.48's pill crown, not 4.6f; the layout frames' two-colour gap:
   *  4.26 on split and aftermath, 4.6f on the rest). */
  blockedByOverride: Partial<Record<GapKey, BlockedBy>> = {},
): Rule[] {
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
          blockedBy: blockedByOverride[gap] ?? GAPS[gap].blockedBy,
        },
        // The earlier gaps didn't hold (first match wins); the later ones are
        // checked at resolve time (FrameMatch.gaps).
        ...(exactBase ? { gaps: gaps.slice(index) } : {}),
        // …and after the swap on a base that is exact once verified.
        ...(!exactBase && base.outcome.exactOnceVerified ? { gapsOnceVerified: gaps.slice(index) } : {}),
        ...(Object.keys(blockedByOverride).length > 0 ? { gapBlockedBy: blockedByOverride } : {}),
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
  "universes-beyond",
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

/** A Vehicle that prints the brown plate with white digits (TODO 4.5c): the
 *  Artifact kind on the 2015 frame with the subtype on its front face, off
 *  the one silver-plated print (SILVER_PLATE_VEHICLE_PINS). */
const BROWN_PLATE_VEHICLE: Match = {
  frames: ["2015"],
  kinds: ["artifact"],
  subtypesAny: ["Vehicle"],
  notCollectorIds: SILVER_PLATE_VEHICLE_PINS,
};

/** The gap rule of the Nyx starfield, naming the Nyx frame once it is
 *  verified (TODO 4.7): `<base>+nyx` keeps its match, status, reason and
 *  gaps, and gains `onceVerified: "m15nyx"`, exact after the swap unless a
 *  later gap of the base still holds there (`gapsOnceVerified`: the rule's
 *  own list — its first, the starfield, is drawn on that frame). */
function nyxOnceVerified(rules: Rule[]): Rule[] {
  return rules.map((rule) =>
    rule.gaps?.[0] === "nyx"
      ? {
          ...rule,
          outcome: { ...rule.outcome, onceVerified: "m15nyx", exactOnceVerified: true },
          gapsOnceVerified: [...rule.gaps, ...NYX_FRAME_GAPS],
        }
      : rule,
  );
}

/** What the Nyx frame doesn't match of a printing it draws the starfield
 *  for (GAPS): read after the swap only, and LAST — a gap of the base that
 *  still holds there (foil-etched, a yellow border) keeps naming the
 *  reason. */
const NYX_FRAME_GAPS: readonly GapKey[] = ["nyx-inverted", "nyx-own-frame"];

/** Where such a Vehicle lands when its printing wears a dress PipGlyph has
 *  no Vehicle plate for (borderless, extended art — 7 of 7 and 8 of 8 read
 *  print the brown plate; owner 2026-10-12, round 48): the bordered Vehicle
 *  frame once it is verified in the card's colour, still `nearest` — the
 *  silver artifact frame until then, as before. `dress` names the print. */
const vehicleStandIn = (dress: string): NonNullable<Outcome["landOnOnceVerified"]> => ({
  template: "m15vehicle",
  match: BROWN_PLATE_VEHICLE,
  gap: "vehicle",
  reason: `this printing is ${dress}, and PipGlyph draws the Vehicle plate on its bordered Vehicle frame only`,
});

/** Where a station printing in a dress lands when that dress has no
 *  station frame of its own to land on (TODO 4.27a step 2, as the Vehicle's
 *  stand-in above): the bordered station frame once it is verified in the
 *  card's colour, still `nearest` — the dress's own landing until then.
 *  `template` is the bordered frame of the printings the dress has: the
 *  Spacecraft's (extended art, borderless, TRK #557's showcase) or the
 *  Planet's (the viewport Planets, a showcase of their own). `dress` names
 *  the print, `why` says why the print's own frame is not the landing. */
const stationStandIn = (
  dress: string,
  why: string,
  template: "m15station" | "m15stationland" = "m15station",
): NonNullable<Outcome["landOnOnceVerified"]> => ({
  template,
  match: { allOf: [GAPS.station.match, template === "m15stationland" ? { kinds: ["land"] } : { notKinds: ["land"] }] },
  gap: "station",
  reason: `this printing is ${dress}, and ${why}`,
  // A frame that draws no tiers (extended art, the borderless artifact
  // frame, a showcase stand-in) is never kept over the station frame, even
  // verified (owner Round 66): the tiers would print as plain lines.
  overOwnFrame: true,
});

/** The gap rule of the station frame on a DRESS (TODO 4.27a step 2): `<base>
 *  +station` keeps its match, status, reason and gaps, and gains
 *    • `standIn` — the bordered station frame as its stand-in LANDING once
 *      verified (`landOnOnceVerified`), where the rule's frame is the print's
 *      own dress or an edge-to-edge one (extended art, borderless, the
 *      borderless viewport Planets);
 *    • `own` — the frame named INSTEAD once verified (`onceVerified`): the
 *      extended-art station frame, exact (`exact`) unless a later gap of the
 *      base still holds there (`gapsOnceVerified`: the rule's own list — its
 *      first, the tiers, is drawn on that frame, gapDrawnBy); or, on a
 *      black-bordered showcase whose frame is only the M15 stand-in (TRK
 *      #557), the bordered station frame, still nearest (the showcase's
 *      reason and item stand).
 *  The dress's own verified frame wins over the stand-in (withVerification).
 *  A gap rule of a `nearest` base (the showcases) records no gaps: it is
 *  found by its key. */
function stationDress(
  rules: Rule[],
  dress: { standIn?: NonNullable<Outcome["landOnOnceVerified"]>; own?: TemplateSpec; exact?: true },
): Rule[] {
  const { standIn, own, exact } = dress;
  return rules.map((rule) =>
    rule.key.endsWith("+station")
      ? {
          ...rule,
          outcome: {
            ...rule.outcome,
            ...(standIn ? { landOnOnceVerified: standIn } : {}),
            ...(own ? { onceVerified: own } : {}),
            ...(own && exact ? { exactOnceVerified: true as const } : {}),
          },
          ...(own && exact ? { gapsOnceVerified: rule.gaps } : {}),
        }
      : rule,
  );
}

/** The item a showcase station printing waits on: its own showcase frame
 *  (4.11) — the `station` gap there only says what else the print has. */
const STATION_SHOWCASE: Partial<Record<GapKey, BlockedBy>> = { station: "4.11" };

const showcaseLabel = ({ card, set }: Ctx) =>
  `${card.set_name ?? set.toUpperCase()} showcase`;

const LAYOUT_KINDS: readonly CardKind[] = ["saga", "adventure", "prepare", "split", "aftermath", "flip"];

/** The M15-era gaps on a double-faced BODY (TODO 5.4): every M15-era gap but
 *  the double-faced marks, which the body draws (gapDrawnBy). */
const DFC_BODY_GAPS: readonly GapKey[] = M15_ERA_GAPS.filter((gap) => gap !== "dfc");

/** The layout frames whose two parts each print their own colour (TODO
 *  4.26's per-part colour): a two-colour printing on them is not the
 *  two-colour dress (4.6f) the other layout frames wait on. */
const PER_PART_COLOUR_TEMPLATES: ReadonlySet<FrameTemplate> = new Set<FrameTemplate>(["split", "aftermath"]);
const LAYOUT_TWO_COLOUR_ITEM: BlockedBy = (template) => (template && PER_PART_COLOUR_TEMPLATES.has(template) ? "4.26" : "4.6f");

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
      reason: "PipGlyph doesn't make this kind of card (planes, schemes, vanguards)",
    },
  },

  // --- 6.23 / 4.52: emblems (layout `emblem`, the emblem kind) -------------
  // 141 printed (Scryfall `t:emblem`, 2026-09-29). The one-offs PipGlyph
  // won't build (4.52's "not planned", logged for 1.6): the Universes
  // Beyond full-bleed emblems (TACR #7, TFIN #24, WFIN #1), The Ring's two
  // faces (TLTR #H13, `double_faced_token`) and the Mystery Booster playtest
  // card (MB2 #513). They import on the emblem kind, nearest its frame.
  {
    key: "emblem/one-off",
    exactLabel: ({ card }) =>
      (card.layout ?? "").toLowerCase() === "double_faced_token"
        ? "Double-faced emblem"
        : (card.promo_types ?? []).includes("playtest")
          ? "Playtest emblem"
          : "Universes Beyond full-bleed emblem",
    match: {
      kinds: ["emblem"],
      anyOf: [{ layouts: ["double_faced_token"] }, { promosAny: ["universesbeyond", "playtest"] }],
    },
    outcome: {
      status: "unsupported",
      template: "emblem",
      reason: "PipGlyph doesn't make this one-off emblem design; the import uses its emblem frame",
    },
  },
  // The first emblems (DKA 2012 → BNG / MD1 2014; 13 printings) print a
  // gold-rimmed "EMBLEM" plaque on the 2003 frame: 4.43 with the old
  // borders (4.52, P3).
  {
    key: "emblem/old-frame",
    exactLabel: ({ frame }) => `${frame} frame emblem`,
    match: { kinds: ["emblem"], frames: ["1993", "1997", "2003"] },
    outcome: {
      status: "nearest",
      template: "emblem",
      reason: "PipGlyph has no emblem frame for this border era yet",
      blockedBy: "4.43",
    },
  },
  // M15 → MH1 (2014-07-18 → 2019-05-30, and The List's pre-M20 prefixes:
  // isM20DesignPrinting, the tokens' rule) print a black "EMBLEM" bar and
  // "Emblem — Ajani": 4.52's later variant (P3, only if people ask).
  {
    key: "emblem/2014-19",
    exactLabel: "2014–19 emblem frame",
    match: { kinds: ["emblem"], frames: ["2015"], m20Design: false },
    outcome: {
      status: "nearest",
      template: "emblem",
      reason: "PipGlyph draws today's emblem frame, not the 2014–19 one with the EMBLEM bar",
      blockedBy: "4.52",
    },
  },
  // M20 on (2019-07-12): today's emblem — the source's name in the dark
  // bar, the spark cut-out, "Emblem" on the type bar. This is 4.52's frame.
  {
    key: "emblem/m20",
    exactLabel: "Emblem frame",
    match: { kinds: ["emblem"], frames: ["2015"], m20Design: true },
    outcome: { status: "exact", template: "emblem" },
  },
  {
    key: "emblem/other",
    exactLabel: ({ frame }) => (frame ? `${frame} frame emblem` : "Emblem"),
    match: { kinds: ["emblem"] },
    outcome: {
      status: "nearest",
      template: "emblem",
      reason: "Scryfall reports a frame PipGlyph doesn't know",
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
    match: {
      borders: ["borderless"],
      anyOf: [{ promosAny: ["poster"] }, { collectorIds: UNFLAGGED_POSTER_PINS }],
    },
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
  // Exact once verified since TODO 4.11 (layout v69: the footer MSE paints
  // at render time painted under the masters — off BORDER_PENDING_TEMPLATES).
  // A two-colour printing (the eight two-colour legends #327–330 and
  // #333–336; #331 / #332 are three-colour, gold) prints its two colours
  // split down the frame, which the template doesn't draw yet: nearest
  // (two-colour gap), on the gold master. A double-faced printing is nearest
  // too: the frame draws neither a face's triangle nor the back's P/T (dfc).
  ...withGaps(
    {
      key: "showcase/blb/woodland",
      exactLabel: "Bloomburrow woodland showcase",
      match: { borders: ["borderless"], collectors: { blb: [[295, 336]] } },
      outcome: { status: "exact", template: "bloomburrow" },
    },
    ["dfc", "two-colour", "two-colour-hybrid"],
    { "two-colour": "4.11", "two-colour-hybrid": "4.11" },
  ),
  {
    key: "showcase/blb/anime",
    exactLabel: "Bloomburrow anime showcase",
    match: { borders: ["borderless"], collectors: { blb: [[343, 355]] } },
    outcome: { status: "exact", template: "bloomanime" },
  },
  // Exact once verified since TODO 4.11 (Card Conjurer's 'Ring' masters are
  // opaque to every edge: off BORDER_PENDING_TEMPLATES). A two-colour
  // printing (24 of the 60: LTR #316, #318–327, #330 and their twins)
  // prints the colour frames split down the card (the pack's
  // maskRightHalf.png), which the template doesn't draw yet: nearest.
  ...withGaps(
    {
      key: "showcase/ltr/ring",
      exactLabel: "The Lord of the Rings ring showcase",
      match: { borders: ["borderless"], collectors: { ltr: [[302, 331], [794, 823]] } },
      outcome: { status: "exact", template: "lotr" },
    },
    ["two-colour", "two-colour-hybrid"],
    { "two-colour": "4.11", "two-colour-hybrid": "4.11" },
  ),
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
  // Exact once verified since TODO 4.11 (layout v69: the title bar and the
  // black footer MSE paints at render time built into the masters — off
  // BORDER_PENDING_TEMPLATES). A two-colour printing (#348 Bumi R/G, #351
  // Katara W/U) prints its two colours split down the frame, which the
  // template doesn't draw yet: nearest (two-colour gap), on the gold master.
  // A double-faced printing (#346 Aang, at the Crossroads and #347, transform)
  // is nearest too: the frame draws neither the transform triangle nor the
  // back's P/T (dfc).
  ...withGaps(
    {
      key: "showcase/tla/avatar",
      exactLabel: "Avatar: The Last Airbender elemental showcase",
      // TLE #305–317 (the Eternal-legal companion set) print the same frame,
      // including its only colourless printings (Arcane Signet TLE #315).
      match: { borders: ["borderless"], collectors: { tla: [[336, 353]], tle: [[305, 317]] } },
      outcome: { status: "exact", template: "avatar" },
    },
    ["dfc", "two-colour", "two-colour-hybrid"],
    { "two-colour": "4.11", "two-colour-hybrid": "4.11" },
  ),
  // The Wilds of Eldraine ENCHANTING TALES showcase (TODO 4.11 wave 2; Card
  // Conjurer's 'Enchanting Tales' pack): the bonus sheet WOT #1–63 — 63
  // printings, every one borderless, single-faced, mono-coloured, on the
  // 2015 frame with the `showcase` effect, every one an enchantment (seven
  // Auras, Fraying Sanity's an Aura Curse, and Bitterblossom a Kindred
  // Enchantment — all on the same frame: none needs a body of its own), none
  // legendary (Scryfall 2026-10-27). NOT WOT #64–83 and their confetti-foil
  // twins #84–103: the anime-style borderless reprints of twenty of the same
  // cards (no `showcase` effect) are another design and keep their landing.
  // Exact once verified (withVerification). No gap: the run prints no
  // two-colour, double-faced, crowned or creature card.
  {
    key: "showcase/wot/enchanting-tales",
    exactLabel: "Wilds of Eldraine Enchanting Tales showcase",
    match: { borders: ["borderless"], collectors: { wot: [[1, 63]] } },
    outcome: { status: "exact", template: "enchantingtales" },
  },
  // Edge of Eternities' ten "viewport" Planets (EOE #277–285, #372–380) are
  // station cards on a showcase of their own: they keep this rule's landing
  // and item, and say the station frame is missing too (STATION_SHOWCASE).
  // Since TODO 4.27a step 2 their import lands on the bordered Planet frame
  // once that is verified in the card's colour (stationDress: the tiers
  // drawn, still nearest — the viewport design itself is 4.11's).
  ...stationDress(
    withGaps(
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
      ["station"],
      STATION_SHOWCASE,
    ),
    { standIn: stationStandIn("a showcase", "PipGlyph draws the tiers on its bordered Planet frame", "m15stationland") },
  ),
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
  // A transform / modal printing with a PLANESWALKER face (TODO 5.4; owner
  // 2026-10-02, Q2: the walker faces wait — 5.13, ask first): the front
  // imports alone on its standard frame, the back is dropped
  // (droppedFaceOf), and this row in the request log counts the ask.
  // Before the borderless rules: a borderless walker DFC waits on 5.13 first.
  {
    key: "dfc/walker",
    exactLabel: "Double-faced planeswalker",
    match: { dfcBlocked: ["walker-face"] },
    outcome: {
      status: "nearest",
      template: { family: "m15" },
      reason: "PipGlyph's double-faced planeswalker frames aren't built yet — the front face imports on its own",
      blockedBy: "5.13",
    },
  },
  // A colourless face without the Artifact word (EMN's Eldrazi backs, TLA's
  // Aang backs, STX #6's Avatar front): the printing's frame IS the
  // double-faced body (a front-body row may be verified against its front),
  // but the body's `c` is the artifact master standing in (design D2) and
  // the see-through frame is 5.11, so the import LANDS on the standard
  // (`landOn`: today's landing, a legacy back) rather than giving the face
  // a colour the print doesn't have.
  {
    key: "dfc/colourless-face",
    exactLabel: "Double-faced card with a colourless face",
    match: { dfcBlocked: ["colourless-face"] },
    outcome: {
      status: "nearest",
      template: { family: "dfc" },
      landOn: { family: "m15" },
      reason: "a colourless double-faced face without the Artifact word prints the see-through frame, which PipGlyph doesn't draw yet",
      blockedBy: "5.11",
    },
  },
  // The borderless transform / modal faces (TODO 5.7). The DARK look
  // (`inverted`: 98 of the 134 plain printings — ECL, FIN, TLA, MSH, SPM …)
  // is exact on the borderless bodies the mapper puts the faces on
  // (dfcImportOf: both faces need one) once both are verified in their
  // colours (finalizeImportMatch: until then the import lands on the
  // bordered bodies, as before 5.7); a face with no borderless body (a land
  // face, a sun / moon back) lands on the bordered bodies with the
  // `borderless-dfc-face` gap. The LIGHT look (ZNR / KHM pathways, SLD
  // #1155–1212, STX's walkers) stays nearest on the bordered bodies.
  ...withGaps(
    {
      key: "borderless/dfc",
      exactLabel: "Borderless double-faced card",
      match: {
        borders: ["borderless"],
        effectsAny: ["inverted"],
        anyOf: [{ layouts: ["transform", "modal_dfc"] }, { effectsAny: DFC_EFFECTS }],
      },
      outcome: { status: "exact", template: { family: "dfc" } },
    },
    ["marvel-variant-face", "borderless-dfc-face", ...DFC_BODY_GAPS.filter((gap) => gap !== "border" && gap !== "universes-beyond")],
  ),
  {
    key: "borderless/dfc/light",
    exactLabel: "Borderless double-faced card (light)",
    match: {
      borders: ["borderless"],
      anyOf: [{ layouts: ["transform", "modal_dfc"] }, { effectsAny: DFC_EFFECTS }],
    },
    outcome: {
      status: "nearest",
      template: { family: "dfc" },
      reason: "PipGlyph doesn't draw the light borderless double-faced look yet",
      blockedBy: "5.7",
    },
  },
  // The light borderless planeswalker (4.33; 199 of the 245 non-showcase
  // printings: Oko ELD #271, Basri Ket M21 #280), regular or tall by its
  // ability rows. Like every edge-to-edge frame it lands on its bordered
  // twin, m15pw (1.18), and is exact only once verified in the card's colour
  // (withVerification). `inverted` printings (Ashiok WOE #297, Ajani ECL
  // #284) are the light frame's nearest (owner decision 2026-09-26), the
  // dark-barred black walkers too (LIGHT_BLACK_WALKER_PINS; PS19 #207 in
  // gold), a two-colour walker's split frame (Oko, Saheeli BRO #294) is
  // 4.6's, and — last, so no earlier key moves — a lettered name (SLD #1619
  // / #1622) and a printed box the rows don't pick (MED #WS2, UNF #275 /
  // #526, PS19 #207).
  ...withGaps(
    {
      key: "borderless/planeswalker",
      exactLabel: "Borderless planeswalker",
      match: { borders: ["borderless"], kinds: ["planeswalker"] },
      outcome: { status: "exact", template: { family: "borderless" } },
    },
    ["inverted", "dark-bars", "etched", "nickname", "colour-indicator", "two-colour", "two-colour-hybrid", "lettered-name", "row-box"],
  ),
  // A nonbasic land (4.34): the borderless land frame — exact once it is
  // verified in the card's colour (withVerification: `nearest`, "not yet
  // verified", until then), and like the spells' frame its art reaches the
  // card edge, so the import lands on the bordered land frame (1.18) with
  // Borderless Land offered once verified. The two-colour lands — MID #281,
  // OTJ #304, the RVR shocks, the MKM surveil lands, the MH3 fetch lands:
  // 119 of the 192 on Scryfall 2026-10-06 — print a split pinline and box
  // on grey bars, which the frame draws since 4.56 (its pair masters, riding
  // the `m` tick): their `two-colour` gap is no gap any more (gapDrawnBy),
  // and they are exact like the mono lands, the pair and the switch on the
  // import patch. Four print variations are pinned `nearest` (Scryfall has
  // no field for any): the spells' dark type bar and box (TDM, WOE, ACR,
  // EOE, many SLD drops), a dark type bar alone over the tinted box (FRA
  // #380–381, four SLD drops), 2025's shadow box under the land's own bars
  // (every two-colour run from the SPG fetch lands on: ECL, SOS, MSH, FRA
  // #397–401) and the short box (the SNC triomes, UNF's shock lands, SLD
  // #456–460) — 4.37's variants. The crowned and nicknamed ones (LTR #343 /
  // #754, HOC #50 / #90, LTC's Bag End) keep their crown / nickname gap: no
  // crowned twin of the land masters exists.
  ...withGaps(
    {
      key: "borderless/land",
      exactLabel: "Borderless land",
      match: { borders: ["borderless"], kinds: ["land"] },
      outcome: { status: "exact", template: { family: "borderless" } },
    },
    ["etched", "nickname", "crown", "nyx", "two-colour", "two-colour-hybrid", "short-box", "dark-type-and-box", "dark-type-bar", "shadow-box", "light-box"],
  ),
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
      // …and, once the full-art token design is verified in the card's
      // colour (1.23, token design 4: every borderless token is an M20+
      // printing — WONE, WMOM, SLD, 19 of 19 on Scryfall 2026-09-29), that
      // design at the height its text asks for: still `nearest` (the
      // borderless dress is 4.37), but the bordered design it prints.
      onceVerified: { family: "m20" },
      reason: "PipGlyph doesn't have the borderless token frame yet",
      blockedBy: "4.37",
    },
  },
  // A borderless Vehicle (63 printings + 4 nicknamed, Scryfall 2026-10-12)
  // prints the brown plate on no frame at all: it stays `nearest` on the
  // borderless artifact frame (the `vehicle` gap — no borderless Vehicle
  // plate exists), and its bordered landing (1.18) is the Vehicle frame once
  // that is verified in its colour, the silver artifact frame until then
  // (`landOnOnceVerified`; the gap rules inherit it).
  // A borderless Spacecraft (EOC #1 Hearthhull, #2 Inspirit) floats the
  // station frame's bands, badges and plate over the art: the `station`
  // gap first — the most visible miss. PipGlyph draws that dress since TODO
  // 4.27a step 2 (`m15borderlessstation`), but as every edge-to-edge frame
  // it is no import's landing (Scryfall's art crop is the window: 1.18), so
  // the import lands on the BORDERED station frame once that is verified in
  // the card's colour (stationDress, as the borderless Vehicle does), the
  // artifact frame before.
  ...stationDress(
    withGaps(
      {
        key: "borderless/standard",
        exactLabel: "Borderless frame",
        match: { borders: ["borderless"] },
        outcome: { status: "exact", template: { family: "borderless" }, landOnOnceVerified: vehicleStandIn("borderless") },
      },
      ["station", "etched", "nickname", "crown", "nyx", "vehicle", "colour-indicator", "two-colour", "two-colour-hybrid", "light-box"],
    ),
    { standIn: stationStandIn("borderless", "an import draws its picture in the bordered Station frame's window") },
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
    // 1993 too since TODO 4.54 retired "alphatoken" (no such print exists:
    // only a hand-built or mislabelled printing reaches it).
    match: { frames: ["1993", "1997", "2003"], kinds: ["token"] },
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
  // Every token from Core Set 2020 on wears the full-art token design (4.48 /
  // 4.50): its template at the height the text asks for, the artifact one
  // for an Artifact (the "m20" family). Until that template is verified in
  // the card's colour the 2014–19 arch (m15token, or its text box or
  // artifact dress) is the nearest; once it is, this rule names it instead
  // (`onceVerified`) and is exact (`exactOnceVerified`), a gap still naming
  // the item that finishes the match. The earlier 2015-frame tokens ARE the
  // arch: era/2015, exact.
  ...withGaps(
    {
      key: "token/m20",
      exactLabel: "M20 full-art token frame",
      match: { frames: ["2015"], kinds: ["token"], m20Design: true },
      outcome: {
        status: "nearest",
        template: { family: "m15" },
        onceVerified: { family: "m20" },
        exactOnceVerified: true,
        reason: "PipGlyph's full-art token frame isn't verified yet",
        blockedBy: "4.48",
      },
    },
    ["dfc-token-transform", "nyx-dress", "border", "crown", "two-colour", "two-colour-hybrid"],
    // The M20 token's crown is its own floating crown round the name pill
    // (TFDN #13) and its two-colour look a central split (TMKM #10) —
    // never the arch's (4.6f): 4.48's, drawn by the m20token* templates
    // since its last pieces (M20_TOKEN_CROWN, the `<pair>` masters). Until
    // the full-art template is verified in the card's colour the arch stands
    // in and the gap names 4.48; after, the gap is drawn there (gapDrawnBy:
    // onceVerifiedMatch is exact). No token prints the hybrid dress (no cost).
    { crown: "4.48", "two-colour": "4.48", "two-colour-hybrid": "4.48" },
  ),
  // The 2014–19 arch tokens that print the TALL text box (TODO 4.55: the 21
  // pinned printings, TALL_BOX_TOKEN_PINS — Scryfall can't tell the height
  // and the text length doesn't: the SOI Clue's 39 characters print tall).
  // Until the arch's tall box is verified in the card's colour the regular
  // box is the nearest — where the import always landed (the `tall-box`
  // gap's answer before 4.55: the text shrinks to fit); once it is, this
  // rule names the tall box instead (`onceVerified`) and is exact
  // (`exactOnceVerified`), every other M15-era gap still naming its item.
  ...withGaps(
    {
      key: "token/tall-box",
      exactLabel: "2014–19 token, tall text box",
      match: { frames: ["2015"], kinds: ["token"], collectorIds: TALL_BOX_TOKEN_PINS },
      outcome: {
        status: "nearest",
        template: { family: "m15" },
        onceVerified: { family: "tokentall" },
        exactOnceVerified: true,
        reason: "PipGlyph's tall text box token frame isn't verified yet",
        blockedBy: "4.55",
      },
    },
    M15_ERA_GAPS.filter((gap) => gap !== "tall-box"),
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
  // The older full-art basic designs (TODO 4.40 / 4.41). Each lands where it
  // always did — the 2022 design, `m15fullartland` — until its own template
  // is verified in the card's colour; then the rule names it
  // (`onceVerified`): exact for the looks it reproduces (the stone ring, the
  // SNC ring, the plain bar), still nearest for the ones it only comes
  // closest to (MH1's snow bars, BRO, MID / VOW's dark bars, ZEN / J14 on
  // the 2003 frame) — their reasons hold on either frame.
  {
    key: "fullart/basic/split-bar/2003",
    exactLabel: "Zendikar full-art basic land (2003 frame)",
    match: { fullArt: true, singleBasic: true, sets: SPLIT_BAR_BASIC_2003_SETS },
    outcome: {
      status: "nearest",
      template: "m15fullartland",
      onceVerified: "m15fullartlandzen",
      reason: "PipGlyph doesn't have this full-art basic on the 2003 border yet",
      blockedBy: "4.43",
    },
  },
  // ZNR is the same design with its type line set further right (owner
  // Round 64): `fullart/basic/split-bar+znr-type-line`, nearest on the
  // stone ring before and after it is verified.
  ...withGaps(
    {
      key: "fullart/basic/split-bar",
      exactLabel: "Zendikar-style full-art basic land (split type bar)",
      match: { fullArt: true, singleBasic: true, sets: SPLIT_BAR_STONE_BASIC_SETS },
      outcome: {
        status: "nearest",
        template: "m15fullartland",
        onceVerified: "m15fullartlandzen",
        exactOnceVerified: true,
        reason: "PipGlyph's Zendikar full-art basic isn't verified yet",
        blockedBy: "4.40",
      },
    },
    ["znr-type-line"],
  ),
  {
    key: "fullart/basic/split-bar/snow",
    exactLabel: "Zendikar-style full-art snow basic land (split type bar)",
    match: { fullArt: true, singleBasic: true, sets: SPLIT_BAR_SNOW_BASIC_SETS },
    outcome: {
      status: "nearest",
      template: "m15fullartland",
      onceVerified: "m15fullartlandzen",
      reason: "PipGlyph doesn't print this design's snow-covered bars yet",
      blockedBy: "4.40",
    },
  },
  {
    key: "fullart/basic/split-bar/ring",
    exactLabel: "Full-art basic land (split type bar, ringed art)",
    match: { fullArt: true, singleBasic: true, sets: SPLIT_BAR_RING_BASIC_SETS },
    outcome: {
      status: "nearest",
      template: "m15fullartland",
      onceVerified: "m15fullartlandsnc",
      exactOnceVerified: true,
      reason: "PipGlyph's New Capenna full-art basic isn't verified yet",
      blockedBy: "4.40",
    },
  },
  {
    key: "fullart/basic/split-bar/bro",
    exactLabel: "The Brothers' War full-art basic land (split type bar)",
    match: { fullArt: true, singleBasic: true, sets: SPLIT_BAR_BRO_BASIC_SETS },
    outcome: {
      status: "nearest",
      template: "m15fullartland",
      onceVerified: "m15fullartlandsnc",
      reason: "PipGlyph doesn't have this set's lower bars yet",
      blockedBy: "4.40",
    },
  },
  {
    key: "fullart/basic/split-bar/dark",
    exactLabel: "Innistrad full-art basic land (dark split type bar)",
    match: { fullArt: true, singleBasic: true, sets: SPLIT_BAR_DARK_BASIC_SETS },
    outcome: {
      status: "nearest",
      template: "m15fullartland",
      onceVerified: "m15fullartlandsnc",
      reason: "PipGlyph doesn't have this set's dark bars yet",
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
      onceVerified: "m15fullartlandthb",
      exactOnceVerified: true,
      reason: "PipGlyph's plain-bar full-art basic isn't verified yet",
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
  // The Expeditions (TODO 4.11 wave 1): two looks, two frames — the 2020
  // Zendikar Rising Expeditions (ZNE) on `expeditionland`, the 2015 Battle
  // for Zendikar / Oath Expeditions (EXP) on `expeditionlandbfz`. Both are
  // exact once verified (withVerification), but for a two-colour land
  // (the duals and the fetch lands): its pinline prints its two colours,
  // which neither frame draws yet — 4.11's pair masters. Until then it lands
  // on the frame's plain land master `c` (twoColourLandOnPlainFrame, owner
  // 2026-10-22), nearest through this gap.
  ...withGaps(
    {
      key: "expedition",
      exactLabel: "Zendikar Rising Expedition",
      match: { setTypes: ["masterpiece"], sets: ["zne"] },
      outcome: { status: "exact", template: "expeditionland" },
    },
    ["two-colour"],
    { "two-colour": "4.11" },
  ),
  ...withGaps(
    {
      key: "expedition/bfz",
      exactLabel: "Battle for Zendikar Expedition",
      match: { setTypes: ["masterpiece"], sets: ["exp"] },
      outcome: { status: "exact", template: "expeditionlandbfz" },
    },
    ["two-colour"],
    { "two-colour": "4.11" },
  ),

  // --- 1.4: pinned showcase runs -------------------------------------------
  // The commander set's scroll printings, LTC #411–490 (80: Scryfall's
  // `scroll` promo type on every one, and the scroll frame by eye on #411,
  // #465, #485 and #490, 2026-10-21) print the same frame as LTR's run.
  // Exact once verified since TODO 4.11 (Card Conjurer's 'Scroll' masters
  // have the printed black border: off BORDER_PENDING_TEMPLATES). A
  // two-colour printing (80 of the 359: LTR #642–686, LTC #449–484) prints
  // the colour halves under gold bars, which the template doesn't draw yet
  // (the pack's 'Multicolored Bars' dress, a 4.11 follow-up): nearest.
  ...withGaps(
    {
      key: "showcase/ltr/scroll",
      exactLabel: "The Lord of the Rings scroll showcase",
      match: { collectors: { ltr: [[452, 712], [723, 730]], ltc: [[411, 490]] } },
      outcome: { status: "exact", template: "lotrscroll" },
    },
    ["two-colour", "two-colour-hybrid"],
    { "two-colour": "4.11", "two-colour-hybrid": "4.11" },
  ),
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
  // Exact once verified since TODO 4.11 (Card Conjurer's 'Tarkir' masters
  // have the printed black border: off BORDER_PENDING_TEMPLATES). Its one
  // two-colour printing (#60 / #190 Taigam, W/U) is the frame's own split
  // wings (FrameProfile.twoColorSplit), so no two-colour gap.
  {
    key: "showcase/mul/tarkir",
    exactLabel: "Multiverse Legends Tarkir showcase (Dragon Wing)",
    match: { collectors: { mul: [[1, 1], [60, 60], [131, 131], [190, 190]] } },
    outcome: { status: "exact", template: "tarkirdragon" },
  },
  // Multiverse Legends' three Theros demigods print the same constellation
  // frame, crown included (checked by eye against THB #259 / #262,
  // 2026-10-21): Daxos #2, Tymaret #18, Renata #28 and their halo-foil
  // twins #132, #148, #158 (the serialized "z" printings too). Not their
  // etched twins (#67, #83, #93: the etched frame, other art), nor the
  // plane's three two-colour legends (Arixmethes #32, Atris #34, Kroxa #49
  // and twins), which print a starless frame with a split pinline — they
  // stay `showcase/mul`.
  {
    key: "showcase/thb/constellation",
    exactLabel: ({ set }) =>
      set === "mul" ? "Multiverse Legends Theros showcase (constellation)" : "Theros Beyond Death constellation showcase",
    match: {
      collectors: {
        thb: [[258, 268]],
        mul: [[2, 2], [18, 18], [28, 28], [132, 132], [148, 148], [158, 158]],
      },
    },
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
  // Two whole sets in a frame of their own that Scryfall flags as no more
  // than `inverted` (no `showcase` effect), so `era/2015` called them exact
  // on M15 and nothing reached the request log (the showcase survey,
  // 2026-10-21). They land where they always did — the kind's M15 frame,
  // a transform card on its double-faced front body, the one Vehicle on
  // the Vehicle frame once that is verified — as its nearest, and each
  // import logs the ask. Not `showcase/…` keys: both print the standard
  // legendary crown in their own tones (DBL #1, #240, #512; SS2 #8), so a
  // legendary one keeps importing with the crown on (crownSwitchFromPrinting
  // turns it off on a showcase signature).
  //   • Innistrad: Double Feature (DBL, 2022; 535 printings): every card in
  //     the black-and-white "silver screen" frame.
  //   • Signature Spellbook (SS1 2018, SS2 2019, SS3 2020; 24 printings):
  //     the Spellbook frame — the art behind a translucent text box.
  {
    key: "double-feature",
    exactLabel: "Innistrad: Double Feature black-and-white frame",
    match: { sets: ["dbl"] },
    outcome: {
      status: "nearest",
      template: { family: "m15" },
      reason: "PipGlyph doesn't have Double Feature's black-and-white frame yet",
      blockedBy: "4.11",
      // The M15 frame here is a stand-in itself: a verified artifact frame
      // is never kept over the Vehicle frame (Honeymoon Hearse DBL #427).
      landOnOnceVerified: { ...vehicleStandIn("in Double Feature's black-and-white frame"), overOwnFrame: true },
    },
  },
  {
    key: "signature-spellbook",
    exactLabel: "Signature Spellbook frame",
    match: { sets: ["ss1", "ss2", "ss3"] },
    outcome: {
      status: "nearest",
      template: { family: "m15" },
      reason: "PipGlyph doesn't have the Signature Spellbook frame yet",
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
  // A showcase station printing (TRK #557 U.S.S. Enterprise-D) says both —
  // and since TODO 4.27a step 2 lands on the bordered Spacecraft frame once
  // that is verified in its colour (stationDress: the tiers drawn, still
  // nearest — the one-off design is 4.11's).
  ...stationDress(
    withGaps(
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
      ["station"],
      STATION_SHOWCASE,
    ),
    // The frame here is the M15 stand-in itself, so the station frame is
    // named instead (a landing would never replace a verified stand-in).
    { own: { family: "station" } },
  ),

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
  // An extended-art Vehicle (49 printings, Scryfall 2026-10-12) prints the
  // brown plate too, and the extended-art frame has none (the `vehicle`
  // gap): while that frame isn't verified in the card's colour the import
  // lands on the Vehicle frame once THAT is, instead of the silver artifact
  // frame (`landOnOnceVerified`).
  // An extended-art Spacecraft (13 printings: EOE #321–355, EOC #27 / #34,
  // TRK #481) prints the station frame without the art window's rails: the
  // `station` gap, before the pieces the extended-art frame lacks. Its own
  // frame exists since TODO 4.27a step 2 (`extendedartstation`): once that
  // is verified in the card's colour the gap rule names it and is exact
  // (stationDress) — the oracle text is already the tiers' grammar; until
  // then the bordered station frame is its landing once THAT is verified,
  // the extended-art frame before (still nearest either way).
  // …and a Universes Beyond extended-art printing (1,124) the streaked
  // dress the extended-art frame has no twin for (TODO 4.25).
  ...stationDress(
    withGaps(
      {
        key: "extendedart",
        exactLabel: "Extended-art frame",
        match: { effectsAny: ["extendedart"] },
        outcome: { status: "exact", template: { family: "extended" }, landOnOnceVerified: vehicleStandIn("extended art") },
      },
      ["layout", "dfc", "station", "etched", "border", "universes-beyond", "crown", "vehicle", "two-colour", "two-colour-hybrid"],
    ),
    {
      standIn: stationStandIn("extended art", "PipGlyph's extended-art Station frame isn't verified in its colour yet"),
      own: "extendedartstation",
      exact: true,
    },
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

  // --- 5.4: the double-faced kinds -------------------------------------------
  // A transform / modal printing whose faces land on the double-faced bodies
  // (the mapper's dfcImportOf: the Transform kind since 5.1a, the Modal kind
  // since 5.1b) is EXACT on its front body — the `dfc` gap is drawn there
  // (gapDrawnBy) — and the creator's verification (withVerification,
  // finalizeImportMatch) says "not yet verified" until the front body is
  // ticked in the front's colour AND the back body in the back's; a
  // 2003-frame one (ISD / DKA / AVR) is nearest on the M15 bodies, a devoid
  // or snow one (MH3 #253 Drowner of Truth, KHM #179 Jorn) nearest on the
  // body for its dress and landing on the era's dress frame (5.11: no devoid
  // or snow double-faced body exists). The walker, colourless-face and
  // borderless rules above take theirs first.
  {
    key: "dfc/2003",
    exactLabel: "Transform frame (2003)",
    match: { frames: ["2003"], kinds: ["transform"] },
    outcome: {
      status: "nearest",
      template: { family: "dfc" },
      reason: "PipGlyph's transform frames are M15-era",
      blockedBy: "4.10",
    },
  },
  // A devoid or snow double-faced printing (MH3's five devoid MDFCs, KHM
  // #179 Jorn): the printing's frame IS the body, nearest for its dress,
  // and the import LANDS on the era's dress frame with a legacy back
  // (dfcImportOf blocks it as "dress"; `landOn` the m15 family's pick, which
  // reads the effects: m15devoid / m15snow) — today's landing, never the
  // plain body as a look the print doesn't have (5.1b skeptic: without the
  // block `modal/2015` judged Jorn EXACT on the plain modal front, and an
  // unverified Drowner fell to plain m15).
  {
    key: "dfc/devoid",
    exactLabel: "Devoid double-faced card",
    match: { dfcBlocked: ["dress"], effectsAny: ["devoid"] },
    outcome: {
      status: "nearest",
      template: { family: "dfc" },
      landOn: { family: "m15" },
      reason: "a devoid double-faced card prints the devoid frame, which PipGlyph's double-faced bodies don't dress yet",
      blockedBy: "5.11",
    },
  },
  {
    key: "dfc/snow",
    exactLabel: "Snow double-faced card",
    match: { dfcBlocked: ["dress"], effectsAny: ["snow"] },
    outcome: {
      status: "nearest",
      template: { family: "dfc" },
      landOn: { family: "m15" },
      reason: "a snow double-faced card prints the snow frame, which PipGlyph's double-faced bodies don't dress yet",
      blockedBy: "5.11",
    },
  },
  ...withGaps(
    {
      key: "modal/2015",
      exactLabel: "M15 (2015) modal double-faced frame",
      match: { frames: ["2015"], kinds: ["mdfc"] },
      outcome: { status: "exact", template: { family: "dfc" } },
    },
    DFC_BODY_GAPS,
  ),
  ...withGaps(
    {
      key: "transform/2015",
      exactLabel: "M15 (2015) transform frame",
      match: { frames: ["2015"], kinds: ["transform"] },
      outcome: { status: "exact", template: { family: "dfc" } },
    },
    // The Ixalan parchment land back (5.8) is the most visible miss after an
    // unmodelled layout; the rest are the M15 era's.
    ["layout", "parchment-land-back", ...DFC_BODY_GAPS.filter((gap) => gap !== "layout")],
  ),

  // --- 5.5 (b): the transforming Saga -----------------------------------------
  // A transforming Saga the mapper puts on the double-faced saga front
  // (dfcImportOf: kind `saga` — NEO's 23 and their promos, TLA #117) is
  // EXACT on it (the `dfc` gap is drawn there), verified on both faces like
  // every double-faced landing (finalizeImportMatch: short of either it
  // lands on the one-faced saga frame with a legacy back, as before). A
  // Saga BACK (MOM's praetors, LCI #189, FIN's summons) and a colourless
  // Avatar back keep their rules (`layout/2015` + the `dfc` gap;
  // `dfc/colourless-face`).
  ...withGaps(
    {
      key: "saga/dfc/2015",
      exactLabel: "Saga (transform front) frame",
      match: { frames: ["2015"], kinds: ["saga"], dfcKinds: ["saga"] },
      outcome: { status: "exact", template: { family: "dfc" } },
    },
    ["nyx-saga-front", "etched", "border", "universes-beyond", "crown", "two-colour", "two-colour-hybrid"],
  ),

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
    // (TODO 4.6.0; 4.6f adds them) — and a two-colour split or aftermath
    // (HOU #157 Driven // Despair g|b) prints each part in its own colour:
    // that is 4.26's per-part colour, not the two-colour dress, so the gap's
    // item follows the frame the printing lands on (as the registry's
    // aftermath/m note says).
    // A Universes Beyond saga (254 printings), adventure or split wears
    // the streaked dress the layout frames have no twin for (TODO 4.25).
    // A Prepare printing whose spell's page is another colour (TODO 4.27):
    // the per-part colour, 4.26.
    ["omen", "dfc", "etched", "border", "universes-beyond", "crown", "two-colour", "two-colour-hybrid", "part-colour"],
    { "two-colour": LAYOUT_TWO_COLOUR_ITEM, "two-colour-hybrid": LAYOUT_TWO_COLOUR_ITEM },
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
    ["border", "marks", "two-line-footer"],
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
    [...OLD_ERA_GAPS, "timeshifted-frame", "reprint-colours"],
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
  // A Spacecraft or a Planet on the plain 2015 frame (TODO 4.27a, step 0;
  // Edge of Eternities 2025 → today: 65 of the 91 station printings, Scryfall
  // 2026-10-13) prints the STATION frame, which PipGlyph doesn't draw: the
  // import lands where it always did — the artifact frame for a Spacecraft,
  // the land frame for a Planet, its tiers as plain rules text — but as that
  // frame's NEAREST, and the request log counts the ask (before this rule
  // `era/2015` called them exact and nothing was logged). Since the build
  // (4.27a step 1) the station frame exists: once `m15station` /
  // `m15stationland` is verified in the card's colour this rule names it
  // instead (`onceVerified`, as the Vehicle rule below) and is exact — the
  // oracle text is already the tiers' grammar (lib/cards/station.ts), so the
  // import draws its bands as it lands. Until then: the same landing as
  // before, saying the frame isn't verified.
  {
    key: "station/2015",
    exactLabel: ({ facts }) => (facts.kind === "land" ? "Station frame (Planet)" : "Station frame (Spacecraft)"),
    match: { frames: ["2015"], ...GAPS.station.match },
    outcome: {
      status: "nearest",
      template: { family: "m15" },
      onceVerified: { family: "station" },
      exactOnceVerified: true,
      reason: "PipGlyph's Station frame isn't verified yet",
      blockedBy: GAPS.station.blockedBy,
    },
  },
  // A Vehicle on the plain 2015 frame (TODO 4.5c; Kaladesh 2016 → today)
  // prints the Vehicle frame: the bronze frame and the brown P/T plate with
  // white digits. Until `m15vehicle` is verified in the card's colour the
  // artifact frame is the nearest, as before; once it is, this rule names it
  // instead (`onceVerified`) and is exact (`exactOnceVerified`) — the plate
  // gap is drawn there (gapDrawnBy), every other M15-era gap still names
  // the item that finishes the match (a two-colour Vehicle prints the split,
  // DFT #188–220: the frame's ten pair masters draw it). A Vehicle BACK face
  // (BOT's converts), the extended-art and borderless Vehicles and the one
  // silver-plated print (SILVER_PLATE_VEHICLE_PINS) keep the `vehicle` gap —
  // the extended-art and borderless ones LANDING on the Vehicle frame once
  // it is verified (their rules' `landOnOnceVerified`), still `nearest`.
  ...withGaps(
    {
      key: "vehicle/2015",
      exactLabel: "Vehicle frame (2015)",
      match: BROWN_PLATE_VEHICLE,
      outcome: {
        status: "nearest",
        template: { family: "m15" },
        onceVerified: "m15vehicle",
        exactOnceVerified: true,
        reason: "PipGlyph's Vehicle frame isn't verified yet",
        blockedBy: "4.5c",
      },
    },
    M15_ERA_GAPS.filter((gap) => gap !== "vehicle"),
  ),
  // A Universes Beyond printing on the plain 2015 frame (TODO 4.25; the
  // 2021-11 Secret Lair drops and 40K 2022 → Final Fantasy 2025: 3,784
  // printings, Scryfall 2026-10-13) prints the Universes Beyond frame.
  // Until its template is verified in the card's colour the M15 frame is
  // the nearest — where the import always landed; once it is, this rule
  // names it (`onceVerified`) and is exact (`exactOnceVerified`), every
  // other M15-era gap still naming its own item. Spells, artifacts and
  // lands only: a Vehicle keeps the Vehicle rule above (the bronze frame
  // is the closer one). A colourless NON-artifact spell (ACR #1, FIN #2,
  // WHO #9 / #614) takes the rule too since the spell frame's colourless
  // master is print's see-through frame (TODO 4.25 follow-up, owner Round
  // 57): the see-through `m15/c` is its nearest until `m15ub/c` is ticked.
  ...withGaps(
    {
      key: "ub/2015",
      exactLabel: "Universes Beyond frame (2021–25)",
      match: {
        frames: ["2015"],
        borders: ["black"],
        kinds: ["land", "artifact", ...UB_SPELL_KINDS],
        layouts: ["normal"],
        // The foil-etched and "inverted" Universes Beyond printings (ACR's
        // etched run, 40K's, the Fallout serials) are dresses of their own:
        // they stay where they landed.
        effectsNone: ["etched", "inverted"],
        allOf: [UB_DRESS],
      },
      outcome: {
        status: "nearest",
        template: { family: "m15" },
        onceVerified: { family: "ub" },
        exactOnceVerified: true,
        reason: "PipGlyph's Universes Beyond frame isn't verified yet",
        blockedBy: "4.25",
      },
    },
    M15_ERA_GAPS.filter((gap) => gap !== "universes-beyond"),
  ),
  // An enchantment on the plain 2015 frame that prints the Nyx dress (TODO
  // 4.7; Scryfall's `enchantment` frame effect — `frame:nyxtouched`: every
  // enchantment creature and enchantment artifact, C15 2015 → today, and
  // every enchantment since Foundations 2024; 983 plain black-bordered
  // printings on 2026-10-13) is `era/2015+nyx`, as it always was: the
  // kind's M15 frame, `nearest`, the starfield its gap. That rule now names
  // `m15nyx` once it is verified in the card's colour (nyxOnceVerified:
  // `onceVerified`, exact — the starfield is drawn there, gapDrawnBy; a
  // legendary one wears the Nyx crown, a two-colour one the frame's pair
  // masters, both drawn; any later gap that still holds keeps it nearest).
  // Until then NOTHING about the match changes — signature, reason, gaps,
  // landing. Only where the Nyx frame dresses the card as it stands
  // (kindMisfit): the Enchantment kind, a creature or an artifact whose face
  // says Enchantment. A saga (4.5d), a class, a case and an adventure (the
  // `layout` gap), a double-faced printing (`dfc`: the flag is the card's,
  // only one face is the enchantment — FIN's Dominants, NEO's sagas) and a
  // token (4.51's `nyx-dress`) never reach it, and the borderless,
  // extended-art and showcase printings are named by earlier rules.
  ...nyxOnceVerified(
    withGaps(
      {
        key: "era/2015",
        exactLabel: "M15 (2015) frame",
        match: { frames: ["2015"] },
        outcome: { status: "exact", template: { family: "m15" } },
      },
      M15_ERA_GAPS,
    ),
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
  const of = (spec: TemplateSpec) => (typeof spec === "string" ? [spec] : FAMILIES[spec.family].produces);
  const later = rule.outcome.onceVerified;
  return later ? [...of(rule.outcome.template), ...of(later)] : of(rule.outcome.template);
}

const RULE_BY_KEY: ReadonlyMap<string, Rule> = new Map(FRAME_SIGNATURE_RULES.map((rule) => [rule.key, rule]));

/**
 * Whether a gap signature logged before its piece shipped ("era/2015+crown",
 * "…+two-colour" — frame_requests rows keep their signature) is drawn today
 * by `template`, the frame the logged import landed on (4.6 review
 * 2026-09-29): the same printing imports exact now, so the admin page lists
 * the row as answered, not as open and blocked by an item. Only when that
 * frame is one the signature's own rule names (a borderless printing that
 * landed on its bordered equivalent is still not exact) and draws the gap's
 * piece (gapDrawnBy — for a family that waits on another item for it, only
 * on the frame the rule names once verified: the M20 token's crown and pairs
 * on the full-art templates, never on the arch). A "two-colour" row logged before the hybrid dress
 * had its own gap may be a hybrid printing: it counts only where the frame
 * draws both dresses, or only lands (a land's split is never hybrid), or
 * where the frame's gold-split printings are its gold master
 * (GOLD_PAIR_TEMPLATES: devoid's one hybrid printing is an MDFC, logged
 * under the dfc gap, never this one). A split-only frame that hosts
 * creatures (m15artifact, m15snow) keeps such a row open: it can't tell a
 * hybrid printing from a gold one.
 */
export function signatureDrawnOn(signature: string, template: string | null | undefined): boolean {
  const rule = RULE_BY_KEY.get(signature);
  const plus = signature.lastIndexOf("+");
  if (!rule || !template || plus < 0) return false;
  const gap = signature.slice(plus + 1);
  if (!Object.prototype.hasOwnProperty.call(GAPS, gap)) return false;
  const key = gap as GapKey;
  const on = template as FrameTemplate;
  // A gap the family waits on another item for counts as drawn only on the
  // frame the rule names once verified (the M20 token's crown and pairs on
  // the full-art templates, TODO 4.48) — never on its stand-in, and only
  // where that frame is EXACT once verified (`exactOnceVerified`): a
  // showcase station printing on the bordered Spacecraft frame is still
  // nearest, its row open on 4.11.
  const later = rule.outcome.onceVerified;
  const onLater =
    later !== undefined &&
    rule.outcome.exactOnceVerified === true &&
    (typeof later === "string" ? [later] : FAMILIES[later.family].produces).includes(on);
  if ((rule.gapBlockedBy?.[key] && !onLater) || !templatesOfRule(rule).includes(on) || !gapDrawnBy(key, on)) return false;
  if (key === "two-colour" && !gapDrawnBy("two-colour-hybrid", on)) {
    // …nor a token's (no cost: a token never prints the hybrid dress — the
    // M20 token's pairs on the full-art templates, TODO 4.48).
    return (
      GOLD_PAIR_TEMPLATES.has(on) ||
      (templateSupportsKind(on, "land") && !templateSupportsKind(on, "creature")) ||
      (templateSupportsKind(on, "token") && !templateSupportsKind(on, "creature"))
    );
  }
  return true;
}

/** Templates no printed signature resolves to exact or nearest: the
 *  transform (TODO 5.1a) and modal (5.1b) BACK bodies — a printing resolves
 *  to its FRONT template; its back wears the body the family and the back's
 *  type derive (lib/cards/dfc.ts bodyFor, the mapper's business in 5.4),
 *  never a signature of its own. And the Spacecraft's BORDERLESS dress
 *  (TODO 4.27a step 2): its two printings (EOC #1 / #2) resolve to the
 *  borderless artifact frame and land on the bordered station frame — as
 *  every edge-to-edge frame, it is never an import's landing (Scryfall's art
 *  crop is the window, 1.18): a maker's pick only. (The double-faced saga
 *  BACK, TODO 5.5 (b) PR 2, is a back body like the others: a Saga back's
 *  printing resolves to its front.) */
export const TEMPLATES_WITHOUT_PRINTED_SIGNATURE: readonly FrameTemplate[] = ["m15dfcback", "m15dfcbackleft", "m15dfclandback", "m15mdfcback", "m15mdfclandback", "m15borderlessstation", "m15borderlessdfcback", "m15borderlessmdfcback", "sagadfcback"];

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
        !(candidate.gaps && gapDrawnBy(candidate.gaps[0], templateOf(candidate), ctx.border)),
    ) ?? FRAME_SIGNATURE_RULES[FRAME_SIGNATURE_RULES.length - 1];
  const template = templateOf(rule);

  let status = rule.outcome.status;
  let reason = status === "exact" ? null : textOf(rule.outcome.reason, ctx);
  let blockedBy = blockedByOn(rule.outcome.blockedBy, template);
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
  // A rule that names its own landing (a double-faced printing whose
  // colourless face can't wear the body yet, 5.11): the import lands there.
  const ruleLanding = rule.outcome.landOn;
  if (!landOn && ruleLanding) {
    landOn = typeof ruleLanding === "string" ? ruleLanding : FAMILIES[ruleLanding.family].pick(ctx);
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

  // The frame the import lands on instead once verified, the match keeping
  // its own frame and status (a borderless or extended-art Vehicle on the
  // bordered Vehicle frame): only for the printings the rule names, only a
  // frame that dresses this card as it stands and holds the cropped art.
  const standIn = rule.outcome.landOnOnceVerified;
  const landOnOnceVerified =
    standIn &&
    status !== "exact" &&
    standIn.template !== (landOn ?? template) &&
    matches(standIn.match, ctx) &&
    !(kind && kindMisfit(standIn.template, kind, ctx)) &&
    !artReachesCardEdge(getFrameProfile(standIn.template))
      ? {
          template: standIn.template,
          reason: rule.gaps?.[0] === standIn.gap ? textOf(standIn.reason, ctx) : null,
          ...(standIn.overOwnFrame ? { overOwnFrame: true as const } : {}),
        }
      : undefined;

  // Every anatomy gap that holds: the matched gap rule's own, then the
  // base's later ones (FrameMatch.gaps).
  // A gap the frame it lands on draws (the crown, a two-colour dress —
  // gapDrawnBy) is no gap there.
  const holding = (list: readonly GapKey[] | undefined, on: FrameTemplate) =>
    list
      ? list.filter((gap, index) => (index === 0 || matches(GAPS[gap].match, ctx)) && !gapDrawnBy(gap, on, ctx.border))
      : [];
  const gaps = holding(rule.gaps, template);

  // What the match says after the swap, on a rule exact once verified: the
  // first gap that still holds (or the later frame's border) keeps it
  // nearest, with its own reason and item; nothing → exact.
  let onceVerifiedMatch: FrameMatch["onceVerifiedMatch"];
  if (onceVerified && rule.outcome.exactOnceVerified) {
    const laterGaps = holding(rule.gapsOnceVerified, onceVerified);
    if (laterGaps.length > 0) {
      const first = GAPS[laterGaps[0]!];
      onceVerifiedMatch = {
        status: "nearest",
        reason: textOf(first.reason, ctx),
        blockedBy: blockedByOn(rule.gapBlockedBy?.[laterGaps[0]!] ?? first.blockedBy, onceVerified),
        gaps: laterGaps,
      };
    } else if (isBorderPending(onceVerified, colorKeyOf(facts))) {
      onceVerifiedMatch = {
        status: "nearest",
        reason: `PipGlyph's ${describeFrame(onceVerified)} frame doesn't have the printed border yet`,
        blockedBy: "4.35",
      };
    } else {
      onceVerifiedMatch = { status: "exact", reason: null };
    }
  }

  // The Nyx dress's stand-in (TODO 4.51): a Nyx token names the dress of its
  // full-art template once verified; until the dress is, the plain template
  // — nearest, with whatever of the rule's gaps it doesn't draw (the
  // starfield first) — where that one is verified, as before the dress.
  let onceVerifiedFallback: FrameMatch["onceVerifiedFallback"];
  if (onceVerified && rule.outcome.exactOnceVerified && isM20NyxTokenTemplate(onceVerified)) {
    const plain = m20TokenTwinWithoutNyx(onceVerified);
    const plainGaps = holding(rule.gapsOnceVerified, plain);
    if (plainGaps.length > 0) {
      const first = GAPS[plainGaps[0]!];
      onceVerifiedFallback = {
        template: plain,
        match: {
          status: "nearest",
          reason: textOf(first.reason, ctx),
          blockedBy: blockedByOn(rule.gapBlockedBy?.[plainGaps[0]!] ?? first.blockedBy, plain),
          gaps: plainGaps,
        },
      };
    }
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
    ...(onceVerified ? { onceVerified } : {}),
    ...(onceVerifiedMatch ? { onceVerifiedMatch } : {}),
    ...(onceVerifiedFallback ? { onceVerifiedFallback } : {}),
    ...(landOnOnceVerified ? { landOnOnceVerified } : {}),
    ...(gaps.length > 0 ? { gaps } : {}),
  };
}

/**
 * Frames whose two-colour (gold-split) printings carry NO split at all: the
 * gold master IS the printed look, so the `two-colour` gap is no gap there.
 * Devoid (TODO 4.6f, wave 2c; measured 2026-10-02): every two-colour devoid
 * printing on the devoid frame — BFZ #199–207, OGW #148–150, MH3 #177 /
 * #204 / #206 / #208 and their reprints (DDP, M3C, PLST, the prerelease
 * stamps, MH3 #517 / #518): 29 of the 31 two-colour printings Scryfall lists
 * for the keyword — prints the UNIFORM gold devoid frame: the title ring
 * reads gold (R − B 65–119) at every x on the eight checked (OGW #148 /
 * #149 / #150, BFZ #200 / #203 / #206, MH3 #177 / #204; the review
 * re-measured thirteen more — BFZ #199 / #201 / #202 / #204 / #205 / #207,
 * MH3 #206 / #208 / #517 / #518, M3C #272 / #275, DDP #64 — gold at both
 * ends of the body and the bar, R − B +78 … +119), where a mono devoid
 * print's ring is its colour. m15devoid's `m` tick is referenced to three
 * of them (Void Grafter, Flayer Drone, Abstruse Appropriation). The other
 * two: the one HYBRID devoid printing (MH3 #253, an MDFC) prints the split
 * hybrid dress, so `two-colour-hybrid` stays a gap; MH3 #342 is a
 * borderless `inverted` showcase, not the devoid frame at all (the
 * borderless rules take it).
 * The 1997 frame (`retro`; TODO 4.6h, measured 2026-10-08): its two-colour
 * gold cards print ONE gold frame — no pinline exists to split, and the
 * text box and its ring read the same at both ends as our gold master's do
 * (12 of 12: MIR #280, VIS #137, TMP #273, INV #226 / #264 / #282, PLS
 * #106 / #116, APC #114 / #121 / #126, ODY #290; left against right 10.5
 * in the box where the master's own shading gives 17.5). The frame's
 * two-colour LANDS are `retroland`'s pair masters, never this set.
 */
const GOLD_PAIR_TEMPLATES: ReadonlySet<FrameTemplate> = new Set<FrameTemplate>(["m15devoid", "retro"]);

/** True when `template` draws the anatomy a gap names — its PROFILES entry
 *  declares the crown overlay or the two-colour dress (lib/cards/anatomy.ts,
 *  TODO 4.6.0): each gap drops where the landing frame draws it, with
 *  nothing to keep in step here (m15, m15artifact and m15land draw the
 *  crown, 4.6a, and the pairs, 4.6b; the borderless, extended-art and snow
 *  frames theirs, 4.6f) — or, for the gold-split gap, where the frame's
 *  two-colour printings are its plain gold master (GOLD_PAIR_TEMPLATES). */
const UB_TEMPLATES: ReadonlySet<FrameTemplate> = new Set<FrameTemplate>(["m15ub", "m15ubartifact", "m15ubland"]);

function gapDrawnBy(gap: GapKey, template: FrameTemplate, border?: string): boolean {
  switch (gap) {
    // The border gap is ONE gap for white, silver, gold and yellow (TODO
    // 4.30): only a WHITE border is drawn, and only by a frame whose profile
    // declares it (the 1997 and 2003 frames). A caller that doesn't know the
    // printing's border (signatureDrawnOn: a logged "+border" row may be a
    // gold-bordered World Championship card) gets false.
    case "border":
      return border === "white" && frameAnatomyOf(template).border;
    case "crown":
      return frameAnatomyOf(template).crown;
    case "two-colour":
      // …and on split and aftermath (TODO 4.26), where a two-colour printing
      // is two one-colour halves (HOU #157 Driven // Despair g|b), not the
      // two-colour dress: drawn where each part draws its own colour.
      return (
        frameAnatomyOf(template).twoColor.includes("split") ||
        GOLD_PAIR_TEMPLATES.has(template) ||
        (PER_PART_COLOUR_TEMPLATES.has(template) && frameAnatomyOf(template).partColor === true)
      );
    // The Prepare page in its spell's own colour (TODO 4.26): the frames
    // whose profile declares a part in its own colour.
    case "part-colour":
      return frameAnatomyOf(template).partColor === true;
    case "two-colour-hybrid":
      return frameAnatomyOf(template).twoColor.includes("hybrid");
    // The double-faced marks (TODO 5.1a): a transform FRONT body draws them
    // (the icon well, the grey tab; the back body the card's back wears).
    case "dfc":
      return templateHasBackFace(template);
    // The Vehicle plate (TODO 4.5c): the Vehicle frame draws it.
    case "vehicle":
      return subtypeDressOf(template) === "Vehicle";
    // The Nyx starfield (TODO 4.7): the Nyx frame draws it.
    case "nyx":
      return isEnchantmentDress(template) && !isM20NyxTokenTemplate(template);
    // The token's Nyx dress (TODO 4.51): the starfield pill templates.
    case "nyx-dress":
      return isM20NyxTokenTemplate(template);
    // The Universes Beyond dress (TODO 4.25): its three frames draw it.
    case "universes-beyond":
      return UB_TEMPLATES.has(template);
    // The arch token's tall box (TODO 4.55): its two templates draw it.
    case "tall-box":
      return isArchTallTokenTemplate(template);
    // The station frame's tiers (TODO 4.27a): every frame that lays them
    // out (FrameProfile.tiers — the bordered pair and its dresses).
    case "station":
      return getFrameProfile(template).tiers !== undefined;
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
  // A transform FRONT body (5.1a) dresses the printing's front kind when
  // the Transform kind draws that card type (dfcFrontDressesKind): the
  // creator's gallery never lists it under that kind.
  if ((!templateSupportsKind(template, kind) && !dfcFrontDressesKind(template, kind)) || (templateIsBasicOnly(template) && !facts.singleBasic)) {
    return `PipGlyph's ${describeFrame(template)} frame doesn't dress ${kindWord(kind)} yet`;
  }
  // A subtype dress (the Vehicle frame, TODO 4.5c) for its subtype only.
  if (!subtypeFrameFits(template, facts.subtypes)) {
    return `PipGlyph's ${describeFrame(template)} frame dresses ${subtypeDressOf(template)}s only`;
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
//     print green); Riftstone Portal (JUD #143, its one printing) taps for
//     {C} alone — the {G} and {W} Scryfall lists are what it grants other
//     lands from the graveyard — and prints the plain land's orange box
//     (looked at 2026-10-08, TODO 4.6h);
//   • "gold" — fetch lands for "a basic land card" that print the gold land
//     frame although Scryfall lists no mana and no identity (Fabled Passage
//     ELD #244, Prismatic Vista MH1 #244; checked 2026-09-28). Evolving Wilds
//     (MSC #240) prints the grey colourless frame and needs no entry. So
//     does Multiversal Passage — "choose a basic land type", no mana listed
//     — on every printing (SPM #180, OM1 #181, the borderless SPM #206;
//     checked 2026-09-29, 4.34's survey: it was the one borderless land the
//     registry called exact in the wrong colour).
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
  ["Riftstone Portal", "colorless"],
  ["Urborg, Tomb of Yawgmoth", "colorless"],
  ["Fabled Passage", "gold"],
  ["Prismatic Vista", "gold"],
  ["Multiversal Passage", "gold"],
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

/** The Zendikar Expeditions' sets (TODO 4.11 wave 1): ZNE 2020 on
 *  `expeditionland`, EXP 2015 on `expeditionlandbfz` — Scryfall's
 *  `masterpiece` set type in both (the registry's two `expedition` rules). */
export const EXPEDITION_SETS: Readonly<Record<string, FrameTemplate>> = Object.freeze({ zne: "expeditionland", exp: "expeditionlandbfz" });

/**
 * True when a printing's TWO frame colours land on the plain land master
 * (`c`) instead of the gold one (owner 2026-10-22, TODO 4.11): a two-colour
 * Zendikar Expedition — the duals and the fetch lands, whose pinline prints
 * their two colours — while its frame draws no two-colour pinline pair
 * (`frameAnatomyOf(template).twoColor`). Both Expedition frames' plain land
 * master is their nearest look (the gold frame is the any-colour lands');
 * the `two-colour` gap still names it nearest and logs its request row.
 * The import (lib/scryfall/import-mapper.ts) reads it as FRAME data —
 * `printed_plain_land_master`, stored as FrameStyle.plainLandMaster — while
 * the card's `color_identity` stays its own (owner 2026-10-22: a frame
 * stand-in never rewrites a card's colour); the frame is drawn, gated and
 * verified in `c` (lib/cards/part-color.ts frameGateColors).
 */
export function twoColourLandOnPlainFrame(card: ScryfallCard, colors: readonly string[]): boolean {
  if (colors.length !== 2) return false;
  if ((card.set_type ?? "").trim().toLowerCase() !== "masterpiece") return false;
  const template = EXPEDITION_SETS[(card.set ?? "").trim().toLowerCase()];
  return template !== undefined && !frameAnatomyOf(template).twoColor.includes("split");
}

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
