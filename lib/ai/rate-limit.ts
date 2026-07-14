import "server-only";

import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isBillingEnabled } from "@/lib/billing/flags";

// Admins are exempt from every AI cap — windowed limits, per-action daily
// limits, and credit spends (owner decision, 2026-07-10). getCurrentProfile
// is React-cached per request, so this adds no extra query in practice, and
// is_admin is trigger-protected against client writes.
async function isCurrentUserAdmin(): Promise<boolean> {
  try {
    return (await getCurrentProfile())?.is_admin === true;
  } catch {
    return false;
  }
}

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
  | "generate_deck"
  | "remix_card"
  | "remix_art"
  | "generate_set_icon"
  | "generate_deck_cards";

// Per-user daily quotas for the image-generating flows. Image generation is
// the priciest call we make, so each flow gets its own cap on top of the
// global PER_DAY_LIMIT. 10/day matches the v2 spec.
const RANDOM_CARD_DAILY_LIMIT = 10;
export const REMIX_DAILY_LIMIT = 10;
// Deck/set batch flows generate many images per job, so the ceiling is the
// per-DAY total across all batch jobs (not per job). Generous — it clears a
// heavy design day and only bites an abuse script. Admins are exempt.
export const DECK_CARDS_DAILY_LIMIT = 60;

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
  if (await isCurrentUserAdmin()) return { ok: true };
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
 * draining the image-generation budget (FLUX via the AI Gateway).
 */
export async function checkRandomCardDailyLimit(
  userId: string,
): Promise<RateLimitResult> {
  return checkDailyActionLimit(
    userId,
    "generate_random_card",
    RANDOM_CARD_DAILY_LIMIT,
    "random-card",
  );
}

/**
 * Generic per-user daily cap for one audit-label. Fails open on DB errors —
 * same posture as the global limit.
 */
export async function checkDailyActionLimit(
  userId: string,
  action: AiActionLabel,
  limit: number,
  label: string,
): Promise<RateLimitResult> {
  if (await isCurrentUserAdmin()) return { ok: true };
  const supabase = await createClient();
  const dayAgo = new Date(Date.now() - DAY_MS).toISOString();
  const { count, error } = await supabase
    .from("card_ai_calls")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("action", action)
    .gte("created_at", dayAgo);

  if (error) return { ok: true };

  if ((count ?? 0) >= limit) {
    return {
      ok: false,
      reason: "per_day",
      retryAfterSeconds: 60 * 60,
      message: `Daily ${label} quota reached (${limit}/day). It resets in 24h.`,
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
  remix_card: 1,
};

export function creditCostFor(action: AiActionLabel): number {
  return AI_ACTION_COST[action] ?? 0;
}

export type CreditSpendResult =
  | { ok: true; balance: number }
  | {
      ok: false;
      // "insufficient_credits" — a real empty balance (always fails closed).
      // "error" — an infra/RPC failure surfaced ONLY when the caller opts into
      // failClosed (a reserve). Without failClosed we fail open on infra errors.
      reason: "insufficient_credits" | "error";
      balance: number;
      message: string;
    };

export type SpendOptions = {
  /**
   * When true, an infrastructure/RPC error fails CLOSED (returns
   * `{ ok: false, reason: "error" }`) instead of the default fail-open.
   * Use this to *reserve* a credit before an expensive generation so a DB
   * hiccup can't hand out a free generation. Pair with `refundCredits`
   * so the user is made whole if the generation then fails.
   */
  failClosed?: boolean;
};

const CREDIT_CHECK_FAILED_MESSAGE =
  "We couldn't verify your AI credits right now. Try again in a moment.";

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
  options: SpendOptions = {},
): Promise<CreditSpendResult> {
  // Billing off → credits aren't enforced; never touch the ledger.
  if (!isBillingEnabled()) return { ok: true, balance: Number.POSITIVE_INFINITY };
  if (amount <= 0) return { ok: true, balance: Number.POSITIVE_INFINITY };
  // Admins generate free — no ledger row, no balance check.
  if (await isCurrentUserAdmin()) {
    return { ok: true, balance: Number.POSITIVE_INFINITY };
  }
  // On an infra error: fail closed (deny) when reserving, else fail open.
  const onInfraError = (): CreditSpendResult =>
    options.failClosed
      ? {
          ok: false,
          reason: "error",
          balance: Number.NaN,
          message: CREDIT_CHECK_FAILED_MESSAGE,
        }
      : { ok: true, balance: Number.NaN };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("consume_credits", {
      p_amount: amount,
      p_reason: reason,
    });
    if (error) return onInfraError();
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return onInfraError();
    if (!row.ok) {
      return {
        ok: false,
        reason: "insufficient_credits",
        balance: row.balance ?? 0,
        message: OUT_OF_CREDITS_MESSAGE,
      };
    }
    return { ok: true, balance: row.balance };
  } catch {
    return onInfraError();
  }
}

/**
 * Fresh credit balance for response payloads, read AFTER spends/refunds in
 * the same request. Reads the profile row directly — getCurrentProfile's
 * per-request React cache was filled before the spend and would report the
 * stale pre-charge balance. Null = a live number isn't meaningful here
 * (billing off, admin exemption, signed out, or a read hiccup); clients
 * leave their display unchanged in that case.
 */
export async function getFreshCreditBalance(): Promise<number | null> {
  if (!isBillingEnabled()) return null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
      .from("profiles")
      .select("credits, is_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (!data || data.is_admin) return null;
    return data.credits ?? 0;
  } catch {
    return null;
  }
}

/**
 * Refund credits back to a user — used when a credit was reserved up-front
 * (see `SpendOptions.failClosed`) but the generation then failed, so the
 * user should not be charged for our failure. Runs via the service-role
 * admin client because `grant_credits` is service-role only. Best-effort: a
 * refund failure is logged loudly (the user is owed a credit) but never
 * surfaced as the request's error.
 */
export async function refundCredits(
  userId: string,
  amount: number,
  reason: string,
): Promise<void> {
  if (amount <= 0) return;
  // Billing off → we never charged, so there's nothing to refund.
  if (!isBillingEnabled()) return;
  if (!isAdminConfigured()) {
    console.error(
      `[credits] Cannot refund ${amount} credit(s) to ${userId} for ${reason}: admin client not configured.`,
    );
    return;
  }
  try {
    const admin = createAdminClient();
    const { error } = await admin.rpc("grant_credits", {
      p_user_id: userId,
      p_amount: amount,
      p_reason: "refund",
      // Unique per refund so grant_credits' idempotency guard never collapses
      // two distinct refunds, while a retried identical call is still deduped.
      p_idempotency_key: `refund:${reason}:${userId}:${Date.now()}`,
    });
    if (error) {
      console.error(
        `[credits] Refund of ${amount} credit(s) to ${userId} for ${reason} failed: ${error.message}`,
      );
    }
  } catch (err) {
    console.error(
      `[credits] Refund of ${amount} credit(s) to ${userId} for ${reason} threw:`,
      err,
    );
  }
}
