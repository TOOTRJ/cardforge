// ---------------------------------------------------------------------------
// Query params that make /gallery and /decks viewer-requests dynamic.
//
// The bare routes are prerendered (ISR) and never read searchParams; when a
// request carries one of THESE params, proxy.ts rewrites it to the hidden
// dynamic sibling (/gallery/browse, /decks/browse) that does the per-request
// render. The list is deliberately explicit so junk params (utm_*, fbclid,
// …) keep hitting the CDN-cached static page instead of forcing a render.
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
