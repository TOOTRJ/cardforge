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
  "/(marketing)/frames",
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
 * after the save instead of 5 min). Only the ISR'd LIST pages; profiles and
 * the dashboard render per request. The static card page is NOT one of them
 * — by route it would expire every card's page on every save — it gets its
 * own path once the bake is done (revalidateCardPaths `cardPageAfterBake`).
 * Best effort: correctness never depends on it (the live preview IS the
 * saved card).
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
  // The frame gallery's examples (TODO NV8): a card made private, hidden or
  // deleted leaves its tile on the next request, not at the end of the
  // page's 5-minute ISR window.
  revalidatePath("/frames");
  revalidateDiscoverySurfaces();
  if (options.afterBake) revalidateBakedTilePages();
}

/**
 * The card page's route as its file is named (TODO CP2a: `force-static` +
 * ISR for a signed-out visitor). `revalidatePath(CARD_PAGE_ROUTE, "page")`
 * expires EVERY card's page — for a change that can't name the pages it
 * touches (a renamed handle, a card whose slug or owner is unknown). A card
 * that can be named is revalidated by its own path (revalidateCardPages).
 */
export const CARD_PAGE_ROUTE = "/(marketing)/card/[username]/[slug]";

/** A card whose static page a change must refresh: its id, and its slug and
 *  owner's handle where known. */
export type CardPageRef = { id: string; slug?: string | null; ownerUsername?: string | null };

/** Expire every card's static page (a renamed handle: its cards' pages under
 *  the old one must 404 now, not at the end of their ISR window). */
export function revalidateEveryCardPage() {
  revalidatePath(CARD_PAGE_ROUTE, "page");
}

/**
 * Refresh the static page of each card — its canonical path and the legacy
 * slug-only redirector. A card whose page can't be named (no slug, or no
 * owner handle — a sweep that holds ids alone) expires every card page once
 * instead: never a public page left up after its card went out of view.
 */
export function revalidateCardPages(cards: readonly CardPageRef[]) {
  let unnamed = false;
  for (const card of cards) {
    if (card.slug) revalidatePath(`/card/${card.slug}`);
    if (card.slug && card.ownerUsername) revalidatePath(`/card/${card.ownerUsername}/${card.slug}`);
    else unnamed = true;
  }
  if (unnamed) revalidateEveryCardPage();
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
    /** A save that bakes after the response: leave the static card page to
     *  the call after the bake (`afterBake`). Next drops, in an after()
     *  callback, a path the request already revalidated — so a page
     *  revalidated now would be rebuilt with the live preview during the bake
     *  and keep it for its whole ISR window. Left alone, a signed-out visitor
     *  sees the card as it was for the seconds the bake takes, then the baked
     *  card. The caller's after() must call again in every outcome. */
    cardPageAfterBake?: boolean;
  } = {},
) {
  revalidateCardListSurfaces({ afterBake: options.afterBake });
  // Legacy slug-only path still serves as the redirector — busting its
  // cache keeps stale redirects from sticking after a slug edit.
  revalidatePath(`/card/${slug}`);
  if (ownerUsername) {
    revalidatePath(`/profile/${ownerUsername}`);
    // Canonical public detail URL (Phase 11 chunk 11).
    if (!options.cardPageAfterBake) revalidatePath(`/card/${ownerUsername}/${slug}`);
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

/** Bulk form of purgeHiddenCard for the multi-select actions, account
 *  deletion and the storage sweep — each card's static page included
 *  (revalidateCardPages: by its path where the ref names it). */
export async function purgeHiddenCards(cards: readonly CardPageRef[]): Promise<void> {
  revalidateCardListSurfaces();
  revalidateCardPages(cards);
  const ids = cards.map((card) => card.id);
  for (const id of ids) revalidatePath(`/api/cards/${id}/og`);
  await purgeCardCdnCache(ids);
}
