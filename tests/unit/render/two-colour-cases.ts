import type { CardPreviewData } from "@/components/cards/card-preview";
import type { ColorIdentity, FrameStyle } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.6b — the two-colour parity cases, ONE table both renderers are held
// to (the bake: tests/unit/render/two-colour-bake.test.tsx; the live preview:
// tests/unit/components/two-colour-preview.test.tsx), each in regular, foil
// and etched, on the REAL profiles (m15 split + hybrid, m15artifact and
// m15land split; the snow frames since 4.6f wave 2c; the borderless land
// since 4.56). `master` is the frame master painted (template/key),
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
    id: "legendary pair: the pair master, under the split crown (4.6a)",
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
  // TODO 4.6f (wave 2c): the snow frames' split pairs — m15snow's white-bar
  // pair under the gold plate (KHM #224 / #223 / #230 print the gold plate),
  // a hybrid snow cost on the same (no hybrid snow print exists), the snow
  // dual land (KHM #248–274); a LAND on the nonland snow frame stays gold
  // (twoColorFits), and devoid draws no pair at all (owner round 20: every
  // two-colour devoid printing IS the gold frame).
  {
    id: "snow pair (KHM #224 style): the white-bar pair, the gold plate",
    card: { supertype: "Legendary Snow", colorIdentity: colours("blue", "black"), cost: "{3}{U}{B}", frameStyle: on("m15snow") },
    master: "m15snow/ub",
    plate: "/frames/m15snow/pt/m.png",
  },
  {
    id: "snow pair with a hybrid cost: the split (no hybrid snow dress)",
    card: { supertype: "Snow", colorIdentity: colours("green", "white"), cost: "{G/W}{G/W}", frameStyle: on("m15snow") },
    master: "m15snow/gw",
    plate: "/frames/m15snow/pt/m.png",
  },
  {
    id: "snow dual land (KHM #249 Arctic Treeline style)",
    card: {
      cardType: "land",
      supertype: "Snow",
      subtypes: ["Forest", "Plains"],
      colorIdentity: colours("green", "white"),
      cost: null,
      power: null,
      toughness: null,
      frameStyle: on("m15snowland"),
    },
    master: "m15snowland/gw",
    plate: null,
  },
  {
    id: "a snow LAND stored on the nonland snow frame: gold (a land wears the pairs on a land frame only)",
    card: {
      cardType: "land",
      supertype: "Snow",
      subtypes: ["Forest", "Plains"],
      colorIdentity: colours("green", "white"),
      cost: null,
      power: null,
      toughness: null,
      frameStyle: on("m15snow"),
    },
    master: "m15snow/m",
    plate: null,
  },
  {
    id: "devoid pair (OGW #150 style): gold — the printed look, no pair masters",
    card: { colorIdentity: colours("green", "blue"), cost: "{1}{G}{U}", frameStyle: on("m15devoid") },
    master: "m15devoid/m",
    plate: "/frames/m15devoid/pt/m.png",
  },
  // TODO 4.56: the borderless land's split pairs — the grey land bars over
  // a split pinline AND box (MID #281, OTJ #304, the MKM surveil lands). A
  // land prints no P/T; the kind gate keeps every other kind off the frame,
  // and a creature forced onto it paints m15borderless's gold plate (the
  // file exists: never a missing key), as a pair does on m15land.
  {
    id: "borderless pair land (MID #281 style): the pair master, no plate",
    card: {
      cardType: "land",
      supertype: null,
      subtypes: [],
      colorIdentity: colours("white", "blue"),
      cost: null,
      power: null,
      toughness: null,
      frameStyle: on("m15borderlessland"),
    },
    master: "m15borderlessland/wu",
    plate: null,
  },
  {
    id: "borderless pair land stored second colour first with the AI's multicolor token: printed order (B|R)",
    card: {
      cardType: "land",
      supertype: null,
      subtypes: ["Swamp", "Mountain"],
      colorIdentity: colours("red", "black", "multicolor"),
      cost: null,
      power: null,
      toughness: null,
      frameStyle: on("m15borderlessland"),
    },
    master: "m15borderlessland/br",
    plate: null,
  },
  {
    id: "a creature forced onto the borderless land frame with a pair: the pair master (no hybrid land dress), the gold borderless plate",
    card: { colorIdentity: colours("green", "white"), cost: null, frameStyle: on("m15borderlessland") },
    master: "m15borderlessland/gw",
    plate: "/frames/m15borderless/pt/m.png",
  },
  // TODO 4.6h: two colours on the old frames — `modern`'s gold pair under
  // the gold plate (an all-hybrid or a cost-less card too: the frame has no
  // hybrid dress), the two land frames' pairs; a LAND on `modern` stays gold
  // (twoColorFits), and `retro` draws no pair at all (the 1997 frame printed
  // one gold card).
  {
    id: "2003 gold pair (RAV #239 style): the pair master, the gold plate",
    card: { colorIdentity: colours("green", "white"), cost: "{G}{W}", frameStyle: on("modern") },
    master: "modern/gw",
    plate: "/frames/modern/pt/m.png",
  },
  {
    id: "2003 pair with an all-hybrid cost: the split (no hybrid dress on the 2003 frame)",
    card: { colorIdentity: colours("red", "white"), cost: "{R/W}{R/W}", frameStyle: on("modern") },
    master: "modern/rw",
    plate: "/frames/modern/pt/m.png",
  },
  {
    id: "2003 pair stored second colour first with the AI's multicolor token: printed order (U|R)",
    card: { colorIdentity: colours("red", "blue", "multicolor"), cost: "{1}{U}{R}", frameStyle: on("modern") },
    master: "modern/ur",
    plate: "/frames/modern/pt/m.png",
  },
  {
    id: "2003 dual land (RAV #284 style): the land pair, no plate",
    card: {
      cardType: "land",
      supertype: null,
      subtypes: ["Forest", "Plains"],
      colorIdentity: colours("green", "white"),
      cost: null,
      power: null,
      toughness: null,
      frameStyle: on("modernland"),
    },
    master: "modernland/gw",
    plate: null,
  },
  {
    id: "1997 dual land (INV #321 style): the land pair, no plate",
    card: {
      cardType: "land",
      supertype: null,
      subtypes: [],
      colorIdentity: colours("white", "blue"),
      cost: null,
      power: null,
      toughness: null,
      frameStyle: on("retroland"),
    },
    master: "retroland/wu",
    plate: null,
  },
  {
    id: "a LAND stored on the 2003 nonland frame: gold (a land wears the pairs on a land frame only)",
    card: {
      cardType: "land",
      supertype: null,
      subtypes: [],
      colorIdentity: colours("white", "blue"),
      cost: null,
      power: null,
      toughness: null,
      frameStyle: on("modern"),
    },
    master: "modern/m",
    plate: null,
  },
  {
    id: "1997 gold pair (INV #264 style): gold — the printed look, no pair masters",
    card: { colorIdentity: colours("blue", "black"), cost: "{1}{U}{B}", frameStyle: on("retro") },
    master: "retro/m",
    plate: null,
  },
  {
    id: "2003 pair, no key (every stored card): gold",
    card: { colorIdentity: colours("green", "white"), cost: "{G}{W}", frameStyle: { template: "modern" } },
    master: "modern/m",
    plate: "/frames/modern/pt/m.png",
  },
  {
    id: "2003 dual land, switched off: the gold land",
    card: {
      cardType: "land",
      supertype: null,
      subtypes: [],
      colorIdentity: colours("green", "white"),
      cost: null,
      power: null,
      toughness: null,
      frameStyle: { template: "modernland", twoColor: false },
    },
    master: "modernland/m",
    plate: null,
  },
  {
    id: "1997 dual land, no key (every stored card): the stand-in",
    card: {
      cardType: "land",
      supertype: null,
      subtypes: [],
      colorIdentity: colours("white", "blue"),
      cost: null,
      power: null,
      toughness: null,
      frameStyle: { template: "retroland" },
    },
    master: "retroland/m",
    plate: null,
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
    id: "a pair on a frame with no pair masters (m15devoid): gold",
    card: { colorIdentity: colours("white", "blue"), cost: "{2}{W}{U}", frameStyle: on("m15devoid") },
    master: "m15devoid/m",
    plate: "/frames/m15devoid/pt/m.png",
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
  // …and on the borderless land (4.56): a stored pair with no key, the
  // switch off, and a three-colour land keep the gold master — the 6 stored
  // production pairs on the frame on 2026-10-06 among them.
  ...(
    [
      ["a stored borderless land pair with no key: the gold land", { template: "m15borderlessland" }, colours("blue", "black")],
      ["a borderless land pair switched off: the gold land", { template: "m15borderlessland", twoColor: false }, colours("white", "black")],
      ["a three-colour borderless land with the switch on: the gold land", { template: "m15borderlessland", twoColor: true }, colours("white", "blue", "black")],
      ["a plain multicolor borderless land with the switch on and no pair named: the gold land", { template: "m15borderlessland", twoColor: true }, colours("multicolor")],
    ] as const
  ).map(
    ([id, frameStyle, colorIdentity]): PairCase => ({
      id,
      card: { cardType: "land", supertype: null, subtypes: [], colorIdentity, cost: null, power: null, toughness: null, frameStyle: frameStyle as FrameStyle },
      master: "m15borderlessland/m",
      plate: null,
    }),
  ),
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
