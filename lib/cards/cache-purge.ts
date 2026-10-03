import "server-only";

// ---------------------------------------------------------------------------
// CDN purge for a card's image responses.
//
// Two routes answer with a card's picture from Vercel's CDN, each tagged
// `Vercel-Cache-Tag: card-<id>`:
//   * /api/cards/[id]/og — the share image (s-maxage up to a day on the
//     versioned URL);
//   * /render-cdn/<owner>/<id>.png|.thumb.webp|.back.png|.back.thumb.webp —
//     the stored bake of either face behind a one-year immutable header
//     (app/render-cdn/[...path]/route.ts); one tag covers both faces.
// `revalidatePath()` does NOT touch that layer — it only purges Next's
// page/data cache — so for months a card flipped to private (or hidden by an
// admin) kept serving its image to every social scraper and to anyone
// holding the old URL until the CDN entry aged out.
//
// Any privatising/deleting/hiding action calls purgeCardCdnCache() (through
// purgeHiddenCard(s) in lib/cards/revalidate.ts, or directly), AFTER the
// render objects are removed — a purge before the remove could be refilled
// from the still-present object. Vercel only: off-platform (local, CI) the
// import is skipped and this is a no-op. "Dangerously" is Vercel's word for
// "purge now instead of revalidating in the background" — exactly what a
// hidden card needs (an invalidate, or Next 16's `revalidateTag(tag, "max")`,
// would serve the stale image once more while it refetched). Best-effort: a
// purge failure is logged, never thrown, because the DB write it follows
// already succeeded.
//
// Vercel's REST API takes at most 16 tags per call (docs "Purging Vercel CDN
// Cache" → Limits); the runtime API is called the same way, in chunks, so a
// bulk action or an account deletion never sends one oversized request.
// ---------------------------------------------------------------------------

export const PURGE_TAGS_PER_CALL = 16;

export function cardCacheTag(cardId: string): string {
  return `card-${cardId}`;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function purgeCardCdnCache(cardIds: readonly string[]): Promise<void> {
  const tags = [...new Set(cardIds)].map(cardCacheTag);
  if (tags.length === 0) return;
  if (!process.env.VERCEL) return;
  try {
    const { dangerouslyDeleteByTag } = await import("@vercel/functions");
    for (const part of chunks(tags, PURGE_TAGS_PER_CALL)) await dangerouslyDeleteByTag(part);
  } catch (error) {
    console.error(
      `[cache-purge] could not purge CDN cache for ${tags.length} card(s):`,
      error,
    );
  }
}

/**
 * Drop Vercel's Image Optimization variants (`/_next/image?url=…`) of these
 * source pictures — kept up to 31 days and across deployments
 * (next.config.ts minimumCacheTTL). Each variant carries its source URL as a
 * system cache tag. For a picture that must stop being shown (a flagged
 * upload removed by scripts/sweep-storage-orphans.mjs --rescan-review).
 * Vercel only, best-effort, like purgeCardCdnCache.
 */
export async function purgeImageSources(sources: readonly string[]): Promise<void> {
  const srcs = [...new Set(sources.filter((s) => typeof s === "string" && s.length > 0))];
  if (srcs.length === 0) return;
  if (!process.env.VERCEL) return;
  try {
    const { dangerouslyDeleteBySrcImage } = await import("@vercel/functions");
    for (const part of chunks(srcs, PURGE_TAGS_PER_CALL)) await dangerouslyDeleteBySrcImage(part);
  } catch (error) {
    console.error(`[cache-purge] could not purge ${srcs.length} optimized image source(s):`, error);
  }
}
