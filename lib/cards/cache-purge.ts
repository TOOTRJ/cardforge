import "server-only";

// ---------------------------------------------------------------------------
// CDN purge for a card's image responses.
//
// /api/cards/[id]/og is cached at Vercel's CDN (s-maxage up to a day on the
// versioned URL). `revalidatePath()` does NOT touch that layer — it only
// purges Next's page/data cache — so for months a card flipped to private (or
// hidden by an admin) kept serving its image to every social scraper and to
// anyone holding the old URL until the CDN entry aged out.
//
// The route now tags every image response with `Vercel-Cache-Tag: card-<id>`
// and any privatising/deleting/hiding action calls purgeCardCdnCache(). Vercel
// only: off-platform (local, CI) the import is skipped and this is a no-op.
// "Dangerously" is Vercel's word for "purge now instead of revalidating in the
// background" — exactly what a hidden card needs. Best-effort: a purge failure
// is logged, never thrown, because the DB write it follows already succeeded.
// ---------------------------------------------------------------------------

export function cardCacheTag(cardId: string): string {
  return `card-${cardId}`;
}

export async function purgeCardCdnCache(cardIds: readonly string[]): Promise<void> {
  if (cardIds.length === 0) return;
  if (!process.env.VERCEL) return;
  try {
    const { dangerouslyDeleteByTag } = await import("@vercel/functions");
    await dangerouslyDeleteByTag(cardIds.map(cardCacheTag));
  } catch (error) {
    console.error(
      `[cache-purge] could not purge CDN cache for ${cardIds.length} card(s):`,
      error,
    );
  }
}
