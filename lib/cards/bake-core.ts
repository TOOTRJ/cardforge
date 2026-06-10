import "server-only";

import {
  isCardType,
  isColorIdentity,
  isRarity,
  type ArtPosition,
  type CardBackFace,
  type CardType,
  type ColorIdentity,
  type FrameStyle,
  type Rarity,
} from "@/types/card";
import type { CardPreviewData } from "@/components/cards/card-preview";

// ---------------------------------------------------------------------------
// Shared bake plumbing — the card-row shape, column list, and row→render-input
// mapping used by BOTH the user-scoped save bake (lib/cards/bake-render.ts, a
// "use server" module) and the admin re-bake sweep (app/api/admin/rebake).
// Lives outside the "use server" module so importing it never exposes a
// server action.
// ---------------------------------------------------------------------------

export type CardRowForBake = {
  id: string;
  owner_id: string;
  title: string;
  cost: string | null;
  card_type: string | null;
  supertype: string | null;
  subtypes: string[];
  rarity: string | null;
  color_identity: string[];
  rules_text: string | null;
  flavor_text: string | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  defense: string | null;
  artist_credit: string | null;
  art_url: string | null;
  art_position: unknown;
  frame_style: unknown;
  set_icon_url: string | null;
  set_icon_code: string | null;
  back_face: unknown;
};

/** Every column the renderer needs (plus owner/visibility for gating). */
export const BAKE_SELECT_COLUMNS =
  "id, owner_id, visibility, title, cost, card_type, supertype, subtypes, rarity, color_identity, rules_text, flavor_text, power, toughness, loyalty, defense, artist_credit, art_url, art_position, frame_style, set_icon_url, set_icon_code, back_face";

export function rowToPreviewData(card: CardRowForBake): CardPreviewData {
  return {
    title: card.title,
    cost: card.cost,
    cardType: isCardType(card.card_type) ? (card.card_type as CardType) : null,
    supertype: card.supertype,
    subtypes: card.subtypes,
    rarity: isRarity(card.rarity) ? (card.rarity as Rarity) : null,
    colorIdentity: card.color_identity.filter(isColorIdentity) as ColorIdentity[],
    rulesText: card.rules_text,
    flavorText: card.flavor_text,
    power: card.power,
    toughness: card.toughness,
    loyalty: card.loyalty,
    defense: card.defense,
    artistCredit: card.artist_credit,
    artUrl: card.art_url,
    artPosition: (card.art_position as ArtPosition | null) ?? {},
    frameStyle: (card.frame_style as FrameStyle | null) ?? {},
    setIconUrl: card.set_icon_url,
    setIconCode: card.set_icon_code,
    // Adventure frames render the back-face content as an inline sub-panel.
    backFace: (card.back_face as CardBackFace | null) ?? null,
  };
}
