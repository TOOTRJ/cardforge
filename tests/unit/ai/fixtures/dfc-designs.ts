// The designs the double-faced tests hand the mocked model (the AI dialog,
// PR 3): one per kind, each clean under the lint (no warning, so no judge
// call), with its back face and the back's own art prompt.

import type { AiDfcKind, BackFaceDesign } from "@/lib/ai/dfc-design";
import { designedCard, type FixtureDesign } from "./layout-designs";

export type DfcFixtureDesign = FixtureDesign & { back_face?: BackFaceDesign | null };

const dfcCard = (over: Partial<DfcFixtureDesign>): DfcFixtureDesign => ({ ...designedCard(), ...over });

const back = (over: Partial<BackFaceDesign>): BackFaceDesign => ({
  title: "Moonlit Ravager",
  cost: "",
  card_type: "creature",
  supertype: null,
  subtypes: ["Werewolf"],
  rules_text: "Trample",
  flavor_text: null,
  power: "5",
  toughness: "4",
  color_identity: [],
  art_prompt: "A huge grey werewolf howling on a moonlit hill above a burning village.",
  ...over,
});

export const TRANSFORM: DfcFixtureDesign = dfcCard({
  title: "Hollow Village Smith",
  cost: "{2}{R}",
  card_type: "creature",
  subtypes: ["Human", "Werewolf"],
  color_identity: ["red"],
  rules_text: "At the beginning of each upkeep, if no spells were cast last turn, transform this creature.",
  flavor_text: null,
  power: "3",
  toughness: "2",
  art_prompt: "A soot-stained village blacksmith at a glowing forge, glancing nervously at the rising moon.",
  back_face: back({}),
});

export const MODAL: DfcFixtureDesign = dfcCard({
  title: "Tidecaller's Summons",
  cost: "{1}{U}",
  card_type: "sorcery",
  subtypes: [],
  color_identity: ["blue"],
  rules_text: "Draw two cards.",
  flavor_text: null,
  power: null,
  toughness: null,
  art_prompt: "A robed mage raising her arms as a great wave curls over a stone jetty.",
  back_face: back({
    title: "Tidecaller's Grotto",
    card_type: "land",
    subtypes: [],
    rules_text: "This land enters tapped.\n{T}: Add {U}.",
    power: null,
    toughness: null,
    color_identity: ["blue"],
    art_prompt: "A hidden sea cave lit by glowing blue water, waves washing over smooth rocks.",
  }),
});

export const DFC_SAGA: DfcFixtureDesign = dfcCard({
  title: "The Lantern's Oath",
  cost: "{2}{W}",
  card_type: "enchantment",
  subtypes: ["Saga"],
  color_identity: ["white"],
  rules_text:
    "I — You gain 3 life.\nII — Exile this Saga, then return it to the battlefield transformed under your control.",
  flavor_text: null,
  power: null,
  toughness: null,
  saga: {
    intro: null,
    chapters: [
      { numerals: [1], text: "You gain 3 life." },
      { numerals: [2], text: "Exile this Saga, then return it to the battlefield transformed under your control." },
    ],
  },
  art_prompt: "A young knight kneeling before a shrine of paper lanterns, swearing an oath at dusk.",
  back_face: back({
    title: "Lantern Oathkeeper",
    supertype: null,
    subtypes: ["Human", "Knight"],
    rules_text: "Vigilance",
    power: "3",
    toughness: "3",
    art_prompt: "A shining knight in white armour holding a glowing lantern aloft on a mountain path.",
  }),
});

export const DFC_TOKEN: DfcFixtureDesign = dfcCard({
  title: "Goblin",
  cost: "—",
  card_type: "token",
  supertype: "Creature",
  subtypes: ["Goblin"],
  color_identity: ["red"],
  rules_text: "",
  flavor_text: null,
  power: "1",
  toughness: "1",
  rarity: "common",
  art_prompt: "A grinning goblin with a crooked spear leaping out of a cave mouth.",
  back_face: back({
    title: "Soldier",
    card_type: "token",
    supertype: "Creature",
    subtypes: ["Soldier"],
    rules_text: "",
    power: "1",
    toughness: "1",
    color_identity: ["white"],
    art_prompt: "A lone shield-bearing soldier standing guard on a sunlit city wall.",
  }),
});

export const DFC_DESIGNS: Record<AiDfcKind, DfcFixtureDesign> = {
  transform: TRANSFORM,
  mdfc: MODAL,
  dfc_saga: DFC_SAGA,
  dfc_token: DFC_TOKEN,
};

/** The frame each kind is made on in the tests (the dialog's pick). */
export const DFC_FRONT: Record<AiDfcKind, string> = {
  transform: "m15dfcfront",
  mdfc: "m15mdfcfront",
  dfc_saga: "sagadfcfront",
  dfc_token: "m20token",
};
