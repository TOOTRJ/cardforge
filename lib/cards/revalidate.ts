import "server-only";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { purgeCardCdnCache } from "@/lib/cards/cache-purge";
import { notifyIndexNow } from "@/lib/seo/indexnow";

// ---------------------------------------------------------------------------
// Cache invalidation for card mutations — shared by the owner's actions
// (lib/cards/actions.ts) and admin moderation (lib/moderation/actions.ts), so
// "hide" and "make private" purge exactly the same surfaces. Plain module, not
// "use server": these are helpers, not endpoints.
// ---------------------------------------------------------------------------

/**
 * Purge the ISR'd discovery pages (home trending/stats, challenges index,
 * every challenge detail). Card mutations are rare relative to reads, so
 * eager purging keeps those pages fresh without shrinking their
 * revalidate windows. Like-toggles deliberately do NOT purge — the ISR
 * window absorbs that churn.
 */
export function revalidateDiscoverySurfaces() {
  revalidatePath("/");
  revalidatePath("/challenges");
  // Purges every /challenges/[slug] page — a published card may be an
  // entry in whichever challenge matches its tags; resolving which one
  // isn't worth a lookup when the purge is this cheap.
  revalidatePath("/challenges/[slug]", "page");
}

/** The list surfaces every card mutation touches (no per-card paths). */
export function revalidateCardListSurfaces() {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/cards");
  revalidatePath("/gallery");
  revalidateDiscoverySurfaces();
}

export function revalidateCardPaths(
  slug: string,
  ownerUsername?: string | null,
  options: {
    /** The card's visibility after the mutation. Private cards are never
     *  announced to search engines; anything else (including a card that just
     *  became private or was deleted — pass nothing) is, so engines recrawl
     *  the URL and see the new page or its 404. */
    visibility?: string | null;
  } = {},
) {
  revalidateCardListSurfaces();
  // Legacy slug-only path still serves as the redirector — busting its
  // cache keeps stale redirects from sticking after a slug edit.
  revalidatePath(`/card/${slug}`);
  if (ownerUsername) {
    revalidatePath(`/profile/${ownerUsername}`);
    // Canonical public detail URL (Phase 11 chunk 11).
    revalidatePath(`/card/${ownerUsername}/${slug}`);
    if (options.visibility !== "private") {
      // Off the request path — IndexNow is best-effort and never delays a save.
      after(() =>
        notifyIndexNow([`/card/${ownerUsername}/${slug}`, `/profile/${ownerUsername}`]),
      );
    }
  }
}

/**
 * A card stopped being publicly visible (made private, deleted, or hidden by
 * an admin): drop every cache that could still show it — the Next caches of
 * its pages AND the CDN copy of its share image.
 */
export async function purgeHiddenCard(
  card: { id: string; slug: string | null },
  ownerUsername: string | null | undefined,
): Promise<void> {
  if (card.slug) revalidateCardPaths(card.slug, ownerUsername);
  else revalidateCardListSurfaces();
  revalidatePath(`/api/cards/${card.id}/og`);
  await purgeCardCdnCache([card.id]);
}

/** Bulk form of purgeHiddenCard for the multi-select actions. */
export async function purgeHiddenCards(cardIds: readonly string[]): Promise<void> {
  revalidateCardListSurfaces();
  for (const id of cardIds) revalidatePath(`/api/cards/${id}/og`);
  await purgeCardCdnCache(cardIds);
}
