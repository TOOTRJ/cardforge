// The designs the layout tests hand the mocked model (the AI dialog, PR 2):
// one per saga / two-part kind, each clean under the lint (no warning, so
// no judge call), and the frame each is made on.

import type { SagaDesign, SecondPartDesign } from "@/lib/ai/layout-design";

export type FixtureDesign = {
  title: string;
  cost: string;
  card_type: string;
  supertype: string | null;
  subtypes: string[];
  rarity: string;
  color_identity: string[];
  rules_text: string;
  flavor_text: string | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  defense: string | null;
  art_prompt: string;
  saga?: SagaDesign | null;
  second_part?: SecondPartDesign | null;
};

export const designedCard = (over: Partial<FixtureDesign> = {}): FixtureDesign => ({
  title: "Hearthwood Giant",
  cost: "{3}{G}",
  card_type: "creature",
  supertype: null,
  subtypes: ["Giant"],
  rarity: "uncommon",
  color_identity: ["green"],
  rules_text: "Reach",
  flavor_text: "It never minded the birds.",
  power: "4",
  toughness: "4",
  loyalty: null,
  defense: null,
  art_prompt: "A mossy giant striding through a misty forest at dawn.",
  ...over,
});

export const SAGA = designedCard({
  title: "The Long Thaw",
  cost: "{2}{G}",
  card_type: "enchantment",
  subtypes: ["Saga"],
  rules_text: "I — Draw a card.\nII, III — Create a 2/2 green Bear creature token.",
  flavor_text: null,
  power: null,
  toughness: null,
  saga: {
    intro: null,
    chapters: [
      { numerals: [1], text: "Draw a card." },
      { numerals: [2, 3], text: "Create a 2/2 green Bear creature token." },
    ],
  },
  art_prompt: "A frozen river cracking open under a spring sun, bears waking on its banks.",
});

export const SPLIT = designedCard({
  title: "Emberlash",
  cost: "{1}{R}",
  card_type: "instant",
  subtypes: [],
  color_identity: ["red", "blue", "multicolor"],
  rules_text: "Emberlash deals 2 damage to any target.",
  flavor_text: null,
  power: null,
  toughness: null,
  second_part: {
    title: "Frostbind",
    cost: "{1}{U}",
    card_type: "instant",
    supertype: null,
    subtypes: [],
    rules_text: "Tap target permanent. Draw a card.",
    power: null,
    toughness: null,
  },
  art_prompt: "A duel of fire and ice above a frozen lake.",
});

export const AFTERMATH = designedCard({
  title: "Cleave",
  cost: "{2}{R}",
  card_type: "sorcery",
  subtypes: [],
  color_identity: ["red", "green", "multicolor"],
  rules_text: "Cleave deals 4 damage to target creature.",
  flavor_text: null,
  power: null,
  toughness: null,
  second_part: {
    title: "Regrowth Rite",
    cost: "{3}{G}",
    card_type: "sorcery",
    supertype: null,
    subtypes: [],
    rules_text: "Aftermath (Cast this spell only from your graveyard. Then exile it.)\nCreate two 2/2 green Wolf creature tokens.",
    power: null,
    toughness: null,
  },
  art_prompt: "An axe splitting a boulder, saplings sprouting from the crack.",
});

export const ADVENTURE = designedCard({
  second_part: {
    title: "Stomp Through",
    cost: "{1}{G}",
    card_type: "instant",
    supertype: null,
    subtypes: ["Adventure"],
    rules_text: "Target creature you control gets +2/+2 until end of turn.",
    power: null,
    toughness: null,
  },
});

export const PREPARE = designedCard({
  title: "Lantern Scholar",
  cost: "{2}{W}",
  subtypes: ["Human", "Cleric"],
  color_identity: ["white"],
  rules_text: "Flying\nThis creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
  power: "2",
  toughness: "3",
  second_part: {
    title: "Gentle Recall",
    cost: "{W}",
    card_type: "sorcery",
    supertype: null,
    subtypes: [],
    rules_text: "You gain 3 life.",
    power: null,
    toughness: null,
  },
  art_prompt: "A robed scholar holding a lantern in a library tower.",
});

export const FLIP = designedCard({
  title: "Ashen Apprentice",
  cost: "{1}{R}",
  supertype: "Legendary",
  subtypes: ["Human", "Wizard"],
  color_identity: ["red"],
  rules_text: "Whenever you cast an instant or sorcery spell, put a ki counter on Ashen Apprentice. Then if it has two or more ki counters on it, flip it.",
  power: "1",
  toughness: "2",
  second_part: {
    title: "Ashen Pyromancer",
    cost: "",
    card_type: "creature",
    supertype: "Legendary",
    subtypes: ["Human", "Wizard"],
    rules_text: "Whenever you cast an instant or sorcery spell, Ashen Pyromancer deals 1 damage to each opponent.",
    power: "3",
    toughness: "3",
  },
  art_prompt: "A young wizard wreathed in ash and embers.",
});

export const LAYOUT_DESIGNS = {
  saga: SAGA,
  adventure: ADVENTURE,
  prepare: PREPARE,
  split: SPLIT,
  aftermath: AFTERMATH,
  flip: FLIP,
} as const;

/** Every field the dialog can tick, as the Start-with hero does. */
export const WANT_ALL = ["card_type", "color_identity", "title", "cost", "rules_text", "flavor_text", "stats", "art"];
