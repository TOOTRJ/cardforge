import "server-only";

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

// ---------------------------------------------------------------------------
// AI usage snapshot (Phase 11 chunk 15).
//
// Mirrors the windows the rate limiter enforces — see lib/ai/rate-limit.ts:
//   - PER_MINUTE_LIMIT = 20
//   - PER_DAY_LIMIT    = 200
//
// Re-importing the constants here would be tighter but risks drift if
// someone updates one and not the other. We hard-code the same values in
// USAGE_LIMITS and keep the rate-limit file as the source of truth — if
// you change them, change both.
// ---------------------------------------------------------------------------

export const AI_USAGE_LIMITS = {
  perMinute: 20,
  perDay: 200,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const TREND_DAYS = 30;

export type DailyCount = { day: string; count: number };

export type AiUsageSnapshot = {
  today: number;
  minute: number;
  /** Last 30 days, ascending. Days with zero calls are omitted by the
   *  RPC; the chart fills in gaps client-side. */
  daily: DailyCount[];
  limits: typeof AI_USAGE_LIMITS;
};

const EMPTY_SNAPSHOT: AiUsageSnapshot = {
  today: 0,
  minute: 0,
  daily: [],
  limits: AI_USAGE_LIMITS,
};

export async function getAiUsageSnapshot(): Promise<AiUsageSnapshot> {
  if (!isSupabaseConfigured()) return EMPTY_SNAPSHOT;
  try {
    const supabase = await createClient();
    const now = Date.now();
    const sinceMinute = new Date(now - MINUTE_MS).toISOString();
    const sinceDay = new Date(now - DAY_MS).toISOString();
    const sinceTrend = new Date(now - TREND_DAYS * DAY_MS).toISOString();

    const [minuteResult, dayResult, dailyResult] = await Promise.all([
      supabase
        .from("card_ai_calls")
        .select("id", { count: "exact", head: true })
        .gte("created_at", sinceMinute),
      supabase
        .from("card_ai_calls")
        .select("id", { count: "exact", head: true })
        .gte("created_at", sinceDay),
      supabase.rpc("card_ai_calls_daily", { since: sinceTrend }),
    ]);

    // bigint columns come back as strings via PostgREST — coerce to
    // Number so the chart and quota math don't have to special-case them.
    const daily = (
      (dailyResult.data ?? []) as Array<{ day: string; count: number | string }>
    ).map((row) => ({
      day: row.day,
      count: typeof row.count === "string" ? Number(row.count) : row.count,
    }));

    return {
      today: dayResult.count ?? 0,
      minute: minuteResult.count ?? 0,
      daily,
      limits: AI_USAGE_LIMITS,
    };
  } catch {
    return EMPTY_SNAPSHOT;
  }
}
