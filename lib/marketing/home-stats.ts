// ---------------------------------------------------------------------------
// The home page's numbers (owner 2026-11-03: ALL TIME, not this week). The
// pure half — what the stat strip and the "Live from the forge" line say
// for a set of counts; the reads are the page's (cookie-free, so it stays
// ISR). The CARDS are every card saved on the site, whatever its visibility
// (owner 2026-11-11: "cards forged" is what people made, not what they
// published); creators and decks are the PUBLIC ones — what a visitor can
// go and see on /creators and /decks.
// ---------------------------------------------------------------------------

export type HomeCounts = {
  /** Every saved card, all time (`getSavedCardCounts`, migration 0207). */
  cards: number;
  /** Real creators with a public card (`countPublicCreators`: /creators' total). */
  creators: number;
  /** Public, non-empty decks (`countPublicDecks`: what /decks lists). */
  decks: number;
  /** Frame templates the creator offers today (the verified set). */
  frameStyles: number;
  /** Saved cards made in the last 7 days — the pulse line's small print. */
  cardsThisWeek: number;
};

export type HomeStatBadge = { value: string; label: string };

/** The decks badge waits for real inventory — "3 decks" undersells more
 *  than it informs. */
export const DECKS_BADGE_MIN = 5;

/** Short form for a badge: 1,308 → "1.3K+", 25,000 → "25K+". Rounded DOWN,
 *  so the "+" is always true (1,950 is "1.9K+", never "2K+"). Below 1,000
 *  the plain number reads more honest than a padded "+". */
export function formatStatCount(n: number): string {
  const value = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
  if (value < 1000) return `${value}`;
  const [unit, size] = value >= 1_000_000 ? ["M", 1_000_000] : ["K", 1000];
  const short = Math.floor((value / size) * 10) / 10;
  return `${short.toFixed(1).replace(/\.0$/, "")}${unit}+`;
}

/** Long form for running text: 1308 → "1,308". */
export function formatStatNumber(n: number): string {
  return Math.max(0, Math.floor(Number.isFinite(n) ? n : 0)).toLocaleString("en-US");
}

/** The stat strip: up to four REAL numbers, best first — cards, creators,
 *  decks (once there are enough), frame styles. "Free / Every frame" only
 *  fills a slot when the counts can't (a database the reads failed on). */
export function homeStatBadges(counts: HomeCounts): HomeStatBadge[] {
  const badges: HomeStatBadge[] = [];
  if (counts.cards > 0) badges.push({ value: formatStatCount(counts.cards), label: "Cards forged" });
  if (counts.creators > 0) {
    badges.push({ value: formatStatCount(counts.creators), label: counts.creators === 1 ? "Creator" : "Creators" });
  }
  if (counts.decks >= DECKS_BADGE_MIN) badges.push({ value: formatStatCount(counts.decks), label: "Decks built" });
  if (counts.frameStyles > 0) badges.push({ value: formatStatCount(counts.frameStyles), label: "Frame styles" });
  if (badges.length < 4) badges.push({ value: "Free", label: "Every frame" });
  return badges.slice(0, 4);
}
