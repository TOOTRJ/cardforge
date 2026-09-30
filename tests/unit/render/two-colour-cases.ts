import type { CardPreviewData } from "@/components/cards/card-preview";
import type { ColorIdentity, FrameStyle } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.6b — the two-colour parity cases, ONE table both renderers are held
// to (the bake: tests/unit/render/two-colour-bake.test.tsx; the live preview:
// tests/unit/components/two-colour-preview.test.tsx), each in regular, foil
// and etched, on the REAL profiles (m15 split + hybrid, m15artifact and
// m15land split). `master` is the frame master painted (template/key),
// `plate` the P/T plate path (null: the card draws none).
// ---------------------------------------------------------------------------

export type PairCase = {
  id: string;
  card: Partial<CardPreviewData>;
  master: string;
  plate: string | null;
};

const on = (template: FrameStyle["template"], extra: Partial<FrameStyle> = {}): FrameStyle => ({
  template,
  twoColor: true,
  ...extra,
});

const colours = (...c: ColorIdentity[]) => c;

export const PAIR_CASES: readonly PairCase[] = [
  {
    id: "gold pair (FDN #122 style)",
    card: { colorIdentity: colours("white", "blue"), cost: "{2}{W}{U}", frameStyle: on("m15") },
    master: "m15/wu",
    plate: "/frames/m15/pt/m.png",
  },
  {
    id: "the AI's pair words with the multicolor token, stored second-first",
    card: { colorIdentity: colours("blue", "white", "multicolor"), cost: "{1}{U}{W}", frameStyle: on("m15") },
    master: "m15/wu",
    plate: "/frames/m15/pt/m.png",
  },
  {
    id: "hybrid pair (TLA #212 style): the hybrid master, the grey plate",
    card: { colorIdentity: colours("green", "white"), cost: "{G/W}{G/W}", frameStyle: on("m15") },
    master: "m15/gw-h",
    plate: "/frames/m15/pt/c.png",
  },
  {
    id: "mixed cost (STX #175): gold-split",
    card: { colorIdentity: colours("black", "green"), cost: "{1}{B}{B/G}{G}", frameStyle: on("m15") },
    master: "m15/bg",
    plate: "/frames/m15/pt/m.png",
  },
  {
    id: "a cost-less nonland (MH2 #186 style): hybrid",
    card: { colorIdentity: colours("black", "red"), cost: null, frameStyle: on("m15") },
    master: "m15/br-h",
    plate: "/frames/m15/pt/c.png",
  },
  {
    id: "legendary pair: the pair master (the crown is 4.6a's)",
    card: {
      supertype: "Legendary",
      colorIdentity: colours("blue", "red"),
      cost: "{2}{U}{R}",
      frameStyle: on("m15", { crown: true }),
    },
    master: "m15/ur",
    plate: "/frames/m15/pt/m.png",
  },
  {
    id: "pair land (MKM #264 style)",
    card: {
      cardType: "land",
      supertype: null,
      subtypes: ["Plains", "Island"],
      colorIdentity: colours("white", "blue"),
      cost: null,
      power: null,
      toughness: null,
      frameStyle: on("m15land"),
    },
    master: "m15land/wu",
    plate: null,
  },
  {
    id: "pair artifact (DFT #219 style): the artifact frame, the gold plate",
    card: {
      supertype: "Artifact",
      colorIdentity: colours("white", "blue"),
      cost: "{1}{W}{W}{U}{U}",
      frameStyle: on("m15artifact"),
    },
    master: "m15artifact/wu",
    plate: "/frames/m15artifact/pt/m.png",
  },
  {
    id: "hybrid artifact (ELD #206 style): no hybrid dress there — gold-split",
    card: {
      supertype: "Artifact",
      colorIdentity: colours("white", "blue"),
      cost: "{W/U}{W/U}{W/U}{W/U}",
      frameStyle: on("m15artifact"),
    },
    master: "m15artifact/wu",
    plate: "/frames/m15artifact/pt/m.png",
  },
  // The look each card had before 4.6b stays wherever the switch isn't on,
  // the identity isn't a pair, or the frame has no pair masters.
  {
    id: "switched off: gold",
    card: { colorIdentity: colours("white", "blue"), cost: "{2}{W}{U}", frameStyle: { template: "m15", twoColor: false } },
    master: "m15/m",
    plate: "/frames/m15/pt/m.png",
  },
  {
    id: "no key (every stored card): gold",
    card: { colorIdentity: colours("white", "blue"), cost: "{2}{W}{U}", frameStyle: { template: "m15" } },
    master: "m15/m",
    plate: "/frames/m15/pt/m.png",
  },
  {
    id: "no key, hybrid cost: gold, the gold plate",
    card: { colorIdentity: colours("green", "white"), cost: "{G/W}{G/W}", frameStyle: { template: "m15" } },
    master: "m15/m",
    plate: "/frames/m15/pt/m.png",
  },
  {
    id: "three colours: gold",
    card: { colorIdentity: colours("white", "blue", "black"), cost: "{W}{U}{B}", frameStyle: on("m15") },
    master: "m15/m",
    plate: "/frames/m15/pt/m.png",
  },
  {
    id: "plain multicolor: gold",
    card: { colorIdentity: colours("multicolor"), cost: "{2}{W}{U}", frameStyle: on("m15") },
    master: "m15/m",
    plate: "/frames/m15/pt/m.png",
  },
  {
    id: "mono, whatever the cost (an explicit black {3}{U}{B}): its colour",
    card: { colorIdentity: colours("black"), cost: "{3}{U}{B}", frameStyle: on("m15") },
    master: "m15/b",
    plate: "/frames/m15/pt/b.png",
  },
  {
    id: "a pair on a frame with no pair masters (m15snow): gold",
    card: { colorIdentity: colours("white", "blue"), cost: "{2}{W}{U}", frameStyle: on("m15snow") },
    master: "m15snow/m",
    plate: "/frames/m15snow/pt/m.png",
  },
  {
    id: "a land pair switched off: the gold land",
    card: {
      cardType: "land",
      supertype: null,
      colorIdentity: colours("white", "blue"),
      cost: null,
      power: null,
      toughness: null,
      frameStyle: { template: "m15land" },
    },
    master: "m15land/m",
    plate: null,
  },
];

export const FINISHES = ["regular", "foil", "etched"] as const;

/** A card for the case at `finish` (a creature with P/T unless the case
 *  says otherwise). */
export function pairCaseCard(c: PairCase, finish: (typeof FINISHES)[number]): CardPreviewData {
  const base: CardPreviewData = {
    title: "Pair Probe",
    cost: "{2}{W}{U}",
    cardType: "creature",
    supertype: null,
    subtypes: ["Bird"],
    rarity: "rare",
    colorIdentity: ["white", "blue"],
    rulesText: null,
    flavorText: null,
    power: "2",
    toughness: "3",
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "m15" },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
  } as CardPreviewData;
  const card = { ...base, ...c.card } as CardPreviewData;
  return { ...card, frameStyle: { ...(card.frameStyle ?? {}), finish } } as CardPreviewData;
}
