import "server-only";

import { requireAdminClient } from "@/lib/admin/users-queries";
import { narrowCard } from "@/lib/cards/narrow";
import type { Card } from "@/types/card";

// ---------------------------------------------------------------------------
// A user's UNLISTED cards, for an admin — the profile page's "Unlisted
// cards" section (owner 2026-11-11: a creator reported a broken frame on a
// card saved unlisted, and nobody on the team could find the card to look
// at it). Debugging only.
//
// An unlisted card is link-only: it is on no profile, gallery, hub, search
// or sitemap, and this is the ONE list that names them. So the gate is in
// the reader itself, never only in the page that calls it:
// `requireAdminClient()` answers null for anyone who is not an admin and
// nothing is read. A later import of this into another page or a route
// cannot hand the list out.
//
// PRIVATE cards are not here and must not be added: private is the maker's
// "nobody but me". Unlisted already opens for anyone who holds its link —
// what an admin gains is the link.
// ---------------------------------------------------------------------------

/** One page of the section: 4 rows of the profile's 6-column grid. */
export const ADMIN_UNLISTED_PAGE_SIZE = 24;

/** The query-string key that pages the section (`?unlisted=2`). */
export const ADMIN_UNLISTED_PARAM = "unlisted";

export type AdminUnlistedCards =
  /** Read: this page's cards (newest edit first) and how many there are. */
  | { ok: true; cards: Card[]; total: number; page: number; pageSize: number }
  /** The read failed: the section says so, never "none". */
  | { ok: false };

/** The page number a `?unlisted=` value asks for (1 for anything else). */
export function parseUnlistedPage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^[1-9]\d{0,3}$/.test(value)) return 1;
  return Number(value);
}

/**
 * `ownerId`'s unlisted cards, a page at a time. NULL for a viewer who is
 * not an admin (signed out included) — the caller then renders nothing at
 * all, not even an empty section.
 */
export async function listUnlistedCardsForAdmin(ownerId: string, page: number): Promise<AdminUnlistedCards | null> {
  const admin = await requireAdminClient();
  if (!admin) return null;
  const safePage = Number.isInteger(page) && page >= 1 ? page : 1;
  const offset = (safePage - 1) * ADMIN_UNLISTED_PAGE_SIZE;
  const { data, count, error } = await admin
    .from("cards")
    .select("*", { count: "exact" })
    .eq("owner_id", ownerId)
    .eq("visibility", "unlisted")
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true })
    .range(offset, offset + ADMIN_UNLISTED_PAGE_SIZE - 1);
  if (error) {
    console.error("[admin/unlisted-cards] read failed:", error.message);
    return { ok: false };
  }
  return {
    ok: true,
    cards: (data ?? []).map(narrowCard),
    total: count ?? (data ?? []).length,
    page: safePage,
    pageSize: ADMIN_UNLISTED_PAGE_SIZE,
  };
}
