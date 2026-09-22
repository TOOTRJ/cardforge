// ---------------------------------------------------------------------------
// My Cards (/dashboard/cards) — view, sort and filter vocabulary.
//
// Pure + dependency-free so the server page (reads the cookie / search
// params), the client browser (writes them) and the unit tests share one
// source. Every parser falls back to the default on anything unrecognised —
// the cookie and the URL are both user-editable.
// ---------------------------------------------------------------------------

/** How the grid is drawn. Remembered per browser (see MY_CARDS_VIEW_COOKIE). */
const MY_CARDS_VIEWS = ["grid", "compact", "list"] as const;
export type MyCardsView = (typeof MY_CARDS_VIEWS)[number];
const DEFAULT_MY_CARDS_VIEW: MyCardsView = "grid";

/** Cookie (not localStorage) so the server renders the chosen view on the
 *  first paint — no flash of the default grid before hydration. */
export const MY_CARDS_VIEW_COOKIE = "pg_my_cards_view";
export const MY_CARDS_VIEW_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const MY_CARDS_SORTS = [
  "updated",
  "newest",
  "oldest",
  "title",
  "title-desc",
  "liked",
] as const;
export type MyCardsSort = (typeof MY_CARDS_SORTS)[number];
export const DEFAULT_MY_CARDS_SORT: MyCardsSort = "updated";

export const MY_CARDS_SORT_LABELS: Record<MyCardsSort, string> = {
  updated: "Recently edited",
  newest: "Newest created",
  oldest: "Oldest created",
  title: "Title A–Z",
  "title-desc": "Title Z–A",
  liked: "Most liked",
};

/** Which slice of the library is showing. `liked` is the one tab of cards
 *  the user does NOT own. */
const MY_CARDS_FILTERS = [
  "all",
  "public",
  "unlisted",
  "drafts",
  "remixes",
  "liked",
] as const;
export type MyCardsFilter = (typeof MY_CARDS_FILTERS)[number];
export const DEFAULT_MY_CARDS_FILTER: MyCardsFilter = "all";

function parseOneOf<T extends string>(
  allowed: readonly T[],
  fallback: T,
  raw: unknown,
): T {
  return typeof raw === "string" && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : fallback;
}

export const parseMyCardsView = (raw: unknown) =>
  parseOneOf(MY_CARDS_VIEWS, DEFAULT_MY_CARDS_VIEW, raw);
export const parseMyCardsSort = (raw: unknown) =>
  parseOneOf(MY_CARDS_SORTS, DEFAULT_MY_CARDS_SORT, raw);
export const parseMyCardsFilter = (raw: unknown) =>
  parseOneOf(MY_CARDS_FILTERS, DEFAULT_MY_CARDS_FILTER, raw);

type SortableCard = {
  title: string | null;
  created_at: string;
  updated_at: string;
  likes_count?: number | null;
};

/** Returns a NEW sorted array. Ties fall back to most-recently-edited so the
 *  order is stable between renders. */
export function sortMyCards<T extends SortableCard>(
  cards: readonly T[],
  sort: MyCardsSort,
): T[] {
  const byUpdated = (a: T, b: T) => b.updated_at.localeCompare(a.updated_at);
  const byTitle = (a: T, b: T) =>
    (a.title ?? "").localeCompare(b.title ?? "", undefined, {
      sensitivity: "base",
      numeric: true,
    });
  const compare: Record<MyCardsSort, (a: T, b: T) => number> = {
    updated: byUpdated,
    newest: (a, b) => b.created_at.localeCompare(a.created_at),
    oldest: (a, b) => a.created_at.localeCompare(b.created_at),
    title: byTitle,
    "title-desc": (a, b) => byTitle(b, a),
    liked: (a, b) => (b.likes_count ?? 0) - (a.likes_count ?? 0),
  };
  return [...cards].sort((a, b) => compare[sort](a, b) || byUpdated(a, b));
}

type FilterableCard = {
  visibility: "private" | "unlisted" | "public";
  parent_card_id: string | null;
};

/** Owned-card filters only — `liked` is a separate list, not a filter. */
export function filterMyCards<T extends FilterableCard>(
  cards: readonly T[],
  filter: Exclude<MyCardsFilter, "liked">,
): T[] {
  switch (filter) {
    case "public":
      return cards.filter((c) => c.visibility === "public");
    case "unlisted":
      return cards.filter((c) => c.visibility === "unlisted");
    case "drafts":
      return cards.filter((c) => c.visibility === "private");
    case "remixes":
      return cards.filter((c) => c.parent_card_id !== null);
    default:
      return [...cards];
  }
}
