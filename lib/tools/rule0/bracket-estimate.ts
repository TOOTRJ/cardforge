// ---------------------------------------------------------------------------
// The Rule 0 table sheet's LIGHT bracket estimate — from the one thing the
// official brackets count that PipGlyph can judge reliably: how many cards
// of the Game Changers list (lib/tools/rule0/game-changers.ts) the deck
// plays. Wizards' bracket rules (BRACKET_RULES_SOURCE): Brackets 1 and 2
// allow none, Bracket 3 up to three, Brackets 4 and 5 any number.
//
// What the estimate does NOT judge, and says so (NOT_JUDGED): tutors, extra
// turns, mass land denial and two-card combos. A real card's rules text is
// not stored with a deck (deck_cards keeps name, type, cost and colours),
// Wizards publishes no official list of those cards, and a custom card can
// say anything — the table talks them through.
//
// So the estimate is a FLOOR ("at least Bracket 3"), never a bracket: zero
// Game Changers fits every bracket. Pure, client-safe.
// ---------------------------------------------------------------------------

export const BRACKET_RULES_SOURCE = {
  title: "Introducing Commander Brackets Beta",
  url: "https://magic.wizards.com/en/news/announcements/introducing-commander-brackets-beta",
  read: "2026-11-08",
} as const;

/** The most Game Changers each bracket allows (null = no limit). */
export const GAME_CHANGER_LIMITS: Readonly<Record<1 | 2 | 3 | 4 | 5, number | null>> = {
  1: 0,
  2: 0,
  3: 3,
  4: null,
  5: null,
};

export type BracketLevel = 1 | 2 | 3 | 4 | 5;

/** The lowest bracket whose Game Changer limit the count fits. */
export function bracketFloorFor(gameChangers: number): BracketLevel {
  for (const level of [1, 2, 3, 4, 5] as const) {
    const limit = GAME_CHANGER_LIMITS[level];
    if (limit === null || gameChangers <= limit) return level;
  }
  return 5;
}

export type BracketEstimate = {
  gameChangers: number;
  floor: BracketLevel;
  /** "No Game Changers", "1 Game Changer", "4 Game Changers". */
  countLabel: string;
  /** What the count says, in a line: "Fits any bracket", "Bracket 3 or higher". */
  verdict: string;
  /** Why, in a line. */
  reason: string;
  /** How the owner's bracket compares: null when the deck names none. */
  fit: "fits" | "below" | null;
};

export function estimateBracket(gameChangers: number, chosen: number | null | undefined): BracketEstimate {
  const floor = bracketFloorFor(gameChangers);
  const countLabel =
    gameChangers === 0 ? "No Game Changers" : `${gameChangers} Game Changer${gameChangers === 1 ? "" : "s"}`;
  const verdict = floor === 1 ? "Fits any bracket" : `Bracket ${floor} or higher`;
  const reason =
    floor === 1
      ? "Brackets 1 and 2 allow no Game Changers; this deck plays none."
      : floor === 3
        ? "Brackets 1 and 2 allow no Game Changers; Bracket 3 allows up to three."
        : "Bracket 3 allows up to three Game Changers; Brackets 4 and 5 have no limit.";
  const level = chosen && chosen >= 1 && chosen <= 5 ? chosen : null;
  return {
    gameChangers,
    floor,
    countLabel,
    verdict,
    reason,
    fit: level === null ? null : level >= floor ? "fits" : "below",
  };
}

/** What the estimate leaves to the table, and why — printed on the sheet. */
export const NOT_JUDGED =
  "Not counted here: tutors, extra turns, mass land denial and two-card combos. A deck doesn't store its real cards' rules text, there's no official list of those cards, and a custom card can say anything — talk them through.";
