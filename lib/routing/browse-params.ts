// ---------------------------------------------------------------------------
// Query params that belong to the browse pages.
//
// /gallery and /decks are prerendered (ISR) landings that never read
// searchParams. Searching, filtering, sorting and paging happen on their
// visible dynamic siblings (/gallery/browse, /decks/browse), and every in-app
// control navigates WITHIN those routes. When a landing request still
// carries one of THESE params (an old link), proxy.ts 308s it to the sibling
// with the query intact. The list is deliberately explicit so junk params
// (utm_*, fbclid, …) keep hitting the CDN-cached static page.
//
// Why a redirect and not a rewrite: Next's client router reuses the cached
// static route tree for a same-path query-string change and never calls the
// server, so a hidden rewrite is invisible to soft navigations — the URL
// changed and the grid didn't (2026-09-22).
//
// Keep in sync with the params parsed in
// app/(marketing)/gallery/gallery-view.tsx and
// app/(marketing)/decks/decks-view.tsx.
//
// Imported by proxy.ts — must stay dependency-free (edge runtime).
// ---------------------------------------------------------------------------

export const GALLERY_FILTER_PARAMS = [
  "type",
  "rarity",
  "color",
  "q",
  "sort",
  "source",
  "tag",
  "remixes",
  "page",
  "seed",
] as const;

export const DECKS_FILTER_PARAMS = ["q", "format", "sort", "page"] as const;

export function hasAnyParam(
  searchParams: URLSearchParams,
  names: readonly string[],
): boolean {
  return names.some((name) => searchParams.has(name));
}

/** Same test on a page's awaited `searchParams` record — a browse page with
 *  any of its own params present is a filtered/paged variant (noindex). */
export function hasAnyParamKey(
  params: Record<string, string | string[] | undefined>,
  names: readonly string[],
): boolean {
  return names.some((name) => params[name] !== undefined);
}
