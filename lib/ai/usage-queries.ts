import "server-only";

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getEntitlements } from "@/lib/billing/entitlements";
import { MONTHLY_CREDITS, type PlanTier } from "@/lib/billing/plans";
import { PER_DAY_LIMIT, PER_MINUTE_LIMIT } from "@/lib/ai/rate-limit";

// ---------------------------------------------------------------------------
// AI usage snapshot for the settings usage panel.
//
// The windows come straight from the rate limiter (lib/ai/rate-limit.ts) —
// a hand-copied 20/200 here drifted from the enforced 40/500 and the panel
// warned users at the wrong caps.
// ---------------------------------------------------------------------------

export const AI_USAGE_LIMITS = {
  perMinute: PER_MINUTE_LIMIT,
  perDay: PER_DAY_LIMIT,
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

// ---------------------------------------------------------------------------
// Credit snapshot (Phase B) — current balance, the plan's monthly allotment,
// and a 30-day spend trend for the usage panel.
// ---------------------------------------------------------------------------

export type CreditSnapshot = {
  balance: number;
  tier: PlanTier;
  isPaid: boolean;
  monthlyAllotment: number;
  /** Credits spent per day, last 30 days, ascending (gaps filled client-side). */
  daily: DailyCount[];
};

// Credits spent in the current calendar month (UTC). Cheap enough to call from
// the layout for the header indicator; reuses the credit_ledger_daily RPC.
export async function getCreditsUsedThisMonth(): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  try {
    const supabase = await createClient();
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).toISOString();
    const { data } = await supabase.rpc("credit_ledger_daily", {
      since: monthStart,
    });
    const rows = (data ?? []) as Array<{ day: string; spent: number | string }>;
    return rows.reduce(
      (total, row) =>
        total + (typeof row.spent === "string" ? Number(row.spent) : row.spent),
      0,
    );
  } catch {
    return 0;
  }
}

export async function getCreditSnapshot(): Promise<CreditSnapshot> {
  const entitlements = await getEntitlements();
  const base: CreditSnapshot = {
    balance: entitlements.credits,
    // The EFFECTIVE tier — a comped Pro is Pro here, exactly as the cards
    // panel (lib/cards/capacity.ts) and every gate already treat them.
    tier: entitlements.effectiveTier,
    isPaid: entitlements.isPaid,
    monthlyAllotment: MONTHLY_CREDITS[entitlements.effectiveTier] ?? 0,
    daily: [],
  };
  if (!isSupabaseConfigured()) return base;
  try {
    const supabase = await createClient();
    const sinceTrend = new Date(Date.now() - TREND_DAYS * DAY_MS).toISOString();
    const { data } = await supabase.rpc("credit_ledger_daily", {
      since: sinceTrend,
    });
    const daily = (
      (data ?? []) as Array<{ day: string; spent: number | string }>
    ).map((row) => ({
      day: row.day,
      count: typeof row.spent === "string" ? Number(row.spent) : row.spent,
    }));
    return { ...base, daily };
  } catch {
    return base;
  }
}
