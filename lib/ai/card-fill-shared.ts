// Per-field AI generation ("fill") — the client-safe half. The creator's AI
// dialog lets the user tick exactly which fields the AI should generate;
// every unticked field is pinned as fixed context so the design stays
// coherent around it, and is never overwritten (owner decision 2026-09-16).
// Pure and React-free: shared by the dialog, the form, the job planner and
// the unit tests.

import type { CardType, ColorIdentity, Rarity } from "@/types/card";

export const CARD_FILL_FIELDS = [
  "title",
  "art",
  "card_type",
  "color_identity",
  "cost",
  "rarity",
  "rules_text",
  "flavor_text",
  "stats",
  "tags",
] as const;

export type CardFillField = (typeof CARD_FILL_FIELDS)[number];

/** Fields that only exist while CREATING a card — edit and remix lock the
 *  card's structure (lib/creator/revise.ts), so they are never offered. */
export const CREATE_ONLY_FILL_FIELDS: readonly CardFillField[] = [
  "card_type",
  "color_identity",
];

export const FILL_FIELD_LABELS: Record<CardFillField, string> = {
  title: "Title",
  art: "Artwork",
  card_type: "Card type",
  color_identity: "Colors",
  cost: "Mana cost",
  rarity: "Rarity",
  rules_text: "Rules text",
  flavor_text: "Flavor text",
  stats: "Power / toughness",
  tags: "Tags",
};

/** Default tick-sets for each entry point. */
export const FILL_PRESETS = {
  /** The Start-with hero tile: everything. */
  all: [...CARD_FILL_FIELDS] as CardFillField[],
  /** "Generate AI artwork and title" beside Choose file (Identity step). */
  artAndTitle: ["title", "art"] as CardFillField[],
  /** The Text & stats step's button. */
  textStep: ["rules_text", "flavor_text", "stats"] as CardFillField[],
} as const;

/** The current form values the designer must respect — everything the user
 *  has NOT asked to regenerate. Strings are trimmed by the caller. */
export type CardFillLocked = {
  title?: string;
  cost?: string;
  card_type?: CardType;
  supertype?: string;
  subtypes?: string[];
  rarity?: Rarity;
  color_identity?: ColorIdentity[];
  rules_text?: string;
  flavor_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  tags?: string[];
};

/** Steering for fields that ARE being generated (the dialog's selects). */
export type CardFillSteer = {
  card_type?: CardType;
  rarity?: Rarity;
};

/** What comes back: only the wanted fields are present. Stats travel as a
 *  group. `art_url` / `artist_credit` arrive when artwork was wanted;
 *  `frame_template` when the card type was generated (create only). */
export type CardFillResult = {
  title?: string;
  cost?: string;
  card_type?: CardType;
  supertype?: string | null;
  subtypes?: string[];
  rarity?: Rarity;
  color_identity?: ColorIdentity[];
  rules_text?: string;
  flavor_text?: string | null;
  power?: string | null;
  toughness?: string | null;
  loyalty?: string | null;
  defense?: string | null;
  tags?: string[];
  art_url?: string;
  artist_credit?: string;
  frame_template?: string | null;
  deck_id?: string | null;
};

/** The designer's output shape (a superset of what we keep). */
export type DesignedLike = {
  title: string;
  cost: string;
  card_type: CardType;
  supertype: string | null;
  subtypes: string[];
  rarity: Rarity;
  color_identity: ColorIdentity[];
  rules_text: string;
  flavor_text: string | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  defense: string | null;
  tags?: string[];
};

/** Keep only the fields the user asked for. Everything else is left to the
 *  form's existing values — the caller never even sees the designer's take
 *  on a pinned field. */
export function pickFillResult(
  designed: DesignedLike,
  want: readonly CardFillField[],
): CardFillResult {
  const has = (f: CardFillField) => want.includes(f);
  const out: CardFillResult = {};
  if (has("title")) out.title = designed.title;
  if (has("cost")) out.cost = designed.cost;
  if (has("card_type")) {
    out.card_type = designed.card_type;
    out.supertype = designed.supertype;
    out.subtypes = designed.subtypes;
  }
  if (has("rarity")) out.rarity = designed.rarity;
  if (has("color_identity")) out.color_identity = designed.color_identity;
  if (has("rules_text")) out.rules_text = designed.rules_text;
  if (has("flavor_text")) out.flavor_text = designed.flavor_text;
  if (has("stats")) {
    out.power = designed.power;
    out.toughness = designed.toughness;
    out.loyalty = designed.loyalty;
    out.defense = designed.defense;
  }
  if (has("tags")) out.tags = designed.tags ?? [];
  return out;
}

/** The prompt line that pins every unticked field. Written so the model
 *  reproduces the pinned values verbatim and designs the rest AROUND them. */
export function fillPromptNote(
  locked: CardFillLocked,
  want: readonly CardFillField[],
): string {
  const has = (f: CardFillField) => want.includes(f);
  const pinned: string[] = [];
  if (!has("title") && locked.title) pinned.push(`title "${locked.title}"`);
  if (!has("card_type")) {
    const typeLine = [
      locked.supertype,
      locked.card_type,
      locked.subtypes?.length ? `— ${locked.subtypes.join(" ")}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    if (typeLine) pinned.push(`type line "${typeLine}"`);
  }
  if (!has("color_identity") && locked.color_identity?.length) {
    pinned.push(`color identity ${locked.color_identity.join("/")}`);
  }
  if (!has("cost") && locked.cost) pinned.push(`mana cost ${locked.cost}`);
  if (!has("rarity") && locked.rarity) pinned.push(`rarity ${locked.rarity}`);
  if (!has("rules_text") && locked.rules_text) {
    pinned.push(`rules text "${locked.rules_text}"`);
  }
  if (!has("flavor_text") && locked.flavor_text) {
    pinned.push(`flavor text "${locked.flavor_text}"`);
  }
  if (!has("stats")) {
    const stats = [
      locked.power && locked.toughness ? `${locked.power}/${locked.toughness}` : null,
      locked.loyalty ? `loyalty ${locked.loyalty}` : null,
      locked.defense ? `defense ${locked.defense}` : null,
    ].filter(Boolean);
    if (stats.length) pinned.push(`stats ${stats.join(", ")}`);
  }
  const generate = want
    .filter((f) => f !== "art")
    .map((f) => FILL_FIELD_LABELS[f].toLowerCase());
  const lines: string[] = [];
  if (pinned.length > 0) {
    lines.push(
      `This card already exists in part. Keep these EXACTLY as given, reproducing them verbatim in your output: ${pinned.join("; ")}.`,
    );
  }
  if (generate.length > 0) {
    lines.push(
      `Design only: ${generate.join(", ")} — make them fit the kept parts naturally.`,
    );
  } else {
    lines.push(
      "Only the artwork is being generated: describe THIS card's illustration in art_prompt, matching its name and text.",
    );
  }
  return lines.join(" ");
}
