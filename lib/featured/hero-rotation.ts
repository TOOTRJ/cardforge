// The home page hero's daily pair (TODO HM4, migration 0169). Pure: the
// server reads home_hero_pool() — the pool's cards that pass the original-card
// guard, oldest-added first, then the fallback slots' — and this picks what
// every visitor sees today. The home page is ISR (revalidate 300), so the
// pair turns over within five minutes of UTC midnight with no cron.

const DAY_MS = 86_400_000;

/** The UTC day number: whole days since 1970-01-01 UTC. */
export function utcDayNumber(now: Date): number {
  return Math.floor(now.getTime() / DAY_MS);
}

export type HeroPoolRow = { source: "pool" | "fallback" };

/**
 * The day's hero cards, at most two:
 *  - two or more pool cards → positions (2d, 2d+1) mod N of the pool, in its
 *    order, for the UTC day number d: the same pair all day, a new pair at
 *    midnight, and every pool card on the hero equally often (N odd included:
 *    the two positions never meet once N > 2);
 *  - fewer → the pool's card (if any), then the fallback slots' in slot
 *    order, the same card never twice.
 */
export function dailyHeroPair<T extends HeroPoolRow & { id: string }>(
  rows: readonly T[],
  now: Date,
): T[] {
  const pool = rows.filter((r) => r.source === "pool");
  if (pool.length >= 2) {
    const n = pool.length;
    const start = (2 * utcDayNumber(now)) % n;
    return [pool[start], pool[(start + 1) % n]];
  }
  const out: T[] = [...pool];
  for (const r of rows) {
    if (out.length >= 2) break;
    if (r.source === "fallback" && !out.some((o) => o.id === r.id)) out.push(r);
  }
  return out;
}

/** What /admin/featured prints for a pool card the guard keeps off the hero
 *  (home_hero_refusal's codes). */
export const HERO_REFUSAL_LABELS: Record<string, string> = {
  missing: "That card no longer exists.",
  not_public: "Not public — only public cards can be on the hero.",
  no_render: "No render yet — its owner opens and saves it to bake one.",
  from_real_card: "Made from a real card (an import or a remix of a printing).",
  remix: "A remix — feature the card it was remixed from instead.",
  not_creator: "Its owner isn't a creator the site features (an admin, or no public card).",
};

export function heroRefusalLabel(code: string): string {
  return HERO_REFUSAL_LABELS[code] ?? "It can't be on the hero.";
}
