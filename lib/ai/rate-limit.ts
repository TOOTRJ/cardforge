import "server-only";

import { createClient } from "@/lib/supabase/server";

// Per-user windowed caps. Two windows so a user can't (a) spam the assistant
// in a tight burst or (b) slowly drain the Anthropic spend cap over a day.
// Tuned for "comfortable solo design session" — typical use is a few calls
// per card; aggressive use is the brainstorm spike where a user fires off
// several actions in a minute. 200/day comfortably covers a heavy design
// day and shuts down anything resembling an abuse script.
const PER_MINUTE_LIMIT = 20;
const PER_DAY_LIMIT = 200;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000;

export type AiActionLabel =
  | "improve_wording"
  | "suggest_cost"
  | "suggest_rarity"
  | "generate_flavor"
  | "generate_art_prompt"
  | "check_balance"
  | "generate_from_concept"
  | "generate_random_card"
  | "generate_random_art";

// Per-user daily quota specifically for the random-card flow. Image
// generation is the priciest call we make, so it gets its own cap on top
// of the global PER_DAY_LIMIT. 10/day matches the v2 spec.
const RANDOM_CARD_DAILY_LIMIT = 10;

export type RateLimitResult =
  | { ok: true }
  | {
      ok: false;
      reason: "per_minute" | "per_day";
      retryAfterSeconds: number;
      message: string;
    };

/**
 * Check the per-user windowed quota. Does NOT log the call — call
 * `logAiCall` after the AI request succeeds (or always, depending on whether
 * you want to count failed calls; we log on entry so that 500s from the
 * provider still consume quota — a noisy attacker can't just trigger errors
 * to evade the limit).
 *
 * The route handler should call this *before* invoking the AI, and abort
 * with HTTP 429 if `ok` is false. The `retryAfterSeconds` field is suitable
 * for the `Retry-After` HTTP header.
 */
export async function checkAiRateLimit(
  userId: string,
): Promise<RateLimitResult> {
  const supabase = await createClient();
  const now = Date.now();
  const minuteAgo = new Date(now - MINUTE_MS).toISOString();
  const dayAgo = new Date(now - DAY_MS).toISOString();

  // Single roundtrip via Postgres count-only HEAD requests. We could pull
  // both windows in one query with an ORed condition, but two count queries
  // are clearer and equally fast at this scale.
  const [minuteResult, dayResult] = await Promise.all([
    supabase
      .from("card_ai_calls")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", minuteAgo),
    supabase
      .from("card_ai_calls")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", dayAgo),
  ]);

  // If the DB call errors (e.g. RLS misconfig), we fail OPEN — the AI route
  // would otherwise be unusable for everyone on an unrelated outage. This
  // matches the project's "don't wedge the editor" posture; a partial
  // outage degrades to "AI works but no rate limit" rather than "AI is dead".
  if (minuteResult.error || dayResult.error) return { ok: true };

  const minuteCount = minuteResult.count ?? 0;
  const dayCount = dayResult.count ?? 0;

  if (minuteCount >= PER_MINUTE_LIMIT) {
    return {
      ok: false,
      reason: "per_minute",
      retryAfterSeconds: 60,
      message: `Slow down — you've hit ${PER_MINUTE_LIMIT} AI calls in the last minute. Try again in a minute.`,
    };
  }

  if (dayCount >= PER_DAY_LIMIT) {
    return {
      ok: false,
      reason: "per_day",
      retryAfterSeconds: 60 * 60,
      message: `Daily AI quota reached (${PER_DAY_LIMIT}/day). It resets in 24h.`,
    };
  }

  return { ok: true };
}

/**
 * Per-user check specifically for the random-card flow. Lives alongside
 * `checkAiRateLimit`; the route handler runs both — the global limit
 * protects the platform AI spend, this one keeps a single user from
 * draining the DALL-E budget.
 */
export async function checkRandomCardDailyLimit(
  userId: string,
): Promise<RateLimitResult> {
  const supabase = await createClient();
  const dayAgo = new Date(Date.now() - DAY_MS).toISOString();
  const { count, error } = await supabase
    .from("card_ai_calls")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("action", "generate_random_card")
    .gte("created_at", dayAgo);

  // Fail open on errors — same posture as the global limit.
  if (error) return { ok: true };

  if ((count ?? 0) >= RANDOM_CARD_DAILY_LIMIT) {
    return {
      ok: false,
      reason: "per_day",
      retryAfterSeconds: 60 * 60,
      message: `Daily random-card quota reached (${RANDOM_CARD_DAILY_LIMIT}/day). It resets in 24h.`,
    };
  }
  return { ok: true };
}

/**
 * Log a successful (or attempted) AI call to the audit table. Best-effort —
 * failures here are swallowed so a logging hiccup doesn't surface as an
 * error to the user.
 */
export async function logAiCall(
  userId: string,
  action: AiActionLabel,
): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.from("card_ai_calls").insert({
      user_id: userId,
      action,
    });
  } catch {
    // Intentionally silent — observability comes from the table itself
    // when it works, and adding a console.warn here would just spam logs
    // on transient outages.
  }
}
