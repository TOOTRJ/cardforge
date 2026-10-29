import { firstString } from "@/lib/routing/search-params";
import type { ListEntry } from "@/components/seo/json-ld";

// ---------------------------------------------------------------------------
// The /creators directory (TODO NV11) — the pure half: sorts, paging, links,
// the row's words and its structured-data entries. The read is
// lib/creators/queries.ts (migration 0148's list_public_creators()).
//
// Who is listed is the DATABASE's rule, held by the migration test: a maker
// with at least one PUBLIC card (the rule the sitemap lists profiles by),
// never an admin account (0091, as the trending and newest rows), and the
// numbers count public cards and public decks that hold a card only — never
// a private or unlisted one, whoever is looking.
//
// Two routes, the gallery's split (lib/routing/browse-params.ts): /creators
// is the static landing — the first page in the default order, never reads
// searchParams — and /creators/browse is the dynamic sibling every sort and
// page link navigates within. The landing is the canonical of both.
// ---------------------------------------------------------------------------

export const CREATOR_SORTS = ["cards", "recent", "liked"] as const;
export type CreatorSort = (typeof CREATOR_SORTS)[number];

export const CREATOR_SORT_LABELS: Record<CreatorSort, string> = {
  cards: "Most cards",
  recent: "Newest cards",
  liked: "Most liked",
};

export const CREATORS_PAGE_SIZE = 24;
/** The last page a link may ask for (24,000 creators): a bigger ?page
 *  would overflow the function's integer offset. Past the end is an empty
 *  page, never an error. */
export const CREATORS_MAX_PAGE = 1000;
export const CREATORS_PATH = "/creators";
export const CREATORS_BROWSE_PATH = "/creators/browse";

export function isCreatorSort(value: unknown): value is CreatorSort {
  return (CREATOR_SORTS as readonly unknown[]).includes(value);
}

export type CreatorsViewParams = { sort: CreatorSort; page: number };

/** A browse request's sort and page; anything else reads as the default,
 *  and a page past CREATORS_MAX_PAGE reads as that page. */
export function parseCreatorsParams(
  params: Record<string, string | string[] | undefined>,
): CreatorsViewParams {
  const sortParam = firstString(params.sort);
  const pageRaw = Number.parseInt(firstString(params.page) ?? "1", 10);
  return {
    sort: isCreatorSort(sortParam) ? sortParam : "cards",
    page: Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.min(pageRaw, CREATORS_MAX_PAGE) : 1,
  };
}

/** The link for a sort and page: the landing for the default view (its
 *  canonical), else the browse route with only the params that differ. */
export function creatorsHref({ sort, page }: CreatorsViewParams): string {
  const parts = [sort !== "cards" ? `sort=${sort}` : "", page > 1 ? `page=${page}` : ""].filter(Boolean);
  return parts.length ? `${CREATORS_BROWSE_PATH}?${parts.join("&")}` : CREATORS_PATH;
}

/** One row of list_public_creators() (migration 0148). */
export type PublicCreatorRow = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  public_cards: number | string;
  public_decks: number | string;
  likes: number | string;
  last_card_at: string | null;
  recent_card_ids: string[] | null;
  total: number | string;
};

/** The row's own numbers and names, before its strip of cards is read. */
export type CreatorSummary = {
  id: string;
  username: string;
  /** The display name, or the handle when there is none. */
  name: string;
  /** Stored avatar URL — drawn only through profileMediaSrc(). */
  avatarUrl: string | null;
  publicCards: number;
  publicDecks: number;
  likes: number;
  lastCardAt: string | null;
  recentCardIds: string[];
};

const count = (value: number | string | null | undefined) => Math.max(0, Number(value) || 0);

/** Pure: database rows → summaries. A row with no handle or no public card
 *  (the database never sends one) is dropped rather than drawn. */
export function mapCreatorRows(rows: readonly PublicCreatorRow[]): { creators: CreatorSummary[]; total: number } {
  const creators = rows
    .filter((row) => Boolean(row.username) && count(row.public_cards) > 0)
    .map((row) => ({
      id: row.id,
      username: row.username,
      name: row.display_name?.trim() || `@${row.username}`,
      avatarUrl: row.avatar_url,
      publicCards: count(row.public_cards),
      publicDecks: count(row.public_decks),
      likes: count(row.likes),
      lastCardAt: row.last_card_at,
      recentCardIds: (row.recent_card_ids ?? []).slice(0, 3),
    }));
  return { creators, total: count(rows[0]?.total) };
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** "14 cards · 2 decks · 7 likes" — the deck part only when there is one. */
export function creatorStats(creator: Pick<CreatorSummary, "publicCards" | "publicDecks" | "likes">): string[] {
  return [
    plural(creator.publicCards, "card", "cards"),
    ...(creator.publicDecks > 0 ? [plural(creator.publicDecks, "deck", "decks")] : []),
    plural(creator.likes, "like", "likes"),
  ];
}

export function profilePath(username: string): string {
  return `/profile/${username}`;
}

/** The structured-data list of a page of creators. */
export function creatorListEntries(creators: readonly Pick<CreatorSummary, "name" | "username">[]): ListEntry[] {
  return creators.map((creator) => ({
    name: creator.name.startsWith("@") ? creator.name : `${creator.name} (@${creator.username})`,
    path: profilePath(creator.username),
  }));
}

/** How many pages `total` creators fill. */
export function creatorPageCount(total: number): number {
  return Math.max(1, Math.ceil(total / CREATORS_PAGE_SIZE));
}
