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
] as const;
export type FrameTemplate = (typeof FRAME_TEMPLATE_VALUES)[number];

// The frame used when a card has no explicit template (new cards + legacy rows
// that predate the picker, including the retired "regular" placeholder).
export const DEFAULT_FRAME_TEMPLATE: FrameTemplate = "m15";

// Display labels for the template picker in the creator form.
export const FRAME_TEMPLATE_LABELS: Record<FrameTemplate, string> = {
  m15: "M15 (modern)",
  m15land: "M15 Land",
  m15token: "M15 Token",
  m15snow: "M15 Snow",
  m15devoid: "M15 Devoid",
  m15pw: "M15 Planeswalker",
  agclassic: "Alpha (1993)",
  alphaland: "Alpha Land",
  alphatoken: "Alpha Token",
  battle: "Battle (Siege)",
  saga: "Saga",
};

export type FrameStyle = {
  /** Optional override of the template's default visual treatment. */
  border?: "thin" | "thick" | "ornate";
  accent?: "warm" | "cool" | "neutral";
  finish?: CardFinish;
  /** Which frame PNG asset to layer behind the card sections. */
  template?: FrameTemplate;
};

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
