import { faceText } from "./card-words";
import { fullNameOf, hasSharedPictures, type PlayBoard, type PlayCustomCard, type PlayExport, type PlayLine } from "./model";

// ---------------------------------------------------------------------------
// Tabletop Simulator — a saved object (`{ "ObjectStates": [...] }`, the
// save-file format of the official knowledge base) the player drops in
// `Tabletop Simulator/Saves/Saved Objects` and spawns from Objects → Saved
// Objects. One deck per board, side by side (the commander face up), each
// card its own one-image CustomDeck entry (NumWidth / NumHeight 1, CardID =
// key × 100) — the shape the community converters write — with that entry
// copied onto the card too, so a card taken out of its deck keeps its face.
// A double-faced card is a card with a second STATE: its back face, as the
// converters do (the player flips it with the state keys).
//
// TTS has no card database: every face is a picture each player's game
// downloads by URL. A custom card's is its stored display bake (the HD PNG)
// and a real card's the printing's Scryfall picture; the back of every card
// is PipGlyph's own (public/tools/play-exports/card-back.png). A custom card
// with no shared picture (a private card) can't be drawn — it is LEFT OUT and
// counted (`leftOut`), never pointed at a picture that isn't public.
// Pure.
// ---------------------------------------------------------------------------

type Transform = {
  posX: number;
  posY: number;
  posZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
};

type CustomDeckEntry = {
  FaceURL: string;
  BackURL: string;
  NumWidth: 1;
  NumHeight: 1;
  BackIsHidden: true;
  UniqueBack: false;
  Type: 0;
};

type CardObject = {
  Name: "Card";
  Transform: Transform;
  Nickname: string;
  Description: string;
  CardID: number;
  CustomDeck: Record<string, CustomDeckEntry>;
  States?: Record<string, CardObject>;
};

type DeckObject = {
  Name: "DeckCustom";
  Transform: Transform;
  Nickname: string;
  Description: string;
  DeckIDs: number[];
  CustomDeck: Record<string, CustomDeckEntry>;
  ContainedObjects: CardObject[];
};

function transform(posX: number, faceUp: boolean): Transform {
  return { posX, posY: 1, posZ: 0, rotX: 0, rotY: 180, rotZ: faceUp ? 0 : 180, scaleX: 1, scaleY: 1, scaleZ: 1 };
}

/** A printing's picture at Scryfall's "large" size (672 × 936), else
 *  Scryfall's named-card image redirect — TTS follows it. */
export function realCardImage(line: Extract<PlayLine, { kind: "real" }>): string {
  if (line.image) return line.image.replace(/^(https:\/\/cards\.scryfall\.io\/)(small|normal|large)\//, "$1large/");
  return `https://api.scryfall.com/cards/named?format=image&version=large&exact=${encodeURIComponent(line.name)}`;
}

const BOARD_PILES: Array<{ boards: PlayBoard[]; nickname: string; faceUp: boolean }> = [
  { boards: ["commander"], nickname: "Commander", faceUp: true },
  { boards: ["main"], nickname: "Deck", faceUp: false },
  { boards: ["companion", "side"], nickname: "Sideboard", faceUp: false },
];

export type TtsFile = {
  json: string;
  /** Physical cards in the file. */
  cards: number;
  /** Physical cards left out: a custom card with no shared picture. */
  leftOut: number;
  leftOutNames: string[];
};

export function buildTts(exp: PlayExport): TtsFile {
  const byId = new Map(exp.cards.map((card) => [card.id, card]));
  const back = exp.cardBackUrl;
  // One CustomDeck key per distinct picture (copies share it).
  let nextKey = 1;
  const keyByFace = new Map<string, number>();
  const keyOf = (face: string) => {
    let key = keyByFace.get(face);
    if (key == null) {
      key = nextKey;
      nextKey += 1;
      keyByFace.set(face, key);
    }
    return key;
  };
  const entry = (face: string): CustomDeckEntry => ({
    FaceURL: face,
    BackURL: back,
    NumWidth: 1,
    NumHeight: 1,
    BackIsHidden: true,
    UniqueBack: false,
    Type: 0,
  });
  const cardObject = (face: string, nickname: string, description: string, faceUp: boolean): CardObject => {
    const key = keyOf(face);
    return {
      Name: "Card",
      Transform: transform(0, faceUp),
      Nickname: nickname,
      Description: description,
      CardID: key * 100,
      CustomDeck: { [String(key)]: entry(face) },
    };
  };

  let cards = 0;
  let leftOut = 0;
  const leftOutNames = new Set<string>();
  const customObject = (card: PlayCustomCard, faceUp: boolean): CardObject => {
    const front = cardObject(card.front.image!, card.secondPart ? fullNameOf(card) : card.front.name, describe(card), faceUp);
    if (card.back?.image) {
      front.States = { "2": cardObject(card.back.image, card.back.name, describeFace(card.back), faceUp) };
    }
    return front;
  };

  const objects: Array<CardObject | DeckObject> = [];
  let column = 0;
  for (const pile of BOARD_PILES) {
    const pileCards: CardObject[] = [];
    for (const line of exp.lines) {
      if (!pile.boards.includes(line.board)) continue;
      for (let copy = 0; copy < line.quantity; copy += 1) {
        if (line.kind === "real") {
          pileCards.push(cardObject(realCardImage(line), line.name, "", pile.faceUp));
          continue;
        }
        const card = byId.get(line.cardId);
        if (!card) continue;
        if (!hasSharedPictures(card)) {
          leftOut += 1;
          leftOutNames.add(card.front.name);
          continue;
        }
        pileCards.push(customObject(card, pile.faceUp));
      }
    }
    if (pileCards.length === 0) continue;
    cards += pileCards.length;
    const posX = column * 3;
    column += 1;
    if (pileCards.length === 1) {
      // A pile of one is a lone card (TTS's own save does the same).
      objects.push({ ...pileCards[0], Transform: transform(posX, pile.faceUp) });
      continue;
    }
    const customDeck: Record<string, CustomDeckEntry> = {};
    for (const card of pileCards) Object.assign(customDeck, card.CustomDeck);
    objects.push({
      Name: "DeckCustom",
      Transform: transform(posX, pile.faceUp),
      Nickname: exp.source === "deck" ? `${exp.title} — ${pile.nickname}` : exp.title,
      Description: "Exported from PipGlyph",
      DeckIDs: pileCards.map((card) => card.CardID),
      CustomDeck: customDeck,
      ContainedObjects: pileCards,
    });
  }
  return { json: `${JSON.stringify({ ObjectStates: objects }, null, 2)}\n`, cards, leftOut, leftOutNames: [...leftOutNames] };
}

function describeFace(face: PlayCustomCard["front"]): string {
  return faceText(face);
}

function describe(card: PlayCustomCard): string {
  const parts = [faceText(card.front)];
  if (card.secondPart) parts.push(faceText(card.secondPart));
  if (card.pageUrl) parts.push(card.pageUrl);
  return parts.join("\n\n");
}
