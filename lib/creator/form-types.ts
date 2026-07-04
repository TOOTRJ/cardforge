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

// Structured row editors (planeswalker loyalty abilities / saga chapters).
// Strings at the form boundary; runSubmit trims + converts to the
// FaceContent shape and dual-writes a serialized rules_text alongside
// (lib/cards/face-content.ts owns the round-trip).
export type LoyaltyRowFormValues = {
  /** "+1" | "-3" | "0" | "X" | "" — empty = static (unbadged) row. */
  cost: string;
  text: string;
};

export type SagaChapterFormValues = {
  /** Chapter numbers this row covers (1-based; rows may share: "I, II —"). */
  numerals: number[];
  text: string;
};

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
  /** Planeswalker loyalty rows — the Text step's editor when the kind is
   *  planeswalker. Empty for every other kind. */
  loyalty_abilities: LoyaltyRowFormValues[];
  /** Saga intro line + chapter rows — the Text step's editor for sagas. */
  saga_intro: string;
  saga_chapters: SagaChapterFormValues[];
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
  /** v2 back face: id of another owned card used as the back (empty = none).
   *  Standard frames use this; the inline frames keep using `back_face`. */
  back_card_id: string;
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
