import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { FREE_PERIOD_CREDITS, PLAN_CREDITS_ONCE, type PaidTier } from "@/lib/billing/plans";

// ---------------------------------------------------------------------------
// Plan credits are ONE-TIME (owner decision 2026-11-06; before it, a monthly
// allotment refilled by this module — the daily cron and the webhook). Two
// grants, each once per account:
//
//   grantPlanCreditsOnce     the tier's stock — Plus 60, Pro 120 — with the
//                            FIRST PAID invoice of a plan on that tier
//                            (lib/stripe/webhook-handlers.ts `invoice.paid`,
//                            `amount_paid > 0`: a $0 trial-start invoice or a
//                            100 %-off coupon grants nothing). The key is per
//                            account and tier (`plan-once:<user>:<tier>`),
//                            and a higher tier grants the DIFFERENCE over
//                            what the account's plan keys already granted: a
//                            Plus subscriber (60) upgrading to Pro gets 60
//                            more, never 180; a downgrade grants nothing; a
//                            cancel and a resubscribe grant nothing twice.
//   grantFreePeriodCredits   FREE_PERIOD_CREDITS (10) when the account's first
//                            free period starts — the subscription created
//                            `trialing` by the checkout that applied the
//                            bank (lib/stripe/subscription-sync.ts), or the
//                            first "Apply banked days" on a live plan
//                            (lib/billing/day-bank.ts) — once per account
//                            (`free-period:<user>`); an account that had the
//                            old 25-credit trial tranche (`trial_grant`) has
//                            had its free-period credits.
//
// Both go through `grant_credits`, which dedupes on the key, so a retried
// webhook or a double click grants nothing twice. Nothing recurs: no cron
// sweep of subscribers, no calendar month, no shortfall arithmetic. Credits
// already on an account are never touched.
// ---------------------------------------------------------------------------

/** The service-role client (grant_credits is service-role only). Exported so
 *  unit tests can cast a minimal stub to it. */
export type CreditGrantClient = ReturnType<typeof createAdminClient>;

export type CreditGrantResult = { ok: true; granted: number } | { ok: false; error: string };

export const PLAN_CREDITS_REASON = "plan_credits_once";
export const FREE_PERIOD_REASON = "free_period_bonus";

export function planCreditsKey(userId: string, tier: PaidTier): string {
  return `plan-once:${userId}:${tier}`;
}

export function freePeriodCreditsKey(userId: string): string {
  return `free-period:${userId}`;
}

/** PostgREST "no such function" — the code is live before migration 0181. */
function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === "PGRST202" || /could not find the function/i.test(error.message ?? "");
}

/**
 * The tier's one-time credits for this account: the difference between the
 * tier's stock and what the account's plan keys already granted (any tier),
 * judged and granted in ONE statement under the user's row lock
 * (`grant_plan_credits_once`, 0181) — so two DIFFERENT tiers' paid invoices
 * handled in the same second (an upgrade seconds after the first payment,
 * delivered concurrently) serialize, and the second sees the first's row.
 * `granted` is what the function granted — an existing key is 0 inside it.
 * Until 0181 is on the database the two-statement path of #773 runs
 * (`grantPlanCreditsOnceTwoStep`): the read first, then the grant.
 */
export async function grantPlanCreditsOnce(
  admin: CreditGrantClient,
  userId: string,
  tier: PaidTier,
): Promise<CreditGrantResult> {
  const target = PLAN_CREDITS_ONCE[tier] ?? 0;
  if (target <= 0) return { ok: true, granted: 0 };
  const { data, error } = await admin.rpc("grant_plan_credits_once", {
    p_user_id: userId,
    p_tier: tier,
    p_target: target,
  });
  if (error && isMissingFunction(error)) {
    console.error(
      `[billing] grant_plan_credits_once is missing (migration 0181 not applied?) — granting ${userId}'s ${tier} credits in two steps.`,
    );
    return grantPlanCreditsOnceTwoStep(admin, userId, tier);
  }
  if (error) return { ok: false, error: error.message };
  // The function answers the credits it granted; anything else is a fault to
  // alert on (the webhook's grant alert), never a silent "0 granted".
  if (typeof data !== "number" || !Number.isFinite(data)) {
    return { ok: false, error: `grant_plan_credits_once answered without a number (${String(data)})` };
  }
  return { ok: true, granted: data };
}

/**
 * #773's path, kept for a database 0181 has not reached: read the account's
 * plan keys, then grant the difference. An unreadable ledger is an error
 * (never a guess: a Pro grant judged without seeing Plus's would hand out
 * 120 on top of 60). The read and the grant are two statements — the
 * cross-tier race 0181 closes.
 */
export async function grantPlanCreditsOnceTwoStep(
  admin: CreditGrantClient,
  userId: string,
  tier: PaidTier,
): Promise<CreditGrantResult> {
  const target = PLAN_CREDITS_ONCE[tier] ?? 0;
  if (target <= 0) return { ok: true, granted: 0 };
  const key = planCreditsKey(userId, tier);
  const { data, error } = await admin
    .from("credit_ledger")
    .select("delta, idempotency_key")
    .eq("user_id", userId)
    .like("idempotency_key", `plan-once:${userId}:%`);
  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []) as Array<{ delta: unknown; idempotency_key: string | null }>;
  if (rows.some((row) => row.idempotency_key === key)) return { ok: true, granted: 0 };
  const already = rows.reduce((sum, row) => sum + (typeof row.delta === "number" && Number.isFinite(row.delta) ? row.delta : 0), 0);
  const amount = target - already;
  if (amount <= 0) return { ok: true, granted: 0 };
  const { error: grantError } = await admin.rpc("grant_credits", {
    p_user_id: userId,
    p_amount: amount,
    p_reason: PLAN_CREDITS_REASON,
    p_idempotency_key: key,
  });
  if (grantError) return { ok: false, error: grantError.message };
  return { ok: true, granted: amount };
}

/**
 * The free-period credits, once per account. An account that had the old
 * trial tranche (`trial_grant`) counts as served. An unreadable ledger falls
 * through to the grant: the key still dedupes the new rule, and the old
 * tranche's accounts are the migration's small window.
 */
export async function grantFreePeriodCredits(admin: CreditGrantClient, userId: string): Promise<CreditGrantResult> {
  if (FREE_PERIOD_CREDITS <= 0) return { ok: true, granted: 0 };
  const { data: earlier, error: readError } = await admin
    .from("credit_ledger")
    .select("id")
    .eq("user_id", userId)
    .in("reason", ["trial_grant", FREE_PERIOD_REASON])
    .limit(1);
  if (!readError && (earlier?.length ?? 0) > 0) return { ok: true, granted: 0 };
  const { error } = await admin.rpc("grant_credits", {
    p_user_id: userId,
    p_amount: FREE_PERIOD_CREDITS,
    p_reason: FREE_PERIOD_REASON,
    p_idempotency_key: freePeriodCreditsKey(userId),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, granted: FREE_PERIOD_CREDITS };
}
