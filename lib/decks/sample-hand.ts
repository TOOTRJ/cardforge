import { OPENING_HAND } from "@/lib/decks/draw-odds";

// ---------------------------------------------------------------------------
// The sample opening hand (TODO DK7.2) — a shuffled library, seven cards,
// then "draw a card" off the top. No mulligan (owner 2026-10-30, TODO DK11
// (f)): a hand the reader doesn't like is a new hand.
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
  /** Cards drawn after the opening seven. */
  drawn: number;
};

/** A fresh seven from the whole deck. */
export function openingHand(deck: readonly string[], random: Random): HandState {
  const order = shuffle(deck, random);
  return { hand: order.slice(0, OPENING_HAND), library: order.slice(OPENING_HAND), drawn: 0 };
}

/** Draw the library's top card (none once the library is empty). */
export function drawCard(state: HandState): HandState {
  if (state.library.length === 0) return state;
  return { ...state, hand: [...state.hand, state.library[0]], library: state.library.slice(1), drawn: state.drawn + 1 };
}

/** A seed for a new random source, from the browser's crypto when there is
 *  one. */
export function freshSeed(): number {
  const cryptoApi = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoApi?.getRandomValues) return cryptoApi.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * 4294967296);
}
