// Domain types for the cards system. The shape comes from the generated
// Database type in `types/supabase.ts` (regenerated whenever migrations
// change). This file narrows free-form columns (rarity, card_type, etc.)
// to safe enum unions that match the DB check constraints.

import type {
  Card as CardRow,
  CardInsert as CardRowInsert,
  CardUpdate as CardRowUpdate,
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
  "spell",
  "artifact",
  "enchantment",
  "land",
  "token",
] as const;
export type CardType = (typeof CARD_TYPE_VALUES)[number];

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
};

export type FrameStyle = {
  /** Optional override of the template's default visual treatment. */
  border?: "thin" | "thick" | "ornate";
  accent?: "warm" | "cool" | "neutral";
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
