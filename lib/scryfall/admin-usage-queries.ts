import "server-only";

import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import {
  SCRYFALL_USAGE_LIMITS,
  type ScryfallAction,
} from "@/lib/scryfall/usage-queries";

// ---------------------------------------------------------------------------
// App-wide Scryfall usage for the admin dashboard (/admin/scryfall).
//
// Same posture as lib/moderation/queries.ts: return null when the caller
// isn't an admin (page maps null → notFound), then read via the service
// role. The two aggregate RPCs (migration 0047) are EXECUTE-granted to
// service_role only, so they can't be called from a user session at all.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const TREND_DAYS = 30;

export type ScryfallAdminActionUsage = {
  action: ScryfallAction;
  today: number;
  minute: number;
};

export type ScryfallAdminDailyRow = {
  day: string;
  action: string;
  count: number;
};

export type ScryfallAdminTopUser = {
  userId: string;
  username: string | null;
  calls: number;
};

export type ScryfallAdminUsageSnapshot = {
  todayTotal: number;
  minuteTotal: number;
  perAction: ScryfallAdminActionUsage[];
  /** Per-day per-action counts for the last 30 days, across all users. */
  daily: ScryfallAdminDailyRow[];
  /** Heaviest users of the proxy over the last 30 days. */
  topUsers: ScryfallAdminTopUser[];
  /** Per-user quotas, for context next to app-wide counts. */
  limits: typeof SCRYFALL_USAGE_LIMITS;
};

const ACTIONS: ScryfallAction[] = ["search", "named", "import_art"];

/**
 * App-wide usage snapshot. Null when the caller isn't an admin; an empty
 * snapshot when the service-role key isn't configured (page still renders
 * the static limits panel).
 */
export async function getScryfallAdminUsageSnapshot(): Promise<ScryfallAdminUsageSnapshot | null> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return null;

  const empty: ScryfallAdminUsageSnapshot = {
    todayTotal: 0,
    minuteTotal: 0,
    perAction: ACTIONS.map((action) => ({ action, today: 0, minute: 0 })),
    daily: [],
    topUsers: [],
    limits: SCRYFALL_USAGE_LIMITS,
  };
  if (!isAdminConfigured()) return empty;

  try {
    const admin = createAdminClient();
    const now = Date.now();
    const sinceMinute = new Date(now - MINUTE_MS).toISOString();
    const sinceDay = new Date(now - DAY_MS).toISOString();
    const sinceTrend = new Date(now - TREND_DAYS * DAY_MS).toISOString();

    const [dailyResult, topUsersResult, ...perActionResults] =
      await Promise.all([
        admin.rpc("scryfall_usage_admin_daily", { since: sinceTrend }),
        admin.rpc("scryfall_usage_admin_top_users", {
          since: sinceTrend,
          max_rows: 10,
        }),
        ...ACTIONS.flatMap((action) => [
          admin
            .from("scryfall_calls")
            .select("id", { count: "exact", head: true })
            .eq("action", action)
            .gte("created_at", sinceMinute),
          admin
            .from("scryfall_calls")
            .select("id", { count: "exact", head: true })
            .eq("action", action)
            .gte("created_at", sinceDay),
        ]),
      ]);

    const perAction: ScryfallAdminActionUsage[] = ACTIONS.map((action, i) => ({
      action,
      minute: perActionResults[i * 2]?.count ?? 0,
      today: perActionResults[i * 2 + 1]?.count ?? 0,
    }));

    return {
      todayTotal: perAction.reduce((sum, a) => sum + a.today, 0),
      minuteTotal: perAction.reduce((sum, a) => sum + a.minute, 0),
      perAction,
      daily: (dailyResult.data ?? []).map((row) => ({
        day: row.day,
        action: row.action,
        count: typeof row.count === "string" ? Number(row.count) : row.count,
      })),
      topUsers: (topUsersResult.data ?? []).map((row) => ({
        userId: row.user_id,
        username: row.username ?? null,
        calls: typeof row.calls === "string" ? Number(row.calls) : row.calls,
      })),
      limits: SCRYFALL_USAGE_LIMITS,
    };
  } catch {
    return empty;
  }
}
