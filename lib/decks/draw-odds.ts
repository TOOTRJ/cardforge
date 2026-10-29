// ---------------------------------------------------------------------------
// Draw odds (TODO DK7.2) — the chance of seeing cards from a shuffled
// library, by the hypergeometric distribution: drawing `draws` cards without
// replacement from `population` cards of which `successes` are hits, the
// chance of `k` hits is C(K, k) · C(N − K, n − k) / C(N, n). Computed in log
// space (a table of ln n!), so a 250-card library stays exact to ~1e-12.
//
// "By turn T" counts the cards SEEN: the opening seven, plus one draw a turn
// — on the play the first turn has no draw (CR 103.8a, a two-player game),
// on the draw it has — and so has every player's in a multiplayer game (CR
// 103.8c: the deck page asks on the draw for Commander and Oathbreaker,
// formatIsMultiplayer). Mulligans are not modelled (the odds of a kept seven).
// The library is the mainboard (a commander waits in the command zone).
// Pure and client-safe.
// ---------------------------------------------------------------------------

export const OPENING_HAND = 7;

const logFactorials: number[] = [0];

function logFactorial(n: number): number {
  for (let i = logFactorials.length; i <= n; i += 1) logFactorials[i] = logFactorials[i - 1] + Math.log(i);
  return logFactorials[n];
}

function logChoose(n: number, k: number): number {
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

/** The chance of EXACTLY `k` hits. 0 for an impossible count. */
export function hypergeometricExactly(population: number, successes: number, draws: number, k: number): number {
  const N = Math.max(0, Math.floor(population));
  const K = Math.min(Math.max(0, Math.floor(successes)), N);
  const n = Math.min(Math.max(0, Math.floor(draws)), N);
  if (k < 0 || k > K || k > n || n - k > N - K) return 0;
  return Math.exp(logChoose(K, k) + logChoose(N - K, n - k) - logChoose(N, n));
}

/** The chance of AT LEAST `atLeast` hits (1 for "at least 0"). Clamped to
 *  [0, 1] against rounding. */
export function hypergeometricAtLeast(population: number, successes: number, draws: number, atLeast: number): number {
  if (atLeast <= 0) return 1;
  let below = 0;
  for (let k = 0; k < atLeast; k += 1) below += hypergeometricExactly(population, successes, draws, k);
  return Math.min(1, Math.max(0, 1 - below));
}

/** Cards seen by turn `turn` (1 = the first turn): the opening seven plus a
 *  draw each turn, the first skipped on the play. Never past the library. */
export function cardsSeenByTurn(turn: number, onThePlay: boolean, librarySize = Number.POSITIVE_INFINITY): number {
  const seen = OPENING_HAND + Math.max(0, turn) - (onThePlay ? 1 : 0);
  return Math.max(0, Math.min(seen, librarySize));
}

export type LandOddsRow = {
  turn: number;
  /** Cards seen by this turn. */
  seen: number;
  /** odds[i] = the chance of at least i + 1 lands. */
  odds: number[];
};

/** The "lands by turn" table: for each turn, the chance of at least 1 … `maxLands`
 *  lands among the cards seen. */
export function landOddsTable(
  librarySize: number,
  lands: number,
  { turns = 7, maxLands = 7, onThePlay }: { turns?: number; maxLands?: number; onThePlay: boolean },
): LandOddsRow[] {
  return Array.from({ length: turns }, (_, index) => {
    const turn = index + 1;
    const seen = cardsSeenByTurn(turn, onThePlay, librarySize);
    return {
      turn,
      seen,
      odds: Array.from({ length: maxLands }, (_, n) => hypergeometricAtLeast(librarySize, lands, seen, n + 1)),
    };
  });
}

/** The chance of drawing at least one of `copies` copies by each turn. */
export function cardOddsByTurn(
  librarySize: number,
  copies: number,
  { turns = 7, onThePlay }: { turns?: number; onThePlay: boolean },
): Array<{ turn: number; seen: number; odds: number }> {
  return Array.from({ length: turns }, (_, index) => {
    const turn = index + 1;
    const seen = cardsSeenByTurn(turn, onThePlay, librarySize);
    return { turn, seen, odds: hypergeometricAtLeast(librarySize, copies, seen, 1) };
  });
}

/** A chance as the page writes it: whole percents, "<1%" and ">99%" at the
 *  ends so a near-certainty never reads as a certainty. */
export function formatOdds(odds: number): string {
  if (odds <= 0) return "0%";
  if (odds >= 1) return "100%";
  const percent = odds * 100;
  if (percent < 1) return "<1%";
  if (percent > 99) return ">99%";
  return `${Math.round(percent)}%`;
}
