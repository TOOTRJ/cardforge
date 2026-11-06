import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import {
  MONTHLY_CREDITS,
  creditRefillKey,
  creditUpgradeKey,
  currentCreditPeriod,
  previousCreditPeriod,
  type PlanTier,
  TRIAL_CREDITS,
} from "@/lib/billing/plans";

// ---------------------------------------------------------------------------
// Monthly subscription credit grants — the ONE code path shared by the Stripe
// webhook (subscription.created/updated) and the daily refill cron, so both
// entry points self-heal the same cases.
//
// Base grant: the first grant of a calendar month uses the per-user-per-month
// refill key, so webhook + cron calling in any order grant at most once.
//
// Upgrade top-up (the bug this module fixed, 2026-07-28): a mid-month tier
// upgrade used to grant NOTHING — the month's refill key was already consumed
// by the lower tier's grant, so a Plus subscriber upgrading to Pro paid
// prorated Pro immediately but saw none of the extra 70 credits until the
// next calendar month. Now, when everything the month has granted so far
// (the base grant PLUS any earlier upgrade top-ups) is smaller than the
// current tier's allotment, the difference is granted under a tier-scoped
// upgrade key (idempotent, so a re-upgrade in the same month can't
// double-grant, and the cron backfills the top-up if the webhook missed it).
// The shortfall is measured against the month's TOTAL, not the base row
// alone: Free (5) → Plus (+25) → Pro in one month used to top up 100 − 5
// again and hand out 125 credits for a 100-credit plan (found 2026-09-22).
// Downgrades grant nothing — credits already banked are never clawed back.
//
// Free tier (owner decision 2026-09-24, reversing 2026-09-15): Free does NOT
// refill. A new account gets SIGNUP_CREDITS once (the `profiles.credits`
// default) and after that only a pack or a plan adds credits — the
// out-of-credits moment is where the upgrade modal and packs sell. The daily
// sweep walks every profile, but `refillTierFor` answers null for free
// accounts and MONTHLY_CREDITS.free is 0, so nothing is granted to them.
//
// A COMP (the perks overlay, `profiles.comp_tier`) is NOT counted here since
// migration 0176: its credits are the free-days grant's own — one allotment
// per 30 days of the grant, by lib/billing/free-days-credits.ts (the cron
// runs both sweeps). The old rule ("an unexpired comp is owed its tier every
// calendar month") banked two months for a 30-day grant across a month end.
//
// WHO grants the base allotment (billing audit 2026-11-05, P2-1; migration
// 0175 `profiles.billing_interval`): the calendar-month key handed out two
// allotments for one payment when a monthly plan paid on Jan 31 (the
// invoice's grant, key 2026-01) and the cron ran on Feb 1 (no base row for
// 2026-02 yet → a second 100). So:
//   • a MONTHLY plan's base allotment is the paying invoice's (the webhook's
//     subscription / invoice.paid sync): the cron grants it only as a
//     BACKSTOP, when the user's newest base grant is older than
//     MONTHLY_REFILL_BACKSTOP_DAYS (a missed webhook) — otherwise the month's
//     payment simply hasn't happened yet. Upgrade top-ups are still
//     backfilled by the cron whenever the month has its base row.
//   • an ANNUAL plan (one payment a year) is the cron's: every calendar
//     month, plus the PREVIOUS month when it has no base row and the plan
//     already ran then (a cron outage spanning a month used to lose it).
//   • an unknown interval (a row synced before 0175) keeps the old rule:
//     every calendar month — so a row synced
//     before 0175 can still see the Jan 31 / Feb 1 early grant until its
//     next Stripe event (accepted); a cron outage spanning TWO whole months
//     loses an annual plan the earlier one (only the previous month is
//     backfilled; accepted — the next outage of that length is the alert);
//     the monthly backstop catches up ONE missed month, never a run of them
//     (a missed webhook is itself an incident), and an upgrade top-up inside
//     the cycle re-anchors its 35-day clock (a renewal missed within days
//     of such a top-up is caught a cycle later — accepted).
// The same "paying invoice" rule holds at the WEBHOOK door:
// grantCreditsForSync passes `base: "backstop"` for a monthly plan unless
// the event paid (a cycle / first invoice, a trial converting) — a cancel
// click on Feb 2 after a Jan 31 payment used to grant February — and a
// paying invoice is granted under ITS OWN period's month, never "now": a
// renewal that failed on Feb 28 and paid on the Mar 5 retry is February's.
// ---------------------------------------------------------------------------

/** A monthly plan whose newest base grant is older than this is missing a
 *  payment's grant (the webhook was missed): the cron grants it. Longer than
 *  any monthly period, so a plan paid on the 31st is never granted twice. */
export const MONTHLY_REFILL_BACKSTOP_DAYS = 35;

/** The service-role client (grant_credits is service-role only). Exported so
 *  unit tests can cast a minimal stub to it. */
export type CreditGrantClient = ReturnType<typeof createAdminClient>;

export type MonthlyGrantResult =
  | { ok: true; granted: number }
  | { ok: false; error: string };

/** PostgREST caps un-ranged selects at 1000 rows — the refill sweep MUST
 *  paginate or subscriber #1001+ silently never refills (and the next day's
 *  "self-healing" rerun drops the very same tail). Exported for tests. */
export const REFILL_PAGE_SIZE = 1000;

export type RefillSweepResult =
  | { ok: true; processed: number; granted: number; failed: number }
  | { ok: false; error: string };

/** The profile columns the sweep reads. */
export type RefillProfileRow = {
  id: string;
  subscription_tier: string | null;
  subscription_status: string | null;
  is_admin: boolean | null;
  created_at: string | null;
  /** The live plan's interval (0175): "month" | "year"; null = unknown. */
  billing_interval?: string | null;
  /** When the live plan's current period ends — bounds the annual backfill. */
  current_period_end?: string | null;
};

/** Which periods the sweep grants a profile, and how (see the header). */
export type RefillPlan = {
  /** The current calendar month: always granted ("always"), or only as the
   *  backstop for a missed payment ("backstop"). */
  current: "always" | "backstop";
  /** The previous calendar month, backfilled (annual plans only). */
  backfillPrevious: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** How the sweep grants this profile `tier` in `period` (see the header). */
export function refillPlanFor(
  profile: RefillProfileRow,
  _tier: PlanTier,
  now: Date = new Date(),
): RefillPlan {
  const subscribed: PlanTier | null =
    (profile.subscription_status === "active" || profile.subscription_status === "trialing") &&
    (profile.subscription_tier === "plus" || profile.subscription_tier === "pro")
      ? profile.subscription_tier
      : null;
  if (!subscribed) return { current: "always", backfillPrevious: false };
  if (profile.billing_interval === "month") return { current: "backstop", backfillPrevious: false };
  if (profile.billing_interval === "year") {
    // The previous month is owed only when the plan already ran then: its
    // start (the period end minus a year) must fall before that month's end.
    const periodEnd = profile.current_period_end ? new Date(profile.current_period_end) : null;
    const start = periodEnd && !Number.isNaN(periodEnd.getTime()) ? periodEnd.getTime() - 365 * DAY_MS : null;
    const prevMonthEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1;
    return { current: "always", backfillPrevious: start != null && start < prevMonthEnd };
  }
  return { current: "always", backfillPrevious: false };
}

/**
 * Which tier's allotment a profile is owed this period, or null when the
 * sweep should leave it alone:
 *   • admins — unlimited credits, a grant is ledger noise;
 *   • trialing — a trial's single grant lands on subscription.created
 *     (see subscription-sync.ts); refilling here let a no-card 7-day trial
 *     spanning a month boundary bank a second allotment without paying —
 *     and a plan HELD by free days reads trialing too: its grant's own
 *     allotments cover the held days (lib/billing/free-days-credits.ts);
 *   • active plus/pro → that tier;
 *   • everyone else (free, lapsed, canceled, a comp overlay) → null: Free
 *     doesn't refill (SIGNUP_CREDITS once at signup, owner decision
 *     2026-09-24), and a comp's credits are its grant's.
 */
export function refillTierFor(
  profile: RefillProfileRow,
  _period: string,
  opts: {
    /** A free-days HOLD on this plan has not started yet (its `starts_at`
     *  is ahead): Stripe reads `trialing` from the moment the hold is
     *  written, but the time until the hold's start is PAID time — an
     *  annual plan held 200 days before its renewal is still owed its
     *  monthly allotments until then. */
    heldBeforeStart?: boolean;
  } = {},
): PlanTier | null {
  if (profile.is_admin) return null;
  const status = profile.subscription_status ?? null;
  const paying = status === "active" || (status === "trialing" && opts.heldBeforeStart === true);
  if (!paying) return null;
  const tier = profile.subscription_tier ?? "free";
  return tier === "plus" || tier === "pro" ? tier : null;
}

/** The users whose free-days HOLD on a PAYING plan (`held_from` active —
 *  a hold on a trial added nothing paid) starts in the future: the paid
 *  time before it (see refillTierFor). A REVOKED hold counts too — Stripe
 *  stays `trialing` until the period end it was put back on, still paid.
 *  A failed read answers nobody: the allotment waits a day, never
 *  doubles. */
async function usersHeldBeforeStart(admin: CreditGrantClient, now: Date): Promise<Set<string>> {
  const { data, error } = await admin
    .from("plan_grants")
    .select("user_id")
    .in("status", ["applied", "revoked"])
    .eq("applied_as", "subscription_hold")
    .eq("held_from", "active")
    .gt("starts_at", now.toISOString())
    .limit(REFILL_PAGE_SIZE * 5);
  if (error) {
    console.error(`[refill-credits] plan_grants hold read failed: ${error.message}`);
    return new Set();
  }
  return new Set(((data ?? []) as Array<{ user_id: string }>).map((row) => row.user_id));
}

/**
 * The daily refill sweep: page through EVERY profile (id-ordered ranges of
 * REFILL_PAGE_SIZE) and grant each the allotment `refillTierFor` says it is
 * owed. Offset pagination is stable because grants never change the read
 * columns. A page-read failure aborts with the stats so far — the grants are
 * idempotent, so the next daily run resumes harmlessly.
 *
 * Every failed grant is logged with its user id and error (no email, no
 * secret) and handed to `onGrantFailed`, so the cron route can alert the
 * admins (lib/billing/credit-alerts.ts). Neither changes what is granted.
 */
export async function refillActiveSubscribers(
  admin: CreditGrantClient,
  period: string,
  opts: { onGrantFailed?: (userId: string, error: string) => void; now?: Date } = {},
): Promise<RefillSweepResult> {
  let processed = 0;
  let granted = 0;
  let failed = 0;
  const heldBeforeStart = await usersHeldBeforeStart(admin, opts.now ?? new Date());
  for (let from = 0; ; from += REFILL_PAGE_SIZE) {
    const { data: page, error } = await admin
      .from("profiles")
      .select(
        "id, subscription_tier, subscription_status, is_admin, created_at, billing_interval, current_period_end",
      )
      .order("id", { ascending: true })
      .range(from, from + REFILL_PAGE_SIZE - 1);
    if (error) {
      console.error(`[refill-credits] profiles page read failed at row ${from}: ${error.message}`);
      return { ok: false, error: error.message };
    }
    for (const profile of (page ?? []) as RefillProfileRow[]) {
      const tier = refillTierFor(profile, period, { heldBeforeStart: heldBeforeStart.has(profile.id) });
      if (!tier) continue;
      const plan = refillPlanFor(profile, tier, opts.now);
      const periods: Array<{ period: string; base: "always" | "backstop" }> = [
        ...(plan.backfillPrevious ? [{ period: previousCreditPeriod(), base: "always" as const }] : []),
        { period, base: plan.current },
      ];
      let failedThis = false;
      for (const { period: p, base } of periods) {
        const result = await grantMonthlyCreditsForPeriod(admin, profile.id, tier, p, { base });
        if (!result.ok) {
          failedThis = true;
          console.error(`[refill-credits] grant failed for user ${profile.id} (${tier}, ${p}): ${result.error}`);
          opts.onGrantFailed?.(profile.id, result.error);
          break;
        }
      }
      if (failedThis) failed += 1;
      else granted += 1;
    }
    processed += page?.length ?? 0;
    if ((page?.length ?? 0) < REFILL_PAGE_SIZE) break;
  }
  return { ok: true, processed, granted, failed };
}

/** Every grant the month has made for this user: the base refill row plus
 *  any tier-scoped upgrade top-ups (`refill:<user>:<period>` and
 *  `refill:<user>:<period>:upgrade:<tier>`). One LIKE read, no joins. */
async function readMonthRefills(
  admin: CreditGrantClient,
  baseKey: string,
): Promise<{ ok: true; hasBase: boolean; total: number } | { ok: false }> {
  const { data, error } = await admin
    .from("credit_ledger")
    .select("delta, idempotency_key")
    .like("idempotency_key", `${baseKey}%`);
  if (error || !data) return { ok: false };
  const rows = (data as Array<{ delta: unknown; idempotency_key: string | null }>).filter(
    (row) => typeof row.delta === "number" && Number.isFinite(row.delta),
  );
  return {
    ok: true,
    hasBase: rows.some((row) => row.idempotency_key === baseKey),
    total: rows.reduce((sum, row) => sum + (row.delta as number), 0),
  };
}

/** The user's newest refill grant of any kind — the base allotment, the
 *  trial tranche, an upgrade top-up (a same-month trial conversion is a
 *  top-up, and it is the payment that anchors the next renewal) — as WHEN
 *  it landed and WHICH month it was for (the key's period, the same prefix
 *  on every refill key); null when there is none or the read failed. */
async function newestRefillGrant(
  admin: CreditGrantClient,
  userId: string,
): Promise<{ at: Date; period: string } | null> {
  const prefix = creditRefillKey(userId, "");
  const { data, error } = await admin
    .from("credit_ledger")
    .select("created_at, idempotency_key")
    .like("idempotency_key", `${prefix}%`)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data) return null;
  const row = (data as Array<{ created_at: string | null; idempotency_key: string | null }>)[0];
  const at = row?.created_at ? new Date(row.created_at) : null;
  if (!at || Number.isNaN(at.getTime()) || !row?.idempotency_key) return null;
  const period = row.idempotency_key.slice(prefix.length, prefix.length + 7);
  return /^\d{4}-\d{2}$/.test(period) ? { at, period } : null;
}

/** A newest grant older than this is no longer a missed PAYMENT of a
 *  running plan but an older plan's (a lapsed subscriber coming back): the
 *  backstop then grants the current month — which the creation event's
 *  grant dedupes — never a "missed" month that was never owed. */
const MISSED_MONTH_LOOKBACK_DAYS = 2 * MONTHLY_REFILL_BACKSTOP_DAYS;

/** The calendar month after "YYYY-MM". */
function nextPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return currentCreditPeriod(new Date(Date.UTC(y, m, 1)));
}

/**
 * Grant the user's monthly allotment for `tier` in `period` (idempotent), or
 * top up the shortfall after a mid-month upgrade. `granted` is what this call
 * ASKED grant_credits for — an already-used idempotency key silently no-ops
 * inside the RPC, so treat the number as intent, not a ledger delta.
 *
 * `base: "backstop"` (the cron on a MONTHLY plan): the month's base
 * allotment is the paying invoice's; it is granted here only when the user's
 * newest base grant is older than MONTHLY_REFILL_BACKSTOP_DAYS (a missed
 * webhook). Top-ups on a month that has its base row run either way.
 */
export async function grantMonthlyCreditsForPeriod(
  admin: CreditGrantClient,
  userId: string,
  tier: PlanTier,
  period: string,
  opts: { base?: "always" | "backstop"; now?: Date } = {},
): Promise<MonthlyGrantResult> {

  const amount = MONTHLY_CREDITS[tier] ?? 0;
  if (amount <= 0) return { ok: true, granted: 0 };

  const baseKey = creditRefillKey(userId, period);
  const month = await readMonthRefills(admin, baseKey);

  // A month that already granted: top up only a positive shortfall against
  // EVERYTHING granted so far (upgrade). Same tier, a downgrade, or a
  // re-upgrade after a downgrade leaves the banked credits untouched.
  if (month.ok && month.hasBase) {
    const shortfall = amount - month.total;
    if (shortfall <= 0) return { ok: true, granted: 0 };
    const { error } = await admin.rpc("grant_credits", {
      p_user_id: userId,
      p_amount: shortfall,
      p_reason: "subscription_refill",
      p_idempotency_key: creditUpgradeKey(userId, period, tier),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, granted: shortfall };
  }

  // The cron on a monthly plan: the payment's own grant is what fills the
  // month. A base grant inside the last MONTHLY_REFILL_BACKSTOP_DAYS means
  // this period's payment hasn't happened yet — granting now would be the
  // second allotment for one invoice. (A failed read of the newest grant
  // answers null and falls through to the grant: idempotent on the key.)
  let grantKey = baseKey;
  if (opts.base === "backstop") {
    const newest = await newestRefillGrant(admin, userId);
    const now = opts.now ?? new Date();
    const age = newest ? now.getTime() - newest.at.getTime() : Infinity;
    if (age < MONTHLY_REFILL_BACKSTOP_DAYS * DAY_MS) {
      return { ok: true, granted: 0 };
    }
    // The missed payment's month is the one AFTER the newest grant's (a plan
    // paid on Jan 31 whose Feb 28 renewal was missed is owed February, found
    // on Mar 8 — granting it under March would leave the Mar 28 renewal
    // nothing to grant). Never past the current month, and only while the
    // newest grant is recent enough to be a running plan's.
    if (newest && newest.period < period && age < MISSED_MONTH_LOOKBACK_DAYS * DAY_MS) {
      const missed = nextPeriod(newest.period);
      grantKey = creditRefillKey(userId, missed < period ? missed : period);
    }
  }

  // No base grant yet this month — or the ledger read failed, in which case
  // falling through to the base grant is safe (grant_credits dedupes on the
  // key; worst case the upgrade top-up waits for the next webhook/cron pass).
  const { error } = await admin.rpc("grant_credits", {
    p_user_id: userId,
    p_amount: amount,
    p_reason: "subscription_refill",
    p_idempotency_key: grantKey,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, granted: amount };
}

/**
 * The trial tranche (TRIAL_CREDITS) when a trial STARTS — under the month's
 * BASE refill key, so the first payment's grant (grantMonthlyCreditsForPeriod)
 * sees it and tops the month up to the plan's full allotment: a Pro trial
 * that converts in the same month gets 25 + 75; one that converts next month
 * gets its full 100 fresh. Idempotent on the key (a retried created event
 * grants nothing twice).
 */
export async function grantTrialCreditsForPeriod(
  admin: CreditGrantClient,
  userId: string,
  period: string,
): Promise<MonthlyGrantResult> {
  // ONCE per account (owner 2026-11-06): the days bank can start a second
  // free period for an account that trialled before (earned days with no
  // live plan check out as a free period) — the tranche is the FIRST free
  // period's alone. An unreadable ledger falls through to the grant (the
  // period key still dedupes within a month).
  const { data: earlier, error: readError } = await admin
    .from("credit_ledger")
    .select("id")
    .eq("user_id", userId)
    .eq("reason", "trial_grant")
    .limit(1);
  if (!readError && (earlier?.length ?? 0) > 0) return { ok: true, granted: 0 };
  const { error } = await admin.rpc("grant_credits", {
    p_user_id: userId,
    p_amount: TRIAL_CREDITS,
    p_reason: "trial_grant",
    p_idempotency_key: creditRefillKey(userId, period),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, granted: TRIAL_CREDITS };
}

