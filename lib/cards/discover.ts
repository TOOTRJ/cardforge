// ---------------------------------------------------------------------------
// "Discover" — the gallery's default order: weighted random over every
// public card, so the grid changes visit to visit while the cards people
// view, like, share and remix the most come up more often.
//
// The ranking itself runs in SQL (migration 0086, list_gallery_cards):
//   weight = 1 + 2·ln(1 + 0.05·views + 1·likes + 1.5·shares + 2·remixes)
//   key    = −ln(u) / weight,  u = uniform(0,1) hashed from card id + seed
//   order by key ascending (Efraimidis–Spirakis weighted sampling)
// Every card has weight ≥ 1, so nothing is unreachable; the log keeps a
// viral card from monopolising page one. `discoverWeight` mirrors the SQL so
// the weighting is unit-tested and documented in one place.
//
// The seed is what makes pagination coherent: page 1 (ISR-cached) links to
// page 2 with its own seed, so both pages are slices of ONE shuffle. A new
// visit without a seed gets the current time bucket — the grid reshuffles
// every DISCOVER_SEED_MINUTES, in step with the page's ISR revalidation.
// ---------------------------------------------------------------------------

const DISCOVER_WEIGHTS = {
  view: 0.05,
  like: 1,
  share: 1.5,
  remix: 2,
} as const;

export const DISCOVER_SEED_MINUTES = 5;

export type DiscoverSignals = {
  views: number;
  likes: number;
  shares: number;
  remixes: number;
};

export function discoverWeight(s: DiscoverSignals): number {
  const engagement =
    DISCOVER_WEIGHTS.view * s.views +
    DISCOVER_WEIGHTS.like * s.likes +
    DISCOVER_WEIGHTS.share * s.shares +
    DISCOVER_WEIGHTS.remix * s.remixes;
  return 1 + 2 * Math.log(1 + Math.max(0, engagement));
}

/** The seed a visit without one gets: the current time bucket. */
export function discoverSeedNow(now: number = Date.now()): string {
  return String(Math.floor(now / (DISCOVER_SEED_MINUTES * 60_000)));
}

/** Seeds come from the URL; keep them short and harmless. */
export function normalizeDiscoverSeed(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().slice(0, 24);
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
}
