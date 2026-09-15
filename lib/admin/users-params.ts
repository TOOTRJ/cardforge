// URL-state for /admin/users — pure + client-safe so the filter bar, the
// page, and the unit tests agree on one parser.

export const USER_LIST_PAGE_SIZE = 25;

export const USER_TIER_FILTERS = ["", "free", "plus", "pro"] as const;
export const USER_STATUS_FILTERS = [
  "",
  "active",
  "trialing",
  "past_due",
  "canceled",
  "none",
] as const;
export const USER_FLAG_FILTERS = ["", "paid", "comped", "admins", "mismatch"] as const;
export const USER_SORTS = ["newest", "oldest", "active", "cards", "credits"] as const;
/** The list opens on recently active users (owner decision, 2026-09-15). */
export const DEFAULT_USER_SORT: (typeof USER_SORTS)[number] = "active";

export type UserListParams = {
  q: string;
  tier: (typeof USER_TIER_FILTERS)[number];
  status: (typeof USER_STATUS_FILTERS)[number];
  flag: (typeof USER_FLAG_FILTERS)[number];
  sort: (typeof USER_SORTS)[number];
  /** 1-based. */
  page: number;
};

export const FLAG_LABELS: Record<(typeof USER_FLAG_FILTERS)[number], string> = {
  "": "Everyone",
  paid: "Paying",
  comped: "Comped",
  admins: "Admins",
  mismatch: "Tier mismatch",
};

export const SORT_LABELS: Record<(typeof USER_SORTS)[number], string> = {
  newest: "Newest",
  oldest: "Oldest",
  active: "Recently active",
  cards: "Most cards",
  credits: "Most credits",
};

type RawParams = Record<string, string | string[] | undefined>;

function pick<T extends readonly string[]>(
  raw: string | string[] | undefined,
  allowed: T,
  fallback: T[number],
): T[number] {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value != null && (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : fallback;
}

export function parseUserListParams(raw: RawParams): UserListParams {
  const q = (Array.isArray(raw.q) ? raw.q[0] : raw.q ?? "").trim().slice(0, 120);
  const pageRaw = Number(Array.isArray(raw.page) ? raw.page[0] : raw.page);
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? Math.min(pageRaw, 10_000) : 1;
  return {
    q,
    tier: pick(raw.tier, USER_TIER_FILTERS, ""),
    status: pick(raw.status, USER_STATUS_FILTERS, ""),
    flag: pick(raw.flag, USER_FLAG_FILTERS, ""),
    sort: pick(raw.sort, USER_SORTS, DEFAULT_USER_SORT),
    page,
  };
}

/** Build the query string for a variant of the current params; the page
 *  resets to 1 whenever a filter changes (unless `page` is passed). */
export function userListHref(
  params: UserListParams,
  patch: Partial<UserListParams> = {},
  extra: Record<string, string | undefined> = {},
): string {
  const next = { ...params, ...patch };
  const pageResets = Object.keys(patch).some((key) => key !== "page");
  const page = patch.page ?? (pageResets ? 1 : next.page);
  const search = new URLSearchParams();
  if (next.q) search.set("q", next.q);
  if (next.tier) search.set("tier", next.tier);
  if (next.status) search.set("status", next.status);
  if (next.flag) search.set("flag", next.flag);
  if (next.sort !== DEFAULT_USER_SORT) search.set("sort", next.sort);
  if (page > 1) search.set("page", String(page));
  for (const [key, value] of Object.entries(extra)) {
    if (value) search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `/admin/users?${qs}` : "/admin/users";
}

export function totalPages(total: number, pageSize = USER_LIST_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
