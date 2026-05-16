import "server-only";

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

// ---------------------------------------------------------------------------
// Scryfall usage snapshot (Phase 11 chunk 15).
//
// Unlike AI calls (one combined quota), Scryfall has per-action limits in
// lib/scryfall/rate-limit.ts. We display a single combined "today /
// minute" count plus a per-action quota table so the user knows which
// specific action is closest to its cap. The chunk doc scopes
// "per-action breakdown beyond high-level split" out, but we keep the
// quota labels because each action's cap is meaningfully different
// (search = 2000/day, named = 500/day, import_art = 100/day) and a
// single combined limit would be misleading.
//
// LIMITS here mirror lib/scryfall/rate-limit.ts. Keep them in sync.
// ---------------------------------------------------------------------------

export const SCRYFALL_USAGE_LIMITS = {
  search: { perMinute: 60, perDay: 2000 },
  named: { perMinute: 30, perDay: 500 },
  import_art: { perMinute: 10, perDay: 100 },
} as const;

export type ScryfallAction = keyof typeof SCRYFALL_USAGE_LIMITS;

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const TREND_DAYS = 30;

export type DailyCount = { day: string; count: number };

export type ScryfallActionUsage = {
  action: ScryfallAction;
  today: number;
  minute: number;
};

export type ScryfallUsageSnapshot = {
  /** Sum across all actions. The chart uses this for a single trendline. */
  todayTotal: number;
  minuteTotal: number;
  /** Per-action counters so the panel can show which action is closest
   *  to its cap. */
  perAction: ScryfallActionUsage[];
  /** Combined 30-day trend (all actions). */
  daily: DailyCount[];
  limits: typeof SCRYFALL_USAGE_LIMITS;
};

const EMPTY_SNAPSHOT: ScryfallUsageSnapshot = {
  todayTotal: 0,
  minuteTotal: 0,
  perAction: (
    Object.keys(SCRYFALL_USAGE_LIMITS) as ScryfallAction[]
  ).map((action) => ({ action, today: 0, minute: 0 })),
  daily: [],
  limits: SCRYFALL_USAGE_LIMITS,
};

export async function getScryfallUsageSnapshot(): Promise<ScryfallUsageSnapshot> {
  if (!isSupabaseConfigured()) return EMPTY_SNAPSHOT;
  try {
    const supabase = await createClient();
    const now = Date.now();
    const sinceMinute = new Date(now - MINUTE_MS).toISOString();
    const sinceDay = new Date(now - DAY_MS).toISOString();
    const sinceTrend = new Date(now - TREND_DAYS * DAY_MS).toISOString();

    // 7 parallel queries: 1 daily-trend RPC + 3 actions × (minute, day).
    // All are head-only counts (cheap), and bounded by user via RLS.
    const actions: ScryfallAction[] = ["search", "named", "import_art"];
    const [trendResult, ...perActionResults] = await Promise.all([
      supabase.rpc("scryfall_calls_daily", { since: sinceTrend }),
      ...actions.flatMap((action) => [
        supabase
          .from("scryfall_calls")
          .select("id", { count: "exact", head: true })
          .eq("action", action)
          .gte("created_at", sinceMinute),
        supabase
          .from("scryfall_calls")
          .select("id", { count: "exact", head: true })
          .eq("action", action)
          .gte("created_at", sinceDay),
      ]),
    ]);

    const perAction: ScryfallActionUsage[] = actions.map((action, i) => ({
      action,
      minute: perActionResults[i * 2]?.count ?? 0,
      today: perActionResults[i * 2 + 1]?.count ?? 0,
    }));

    const todayTotal = perAction.reduce((sum, a) => sum + a.today, 0);
    const minuteTotal = perAction.reduce((sum, a) => sum + a.minute, 0);

    const daily = (
      (trendResult.data ?? []) as Array<{ day: string; count: number | string }>
    ).map((row) => ({
      day: row.day,
      count: typeof row.count === "string" ? Number(row.count) : row.count,
    }));

    return {
      todayTotal,
      minuteTotal,
      perAction,
      daily,
      limits: SCRYFALL_USAGE_LIMITS,
    };
  } catch {
    return EMPTY_SNAPSHOT;
  }
}
