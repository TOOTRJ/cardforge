// A closed challenge's winners (TODO NV12, migration 0172) — the pure half,
// safe for client AND server imports. The reads are in
// lib/challenges/queries.ts, the admin's write in lib/challenges/actions.ts.

/** The three places a challenge can name (0172's CHECK: 1–3). */
export const WINNER_PLACES = [1, 2, 3] as const;
export type WinnerPlace = (typeof WINNER_PLACES)[number];

export function isWinnerPlace(value: unknown): value is WinnerPlace {
  return value === 1 || value === 2 || value === 3;
}

const ORDINALS: Record<WinnerPlace, string> = { 1: "1st", 2: "2nd", 3: "3rd" };

/** "1st place" — the words every surface prints for a place. */
export function placeLabel(place: WinnerPlace): string {
  return `${ORDINALS[place]} place`;
}

/** A card's win, as its page names it. */
export type ChallengeWin = {
  place: WinnerPlace;
  challenge: { slug: string; title: string };
};

/** The card page's line and its JSON-LD `award`: "1st place, Tiny Titans
 *  design challenge". */
export function challengeWinAward(win: ChallengeWin): string {
  return `${placeLabel(win.place)}, ${win.challenge.title} design challenge`;
}

/** What the admin is told for each of set_challenge_winners' refusals. */
const WINNER_ERRORS: Record<string, string> = {
  challenge_not_closed:
    "Winners can only be named once the challenge has closed.",
  not_a_challenge_entry:
    "That card is no longer an entry (it must be public and carry the challenge tag).",
  duplicate_winner: "A card can only take one place.",
  challenge_not_found: "That challenge no longer exists.",
  admin_required: "Admin access required.",
  // Two admins saving at once: the deferred keys meet at commit.
  challenge_winners_pkey:
    "Someone else saved these winners just now. Reload the page and try again.",
  challenge_winners_card_once:
    "Someone else saved these winners just now. Reload the page and try again.",
  winner_row_fixed:
    "That winner can only change place. Reload the page and try again.",
};

export function winnerErrorMessage(message: string): string {
  const code = Object.keys(WINNER_ERRORS).find((key) => message.includes(key));
  return code ? WINNER_ERRORS[code] : message;
}
