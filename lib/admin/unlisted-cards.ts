import "server-only";

import { requireAdminClient } from "@/lib/admin/users-queries";
import { narrowCard } from "@/lib/cards/narrow";
import { createPublicClient } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";
import type { Card } from "@/types/card";

// ---------------------------------------------------------------------------
// A user's UNLISTED cards, for an admin — the profile page's "Unlisted
// cards" section (owner 2026-11-11: a creator reported a broken frame on a
// card saved unlisted, and nobody on the team could find the card to look
// at it). Debugging only.
//
// An unlisted card is link-only: no page of the app lists a creator's — no
// profile, gallery, hub, search or sitemap — and this is the one place that
// does. So the gate is in the reader itself, never only in the page that
// calls it: for anyone who is not an admin it answers null and no card is
// read. A later import of this into another page or a route cannot hand the
// list out. (The database API itself still hands an unlisted row to anyone
// who asks for it — CLAUDE.md's open follow-up; this module does not widen
// that, and does not rely on it being closed.)
//
// THE READ IS A SIGNED-OUT VISITOR'S (the cookie-free client), not the
// service role's: RLS already hands an unlisted card to anyone, so nothing
// more is needed — and RLS then keeps every PRIVATE card out whatever
// becomes of the filter below. Private is the maker's "nobody but me";
// never list one here.
// ---------------------------------------------------------------------------

/** One page of the section: 4 rows of the profile's 6-column grid. */
export const ADMIN_UNLISTED_PAGE_SIZE = 24;

/** The query-string key that pages the section (`?unlisted=2`). */
export const ADMIN_UNLISTED_PARAM = "unlisted";

export type AdminUnlistedCards =
  /** Read: this page's cards (newest edit first) and how many there are. A
   *  page past the last card is an empty page with the real total. */
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
 * Whether the DATABASE says the viewer is an admin — one small call, asked
 * as the viewer. It is here for everyone who is NOT one: the profile page
 * asks this reader on every signed-in view, and the app's own gate
 * (`requireAdminClient`) costs two reads. An answer of yes is not trusted by
 * itself; the app's gate is still asked.
 */
async function databaseSaysAdmin(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("viewer_is_admin");
    return !error && data === true;
  } catch {
    return false;
  }
}

/**
 * `ownerId`'s unlisted cards, a page at a time. NULL for a viewer who is
 * not an admin (signed out included) — the caller then renders nothing at
 * all, not even an empty section.
 */
export async function listUnlistedCardsForAdmin(ownerId: string, page: number): Promise<AdminUnlistedCards | null> {
  if (!(await databaseSaysAdmin())) return null;
  if (!(await requireAdminClient())) return null;

  const safePage = Number.isInteger(page) && page >= 1 ? page : 1;
  const offset = (safePage - 1) * ADMIN_UNLISTED_PAGE_SIZE;
  const reader = createPublicClient();
  const { data, count, error } = await reader
    .from("cards")
    .select("*", { count: "exact" })
    .eq("owner_id", ownerId)
    .eq("visibility", "unlisted")
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true })
    .range(offset, offset + ADMIN_UNLISTED_PAGE_SIZE - 1);

  if (error) {
    // PostgREST refuses a range that starts past the last row (PGRST103, HTTP
    // 416) instead of answering an empty page: a creator who published ten
    // cards while an admin sat on page 2. That is "past the end", not a
    // failure — the count alone says how many there are.
    if (offset > 0 && error.code === "PGRST103") {
      const all = await reader
        .from("cards")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", ownerId)
        .eq("visibility", "unlisted");
      if (!all.error) {
        return { ok: true, cards: [], total: all.count ?? 0, page: safePage, pageSize: ADMIN_UNLISTED_PAGE_SIZE };
      }
      console.error("[admin/unlisted-cards] count read failed:", all.error.message);
      return { ok: false };
    }
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
