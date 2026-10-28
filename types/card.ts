// Domain types for the cards system. The shape comes from the generated
// Database type in `types/supabase.ts` (regenerated whenever migrations
// change). This file narrows free-form columns (rarity, card_type, etc.)
// to safe enum unions that match the DB check constraints.

import type {
  Card as CardRow,
  CardInsert as CardRowInsert,
  CardUpdate as CardRowUpdate,
  CardComment as CardCommentRow,
  CardCommentInsert as CardCommentRowInsert,
  CardTemplate as CardTemplateRow,
  GameSystem as GameSystemRow,
  Profile as ProfileRow,
  Json,
} from "@/types/supabase";

// ---------------------------------------------------------------------------
// Enum unions — kept in sync with the cards table check constraints.
// ---------------------------------------------------------------------------

export const VISIBILITY_VALUES = ["private", "unlisted", "public"] as const;
export type Visibility = (typeof VISIBILITY_VALUES)[number];
/** The ONE copy source for a visibility's human label. */
export const VISIBILITY_LABELS: Record<Visibility, string> = {
  private: "Private",
  unlisted: "Unlisted",
  public: "Public",
};

export const RARITY_VALUES = [
  "common",
  "uncommon",
  "rare",
  "mythic",
] as const;
export type Rarity = (typeof RARITY_VALUES)[number];

export const RARITY_LABELS: Record<Rarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  mythic: "Mythic",
};

export const CARD_TYPE_VALUES = [
  "creature",
  "instant",
  "sorcery",
  "artifact",
  "enchantment",
  "land",
  "planeswalker",
  "battle",
  "token",
  // CR 114 (TODO 6.23, migration 0130): an emblem has no colour, cost, P/T
  // or rarity. Reached from the token kind's picker (the emblem kind); it
  // prints "Emblem" on the emblem frame (4.52).
  "emblem",
  // Legacy value kept for backward compatibility with existing saved cards.
  // New cards should use 'instant' or 'sorcery' directly.
  "spell",
] as const;
export type CardType = (typeof CARD_TYPE_VALUES)[number];

// Display-friendly labels for each card type, used in select menus and previews.
export const CARD_TYPE_LABELS: Record<CardType, string> = {
  creature: "Creature",
  instant: "Instant",
  sorcery: "Sorcery",
  artifact: "Artifact",
  enchantment: "Enchantment",
  land: "Land",
  planeswalker: "Planeswalker",
  battle: "Battle",
  token: "Token",
  emblem: "Emblem",
  spell: "Spell (legacy)",
};

export const COLOR_IDENTITY_VALUES = [
  "white",
  "blue",
  "black",
  "red",
  "green",
  "colorless",
  "multicolor",
] as const;
export type ColorIdentity = (typeof COLOR_IDENTITY_VALUES)[number];

export const COLOR_IDENTITY_LABELS: Record<ColorIdentity, string> = {
  white: "White",
  blue: "Blue",
  black: "Black",
  red: "Red",
  green: "Green",
  colorless: "Colorless",
  multicolor: "Multicolor",
};

/** WUBRG letter (plus C) → color identity, for deck data that stores letters
 *  (deck_cards.colors, mana costs, the deck analytics buckets). */
export const COLOR_LETTER_IDENTITY = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
  C: "colorless",
} as const satisfies Record<string, ColorIdentity>;
export type ColorLetter = keyof typeof COLOR_LETTER_IDENTITY;

// ---------------------------------------------------------------------------
// Narrowed row types — the DB stores enums as text, so we re-export rows with
// the enum unions baked in. Use these everywhere downstream (queries,
// preview components, server actions) so the rest of the app never has to
// guard against arbitrary strings.
// ---------------------------------------------------------------------------

export type Card = Omit<
  CardRow,
  | "visibility"
  | "rarity"
  | "card_type"
  | "color_identity"
  | "face_content"
  | "watermark"
  | "frame_preview"
  | "printed_types"
  | "nickname"
> & {
  visibility: Visibility;
  rarity: Rarity | null;
  card_type: CardType | null;
  color_identity: ColorIdentity[];
  // Narrowed from the generated Json columns (migration 0050, present in
  // types/supabase.ts): the DB stores opaque jsonb, downstream code gets the
  // typed FaceContent / CardWatermark shapes. NULL on every legacy row.
  face_content?: FaceContent | null;
  watermark?: CardWatermark | null;
  /** An admin's frame preview (TODO 2.3, migration 0121) — always private.
   *  Optional: a row read before the migration lands has no such key, so
   *  test it with `=== true`. */
  frame_preview?: boolean;
  /** The Types field as its maker typed it (TODO 3b.16, migration 0137):
   *  the words printed left of the dash, in their order ("" = emptied).
   *  NULL / absent = the line is built from `supertype` + `card_type`
   *  (lib/cards/card-display.ts typeLineWords). Optional: a row read by a
   *  select that does not name the column has no such key. */
  printed_types?: string | null;
  /** The card's nickname / flavour name (TODO 6.3, migration 0141): printed
   *  in the title bar, `title` on a plate under it, on a frame that declares
   *  the plate (lib/cards/nickname.ts). NULL / absent = none. Optional: a
   *  row read by a select that does not name the column has no such key. */
  nickname?: string | null;
};

export type CardInsert = Omit<
  CardRowInsert,
  | "visibility"
  | "rarity"
  | "card_type"
  | "color_identity"
  | "face_content"
  | "watermark"
> & {
  visibility?: Visibility;
  rarity?: Rarity | null;
  card_type?: CardType | null;
  color_identity?: ColorIdentity[];
  face_content?: FaceContent | null;
  watermark?: CardWatermark | null;
};

export type CardUpdate = Omit<
  CardRowUpdate,
  | "visibility"
  | "rarity"
  | "card_type"
  | "color_identity"
  | "face_content"
  | "watermark"
> & {
  visibility?: Visibility;
  rarity?: Rarity | null;
  card_type?: CardType | null;
  color_identity?: ColorIdentity[];
  face_content?: FaceContent | null;
  watermark?: CardWatermark | null;
};

export type GameSystem = GameSystemRow;
export type CardTemplate = CardTemplateRow;
export type Profile = ProfileRow;

// ---------------------------------------------------------------------------
// JSON shapes — explicit so server actions and the renderer agree on layout.
// ---------------------------------------------------------------------------

export type ArtPosition = {
  /** 0–1, where 0.5 centers the focal point. */
  focalX?: number;
  focalY?: number;
  /** 1.0 = no zoom, >1 zooms in, <1 zooms out. */
  scale?: number;
  // `rotation` is NOT a field: neither renderer draws it and the uploader never
  // writes it. lib/validation/card.ts still accepts the key so the two legacy
  // rows that carry `rotation: 0` keep saving.
};

// Back-face content for double-faced cards (DFCs). Persisted as jsonb on
// the same `cards` row (no join table). Shared fields like rarity, finish,
// set symbol, the collector fields and the anatomy switches live on the
// front-card row and apply to both faces — the back face carries its
// per-face content and, since Phase 5 (TODO 5.0a, design 2026-10-02,
// owner decision Q1: ONE card holds both faces), its own BODY and colour.
export type CardBackFace = {
  title: string;
  cost?: string;
  card_type?: CardType;
  supertype?: string;
  /** The face's Types field as typed (TODO 3b.16) — absent = the built
   *  line; "" = emptied. Display only, as the front's `printed_types`. */
  printed_types?: string;
  subtypes?: string[];
  rules_text?: string;
  flavor_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  artist_credit?: string;
  art_url?: string;
  art_position?: ArtPosition;
  /** The back's own BODY (Phase 5): a back-face template only — one whose
   *  profile declares `dfc.role === "back"` (lib/cards/dfc.ts; none exists
   *  until 5.1a). Absent on a LEGACY back (the 8 imported DFCs): the back
   *  draws on the FRONT's template and colour, as it always has
   *  (lib/cards/faces.ts). Written by the editor (5.2), the Q3 move and the
   *  import (5.4); re-derived at every save from the layout, the back's
   *  type and the card's icon family (`bodyFor`). */
  frame_style?: { template: FrameTemplate };
  /** The back's own frame colour, FrameStyle vocabulary. Absent = the
   *  front's (a legacy back). */
  color_identity?: ColorIdentity[];
};

/** The transform icon FAMILIES (TODO 5.0a, design 2026-10-02 §2.1 / §3.1):
 *  the printed pair of glyphs a transform card wears — `arrows` (today's
 *  ▲ / ▼, every transform printed since 2022-11; the default, owner
 *  decision Q5), `sunmoon` (SOI–VOW's sun / moon), `moon` (EMN's full moon /
 *  Emrakul), `compass` (XLN / RIX / LCI's compass / land) and `fan` (NEO's
 *  closed / open fan). `spark` (ORI's walker backs) arrives with the walker
 *  bodies (5.13). The family is ONE card-level key (FrameStyle.dfcIcon)
 *  from which the back body is derived (`bodyFor`); the MDFC housing has no
 *  family. */
export const DFC_ICON_FAMILY_VALUES = ["arrows", "sunmoon", "moon", "compass", "fan"] as const;
export type DfcIconFamily = (typeof DFC_ICON_FAMILY_VALUES)[number];

// ---------------------------------------------------------------------------
// Structured FRONT-face content (cards.face_content, migration 0050).
// Loyalty ability rows and saga chapters as data instead of rules_text
// conventions. NULL/absent = legacy card → renderers fall back to parsing
// rules_text (lib/cards/face-content.ts owns the round-trip contract).
// ---------------------------------------------------------------------------

export type LoyaltyRowContent = {
  /** "+1" | "-3" | "0" | "X" — ASCII sign, uppercase X; null = static row. */
  cost: string | null;
  text: string;
};

export type SagaChapterContent = {
  /** Chapter numbers this row covers (real cards share text: "I, II —"). */
  numerals: number[];
  text: string;
};

/** One tier of a station card (TODO 4.27a; lib/cards/station.ts): the charge
 *  threshold its badge prints ("12+") and its text. `pt: true` on at most
 *  ONE tier — where the card's power / toughness print, on the plate. */
export type StationTierContent = {
  threshold: number;
  text: string;
  pt?: true;
};

export type FaceContent = {
  v: 1;
  loyalty?: { abilities: LoyaltyRowContent[] };
  saga?: { intro?: string | null; chapters: SagaChapterContent[] };
  /** A Spacecraft's / Planet's top band and its 0–3 tiers. */
  station?: { intro?: string | null; tiers: StationTierContent[] };
};

// Per-card design watermark (cards.watermark, migration 0050) — the faint
// mark behind the rules text. NULL = none (default). "large" is the
// basic-land treatment (big centered symbol filling the text box).
export type CardWatermark =
  | {
      kind: "mana";
      key: "w" | "u" | "b" | "r" | "g" | "c";
      opacity?: number;
      size?: "normal" | "large";
    }
  | { kind: "preset"; key: string; opacity?: number; size?: "normal" | "large" }
  | { kind: "custom"; url: string; opacity?: number; size?: "normal" | "large" };

// Card finish — a treatment layered on top of the base frame (every finish is
// free: PREMIUM_FINISHES below is empty). Default is "regular"; "foil" adds a
// holographic sheen, strongest on light areas (lib/cards/foil-finish.tsx),
// and "etched" a frame-masked cross-hatch + sheen
// (lib/cards/etched-finish.tsx), both drawn identically by the live preview
// and the bake. "showcase" italicises the title in the live preview only —
// the bake has no italic Beleren face and draws it upright, and neither
// renderer draws an ornament — so its chip stays "Soon" (TODO 6.5).
// Borderless is a frame treatment (its own templates), never a finish —
// Scryfall's finishes are nonfoil/foil/etched, and borderless printings come
// in all three.
export const CARD_FINISH_VALUES = [
  "regular",
  "foil",
  "etched",
  "showcase",
] as const;
export type CardFinish = (typeof CARD_FINISH_VALUES)[number];

// Retired finish values → the finish that draws the same pixels. The old
// "borderless" finish drew nothing after the MSE-schema rebuild (2026-06-01)
// and migration 0119 reset every stored row to "regular"; an old payload
// (a stale tab, a remix of an unmigrated row) still reads as "regular"
// instead of failing validation (lib/validation/card.ts,
// normalizeCardFinish in lib/cards/card-display.ts).
export const RETIRED_CARD_FINISHES: ReadonlyMap<string, CardFinish> = new Map([
  ["borderless", "regular"],
]);

// Frame templates correspond to one master per colour key (w/u/b/r/g/c/m;
// 1500×2100, the landscape battle 2100×1500), with the art window cut out to
// alpha=0 so the user's art renders behind the frame, plus a layout profile
// in lib/cards/template-layout.ts. The masters come from two sources
// (docs/FRAMES.md "Provenance and legal"): MSE's Full-Magic-Pack, in git
// under public/frames/{template}/, and Card Conjurer (the M15 family, the
// borderless frame, the full-art basics, the text-box tokens), in the frames
// storage bucket only — lib/frames/frame-manifest.json lists those.
//
// "m15"       — Magic 2015-era modern frame (the default).
// "m15land"   — M15 land frame (stone border, color-tinted text box, no cost).
// "m15token"  — M15 token frame (art-forward; dark title bar, no cost).
// "m15artifact" — M15 artifact frame (silver plates + textbox with the COLOR's
//               outer border, blended through MSE's artifact_blend mask —
//               scripts/build-artifact-blend.mjs; m15 geometry).
// "m15snow"   — M15 snow frame (frosty silver skin; m15 geometry).
// "m15devoid" — M15 devoid/Eldrazi frame (washed-out colorless; m15 geometry).
// "m15pw"     — M15 planeswalker frame (two art cut-outs + loyalty badge).
// "agclassic" — 1993 Alpha/Beta frame.
// "alphaland" — 1993 Alpha land frame (agclassic geometry, no cost).
// "battle"    — M15 Battle/Siege frame — the only LANDSCAPE (7:5) frame.
// "saga"      — M15 Saga frame (chapter rail on the left, art column on the right).
// "adventure" — M15 Adventure (Eldraine) frame — a creature whose lower text area
//               is split into an open "storybook": the adventure spell (its
//               name/type/cost/rules come from the card's back-face content) on
//               the LEFT page, the creature's own rules on the RIGHT page.
//
// Adding a frame (the full checklist: docs/FRAMES.md "Adding a frame"): add
// a value here, a label in FRAME_TEMPLATE_LABELS, a set in FRAME_TEMPLATE_SET
// (both exhaustive — the compiler will tell you), a picker mapping
// (ERA_TYPE_FRAME / TEMPLATE_SKIN_VARIANTS / an M15 treatment set / a
// showcase set / a kind's layoutTemplates in lib/creator/card-kinds.ts —
// docs/FRAMES.md "Which group a frame sits in"), and one profile entry in
// lib/cards/template-layout.ts. No renderer changes needed (landscape frames
// just set orientation: "landscape" in their profile). It stays hidden until
// each color is verified in /admin/frame-compare.
export const FRAME_TEMPLATE_VALUES = [
  "m15",
  "m15land",
  "m15token",
  "m15artifact",
  // The Vehicle frame (TODO 4.5c, Card Conjurer 'Vehicle Frame' + its brown
  // P/T plate, white digits): the artifact kind's variation for a card whose
  // subtype says Vehicle. A stored template of its own — never a render-time
  // pick from the subtype, which would re-dress every stored Vehicle.
  "m15vehicle",
  // The Nyx dress (TODO 4.7, Card Conjurer 'Nyx' of the accurate M15 pack):
  // the M15 frame with the starfield in its frame field — the printed
  // enchantment frame (enchantment creatures and artifacts since Theros,
  // every enchantment since Foundations 2024). A stored template of its own,
  // for a card whose type words say Enchantment; never a render-time pick
  // from the words, which would re-dress every stored enchantment. NOT the
  // `nyx` template below (the Theros Beyond Death constellation showcase).
  "m15nyx",
  // The station frame (TODO 4.27a, Edge of Eternities 2025): a Spacecraft's
  // (an artifact whose subtype says Spacecraft) and a Planet's (a land whose
  // subtype says Planet) — PipGlyph's own masters, cut from the published
  // m15artifact / m15land ones; the picture runs under the whole frame and
  // the see-through text box is banded into charge tiers
  // (lib/cards/station.ts). Stored templates of their own, as the Vehicle's.
  "m15station",
  "m15stationland",
  // The Universes Beyond frames (TODO 4.25, Card Conjurer 'Universes
  // Beyond' accurate pack): the smooth, streaked dress Universes Beyond
  // printed from 40K (2022-10) to Final Fantasy (2025-06) on M15's geometry —
  // three looks of their own (owner 2026-10-13), a skin each of the M15
  // standard, the artifact frame and the land frame. A card wears one only
  // by its maker's pick or an import; no new card starts on them.
  "m15ub",
  "m15ubartifact",
  "m15ubland",
  "m15snow",
  "m15snowland",
  "m15devoid",
  "m15pw",
  "m15tokenartifact",
  // The 2014–19 arch token with a text box (TODO 4.49 (b), Card Conjurer
  // 'Regular (Bordered M15)', re-cut onto the prints), and its artifact
  // dress: the token kind's text-box variations of m15token /
  // m15tokenartifact.
  "m15tokentext",
  "m15tokenartifacttext",
  // Its TALL text box (TODO 4.55): the same arch with the window shorter,
  // the type pill 238 px higher and the box twice the regular one's — Amonkhet
  // / Hour of Devastation's embalmed and eternalized cards, the SOI Clues,
  // TDOM #7, TC18 #4 / #10 / #19, TRIX #1, TUST #18. PipGlyph's own cut of
  // the text-box masters (Card Conjurer has none); the height follows the
  // text, as the full-art token's does.
  "m15tokentall",
  "m15tokenartifacttall",
  // The emblem (TODO 4.52, Card Conjurer 'Planeswalker Emblems'): the M20
  // design — the source's name in the dark title bar, the art in a
  // planeswalker-spark cut-out on a silver frame, a type bar reading
  // "Emblem". The emblem kind's one frame (6.23).
  "emblem",
  // The full-art token design, M20 (2019) → today (TODO 4.48 / 4.50, Card
  // Conjurer's 'Textless', 'Short' and 'Tall' token packs): the art to the
  // black ring, a name pill, a type pill and a translucent box. Three
  // printed heights — no box, the regular box, the tall box — and an
  // artifact template for each (owner 2026-09-29), the token kind's only.
  "m20token",
  "m20tokentext",
  "m20tokentall",
  "m20tokenartifact",
  "m20tokenartifacttext",
  "m20tokenartifacttall",
  // The full-art token's Nyx dress (TODO 4.51): the starfield in the name
  // pill an Enchantment token prints (TDSK #4, TEOC #13), at each height,
  // plain and artifact — the token kind's only.
  "m20tokennyx",
  "m20tokennyxtext",
  "m20tokennyxtall",
  "m20tokenartifactnyx",
  "m20tokenartifactnyxtext",
  "m20tokenartifactnyxtall",
  // The 2019+ borderless frame (frames plan 4.32, Card Conjurer 'Borderless
  // (Alt)'): art to the card edge, dark translucent bars and box, white ink.
  // Skins of the M15 standard and the M15 artifact frame, in the Borderless
  // set. The artifact skin paints Card Conjurer's A frame for colourless
  // artifacts; its coloured keys are the colour frames (a borderless frame
  // has no body for 4.16's artifact interior).
  "m15borderless",
  "m15borderlessartifact",
  // …and its nonbasic land (frames plan 4.34): a skin of the M15 land frame
  // whose title bar, type bar AND text box wear the colour's tint, as the
  // borderless land prints do (MID #281, OTJ #304, CMM #659).
  "m15borderlessland",
  // The Spacecraft's borderless dress (TODO 4.27a step 2; EOC #1 / #2): the
  // borderless artifact frame's bars floating on the art over the station
  // frame's box. A Variations pick for a Spacecraft, never a new card's
  // default: a new Spacecraft follows its subtype onto the bordered station
  // frame only.
  "m15borderlessstation",
  // The borderless planeswalkers (frames plan 4.33, Card Conjurer
  // 'Borderless' and 'Tall Borderless' planeswalker packs): art to the card
  // edge under the planeswalker's light title and type bars, light ability
  // rows with dark ink. Skins of m15pw in the Borderless set; the tall one
  // (4 ability rows, the type bar 138 px higher) is picked by the card's
  // row count (lib/creator/card-kinds.ts walkerRowsFrameFor).
  "m15borderlesspw",
  "m15borderlesspwtall",
  // The transform bodies (TODO 5.1a, Card Conjurer 'Transform (Front)',
  // 'Transform (Back)' and 'Transform (Back) (New)'): a double-faced card's
  // two printed faces, one body each (FrameProfile.dfc, lib/cards/dfc.ts).
  // A FRONT body is a card's template (the Transform kind's); a BACK body
  // is the back face's (`back_face.frame_style.template`) and never a
  // card's own. `m15dfcback` is the ▼-right back every transform has
  // printed since 2022-11 (the default, owner decision Q5), `m15dfcbackleft`
  // the 2016–22 look (the sun / moon, moon / Emrakul, compass / land and
  // fan families, the icon at the left); the land pair is one master under
  // every key. Additions: no stored card changes.
  "m15dfcfront",
  "m15dfcback",
  "m15dfcbackleft",
  "m15dfclandfront",
  "m15dfclandback",
  // The modal bodies (TODO 5.1b, Card Conjurer 'Modal Regular'): a modal
  // double-faced card's two faces, the housing and the flipside strip in
  // the masters, the strip's two texts drawn from the other face
  // (lib/cards/faces.ts). A FRONT body is the Modal kind's template, a BACK
  // body the back face's; the land pair is a PipGlyph recipe over the 2015
  // land tints. Additions: no stored card changes.
  "m15mdfcfront",
  "m15mdfcback",
  "m15mdfclandfront",
  "m15mdfclandback",
  // The borderless double-faced bodies (TODO 5.7): the DARK (`inverted`)
  // borderless look of 98 of the 134 plain borderless transform / modal
  // printings — m15borderless's floating bars and dark box with the
  // double-faced pieces (the icon well, the ▼ well, the reverse-P/T tab,
  // the modal housing and strip) grafted from Card Conjurer's light packs
  // (scripts/lib/dfc-borderless.mjs). The FRONT bodies are skins of the
  // bordered fronts (Variations); the back follows the front's look
  // (bodyFor's `look`). No land pair, no 2016–22 left-well back yet.
  // Additions: no stored card changes.
  "m15borderlessdfcfront",
  "m15borderlessdfcback",
  "m15borderlessmdfcfront",
  "m15borderlessmdfcback",
  "agclassic",
  "alphaland",
  "battle",
  "saga",
  // The double-faced saga's FRONT (TODO 5.5 (b), Card Conjurer 'Saga
  // (Transform)', packSagaDFC.js): Kamigawa: Neon Dynasty's transforming
  // Sagas — the saga body with the transform icon well in its title bar and
  // the back's P/T in the tab at the rail's foot. The Saga kind's frame for a
  // saga with a back face of its own (lib/cards/dfc.ts, DfcProfile.saga);
  // the back is a transform back body. An addition: no stored card changes.
  "sagadfcfront",
  // …and the double-faced saga's BACK (TODO 5.5 (b), PR 2): the back of a
  // card whose back face is a Saga (MOM's praetors, LCI #189) — PipGlyph's
  // own composite of the saga body and the ▼ back's bars. A back body, never
  // a card's own template. An addition: no stored card changes.
  "sagadfcback",
  "adventure",
  // The Prepare frame (TODO 4.27, Secrets of Strixhaven 2026): the M15
  // frame with the spell on a PAGE on the right — its own name, cost and
  // type bars and box — and the creature's rules in the box on the left.
  // PipGlyph's own derivation (scripts/build-prepare-frames.mjs): no Card
  // Conjurer or MSE source. An addition: no stored card changes.
  "prepare",
  "flip",
  "split",
  "aftermath",
  // Showcase set families (popular recent sets).
  "lotr",
  "lotrscroll",
  // The Wilds of Eldraine Enchanting Tales showcase (TODO 4.11 wave 2, Card
  // Conjurer's 'Enchanting Tales' pack, frames bucket): the swirled
  // storybook frame of the bonus sheet WOT #1–63 (2023), borderless, the
  // art under its translucent text box. An addition: no stored card sits on
  // it.
  "enchantingtales",
  "avatar",
  "bloomburrow",
  "bloomanime",
  "tarkirdraconic",
  "tarkirghostfire",
  // Multiverse Legends (MOM 2023) Tarkir frame. The key keeps its historical
  // "tarkir" prefix because it is stored in cards.frame_style, frame_reviews
  // and the frames bucket. Its set is "multiverselegends", not "tarkir".
  "tarkirdragon",
  // Streets of New Capenna (SNC 2022) — the ART DECO showcase of the five
  // families' three-colour cards (SNC #296–340) and their gilded-foil twins
  // (#361–405): black and gold filigree, the art under translucent bars and
  // text box. Card Conjurer's pack for it is 'Golden Age (SNC)'
  // (packSNCGilded.js; CC's 'Art Deco (SNC)' pack draws the Golden Age
  // cards #341–359 instead). An addition: no stored card sits on it.
  "sncartdeco",
  // Zendikar Rising (ZNR 2020) showcase — the hedron frame. It is not full
  // art (Scryfall flags none of those printings full_art), but the key keeps
  // its historical name because it is stored in cards.frame_style,
  // frame_reviews and the frames bucket. Its set is "zendikarrising".
  "fullart",
  // The Dungeons & Dragons Sourcebook showcase (TODO 4.11 wave 2, Card
  // Conjurer's 'D&D Sourcebook' pack, frames bucket): the parchment page of
  // Adventures in the Forgotten Realms (AFR #299–349, 2021) and Commander
  // Legends: Battle for Baldur's Gate (CLB #375–450, 2022) — one design for
  // every colour. An addition: no stored card sits on it.
  "dndsourcebook",
  // The Murders at Karlov Manor DOSSIER showcase (TODO 4.11 wave 2, Card
  // Conjurer's 'Dossier' pack, frames bucket): the case-file folder of MKM
  // #336–389 and #433 (Scryfall's `dossier` promo type, 55 printings) — a
  // photo clipped to the page, a colour accent per key. An addition: no
  // stored card sits on it.
  "dossier",
  // The Dominaria United Stained Glass showcase (TODO 4.11 wave 2, Card
  // Conjurer's 'Stained Glass (DMU)' pack, frames bucket): DMU #287–368 and
  // the Multiverse Legends Dominaria legends (MUL #5, #12, #19, #22, #24,
  // #55, #56, #58, #59 and their halo-foil / serialized twins). An
  // addition: no stored card sits on it.
  "stainedglass",
  // Variation treatments (2026-07): extended/full art, premium lands, Nyx.
  "extendedart",
  // Its land dress (TODO 4.7, owner Round 63): the pack's land frames, as
  // m15land is M15's.
  "extendedartland",
  // …and the Spacecraft's (TODO 4.27a step 2; EOE #321–355, EOC #27 / #34,
  // TRK #481): the extended-art bars and black type bar over the station
  // frame's box. A pick, like the borderless one.
  "extendedartstation",
  // Full-art basic lands, Card Conjurer 'Fullart Basics (2022)' (frames plan
  // 4.39): the black-bordered frame of ONE / MOM / … (2023+) and the same
  // frame without its border (fullartland, borderless — owner decision
  // 4.35(a)). Basic lands only.
  "m15fullartland",
  "fullartland",
  // The older black-bordered full-art basic designs (TODO 4.40 / 4.41):
  // the Zendikar-style split type bar with a centred medallion on a stone
  // ring (BFZ, OGW, AKH, HOU, ZNR), the same bars with the art under a white
  // ring (SNC), and the plain "Basic Land — Plains" bar with no symbol (THB,
  // 2XM, DMU, SPM, SOS, PLG25). Card Conjurer packs re-cut onto the prints;
  // basic lands only. Additions: no stored card sits on them.
  "m15fullartlandzen",
  "m15fullartlandsnc",
  "m15fullartlandthb",
  "m15textless",
  "m15textlessland",
  // The Zendikar Expeditions (TODO 4.11 wave 1, Card Conjurer, frames
  // bucket): the 2020 Zendikar Rising look (ZNE) and the 2015 Battle for
  // Zendikar look (EXP), each its own template.
  "expeditionland",
  "expeditionlandbfz",
  "nyx",
  // Border eras beyond Alpha/M15 (converted from the MSE old/new/future styles).
  "retro",
  "retroland",
  "modern",
  "modernland",
] as const;
export type FrameTemplate = (typeof FRAME_TEMPLATE_VALUES)[number];

// The frame used when a card has no explicit template (new cards + legacy rows
// that predate the picker, including the retired "regular" placeholder).
export const DEFAULT_FRAME_TEMPLATE: FrameTemplate = "m15";

// Retired frame templates → the frame a stored value READS as (TODO 4.54).
// `alphatoken` (a 1993-style token frame of our own; no such token was ever
// printed) left FRAME_TEMPLATE_VALUES on 2026-10-07 with 0 production cards
// on it. A row, draft, remix payload, URL parameter or stored override that
// still says it resolves to the M15 token — `bare` without rules or flavour
// text, `withText` with either (the text box follows the text, as on every
// token) — instead of falling to DEFAULT_FRAME_TEMPLATE, the creature frame.
// Read path only: nothing writes a retired value, and nothing rewrites a
// stored row until its owner saves it (the card actions then store the
// replacement: withRetiredFrameTemplate / retiredFrameStyleRewrite).
// Readers: normalizeFrameTemplate / retiredFrameTemplate
// (lib/cards/card-display.ts), getFrameProfile (the bare frame, for a reader
// handed the stored value raw), the validator's preprocess
// (lib/validation/card.ts), staleTemplateFilter. docs/FRAMES.md "Retiring a
// frame".
export const RETIRED_FRAME_TEMPLATES: ReadonlyMap<
  string,
  { bare: FrameTemplate; withText: FrameTemplate }
> = new Map([["alphatoken", { bare: "m15token", withText: "m15tokentext" }]]);

// Display labels for the template picker. These are shown UNDER a frame-set
// chip (Magic 2015 / Alpha), which supplies the family — so the labels are
// set-relative ("Standard", "Land", …) rather than repeating the set name.
export const FRAME_TEMPLATE_LABELS: Record<FrameTemplate, string> = {
  m15: "Standard",
  m15land: "Land",
  // The 2014–19 arch, named for its years (owner decision 2026-09-29) now
  // that new tokens default to the full-art design once it is verified.
  m15token: "Token (2014–2019)",
  m15artifact: "Artifact",
  m15vehicle: "Vehicle",
  m15nyx: "Nyx",
  m15station: "Spacecraft",
  m15stationland: "Planet",
  extendedartstation: "Extended Art Spacecraft",
  m15borderlessstation: "Borderless Spacecraft",
  m15ub: "Universes Beyond",
  m15ubartifact: "Universes Beyond Artifact",
  m15ubland: "Universes Beyond Land",
  m15snow: "Snow",
  m15snowland: "Snow Land",
  m15devoid: "Devoid",
  m15tokenartifact: "Artifact Token (2014–2019)",
  m15tokentext: "Token (2014–2019), text box",
  m15tokenartifacttext: "Artifact Token (2014–2019), text box",
  m15tokentall: "Token (2014–2019), tall text box",
  m15tokenartifacttall: "Artifact Token (2014–2019), tall text box",
  emblem: "Emblem",
  // The full-art design (TODO 4.48) is what a token IS now that it is
  // verified (4.48a, owner round 14b; every colour verified 2026-09-30):
  // plain "Token", beside the arch's "Token (2014–2019)". Alpha's token is
  // "Token" too, under its own era — describeFrame reads "M15 (2015) Token"
  // and "Classic (1993) Token", and the admin pages show the template key.
  m20token: "Token",
  m20tokentext: "Token, text box",
  m20tokentall: "Token, tall text box",
  m20tokenartifact: "Artifact Token",
  m20tokenartifacttext: "Artifact Token, text box",
  m20tokenartifacttall: "Artifact Token, tall text box",
  m20tokennyx: "Nyx Token",
  m20tokennyxtext: "Nyx Token, text box",
  m20tokennyxtall: "Nyx Token, tall text box",
  m20tokenartifactnyx: "Nyx Artifact Token",
  m20tokenartifactnyxtext: "Nyx Artifact Token, text box",
  m20tokenartifactnyxtall: "Nyx Artifact Token, tall text box",
  m15borderless: "Borderless",
  m15borderlessartifact: "Borderless Artifact",
  m15borderlessland: "Borderless Land",
  m15borderlesspw: "Borderless Planeswalker",
  m15borderlesspwtall: "Borderless Planeswalker, 4+ abilities",
  // The transform bodies (TODO 5.1a): the admin pages and describeFrame
  // show the template key beside these.
  m15dfcfront: "Transform front",
  m15dfcback: "Transform back (2022–)",
  m15dfcbackleft: "Transform back (2016–2022)",
  m15dfclandfront: "Transform land front",
  m15dfclandback: "Transform land back",
  // The modal bodies (TODO 5.1b).
  m15mdfcfront: "Modal front",
  m15mdfcback: "Modal back",
  m15mdfclandfront: "Modal land front",
  m15mdfclandback: "Modal land back",
  // The borderless double-faced bodies (TODO 5.7).
  m15borderlessdfcfront: "Borderless transform front",
  m15borderlessdfcback: "Borderless transform back",
  m15borderlessmdfcfront: "Borderless modal front",
  m15borderlessmdfcback: "Borderless modal back",
  m15pw: "Planeswalker",
  agclassic: "Standard",
  alphaland: "Land",
  battle: "Battle (Siege)",
  saga: "Saga",
  sagadfcfront: "Saga (transform front)",
  sagadfcback: "Saga (transform back)",
  adventure: "Adventure",
  prepare: "Prepare",
  flip: "Flip",
  split: "Split",
  aftermath: "Aftermath",
  lotr: "Ring",
  lotrscroll: "Scroll",
  // Set-relative: the picker prints "Wilds of Eldraine — Enchanting Tales".
  enchantingtales: "Enchanting Tales",
  avatar: "Elemental",
  bloomburrow: "Woodland",
  bloomanime: "Anime",
  // Owner decision 2026-09-25: this label names its set. Set-qualified copy
  // (describeFrame, setQualifiedFrameLabel) shows it as-is rather than
  // adding the set name again.
  tarkirdragon: "Dragon Wing (Multiverse Legends)",
  tarkirdraconic: "Draconic",
  tarkirghostfire: "Ghostfire",
  // Set-relative: the picker prints "Streets of New Capenna — Art Deco".
  sncartdeco: "Art Deco",
  // Set-relative: the picker prints "Murders at Karlov Manor — Dossier".
  dossier: "Dossier",
  // Set-relative: the picker prints "Dominaria United — Stained Glass".
  stainedglass: "Stained Glass",
  extendedart: "Extended Art",
  extendedartland: "Extended Art Land",
  // Set-relative like the other showcase labels: the picker prints
  // "Zendikar Rising — Hedron" (setQualifiedFrameLabel).
  fullart: "Hedron",
  // Set-relative: the picker prints "Dungeons & Dragons — Sourcebook".
  dndsourcebook: "Sourcebook",
  // Two full-art basics in the Full Art set: the black-bordered print (the
  // common one, 263 printings) and the borderless one (FRA #382–396). They
  // are variations of the M15 land frame (the picker's groups, 2026-10-13),
  // so their chips carry no set name: the label says "Full-Art" itself.
  m15fullartland: "Full-Art Basic Land",
  fullartland: "Borderless Full-Art Basic Land",
  m15fullartlandzen: "Zendikar Full-Art Basic Land",
  m15fullartlandsnc: "New Capenna Full-Art Basic Land",
  m15fullartlandthb: "Plain-Bar Full-Art Basic Land",
  m15textless: "Textless",
  m15textlessland: "Textless Land",
  expeditionland: "Land",
  expeditionlandbfz: "2015 Land",
  nyx: "Constellation",
  retro: "Standard",
  retroland: "Land",
  modern: "Standard",
  modernland: "Land",
};

// ---------------------------------------------------------------------------
// Frame sets — group the templates into families so the creator can offer a
// two-step picker: choose a set, then a frame within it. Every template must
// map to a set (the Record below is exhaustive, so adding a frame is a compile
// error until it's assigned a set).
// ---------------------------------------------------------------------------
export const FRAME_SET_VALUES = [
  "m15",
  "borderless",
  "alpha",
  "lotr",
  "eldraine",
  "avatar",
  "bloomburrow",
  "tarkir",
  "dominariaunited",
  "multiverselegends",
  "newcapenna",
  "zendikarrising",
  "dnd",
  "karlov",
  "extended",
  "fullartset",
  "expeditions",
  "nyxset",
  "retro",
  "modern",
] as const;
export type FrameSet = (typeof FRAME_SET_VALUES)[number];

export const FRAME_SET_LABELS: Record<FrameSet, string> = {
  m15: "Magic 2015 (modern)",
  borderless: "Borderless",
  alpha: "Alpha (1993)",
  lotr: "The Lord of the Rings",
  // Wilds of Eldraine (WOE 2023) and its bonus sheet, Enchanting Tales (WOT).
  eldraine: "Wilds of Eldraine",
  avatar: "Avatar: The Last Airbender",
  bloomburrow: "Bloomburrow",
  tarkir: "Tarkir: Dragonstorm",
  // Dominaria United (DMU 2022) — its Stained Glass showcase, which the
  // Multiverse Legends Dominaria legends (MUL 2023) print too.
  dominariaunited: "Dominaria United",
  multiverselegends: "Multiverse Legends",
  newcapenna: "Streets of New Capenna",
  zendikarrising: "Zendikar Rising",
  // Adventures in the Forgotten Realms (AFR 2021) and Commander Legends:
  // Battle for Baldur's Gate (CLB 2022): the Dungeons & Dragons sets.
  dnd: "Dungeons & Dragons",
  // Murders at Karlov Manor (MKM 2024): the Dossier showcase.
  karlov: "Murders at Karlov Manor",
  extended: "Extended Art",
  fullartset: "Full Art",
  expeditions: "Expeditions",
  nyxset: "Nyx",
  retro: "Retro (1997)",
  modern: "Modern border (2003)",
};

export const FRAME_TEMPLATE_SET: Record<FrameTemplate, FrameSet> = {
  m15: "m15",
  m15land: "m15",
  m15token: "m15",
  m15artifact: "m15",
  m15vehicle: "m15",
  m15nyx: "m15",
  m15station: "m15",
  m15stationland: "m15",
  extendedartstation: "extended",
  m15borderlessstation: "borderless",
  m15ub: "m15",
  m15ubartifact: "m15",
  m15ubland: "m15",
  m15snow: "m15",
  m15snowland: "m15",
  m15devoid: "m15",
  m15pw: "m15",
  m15tokenartifact: "m15",
  m15tokentext: "m15",
  m15tokenartifacttext: "m15",
  m15tokentall: "m15",
  m15tokenartifacttall: "m15",
  emblem: "m15",
  m20token: "m15",
  m20tokentext: "m15",
  m20tokentall: "m15",
  m20tokenartifact: "m15",
  m20tokenartifacttext: "m15",
  m20tokenartifacttall: "m15",
  m20tokennyx: "m15",
  m20tokennyxtext: "m15",
  m20tokennyxtall: "m15",
  m20tokenartifactnyx: "m15",
  m20tokenartifactnyxtext: "m15",
  m20tokenartifactnyxtall: "m15",
  m15borderless: "borderless",
  m15borderlessartifact: "borderless",
  m15borderlessland: "borderless",
  m15borderlesspw: "borderless",
  m15borderlesspwtall: "borderless",
  m15dfcfront: "m15",
  m15dfcback: "m15",
  m15dfcbackleft: "m15",
  m15dfclandfront: "m15",
  m15dfclandback: "m15",
  m15mdfcfront: "m15",
  m15mdfcback: "m15",
  m15mdfclandfront: "m15",
  m15mdfclandback: "m15",
  m15borderlessdfcfront: "m15",
  m15borderlessdfcback: "m15",
  m15borderlessmdfcfront: "m15",
  m15borderlessmdfcback: "m15",
  battle: "m15",
  saga: "m15",
  sagadfcfront: "m15",
  sagadfcback: "m15",
  adventure: "m15",
  prepare: "m15",
  flip: "m15",
  split: "m15",
  aftermath: "m15",
  lotr: "lotr",
  lotrscroll: "lotr",
  enchantingtales: "eldraine",
  avatar: "avatar",
  bloomburrow: "bloomburrow",
  bloomanime: "bloomburrow",
  tarkirdraconic: "tarkir",
  tarkirghostfire: "tarkir",
  stainedglass: "dominariaunited",
  tarkirdragon: "multiverselegends",
  sncartdeco: "newcapenna",
  dossier: "karlov",
  extendedart: "extended",
  extendedartland: "extended",
  fullart: "zendikarrising",
  dndsourcebook: "dnd",
  m15fullartland: "fullartset",
  fullartland: "fullartset",
  m15fullartlandzen: "fullartset",
  m15fullartlandsnc: "fullartset",
  m15fullartlandthb: "fullartset",
  m15textless: "fullartset",
  m15textlessland: "fullartset",
  expeditionland: "expeditions",
  expeditionlandbfz: "expeditions",
  nyx: "nyxset",
  agclassic: "alpha",
  alphaland: "alpha",
  retro: "retro",
  retroland: "retro",
  modern: "modern",
  modernland: "modern",
};

// ---------------------------------------------------------------------------
// Frame ERAS — the top tier of the creator's frame picker. An era is a border
// generation (the visual trade-dress family), NOT a play format. Play formats
// (Modern, Pioneer…) span multiple borders, so they can't group frames; border
// years can. The kind-first picker flow is: pick a card KIND → the gallery
// shows every era's frame for it (ERA_TYPE_FRAME inverted by framesForKind in
// lib/creator/card-kinds.ts, plus skins and showcase treatments) → pick the
// frame's color.
//
// Eras group the existing FrameSets: alpha→classic, m15→m15, and the
// Universes Beyond / showcase sets — a frame ONE set or one crossover printed
// (lotr/avatar/bloomburrow/tarkir/multiverselegends/zendikarrising, the
// Zendikar Expeditions, Theros Beyond Death's constellation frame)→showcase.
// A TREATMENT of the 2015 frame that any set prints — Borderless, extended
// art, the full-art basics, the textless promos — is M15-era
// (M15_TREATMENT_SETS, below).
// ---------------------------------------------------------------------------
export const FRAME_ERA_VALUES = ["classic", "retro", "modern", "m15", "showcase"] as const;
export type FrameEra = (typeof FRAME_ERA_VALUES)[number];

export const FRAME_ERA_LABELS: Record<FrameEra, string> = {
  classic: "Classic (1993)",
  retro: "Retro (1997)",
  modern: "Modern border (2003)",
  m15: "M15 (2015)",
  showcase: "Showcase & Universes Beyond",
};

// Friendly one-liners shown under each era chip.
export const FRAME_ERA_HINTS: Record<FrameEra, string> = {
  classic: "Alpha / Beta — the original border",
  retro: "Mirage–Scourge old border",
  modern: "8th Edition–M14, the pre-2015 frame",
  m15: "The current Magic frame",
  showcase: "Modern IP crossovers & alt-art frames",
};

// Which era each FrameSet belongs to. Exhaustive → adding a set is a compile
// error until it's assigned an era.
export const FRAME_SET_ERA: Record<FrameSet, FrameEra> = {
  alpha: "classic",
  retro: "retro",
  modern: "modern",
  m15: "m15",
  // The borderless M15 frame is M15-era trade dress offered as a skin of
  // the M15 standard (TEMPLATE_SKIN_VARIANTS), not a showcase treatment:
  // a kind change keeps the M15 era (frames plan 4.32).
  borderless: "m15",
  // Extended art, the full-art basics and the textless frames (the picker's
  // groups, 2026-10-13): treatments of the 2015 frame that every set prints
  // — Scryfall 2026-10-13: `extendedart` on 4,235 printings in 86 sets since
  // 2018, black-bordered full-art basics on 588 in 52, 2015-frame textless
  // promos on 78 in 24 — never one set's showcase. Variations of the M15
  // standard like Borderless (M15_TREATMENT_SETS, below).
  extended: "m15",
  fullartset: "m15",
  lotr: "showcase",
  // The Enchanting Tales showcase (WOT #1–63).
  eldraine: "showcase",
  avatar: "showcase",
  bloomburrow: "showcase",
  tarkir: "showcase",
  // The Stained Glass showcase (DMU #287–368, MUL's Dominaria legends).
  dominariaunited: "showcase",
  multiverselegends: "showcase",
  // The Art Deco showcase (SNC #296–340, #361–405).
  newcapenna: "showcase",
  zendikarrising: "showcase",
  // The D&D Sourcebook showcase (AFR #299–349, CLB #375–450).
  dnd: "showcase",
  // The Murders at Karlov Manor Dossier showcase (MKM #336–389, #433).
  karlov: "showcase",
  // One block's masterpiece series (BFZ / OGW 2015–16, 45 printings).
  expeditions: "showcase",
  // Theros Beyond Death's constellation SHOWCASE (THB #258–268: Scryfall
  // `showcase`, black border, 11 printings) — not the printed enchantment
  // frame (m15nyx, an M15 variation) and not a borderless frame.
  nyxset: "showcase",
};

// The M15-era TREATMENT sets that left the showcase era on 2026-10-13. Each
// frame in them is a body of its own that several kinds wear — one
// `extendedart` for a creature, an artifact, a land and a token, where
// Borderless has a template per kind — so the picker offers them as
// variations of whichever M15 standard the kind has
// (lib/creator/card-kinds.ts skinVariantsFor), and everything that judged
// them as a showcase BODY still does (lib/creator/frame-picker.ts
// isTreatmentBody: the kind-capability rule, the import's candidates and its
// treatment notice). Only the group and the labels moved: FRAME_TEMPLATE_SET
// is untouched, so the admin's treatment batches and the import chooser's
// families are too.
export const M15_TREATMENT_SETS: readonly FrameSet[] = ["extended", "fullartset"];

// The standard / type-specific frame for a BORDER era + card type. The showcase
// era is intentionally absent — its frames are chosen by a set→treatment
// sub-picker, not derived from type. A missing card-type entry means the era
// has no frame for that type (e.g. Classic has no planeswalker or battle —
// those card types postdate the 1993 border), which the picker surfaces by
// disabling the era chip for that type.
export const ERA_TYPE_FRAME: Partial<
  Record<FrameEra, Partial<Record<CardType, FrameTemplate>>>
> = {
  classic: {
    creature: "agclassic",
    instant: "agclassic",
    sorcery: "agclassic",
    artifact: "agclassic",
    enchantment: "agclassic",
    spell: "agclassic",
    land: "alphaland",
  },
  retro: {
    creature: "retro",
    instant: "retro",
    sorcery: "retro",
    artifact: "retro",
    enchantment: "retro",
    spell: "retro",
    land: "retroland",
  },
  modern: {
    creature: "modern",
    instant: "modern",
    sorcery: "modern",
    artifact: "modern",
    enchantment: "modern",
    spell: "modern",
    land: "modernland",
  },
  m15: {
    creature: "m15",
    instant: "m15",
    sorcery: "m15",
    // Real M15 artifacts use the silver-blue artifact frame, not the plain
    // spell frame (which doubles as our colorless "c" variant).
    artifact: "m15artifact",
    enchantment: "m15",
    spell: "m15",
    land: "m15land",
    token: "m15token",
    // TODO 6.23 / 4.52: the emblem kind's one frame; no other era prints
    // today's emblem (the 2003 plaque and the 2014–19 "EMBLEM" bar are P3).
    emblem: "emblem",
    planeswalker: "m15pw",
    battle: "battle",
  },
};

// SKIN variants — alternate dressings that keep their BASE template's
// geometry wholesale (m15snow reuses the m15 profile, m15snowland the
// m15land profile, …). Unlike layout templates these are NOT kinds: a snow
// creature is still a creature, so the gallery offers them as variants
// under whichever era standard they re-dress. Keyed by base template;
// order = display order in the picker.
export const TEMPLATE_SKIN_VARIANTS: Partial<
  Record<FrameTemplate, FrameTemplate[]>
> = {
  // …and the Universes Beyond dress of each standard (TODO 4.25).
  m15: ["m15snow", "m15devoid", "m15borderless", "m15ub"],
  // The artifact kind's own borderless dress (frames plan 4.32), and the
  // Vehicle frame (TODO 4.5c) — offered to a card whose subtype says Vehicle
  // (lib/creator/card-kinds.ts templateSubtypeDress).
  // …and the station frame (TODO 4.27a), a Spacecraft's, with its
  // borderless dress (step 2; the extended-art one is an M15 treatment,
  // offered through its set).
  m15artifact: ["m15borderlessartifact", "m15vehicle", "m15station", "m15borderlessstation", "m15ubartifact"],
  // The planeswalker kind's borderless dresses (frames plan 4.33): the tall
  // one follows the ability rows (walkerRowsFrameFor).
  m15pw: ["m15borderlesspw", "m15borderlesspwtall"],
  // The land kind's own borderless dress (frames plan 4.34).
  // …and the station frame (TODO 4.27a), a Planet's.
  m15land: ["m15snowland", "m15borderlessland", "m15stationland", "m15ubland"],
  // The text-box variations (TODO 4.49 (b)); the artifact ones are dressed
  // by the Artifact type word (lib/creator/card-kinds.ts TYPE_WORD_DRESSES).
  // The full-art token design (TODO 4.48) and its heights, variations of the
  // token kind — a NEW token starts on them where they are verified in its
  // colour (lib/creator/token-frame-auto.ts newTokenFrame); the artifact
  // templates are dressed by the Artifact word (4.50).
  m15token: [
    "m15tokenartifact",
    "m15tokentext",
    "m15tokenartifacttext",
    // The arch's tall box (TODO 4.55): a height of the arch, as the
    // full-art design's tall box is of its own.
    "m15tokentall",
    "m15tokenartifacttall",
    "m20token",
    "m20tokentext",
    "m20tokentall",
    "m20tokenartifact",
    "m20tokenartifacttext",
    "m20tokenartifacttall",
    // The Nyx dress (TODO 4.51): an Enchantment token's, followed by its
    // type words (lib/creator/card-kinds.ts ENCHANTMENT_DRESSES); the
    // heights and the artifact dress follow the text and the Artifact word.
    "m20tokennyx",
    "m20tokennyxtext",
    "m20tokennyxtall",
    "m20tokenartifactnyx",
    "m20tokenartifactnyxtext",
    "m20tokenartifactnyxtall",
  ],
};


/** A card's rules-text alignment as the creator's form holds it (TODO
 *  4.21e); a stored frame_style names "center" only. */
export const RULES_ALIGN_VALUES = ["left", "center"] as const;
export type RulesAlign = (typeof RULES_ALIGN_VALUES)[number];

/** A card's border colour as the creator's form holds it (TODO 4.30); a
 *  stored frame_style names "white" only — absent is the black border. */
export const CARD_BORDER_VALUES = ["black", "white"] as const;
export type CardBorder = (typeof CARD_BORDER_VALUES)[number];

export type FrameStyle = {
  /** Premium treatment layered on the base frame (foil / etched / showcase). */
  finish?: CardFinish;
  /** Which frame PNG asset to layer behind the card sections. */
  template?: FrameTemplate;
  /** The printed legendary crown (TODO 4.6a) — an ADDITION, so it is opt-in
   *  per card (owner rule 2026-09-29, docs/FRAMES.md "Additions vs
   *  corrections"): the renderers draw it only when this is `true`, the
   *  card is Legendary and its template draws one (lib/cards/anatomy.ts).
   *  Absent = off: every card stored before the crown shipped keeps its
   *  look. A new card starts `true`; the save drops the switch where its
   *  template can't draw a crown (normalizeAnatomy), so a template that
   *  gains the crown later never changes a stored card. */
  crown?: boolean;
  /** The printed two-colour frame (TODO 4.6b): split pinline + text box on
   *  the gold frame, or the hybrid frame when every coloured pip is hybrid.
   *  Opt-in per card like `crown`; drawn only for a stored colour PAIR
   *  (exactly two WUBRG words in color_identity) on a template with pair
   *  masters — for a land, only a land frame's (twoColorFits; the save drops
   *  it elsewhere). Absent = off = the gold frame, as before. */
  twoColor?: boolean;
  /** The printed collector line (TODO 4.9b): an ADDITION, opt-in per card.
   *  "2015" draws the M15 → ONE style ("107/281   M" over "DMU • EN"),
   *  "2023" the style printed from 2023-03-26 ("R 0009"); "off" is the
   *  owner's explicit off (no editor hint); absent = a card stored before
   *  the line shipped, which keeps its look (the editor hints at the
   *  switch). Drawn only on a template whose PROFILES entry has a collector
   *  slot (lib/cards/collector-line.ts COLLECTOR_TEMPLATES); the save drops
   *  it elsewhere (normalizeAnatomy). A new card starts "2023"; an import
   *  takes its printing's style, or "off" for a pre-2015-frame printing. */
  collector?: "2015" | "2023" | "off";
  /** The foil-printing ★ (TODO 4.9b, owner 2026-09-29): the collector
   *  line's separator is the ★ instead of the • — a flag, no sheen, free
   *  for every plan (a Foil FINISH prints the ★ too). `true` or absent:
   *  an import sets it for a foil-only printing (`finishes` = ["foil"]). */
  star?: true;
  /** The holofoil security stamp (TODO 4.9c): an ADDITION, opt-in per card.
   *  "auto" draws the oval on a rare or mythic (a new card's default on a
   *  frame with the notch); "oval" / "triangle" always draw the frame's own
   *  stamp (the owner's "Always", or an import following its printing's
   *  `security_stamp`); "none" is the owner's "Never"; absent = a card saved
   *  before the stamp shipped, which keeps its look (cards saved between
   *  4.9b and 4.9c included). Drawn only on a template whose PROFILES entry
   *  declares a `holoStamp` overlay (lib/cards/holo-stamp.ts), never on a
   *  token or an emblem; the save drops it elsewhere (normalizeAnatomy). */
  stamp?: "auto" | "oval" | "triangle" | "none";
  /** The transform icon family (TODO 5.0a, DFC_ICON_FAMILY_VALUES): the
   *  glyph pair a transform card wears and, with it, which BACK body the
   *  card's back face draws on (`arrows` → the ▼-right back; the four
   *  left-icon families → the 2016–22 back; a land back its own, whatever
   *  the family — lib/cards/dfc.ts bodyFor). ONE card-level key, written
   *  only by a transform save (5.1a+): the save drops it on any template
   *  whose profile is not a transform FRONT body (normalizeAnatomy), so no
   *  stored card can carry it until those bodies exist. Absent on a
   *  transform card = `arrows` (owner decision Q5, 2026-10-02). */
  dfcIcon?: DfcIconFamily;
  /** The rules text's alignment (TODO 4.21e): an ADDITION, opt-in per card,
   *  on every kind of card (owner 2026-10-07). "center" sets every line of
   *  the card's plain rules boxes — rules, reminder and flavour; every face
   *  and half alike — centred on its box, as MH2 #123 and TSR #186 print
   *  their halves; absent = left, today's look (the stored key is "center"
   *  or absent — the owner's "Left" removes it). A NEW card starts left, an
   *  import stays left. Drawn on every template with plain rules boxes
   *  (lib/cards/template-layout.ts profileOffersRulesAlign: not the saga's
   *  chapter rows, a walker frame's ability rows or a textless frame); the
   *  save drops it anywhere else (lib/cards/anatomy.ts normalizeAnatomy). */
  rulesAlign?: RulesAlign;
  /** The card's border colour (TODO 4.30): an ADDITION, opt-in per card.
   *  "white" draws the printed white border of the core sets up to Ninth
   *  Edition — the white over the frame's black border and the black keyline
   *  round the frame box (lib/cards/white-border.ts); absent = black,
   *  today's look (the stored key is "white" or absent — the owner's off
   *  removes it). A NEW card starts black: a white border is a printing
   *  choice, not a default; an import follows its printing's
   *  `border_color`. Drawn only on a template whose PROFILES entry declares
   *  `whiteBorder` (the 1997 and 2003 frames); the save drops it anywhere
   *  else (lib/cards/anatomy.ts normalizeAnatomy). */
  border?: CardBorder;
  /** CARDNAME / `~` (TODO 6.2, lib/cards/self-name.ts): absent = they draw
   *  as the card's name (every new card). "literal" = a card stored before
   *  it with a literal `~` / CARDNAME in its text (migration 0142 flags
   *  them): it keeps printing what it printed until its owner switches the
   *  name on (an edit's `frame_anatomy.selfName: "name"` removes the key). */
  selfName?: "literal";
  /** Each part in its own colour (TODO 4.26): an ADDITION, opt-in per card.
   *  `true` draws the SECOND part in its own colour (`back_face.
   *  color_identity`) — split's right half and aftermath's lower half as
   *  that colour's master past a hard seam (FrameProfile.partColorSeam),
   *  the Prepare spell's page as that colour's page (a `partPage` overlay
   *  slot); absent and `false` are today's look, the card's one colour, so
   *  no stored card changes. A NEW card starts on (NEW_CARD_ANATOMY), an
   *  import follows its printing (on); every save drops it on a template
   *  that declares neither (lib/cards/anatomy.ts normalizeAnatomy). */
  partColor?: boolean;
  /** The FIRST part's own frame colour where it is not the card's (TODO
   *  4.26, owner decision M2): a split or aftermath card's `color_identity`
   *  stays the WHOLE card's colours (Fire // Ice is red and blue, gold on
   *  the card page, the filters and the deck stats), and this names the
   *  colour its first half's master paints with `partColor` on (Fire's
   *  red). FrameStyle colour words, as `color_identity`. Absent = the
   *  card's colour paints the first part (every creator card: its picked
   *  colour IS the first part's). Written by an import and the AI paths;
   *  dropped at the save on a frame without a seam (normalizeAnatomy).
   *  Frame data only — never read for behaviour. */
  firstPartColor?: ColorIdentity[];
  /** The frame paints its PLAIN LAND master (`c`) for this gold-keyed card
   *  (TODO 4.11, owner 2026-10-22): a two-colour Zendikar Expedition — a
   *  dual or a fetch land, whose pinline prints its two colours — on a frame
   *  that draws no two-colour pinline yet (FrameProfile.plainLandStandIn).
   *  The card's `color_identity` stays what the import stores (its
   *  "multicolor": the card page, the filters, the decks); the frame draws
   *  and is gated / verified in `c` (lib/cards/part-color.ts
   *  frameGateColors). Written by an import of such a printing (and kept by
   *  an edit and a remix); dropped at the save on a frame that declares no
   *  stand-in (normalizeAnatomy). Frame data only — never read for
   *  behaviour. */
  plainLandMaster?: true;
};

// ---------------------------------------------------------------------------
// Premium gating (subscriptions).
//
// IP-safe rule: we ONLY ever gate our OWN technology — the rendered finishes
// (foil/etched/showcase are our own shader code) and any ORIGINAL PipGlyph
// frames. WotC-derived frame trade dress (m15/alpha/lotr/avatar/bloomburrow/
// tarkir) is NEVER paywalled — it stays free for everyone.
// ---------------------------------------------------------------------------

// Finishes that require a paid plan. NONE: every finish is free (owner
// decision 2026-07-10; the paid tease is "premium custom frames", tracked in
// PREMIUM_FRAME_TEMPLATES below). Foil and etched are selectable in the
// creator since TODO 6.5 shipped (2026-09-26); showcase is still a disabled
// "Soon" chip (components/creator/panels/effects-panel.tsx). The gating
// plumbing stays wired so adding an entry here re-paywalls instantly.
export const PREMIUM_FINISHES: ReadonlySet<CardFinish> = new Set<CardFinish>();

// Original premium frame templates (none yet). Add ONLY original PipGlyph
// frames here — never WotC trade dress. Wired up so gating is ready the moment
// original premium frames ship.
export const PREMIUM_FRAME_TEMPLATES: ReadonlySet<FrameTemplate> =
  new Set<FrameTemplate>([]);

export function isPremiumFinish(finish: CardFinish | null | undefined): boolean {
  return finish != null && PREMIUM_FINISHES.has(finish);
}

export function isPremiumFrameTemplate(
  template: FrameTemplate | null | undefined,
): boolean {
  return template != null && PREMIUM_FRAME_TEMPLATES.has(template);
}

/** True if a frame style uses any premium (paid) treatment. */
export function frameStyleRequiresPremium(
  frameStyle: FrameStyle | null | undefined,
): boolean {
  if (!frameStyle) return false;
  return (
    isPremiumFinish(frameStyle.finish) ||
    isPremiumFrameTemplate(frameStyle.template)
  );
}

// Roadmap ERAS — border generations not yet converted, shown as disabled "Soon"
// chips in the era tier so users see what's coming. The MSE pack has all three
// (magic-old / magic-new / magic-future); to ship one, convert its frames, add
// the era to FRAME_ERA_VALUES + an ERA_TYPE_FRAME row, and remove it here.
export type ComingSoonEra = { key: string; label: string; hint: string };
export const COMING_SOON_ERAS: ComingSoonEra[] = [
  { key: "future", label: "Future Sight (2007)", hint: "The futureshifted frame" },
];

// ---------------------------------------------------------------------------
// Composed types for queries that join cards with related tables.
// ---------------------------------------------------------------------------

export type CardWithOwner = Card & {
  owner: Pick<Profile, "username" | "display_name" | "avatar_url"> | null;
};

// ---------------------------------------------------------------------------
// Comments on public cards (Phase v2)
// ---------------------------------------------------------------------------

export type CardComment = CardCommentRow;
export type CardCommentInsert = CardCommentRowInsert;

export type CardCommentWithAuthor = CardComment & {
  author: Pick<Profile, "username" | "display_name" | "avatar_url"> | null;
};

// ---------------------------------------------------------------------------
// Narrowing helpers — runtime guards so unknown DB rows can be safely used as
// the narrowed Card type. Useful when reading cards via a Supabase client
// configured against the raw Database type (e.g. realtime payloads).
// ---------------------------------------------------------------------------

export function isVisibility(value: unknown): value is Visibility {
  return typeof value === "string" && (VISIBILITY_VALUES as readonly string[]).includes(value);
}

export function isRarity(value: unknown): value is Rarity {
  return typeof value === "string" && (RARITY_VALUES as readonly string[]).includes(value);
}

export function isCardType(value: unknown): value is CardType {
  return typeof value === "string" && (CARD_TYPE_VALUES as readonly string[]).includes(value);
}

export function isColorIdentity(value: unknown): value is ColorIdentity {
  return (
    typeof value === "string" &&
    (COLOR_IDENTITY_VALUES as readonly string[]).includes(value)
  );
}

export type { Json };
