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

export const RARITY_VALUES = [
  "common",
  "uncommon",
  "rare",
  "mythic",
] as const;
export type Rarity = (typeof RARITY_VALUES)[number];

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

export const FANTASY_TEMPLATE_KEYS = [
  "fantasy_creature",
  "fantasy_spell",
  "fantasy_artifact",
  "fantasy_land",
] as const;
export type FantasyTemplateKey = (typeof FANTASY_TEMPLATE_KEYS)[number];

// ---------------------------------------------------------------------------
// Narrowed row types — the DB stores enums as text, so we re-export rows with
// the enum unions baked in. Use these everywhere downstream (queries,
// preview components, server actions) so the rest of the app never has to
// guard against arbitrary strings.
// ---------------------------------------------------------------------------

export type Card = Omit<
  CardRow,
  "visibility" | "rarity" | "card_type" | "color_identity"
> & {
  visibility: Visibility;
  rarity: Rarity | null;
  card_type: CardType | null;
  color_identity: ColorIdentity[];
};

export type CardInsert = Omit<
  CardRowInsert,
  "visibility" | "rarity" | "card_type" | "color_identity"
> & {
  visibility?: Visibility;
  rarity?: Rarity | null;
  card_type?: CardType | null;
  color_identity?: ColorIdentity[];
};

export type CardUpdate = Omit<
  CardRowUpdate,
  "visibility" | "rarity" | "card_type" | "color_identity"
> & {
  visibility?: Visibility;
  rarity?: Rarity | null;
  card_type?: CardType | null;
  color_identity?: ColorIdentity[];
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
  /** Rotation in degrees, -180 to 180. 0 (default) = no rotation. */
  rotation?: number;
};

// Back-face content for double-faced cards (DFCs). Persisted as jsonb on
// the same `cards` row (no join table). Shared fields like rarity,
// color_identity, and frame_style live on the front-card row and apply
// to both faces — the back face only carries per-face content.
export type CardBackFace = {
  title: string;
  cost?: string;
  card_type?: CardType;
  supertype?: string;
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
};

// Card finish — premium treatments layered on top of the base frame.
// Default is "regular"; "foil" adds an animated holographic sheen,
// "etched" adds a gold-leaf inner border + faint texture, "borderless"
// lets the art bleed under the section panels, and "showcase" swaps the
// title to an italic display treatment with an ornate underline.
export const CARD_FINISH_VALUES = [
  "regular",
  "foil",
  "etched",
  "borderless",
  "showcase",
] as const;
export type CardFinish = (typeof CARD_FINISH_VALUES)[number];

// Frame templates correspond to PNG assets in public/frames/{template}/{color}.png
// plus a layout profile in lib/cards/template-layout.ts. Every template is an
// MSE-derived MTG frame converted from the open-source Full-Magic-Pack; the
// 375×523 MSE base is upscaled to 1500×2100 with the art window cut out to
// alpha=0 so the user's art renders behind the frame. All templates share the
// 7-color contract (w/u/b/r/g/c/m).
//
// "m15"       — Magic 2015-era modern frame (the default).
// "m15land"   — M15 land frame (stone border, color-tinted text box, no cost).
// "m15token"  — M15 token frame (art-forward; dark title bar, no cost).
// "m15snow"   — M15 snow frame (frosty silver skin; m15 geometry).
// "m15devoid" — M15 devoid/Eldrazi frame (washed-out colorless; m15 geometry).
// "m15pw"     — M15 planeswalker frame (two art cut-outs + loyalty badge).
// "agclassic" — 1993 Alpha/Beta frame.
// "alphaland" — 1993 Alpha land frame (agclassic geometry, no cost).
// "alphatoken"— 1993 Alpha token frame (silver border, tan type box, no cost).
// "battle"    — M15 Battle/Siege frame — the only LANDSCAPE (7:5) frame.
// "saga"      — M15 Saga frame (chapter rail on the left, art column on the right).
// "adventure" — M15 Adventure (Eldraine) frame — a creature whose lower text area
//               is split into an open "storybook": the adventure spell (its
//               name/type/cost/rules come from the card's back-face content) on
//               the LEFT page, the creature's own rules on the RIGHT page.
//
// Adding a frame: drop the PNGs, add a value here + a label below, and add one
// profile entry in lib/cards/template-layout.ts. No renderer changes needed
// (landscape frames just set orientation: "landscape" in their profile).
export const FRAME_TEMPLATE_VALUES = [
  "m15",
  "m15land",
  "m15token",
  "m15snow",
  "m15devoid",
  "m15pw",
  "agclassic",
  "alphaland",
  "alphatoken",
  "battle",
  "saga",
  "adventure",
] as const;
export type FrameTemplate = (typeof FRAME_TEMPLATE_VALUES)[number];

// The frame used when a card has no explicit template (new cards + legacy rows
// that predate the picker, including the retired "regular" placeholder).
export const DEFAULT_FRAME_TEMPLATE: FrameTemplate = "m15";

// Display labels for the template picker. These are shown UNDER a frame-set
// chip (Magic 2015 / Alpha), which supplies the family — so the labels are
// set-relative ("Standard", "Land", …) rather than repeating the set name.
export const FRAME_TEMPLATE_LABELS: Record<FrameTemplate, string> = {
  m15: "Standard",
  m15land: "Land",
  m15token: "Token",
  m15snow: "Snow",
  m15devoid: "Devoid",
  m15pw: "Planeswalker",
  agclassic: "Standard",
  alphaland: "Land",
  alphatoken: "Token",
  battle: "Battle (Siege)",
  saga: "Saga",
  adventure: "Adventure",
};

// ---------------------------------------------------------------------------
// Frame sets — group the templates into families so the creator can offer a
// two-step picker: choose a set, then a frame within it. Every template must
// map to a set (the Record below is exhaustive, so adding a frame is a compile
// error until it's assigned a set).
// ---------------------------------------------------------------------------
export const FRAME_SET_VALUES = ["m15", "alpha"] as const;
export type FrameSet = (typeof FRAME_SET_VALUES)[number];

export const FRAME_SET_LABELS: Record<FrameSet, string> = {
  m15: "Magic 2015 (modern)",
  alpha: "Alpha (1993)",
};

export const FRAME_TEMPLATE_SET: Record<FrameTemplate, FrameSet> = {
  m15: "m15",
  m15land: "m15",
  m15token: "m15",
  m15snow: "m15",
  m15devoid: "m15",
  m15pw: "m15",
  battle: "m15",
  saga: "m15",
  adventure: "m15",
  agclassic: "alpha",
  alphaland: "alpha",
  alphatoken: "alpha",
};

// The frame a set defaults to when the picker switches to it.
export const FRAME_SET_DEFAULT_TEMPLATE: Record<FrameSet, FrameTemplate> = {
  m15: "m15",
  alpha: "agclassic",
};

export type FrameStyle = {
  /** Premium treatment layered on the base frame (foil / etched / showcase). */
  finish?: CardFinish;
  /** Which frame PNG asset to layer behind the card sections. */
  template?: FrameTemplate;
};

// ---------------------------------------------------------------------------
// Roadmap frames — on the to-do list but not yet selectable. The picker shows
// these as disabled "Soon" chips so users can see what's coming. They are NOT
// part of FRAME_TEMPLATE_VALUES (which is compile-enforced and needs a layout
// profile + the 7 color PNGs), so they're plain display rows keyed by a string.
//
// To ship one: build the frame (see scripts/build-adventure-frame.mjs for the
// multi-panel composite approach), add it to FRAME_TEMPLATE_VALUES + a profile,
// and remove it from here.
// ---------------------------------------------------------------------------
export type ComingSoonFrame = { key: string; label: string; set: FrameSet };
export const COMING_SOON_FRAMES: ComingSoonFrame[] = [
  // Multi-panel frames (m15 family) — the composite approach is proven by the
  // Adventure frame; these are the remaining split-layout cards.
  { key: "flip", label: "Flip", set: "m15" },
  { key: "aftermath", label: "Aftermath", set: "m15" },
  { key: "split", label: "Split", set: "m15" },
];

export type ComingSoonSet = { key: string; label: string };
export const COMING_SOON_SETS: ComingSoonSet[] = [
  // Whole frame families on the roadmap (popular + recent set trade dress).
  { key: "retro", label: "Retro (1997)" },
  { key: "futureshifted", label: "Future Sight" },
  { key: "showcase", label: "Showcase" },
  { key: "universesbeyond", label: "Universes Beyond" },
];

// ---------------------------------------------------------------------------
// Composed types for queries that join cards with related tables.
// ---------------------------------------------------------------------------

export type CardWithOwner = Card & {
  owner: Pick<Profile, "username" | "display_name" | "avatar_url"> | null;
};

export type CardWithLineage = Card & {
  parent: Pick<Card, "id" | "slug" | "title"> | null;
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
