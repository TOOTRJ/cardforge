// ---------------------------------------------------------------------------
// Card URL helpers (Phase 11 chunk 11).
//
// The canonical public URL for a card is `/card/[username]/[slug]`. The
// legacy `/card/[slug]` exists only as a redirector (or 404 when the slug
// can't be uniquely resolved). Use these helpers everywhere the app
// builds a public link so a future URL-format change is a one-file edit.
//
// Edit URLs (`/card/[slug]/edit`) are NOT touched — they're owner-scoped
// and don't need disambiguation, since slugs are unique within an owner.
// ---------------------------------------------------------------------------

export type LinkableCard = {
  slug: string;
  owner?: { username?: string | null } | null;
};

/**
 * Canonical public URL for a card. Prefers the username-namespaced path;
 * falls back to the legacy slug-only path when the owner has no username
 * (the legacy route will then 301 to the canonical form OR 404 if it
 * still can't resolve).
 */
export function buildCardPath(card: LinkableCard): string {
  if (card.owner?.username) {
    return `/card/${card.owner.username}/${card.slug}`;
  }
  return `/card/${card.slug}`;
}

/**
 * Canonical absolute URL — used in og:url, sitemap entries, and any
 * server-side context that needs the full URL rather than the relative
 * path. Pass the site base URL as the second arg.
 */
export function buildCardUrl(card: LinkableCard, baseUrl: string): string {
  return `${baseUrl}${buildCardPath(card)}`;
}
