import "server-only";

import { createClient } from "@/lib/supabase/server";
import { isBillingEnabled } from "@/lib/billing/flags";

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
  | "generate_random_art"
  | "generate_deck";

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
 * draining the gpt-image-1 budget.
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

// ---------------------------------------------------------------------------
// AI generation credits (Phase B).
//
// Credits meter the operations with real marginal cost — AI card/art
// generation. Cheap text-assistant actions stay governed by the windowed
// rate limit above (cost 0), so free users can keep using them. Paid tiers get
// a monthly credit allotment (granted on Stripe `invoice.paid`); everyone can
// buy consumable top-up packs. Spending goes through the atomic consume_credits
// RPC (which row-locks the profile), so concurrent generations can't
// double-spend the balance.
// ---------------------------------------------------------------------------

// Cost in credits per AI action. Anything not listed is free (0) and relies on
// the windowed rate limit only. Deck generation is metered per-card by the deck
// route, so it isn't a fixed cost here.
export const AI_ACTION_COST: Partial<Record<AiActionLabel, number>> = {
  generate_random_card: 1,
};

export function creditCostFor(action: AiActionLabel): number {
  return AI_ACTION_COST[action] ?? 0;
}

export type CreditSpendResult =
  | { ok: true; balance: number }
  | {
      ok: false;
      reason: "insufficient_credits";
      balance: number;
      message: string;
    };

const OUT_OF_CREDITS_MESSAGE =
  "You're out of AI credits. Upgrade your plan or grab a credit pack to keep generating.";

/**
 * Spend `amount` credits atomically via the consume_credits RPC (relies on
 * auth.uid() inside the function). Fails OPEN on an infrastructure error — a
 * transient DB outage shouldn't wedge generation, matching checkAiRateLimit's
 * posture — but fails CLOSED on an actual insufficient balance.
 */
export async function spendCredits(
  amount: number,
  reason: string,
): Promise<CreditSpendResult> {
  // Billing off → credits aren't enforced; never touch the ledger.
  if (!isBillingEnabled()) return { ok: true, balance: Number.POSITIVE_INFINITY };
  if (amount <= 0) return { ok: true, balance: Number.POSITIVE_INFINITY };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("consume_credits", {
      p_amount: amount,
      p_reason: reason,
    });
    if (error) return { ok: true, balance: Number.NaN }; // fail open
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || !row.ok) {
      return {
        ok: false,
        reason: "insufficient_credits",
        balance: row?.balance ?? 0,
        message: OUT_OF_CREDITS_MESSAGE,
      };
    }
    return { ok: true, balance: row.balance };
  } catch {
    return { ok: true, balance: Number.NaN }; // fail open
  }
}

/** Spend the credit cost of a specific AI action (0 = free / windowed-only). */
export async function consumeAiCredits(
  action: AiActionLabel,
): Promise<CreditSpendResult> {
  const cost = creditCostFor(action);
  if (cost <= 0) return { ok: true, balance: Number.POSITIVE_INFINITY };
  return spendCredits(cost, action);
}
