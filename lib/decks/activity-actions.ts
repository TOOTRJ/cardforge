"use server";

import { getEntitlements } from "@/lib/billing/entitlements";
import {
  activityReadDays,
  addDays,
  buildDeckActivity,
  type DayCount,
  isActivityPeriod,
  utcDay,
  type DeckActivity,
} from "@/lib/decks/deck-activity";
import { isUuid } from "@/lib/ids";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// The deck activity panel's one read (TODO DK7.4). The panel is an owner-only
// client island that calls this when it mounts and when the period changes —
// nothing of it is in a visitor's page. The gate is here, on the server:
//   * signed in, and the plan is Pro (getEntitlements — an admin, or billing
//     off, is unlocked; Plus is not Pro);
//   * the deck is the caller's: both database functions answer no rows for
//     anyone else's deck (0151 / 0154), and the owner check below says so
//     plainly instead of drawing an empty chart.
// One read of twice the period gives the period and the one before it.
//
// The app may ship before 0154 reaches a database (the dev branch migrates
// from `dev` after the merge): on a database without deck_likes_by_day
// (PGRST202 / 42883) the likes are counted from the deck's like rows the
// owner can read anyway (0151's policy), by their UTC day — capped at
// LIKES_FALLBACK_CAP rows. Remove the fallback once 0154 is on production
// and dev.
// ---------------------------------------------------------------------------

const LIKES_FALLBACK_CAP = 5000;

function isMissingFunction(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "PGRST202" || code === "42883";
}

export type DeckActivityResult =
  | { ok: true; activity: DeckActivity }
  | { ok: false; error: "signed_out" | "not_pro" | "not_found" | "failed" };

export async function getDeckActivityAction(deckId: string, days: number): Promise<DeckActivityResult> {
  if (!isUuid(deckId) || !isActivityPeriod(days)) return { ok: false, error: "not_found" };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "signed_out" };
  const entitlements = await getEntitlements();
  if (entitlements.effectiveTier !== "pro") return { ok: false, error: "not_pro" };

  const supabase = await createClient();
  const { data: deck } = await supabase.from("decks").select("id, owner_id").eq("id", deckId).maybeSingle();
  if (!deck || deck.owner_id !== user.id) return { ok: false, error: "not_found" };

  const span = activityReadDays(days);
  const today = utcDay(new Date());
  const [views, likes] = await Promise.all([
    supabase.rpc("deck_views_by_day", { p_deck_id: deckId, p_days: span }),
    supabase.rpc("deck_likes_by_day", { p_deck_id: deckId, p_days: span }),
  ]);
  let likeRows: DayCount[] | null = likes.error
    ? null
    : (likes.data ?? []).map((row) => ({ day: row.day, count: row.likes }));
  if (likes.error && isMissingFunction(likes.error)) {
    const since = `${addDays(today, -(span - 1))}T00:00:00Z`;
    const fallback = await supabase
      .from("deck_likes")
      .select("created_at")
      .eq("deck_id", deckId)
      .gte("created_at", since)
      .limit(LIKES_FALLBACK_CAP);
    if (!fallback.error) {
      likeRows = (fallback.data ?? []).map((row) => ({ day: utcDay(new Date(row.created_at)), count: 1 }));
    }
  }
  if (views.error || !likeRows) {
    console.error("[deck-activity] read failed", views.error?.message ?? likes.error?.message);
    return { ok: false, error: "failed" };
  }

  return {
    ok: true,
    activity: buildDeckActivity(
      {
        views: (views.data ?? []).map((row) => ({ day: row.day, count: row.views })),
        likes: likeRows,
      },
      days,
      today,
    ),
  };
}
