import {
  CARD_TYPE_VALUES,
  COLOR_IDENTITY_VALUES,
  type CardType,
  type ColorIdentity,
} from "@/types/card";

// ---------------------------------------------------------------------------
// The profile page's card-section query string (?q= &color= &type= &sort=
// &page=) — ONE parser for the server page (list_profile_cards, migration
// 0153) and the filter bar. Anything it doesn't know reads as unset, so a
// hand-edited URL never reaches the database as a bad value.
// ---------------------------------------------------------------------------

export const PROFILE_CARD_SORTS = ["recent", "newest", "popular", "name"] as const;
export type ProfileCardSortKey = (typeof PROFILE_CARD_SORTS)[number];

export const PROFILE_CARD_SORT_LABELS: Record<ProfileCardSortKey, string> = {
  recent: "Recently updated",
  newest: "Newest",
  popular: "Most liked",
  name: "Name (A–Z)",
};

/** The query-string keys the card section owns. Any of them present = a
 *  filtered / paged variant of the profile (noindex, canonical = the bare
 *  profile). */
export const PROFILE_CARD_PARAMS = ["q", "color", "type", "sort", "page"] as const;

/** Cards per page: 4 full rows of the 6-column grid, 6 of the 4-column one. */
export const PROFILE_CARDS_PAGE_SIZE = 24;

export type ProfileCardParams = {
  q: string;
  color: ColorIdentity | null;
  type: CardType | null;
  sort: ProfileCardSortKey;
  page: number;
};

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function parseProfileCardParams(raw: RawParams): ProfileCardParams {
  const color = first(raw.color);
  const type = first(raw.type);
  const sort = first(raw.sort);
  const page = Number.parseInt(first(raw.page), 10);
  return {
    q: first(raw.q).trim().slice(0, 150),
    color: (COLOR_IDENTITY_VALUES as readonly string[]).includes(color) ? (color as ColorIdentity) : null,
    type: (CARD_TYPE_VALUES as readonly string[]).includes(type) ? (type as CardType) : null,
    sort: (PROFILE_CARD_SORTS as readonly string[]).includes(sort) ? (sort as ProfileCardSortKey) : "recent",
    page: Number.isFinite(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

/** True when the card section shows anything but its default first page. */
export function isFilteredProfileView(params: ProfileCardParams): boolean {
  return Boolean(params.q || params.color || params.type || params.sort !== "recent" || params.page > 1);
}

/** The profile URL for `params` with `page`, anchored at the card section. */
export function profileCardsHref(username: string, params: ProfileCardParams, page: number): string {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.color) qs.set("color", params.color);
  if (params.type) qs.set("type", params.type);
  if (params.sort !== "recent") qs.set("sort", params.sort);
  if (page > 1) qs.set("page", String(page));
  const query = qs.toString();
  return `/profile/${encodeURIComponent(username)}${query ? `?${query}` : ""}#cards`;
}
