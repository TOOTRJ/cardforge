// The parts of a card AI provenance names (TODO CP1, migration 0162's
// `cards_ai_fields_known`) — dependency-free so the card schema can read
// them. Everything else is lib/cards/ai-provenance.ts.

/** The text parts — what an AI fill, idea or job writes. */
export const AI_TEXT_FIELD_KEYS = [
  "title",
  "cost",
  "type_line",
  "rules_text",
  "flavor_text",
  "stats",
  "back.title",
  "back.cost",
  "back.type_line",
  "back.rules_text",
  "back.flavor_text",
  "back.stats",
] as const;

/** The pictures — derived by the database from the art's address. */
export const AI_ART_FIELD_KEYS = ["art", "back.art"] as const;

export const AI_FIELD_KEYS = [...AI_TEXT_FIELD_KEYS, ...AI_ART_FIELD_KEYS] as const;

export type AiTextFieldKey = (typeof AI_TEXT_FIELD_KEYS)[number];
export type AiArtFieldKey = (typeof AI_ART_FIELD_KEYS)[number];
export type AiFieldKey = (typeof AI_FIELD_KEYS)[number];

