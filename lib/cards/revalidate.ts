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
function revalidateDiscoverySurfaces() {
  revalidatePath("/");
  revalidatePath("/challenges");
  // Purges every /challenges/[slug] page — a published card may be an
  // entry in whichever challenge matches its tags; resolving which one
  // isn't worth a lookup when the purge is this cheap.
  revalidatePath("/challenges/[slug]", "page");
}

/**
 * The ISR'd list pages a card's TILE is drawn on, as their route files are
 * named — `revalidatePath(route, "page")` takes the file-system route, with
 * its route group (tests/unit/cards/revalidate-after-bake.test.ts holds each
 * to its `page.tsx`).
 */
export const BAKED_TILE_PAGE_ROUTES = [
  "/(marketing)",
  "/(marketing)/gallery",
  "/(marketing)/challenges",
  "/(marketing)/challenges/[slug]",
] as const;

/**
 * What a deferred bake adds to its revalidation once the render is
 * persisted — from inside the action's `after()` callback (`afterBake`).
 * The plain paths again do NOTHING there: Next runs an after() callback's
 * revalidations only for tags the request has not already revalidated
 * (next/dist/server/revalidation-utils.js withExecuteRevalidates →
 * diffRevalidationState), and the action has just revalidated those very
 * paths. The PAGE form of the same routes is another tag (`<route>/page`,
 * one of the page's own implicit tags), so it is not dropped: the list pages
 * built while the bake ran — drawing the live preview
 * (lib/cards/bake-core.ts REBAKE_PENDING_RENDER) — are rebuilt with the
 * thumb as soon as it exists, not at the end of their ISR window (measured
 * on a production build, 2026-10-09: /gallery showed the new thumb 4.9 s
 * after the save instead of 5 min). Only the ISR'd pages need it; the card
 * page, profiles and the dashboard render per request. Best effort:
 * correctness never depends on it (the live preview IS the saved card).
 */
function revalidateBakedTilePages() {
  for (const route of BAKED_TILE_PAGE_ROUTES) revalidatePath(route, "page");
}

/** The list surfaces every card mutation touches (no per-card paths).
 *  `afterBake`: called from an after() callback once a deferred bake has
 *  persisted — see revalidateBakedTilePages. */
export function revalidateCardListSurfaces(options: { afterBake?: boolean } = {}) {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/cards");
  revalidatePath("/gallery");
  revalidateDiscoverySurfaces();
  if (options.afterBake) revalidateBakedTilePages();
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
    /** Called from an after() callback once the deferred bake has persisted:
     *  also rebuild the ISR'd list pages by their PAGE tag (the plain paths
     *  are skipped there — revalidateBakedTilePages). */
    afterBake?: boolean;
  } = {},
) {
  revalidateCardListSurfaces({ afterBake: options.afterBake });
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
