// Shared form-state shapes for the card creator. Extracted from
// components/creator/card-creator-form.tsx so the pure step model
// (lib/creator/steps.ts) can reference `FormValues` without importing the
// client component (which would create a cycle + drag React into the test).

import type {
  ArtPosition,
  CardType,
  ColorIdentity,
  FrameStyle,
  Rarity,
  Visibility,
} from "@/types/card";

// Back-face form values mirror the front-face fields the back face stores.
// Doubles as the Adventure spell's content on Adventure frames.
export type BackFaceFormValues = {
  title: string;
  cost: string;
  card_type: CardType | "";
  supertype: string;
  subtypes_text: string;
  rules_text: string;
  flavor_text: string;
  power: string;
  toughness: string;
  loyalty: string;
  defense: string;
  artist_credit: string;
  art_url: string;
  art_position: ArtPosition;
};

export type FormValues = {
  title: string;
  slug: string;
  game_system_id: string;
  template_id: string;
  cost: string;
  color_identity: ColorIdentity[];
  supertype: string;
  card_type: CardType | "";
  subtypes_text: string;
  tags_text: string;
  rarity: Rarity | "";
  rules_text: string;
  flavor_text: string;
  power: string;
  toughness: string;
  loyalty: string;
  defense: string;
  artist_credit: string;
  art_url: string;
  art_position: ArtPosition;
  frame_style: FrameStyle;
  visibility: Visibility;
  has_back_face: boolean;
  back_face: BackFaceFormValues;
  source_scryfall_id: string;
  /** The set this card is added to (empty = none). Its icon becomes the card's
   *  set symbol; the action also adds the card to the set's list. */
  primary_set_id: string;
};

// Empty back-face values — used when the user toggles on "has back face" from a
// freshly-created card, or when there's no persisted back face.
export const EMPTY_BACK_FACE: BackFaceFormValues = {
  title: "",
  cost: "",
  card_type: "creature",
  supertype: "",
  subtypes_text: "",
  rules_text: "",
  flavor_text: "",
  power: "",
  toughness: "",
  loyalty: "",
  defense: "",
  artist_credit: "",
  art_url: "",
  art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
};
