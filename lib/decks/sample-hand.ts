import { OPENING_HAND } from "@/lib/decks/draw-odds";

// ---------------------------------------------------------------------------
// The sample opening hand (TODO DK7.2) — a shuffled library, seven cards and
// the London mulligan (CR 103.5): shuffle the hand back, draw seven again,
// then put one card on the bottom for each mulligan taken. In a multiplayer
// game the first mulligan is free (CR 103.5c) — the deck page passes it for
// a commander format. Then "draw a card" off the top.
//
// Every step is a pure function of a state and a random source, so a test
// replays a hand from a seed (seededRandom: mulberry32, a 32-bit generator
// — plenty for a shuffle). The page seeds it from the browser's crypto.
// A card of the library is a KEY, "<entry id>#<copy>": two copies of one
// entry are two cards.
// ---------------------------------------------------------------------------

export type Random = () => number;

/** mulberry32: a seeded generator in [0, 1). */
export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A new array in a Fisher–Yates order. */
export function shuffle<T>(list: readonly T[], random: Random): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The library's cards: one key per copy of each entry. */
export function libraryKeys(entries: ReadonlyArray<{ id: string; quantity: number }>): string[] {
  return entries.flatMap((entry) => Array.from({ length: Math.max(0, entry.quantity) }, (_, copy) => `${entry.id}#${copy}`));
}

/** The entry a library key stands for. */
export function entryIdOfKey(key: string): string {
  const hash = key.lastIndexOf("#");
  return hash < 0 ? key : key.slice(0, hash);
}

export type HandState = {
  /** The hand, in the order drawn. */
  hand: string[];
  /** The library, top first. */
  library: string[];
  /** Mulligans taken. */
  mulligans: number;
  /** Cards still to put on the bottom before the hand is kept. */
  toBottom: number;
  /** Cards drawn after the hand was kept. */
  drawn: number;
};

/** A fresh seven from the whole deck. */
export function openingHand(deck: readonly string[], random: Random): HandState {
  const order = shuffle(deck, random);
  return { hand: order.slice(0, OPENING_HAND), library: order.slice(OPENING_HAND), mulligans: 0, toBottom: 0, drawn: 0 };
}

/** How many cards a hand after `mulligans` mulligans puts on the bottom. */
export function bottomCountFor(mulligans: number, freeFirst: boolean): number {
  return Math.min(OPENING_HAND, Math.max(0, mulligans - (freeFirst ? 1 : 0)));
}

/** Whether one more mulligan leaves a card to keep. */
export function canMulligan(state: HandState, deckSize: number, freeFirst: boolean): boolean {
  return deckSize > 0 && bottomCountFor(state.mulligans + 1, freeFirst) < Math.min(OPENING_HAND, deckSize);
}

/** A London mulligan: the whole deck shuffled again, seven drawn, and the
 *  bottom count owed for every mulligan so far. */
export function mulligan(state: HandState, deck: readonly string[], random: Random, freeFirst: boolean): HandState {
  const mulligans = state.mulligans + 1;
  const order = shuffle(deck, random);
  const hand = order.slice(0, OPENING_HAND);
  return {
    hand,
    library: order.slice(OPENING_HAND),
    mulligans,
    toBottom: Math.min(bottomCountFor(mulligans, freeFirst), hand.length),
    drawn: 0,
  };
}

/** Keep the hand: the chosen cards go to the bottom, in the order given.
 *  Refused (the state unchanged) unless exactly the owed number of cards of
 *  the hand is chosen. */
export function keepHand(state: HandState, bottom: readonly string[]): HandState {
  const chosen = [...new Set(bottom)];
  if (chosen.length !== state.toBottom || !chosen.every((key) => state.hand.includes(key))) return state;
  return {
    ...state,
    hand: state.hand.filter((key) => !chosen.includes(key)),
    library: [...state.library, ...chosen],
    toBottom: 0,
  };
}

/** Draw the library's top card (none while the hand isn't kept, or the
 *  library is empty). */
export function drawCard(state: HandState): HandState {
  if (state.toBottom > 0 || state.library.length === 0) return state;
  return { ...state, hand: [...state.hand, state.library[0]], library: state.library.slice(1), drawn: state.drawn + 1 };
}

/** A seed for a new random source, from the browser's crypto when there is
 *  one. */
export function freshSeed(): number {
  const cryptoApi = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoApi?.getRandomValues) return cryptoApi.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * 4294967296);
}
