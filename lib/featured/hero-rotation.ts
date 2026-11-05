// The home page hero's daily pair (TODO HM4, migration 0169). Pure: the
// server reads home_hero_pool() — the pool's cards the hero can draw
// (public, baked), oldest-added first, then the fallback slots' that pass the
// original-card guard — and this picks what every visitor sees today. The
// home page is ISR (revalidate 300), so the pair turns over within five
// minutes of UTC midnight with no cron.

const DAY_MS = 86_400_000;

/** The UTC day number: whole days since 1970-01-01 UTC. */
export function utcDayNumber(now: Date): number {
  return Math.floor(now.getTime() / DAY_MS);
}

export type HeroPoolRow = { source: "pool" | "fallback"; ord: number };

/** home_hero_pool's order, kept by the app rather than trusted to the
 *  transport: the pool (by `ord` = added_at, card_id) before the fallback
 *  slots (by slot). Every server walks the same list. */
export function orderHeroRows<T extends HeroPoolRow>(rows: readonly T[]): T[] {
  const rank = (r: HeroPoolRow) => (r.source === "pool" ? 0 : 1);
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.ord - b.ord);
}

/**
 * The day's hero cards, at most two, never two by the same maker (owner
 * 2026-11-04; `username` is the maker — every row home_hero_pool hands out
 * has one, and a handle is one account's):
 *  - two or more pool cards → position 2d mod N of the pool, in its order,
 *    for the UTC day number d, then the next card after it (2d+1, 2d+2… mod
 *    N) by ANOTHER maker: a new pair at midnight, and while no maker has two
 *    pool cards every pool card is on the hero equally often (N odd
 *    included). A maker's second pool card is skipped while their first is
 *    shown, so a pool where makers repeat is no longer drawn evenly. No other
 *    maker in the pool → the first fallback slot's card by another maker,
 *    else that one card alone. "The same pair all day" holds only while N is
 *    stable: adding or removing a pool card, or a pooled card leaving the
 *    read (it stops being public, or loses its render — an edit clears it
 *    until the re-bake), reshuffles the pair at the page's next regeneration;
 *  - fewer → the pool's card (if any), then the fallback slots' in slot
 *    order, the same card or the same maker never twice.
 */
export function dailyHeroPair<T extends HeroPoolRow & { id: string; username: string }>(
  rows: readonly T[],
  now: Date,
): T[] {
  const ordered = orderHeroRows(rows);
  const pool = ordered.filter((r) => r.source === "pool");
  const out: T[] = [];
  if (pool.length >= 2) {
    const n = pool.length;
    const start = (2 * utcDayNumber(now)) % n;
    out.push(pool[start]);
    for (let step = 1; step < n; step++) {
      const next = pool[(start + step) % n];
      if (next.username !== out[0].username) return [out[0], next];
    }
  } else {
    out.push(...pool);
  }
  for (const r of ordered) {
    if (out.length >= 2) break;
    if (r.source === "fallback" && !out.some((o) => o.id === r.id || o.username === r.username)) {
      out.push(r);
    }
  }
  return out;
}

/** What /admin/featured prints for a card the checks keep off the hero
 *  (home_hero_shown_refusal's and home_hero_refusal's codes), and the two
 *  the APP adds for a card home_hero_pool hands out but the hero can't draw
 *  (readHeroPool on /admin/featured). */
export const HERO_REFUSAL_LABELS: Record<string, string> = {
  missing: "That card no longer exists.",
  render_not_drawable: "Its render can't be drawn (not one of our stored bakes) — its owner opens and saves it to bake again.",
  no_handle: "Its owner has no handle, so the hero can't link to it.",
  not_public: "Not public — only public cards can be on the hero.",
  no_render: "No render yet — its owner opens and saves it to bake one.",
  from_real_card: "Made from a real card (an import or a remix of a printing).",
  remix: "A remix — feature the card it was remixed from instead.",
  not_creator: "Its owner isn't a creator the site features (an admin, or no public card).",
};

export function heroRefusalLabel(code: string): string {
  return HERO_REFUSAL_LABELS[code] ?? "It can't be on the hero.";
}

/** The original-card guard's reasons, as the admin list's note words them
 *  ("Not original: …"). Information only: a pool card shows whatever they say. */
export const NOT_ORIGINAL_LABELS: Record<string, string> = {
  from_real_card: "imported (made from a real card)",
  remix: "a remix",
  not_creator: "its maker isn't a featured creator (an admin, or no public card)",
};

export function notOriginalLabel(code: string): string {
  return NOT_ORIGINAL_LABELS[code] ?? code;
}
