export type Rarity = "common" | "uncommon" | "rare" | "mythic";

export type CardType =
  | "creature"
  | "spell"
  | "artifact"
  | "enchantment"
  | "land"
  | "token";

export type Visibility = "private" | "unlisted" | "public";

export type ColorIdentity =
  | "white"
  | "blue"
  | "black"
  | "red"
  | "green"
  | "colorless"
  | "multicolor";

export type CardPreview = {
  id: string;
  slug: string;
  title: string;
  cost?: string;
  cardType?: CardType;
  rarity?: Rarity;
  colorIdentity?: ColorIdentity;
  artistCredit?: string;
};

export type SetPreview = {
  id: string;
  slug: string;
  title: string;
  cardCount: number;
  description?: string;
};

export type ProfilePreview = {
  username: string;
  displayName: string;
  bio?: string;
  cardCount: number;
};
