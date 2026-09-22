// The share-image cache-buster. `updated_at` used to double as it, which
// only worked because every bake bumped updated_at (migration 0100's guard
// didn't exclude the render columns). Since 0108 a render write is not an
// edit, so the version is the newer of the two stamps: an edit OR a rebake
// refreshes /api/cards/[id]/og?v=…, and a stale-cache scraper lands on the
// current image either way. Plain module (no server-only) — the card page's
// metadata, the OG route and oEmbed all share it.
export function renderVersionOf(card: {
  updated_at: string;
  rendered_at?: string | null;
}): number | null {
  const edited = Date.parse(card.updated_at);
  const rendered = card.rendered_at ? Date.parse(card.rendered_at) : Number.NaN;
  const version = Math.max(
    Number.isFinite(edited) ? edited : Number.NEGATIVE_INFINITY,
    Number.isFinite(rendered) ? rendered : Number.NEGATIVE_INFINITY,
  );
  return Number.isFinite(version) ? version : null;
}
