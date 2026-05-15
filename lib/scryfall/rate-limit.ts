import "server-only";

import { createClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Per-user windowed quota for the Scryfall proxy. Mirrors the AI rate-limit
// helper from lib/ai/rate-limit.ts — same shape, separate table.
//
// Limits are more generous than AI because:
//   - Scryfall is free and doesn't cost us per call (only their politeness)
//   - typeahead search is naturally chatty (one call per keystroke pause)
//   - art import is bounded by the user's storage quota anyway
//
// `import_art` has a tighter cap than `search`/`named` because it pulls a
// few hundred KB across the wire each time.
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000;

// action → { perMinute, perDay }
const LIMITS = {
  search: { perMinute: 60, perDay: 2000 },
  named: { perMinute: 30, perDay: 500 },
  import_art: { perMinute: 10, perDay: 100 },
} as const;

export type ScryfallActionLabel = keyof typeof LIMITS;

export type ScryfallRateLimitResult =
  | { ok: true }
  | {
      ok: false;
      reason: "per_minute" | "per_day";
      retryAfterSeconds: number;
      message: string;
    };

export async function checkScryfallRateLimit(
  userId: string,
  action: ScryfallActionLabel,
): Promise<ScryfallRateLimitResult> {
  const supabase = await createClient();
  const now = Date.now();
  const minuteAgo = new Date(now - MINUTE_MS).toISOString();
  const dayAgo = new Date(now - DAY_MS).toISOString();

  const [minuteResult, dayResult] = await Promise.all([
    supabase
      .from("scryfall_calls")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("action", action)
      .gte("created_at", minuteAgo),
    supabase
      .from("scryfall_calls")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("action", action)
      .gte("created_at", dayAgo),
  ]);

  // Same fail-open posture as the AI limiter: if the DB hiccups, let the
  // request through rather than wedging the editor on an unrelated outage.
  if (minuteResult.error || dayResult.error) return { ok: true };

  const minuteCount = minuteResult.count ?? 0;
  const dayCount = dayResult.count ?? 0;
  const limits = LIMITS[action];

  if (minuteCount >= limits.perMinute) {
    return {
      ok: false,
      reason: "per_minute",
      retryAfterSeconds: 60,
      message: `Slow down — you've hit ${limits.perMinute} ${action} calls in the last minute.`,
    };
  }
  if (dayCount >= limits.perDay) {
    return {
      ok: false,
      reason: "per_day",
      retryAfterSeconds: 60 * 60,
      message: `Daily quota reached (${limits.perDay} ${action}/day).`,
    };
  }

  return { ok: true };
}

export async function logScryfallCall(
  userId: string,
  action: ScryfallActionLabel,
): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.from("scryfall_calls").insert({
      user_id: userId,
      action,
    });
  } catch {
    // Silent — see lib/ai/rate-limit.ts for the rationale.
  }
}
