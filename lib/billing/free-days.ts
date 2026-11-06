import { TIER_RANK, type PaidTier, type PlanTier } from "@/lib/billing/plans";
import { MAX_TRIAL_SECONDS, TRIAL_END_BEFORE_COMP_KEY } from "@/lib/billing/comp-stripe";
import { formatUtcDateTime } from "@/lib/format/dates";

// ---------------------------------------------------------------------------
// Free 30 days — the ONE mechanism behind an admin comp and (PR F) a referral
// reward (owner decisions 2026-11-05; docs/research/free-months-design-2026-11.md
// §6, docs/BILLING.md "Free 30 days").
//
// A grant is N UNITS of exactly 30 × 86 400 seconds of a paid tier and
// nothing else (the per-30-days credits of the grants made before 2026-11-06
// still run out through lib/billing/free-days-credits.ts; a new grant carries
// none — plan credits are one-time, lib/billing/credit-refill.ts). The pure decision here (`planFreeDays`) reads the user's profile and
// their CURRENT Stripe subscription and says how the days apply:
//
//   hold        a live, RENEWING plan or trial (the tier granted at or above
//               the one paid for): the days are ADDED to the time already
//               paid for — Stripe `trial_end` = the current period's end (a
//               trial: its own end) + N × 30 d, `proration_behavior: none`
//               (the documented way to push the next charge out: a trial on
//               the existing subscription). On a monthly plan the billing day
//               moves by the days; on an annual plan the renewal does; on a
//               trial the trial end does. Nothing is invoiced now; the next
//               invoice is the plan's own price on the new date. The trial
//               end the subscription had BEFORE any hold stays in its
//               metadata (`pipglyph_trial_end_before_comp`, the key #688
//               introduced): a revoke moves the end back but never before
//               it, and a cancel during the free days is not a lapsed trial
//               (lib/stripe/subscription-sync.ts `isUnconvertedTrial`).
//               The perks overlay (`profiles.comp_tier` / `comp_expires_at`)
//               is written to the SAME instant: the billing page, the
//               reworded trial reminder and the comp-ending reminders read
//               it (lib/billing/comp-ending.ts `isCompHeldTrial` matches the
//               two to the minute).
//   overlay     no live plan (free, lapsed, a cancelled plan still running —
//               the days start when it ends — or one past due, whose
//               dunning keeps its own dates): the overlay alone, from the
//               later of now and its current end. The overlay carries ONE
//               tier: the higher of what it holds and what is granted, for
//               the whole stretch.
//   below_plan  a grant below the tier paid for (Plus days for a Pro payer):
//               recorded (it counts, PR F's caps), applies nothing, no
//               credits — the admin is told.
//   staff       `units` null = no end: the overlay with no expiry, an
//               account with NO Stripe subscription only (owner 2026-11-05:
//               staff accounts). An allotment every 30 days all the same.
//
// Exact to the second (owner 2026-11-05): no rounding to a day or a zone;
// every surface prints the end with its time, in the viewer's zone on the
// pages (<LocalDate>), labelled UTC in the admin's toast.
//
// Revoking (`planRevoke`, the NEWEST applied grant only): the overlay's end
// moves back by the grant's days (cleared when that is now or earlier; the
// tier falls to the highest other live grant's), and a Stripe trial that
// ends at the overlay's end moves back the same way — never before the end
// it had before any hold, and "now" when that has passed (the charge it
// would have made; the user's notice says only that the access ended).
// ---------------------------------------------------------------------------

export const FREE_DAYS_UNIT_DAYS = 30;
export const FREE_DAYS_UNIT_SECONDS = FREE_DAYS_UNIT_DAYS * 86_400;
/** The admin form's longest grant: 12 × 30 days (360 days, under Stripe's
 *  730-day trial limit even on top of a running hold of the same length). */
export const MAX_FREE_DAY_UNITS = 12;

export type GrantSource = "comp" | "referral_friend" | "referral_referrer" | "promo" | "day_bank";
/** An exact length (the days bank, lib/billing/day-bank.ts): 1 … 730 days. */
export const MAX_FREE_DAYS_EXACT = 730;
/** An admin's comp is banked days (owner 2026-11-06): at least two — the
 *  owner's floor for a comp ("any period length greater than 48 hours"), a
 *  product choice, not a Stripe limit (the bank goes to Stripe as
 *  `trial_period_days`, whose floor is one day; a 1-day REFERRAL entry
 *  checks out). Client-safe: the admin form reads it (lib/billing/day-bank.ts
 *  is server-only). */
export const MIN_ADMIN_BANK_DAYS = 2;
export type GrantAppliedAs = "overlay" | "subscription_hold" | "below_plan";

export type FreeDaysProfile = {
  subscription_status?: string | null;
  subscription_tier?: string | null;
  comp_tier?: string | null;
  comp_expires_at?: string | null;
  is_admin?: boolean | null;
};

export type FreeDaysSubscription = {
  id: string;
  status: string;
  /** A subscription schedule (a pending downgrade): Stripe refuses a
   *  direct update while one manages the subscription. */
  schedule?: string | { id: string } | null;
  trial_end?: number | null;
  cancel_at_period_end?: boolean | null;
  cancel_at?: number | null;
  current_period_end?: number | null;
  items?: { data?: Array<{ current_period_end?: number | null }> } | null;
  metadata?: Record<string, string> | null;
};

/** What the profile's overlay columns are set to. */
export type OverlayWrite = { comp_tier: PaidTier | null; comp_expires_at: string | null };

export type FreeDaysPlan =
  | {
      kind: "overlay";
      tier: PaidTier;
      /** Unix seconds. `endsAt` null = no end (staff). */
      startsAt: number;
      endsAt: number | null;
      overlay: OverlayWrite;
      why: "no_plan" | "plan_ending" | "delinquent" | "staff";
      /** `plan_ending`: when the cancelled plan stops (the days start then). */
      planEndsAt?: number;
    }
  | {
      kind: "hold";
      tier: PaidTier;
      startsAt: number;
      endsAt: number;
      subscriptionId: string;
      /** The `trial_end` to write: the base + the days. */
      trialEnd: number;
      /** The metadata value: the end before ANY hold (kept if already set). */
      beforeComp: string;
      overlay: OverlayWrite;
      was: "trialing" | "active";
    }
  | { kind: "below_plan"; tier: PaidTier; subscribedTier: PaidTier }
  | { kind: "refused"; error: string };

const LIVE = new Set(["trialing", "active"]);
const DUNNING = new Set(["past_due", "unpaid"]);

function sec(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

export function isoOf(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

export function utcOf(seconds: number): string {
  return formatUtcDateTime(isoOf(seconds));
}

function paidTier(value: unknown): PaidTier | null {
  return value === "plus" || value === "pro" ? value : null;
}

function higher(a: PaidTier | null, b: PaidTier): PaidTier {
  return a && TIER_RANK[a] > TIER_RANK[b] ? a : b;
}

/** The overlay in force now: its tier and its end (null = no end). */
export function activeOverlayOf(
  profile: FreeDaysProfile,
  nowSec: number,
): { tier: PaidTier; endSec: number | null } | null {
  const tier = paidTier(profile.comp_tier);
  if (!tier) return null;
  const endSec = sec(profile.comp_expires_at);
  if (profile.comp_expires_at && endSec == null) return null;
  if (endSec != null && endSec <= nowSec) return null;
  return { tier, endSec };
}

function periodEndOf(sub: FreeDaysSubscription): number | null {
  const item = sub.items?.data?.[0]?.current_period_end;
  if (typeof item === "number") return item;
  return typeof sub.current_period_end === "number" ? sub.current_period_end : null;
}

function isEnding(sub: FreeDaysSubscription): boolean {
  return Boolean(sub.cancel_at_period_end) || typeof sub.cancel_at === "number";
}

function storedBefore(sub: FreeDaysSubscription): number | null {
  const raw = sub.metadata?.[TRIAL_END_BEFORE_COMP_KEY];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

export const STAFF_NEEDS_NO_PLAN =
  "Open-ended (staff) access is for an account with no Stripe subscription. Give dated free days instead.";

/**
 * How `units` × 30 free days of `tier` apply to this user. `sub` is the
 * subscription the profile points at, read from Stripe NOW (null: none);
 * `subscribedTier` the tier it pays for (resolveSubscriptionTier).
 */
export function planFreeDays(input: {
  profile: FreeDaysProfile;
  sub: FreeDaysSubscription | null;
  subscribedTier: PlanTier | null;
  tier: PaidTier;
  /** 30-day units, 1 … MAX_FREE_DAY_UNITS; null = no end (staff) — unless
   *  `days` is given. */
  units: number | null;
  /** An EXACT length in days (the days bank) instead of units. */
  days?: number | null;
  /** The days bank's rule: only a hold on a live, renewing plan or free
   *  period — never a perks overlay (the days must end in a charge). */
  holdOnly?: boolean;
  now?: Date;
}): FreeDaysPlan {
  const { profile, sub, tier } = input;
  const days = input.days ?? null;
  const units = days != null ? null : input.units;
  const nowSec = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (profile.is_admin) {
    return { kind: "refused", error: "An admin account already has every perk and unlimited credits." };
  }
  if (days != null && (!Number.isInteger(days) || days < 1 || days > MAX_FREE_DAYS_EXACT)) {
    return { kind: "refused", error: `Free days run from 1 to ${MAX_FREE_DAYS_EXACT}.` };
  }
  if (days == null && units != null && (!Number.isInteger(units) || units < 1 || units > MAX_FREE_DAY_UNITS)) {
    return { kind: "refused", error: `Free days come in 30-day units, 1 to ${MAX_FREE_DAY_UNITS}.` };
  }
  const existing = activeOverlayOf(profile, nowSec);
  const live = sub != null && LIVE.has(sub.status);
  const dunning = sub != null && DUNNING.has(sub.status);

  if (input.holdOnly) {
    if (!live) {
      return {
        kind: "refused",
        error: dunning
          ? "Your plan's payment is still being retried — fix the card first, then apply your banked days."
          : "Banked days need a live plan: start a plan first, and they become its free period.",
      };
    }
    if (isEnding(sub)) {
      return { kind: "refused", error: "Your plan is set to end. Resume it first, then apply your banked days." };
    }
  }

  if (days == null && units == null) {
    if (live || dunning) return { kind: "refused", error: STAFF_NEEDS_NO_PLAN };
    if (existing && existing.endSec == null) {
      return { kind: "refused", error: "This account already has open-ended access." };
    }
    return {
      kind: "overlay",
      tier,
      startsAt: nowSec,
      endsAt: null,
      overlay: { comp_tier: higher(existing?.tier ?? null, tier), comp_expires_at: null },
      why: "staff",
    };
  }
  if (existing && existing.endSec == null) {
    return {
      kind: "refused",
      error: "This account has open-ended (staff) access, so dated free days would change nothing. Revoke it first.",
    };
  }
  const seconds = days != null ? days * 86_400 : (units as number) * FREE_DAYS_UNIT_SECONDS;
  const overlayTier = higher(existing?.tier ?? null, tier);
  const overlayFrom = (base: number) => {
    const startsAt = Math.max(nowSec, existing?.endSec ?? 0, base);
    const endsAt = startsAt + seconds;
    return { startsAt, endsAt, overlay: { comp_tier: overlayTier, comp_expires_at: isoOf(endsAt) } as OverlayWrite };
  };

  if (!live) {
    return { kind: "overlay", tier, ...overlayFrom(0), why: dunning ? "delinquent" : "no_plan" };
  }

  const subscribed = paidTier(input.subscribedTier) ?? paidTier(profile.subscription_tier);
  if (!subscribed) {
    return { kind: "refused", error: "Couldn't tell which plan their Stripe subscription pays for. Nothing was granted." };
  }
  if (TIER_RANK[tier] < TIER_RANK[subscribed]) return { kind: "below_plan", tier, subscribedTier: subscribed };

  if (isEnding(sub)) {
    const planEndsAt = typeof sub.cancel_at === "number" ? sub.cancel_at : (periodEndOf(sub) ?? nowSec);
    return { kind: "overlay", tier, ...overlayFrom(planEndsAt), why: "plan_ending", planEndsAt };
  }
  if (sub.schedule) {
    return {
      kind: "refused",
      error: "Their plan has a scheduled change (a pending downgrade). Release it first — \"Keep plan\" on their billing page — then give the free days.",
    };
  }

  const base = sub.status === "trialing" ? (typeof sub.trial_end === "number" ? sub.trial_end : null) : periodEndOf(sub);
  if (base == null) {
    return { kind: "refused", error: "Their Stripe subscription has no period end to add the days to. Nothing was granted." };
  }
  if (base < nowSec) {
    return { kind: "refused", error: "Their Stripe plan is renewing right now. Try again in a minute." };
  }
  const trialEnd = base + seconds;
  if (trialEnd - nowSec > MAX_TRIAL_SECONDS) {
    return {
      kind: "refused",
      error: `Stripe allows at most 730 days of free time ahead; this would run to ${utcOf(trialEnd)}. Give fewer units.`,
    };
  }
  const before = storedBefore(sub) ?? base;
  const overlayEnd = Math.max(trialEnd, existing?.endSec ?? 0);
  return {
    kind: "hold",
    tier,
    startsAt: base,
    endsAt: trialEnd,
    subscriptionId: sub.id,
    trialEnd,
    beforeComp: String(before),
    overlay: { comp_tier: overlayTier, comp_expires_at: isoOf(overlayEnd) },
    was: sub.status === "trialing" ? "trialing" : "active",
  };
}

/** What the grant did, in one line for the admin (UTC, labelled). */
export function freeDaysNote(plan: Exclude<FreeDaysPlan, { kind: "refused" }>, tierName: (t: PaidTier) => string): string {
  switch (plan.kind) {
    case "hold":
      return plan.was === "trialing"
        ? `Their Stripe trial now ends on ${utcOf(plan.trialEnd)} instead of ${utcOf(plan.startsAt)}; the first charge lands then.`
        : `Their Stripe plan's next charge moves from ${utcOf(plan.startsAt)} to ${utcOf(plan.trialEnd)} — the free days are added to the time they paid for.`;
    case "below_plan":
      return `${tierName(plan.tier)} is below the ${tierName(plan.subscribedTier)} they pay for: recorded, but it changes nothing and grants no credits.`;
    case "overlay":
      switch (plan.why) {
        case "staff":
          return `${tierName(plan.overlay.comp_tier ?? plan.tier)} with no end date (staff). No Stripe subscription is involved.`;
        case "plan_ending":
          return `Their plan is cancelled and ends on ${utcOf(plan.planEndsAt ?? plan.startsAt)}; the free days run from ${utcOf(plan.startsAt)} to ${utcOf(plan.endsAt as number)} as a perks overlay (nothing is charged).`;
        case "delinquent":
          return `Their Stripe plan is past due and keeps its own dates; the free days are a perks overlay until ${utcOf(plan.endsAt as number)}.`;
        default:
          return `${tierName(plan.overlay.comp_tier ?? plan.tier)} until ${utcOf(plan.endsAt as number)} (no Stripe subscription: a perks overlay).`;
      }
  }
}

// ---------------------------------------------------------------------------
// Revoking a grant.
// ---------------------------------------------------------------------------

export type PlanGrantFacts = {
  id: string;
  tier: PaidTier;
  units: number | null;
  /** An exact length (a days-bank application, 0179) — beside units. */
  days?: number | null;
  ends_at: string | null;
  status: string;
};

/** A grant's length in seconds: exact days, or 30-day units; null = no end. */
export function grantSecondsOf(grant: Pick<PlanGrantFacts, "units" | "days">): number | null {
  if (grant.days != null) return grant.days * 86_400;
  if (grant.units != null) return grant.units * FREE_DAYS_UNIT_SECONDS;
  return null;
}

/** The Stripe trial to move back: its new end ("now": it ends and charges
 *  at once) and the metadata value to write ("" once it is back on its own
 *  end). */
export type TrialMove = { subscriptionId: string; trialEnd: number | "now"; beforeComp: string };

export type RevokePlan =
  | {
      kind: "revoke";
      overlay: OverlayWrite;
      /** Null: no Stripe trial is held at this overlay's end. */
      trial: TrialMove | null;
    }
  | { kind: "refused"; error: string };

/** A trial is "held at" the overlay's end within this much (comp-ending.ts). */
const HELD_TOLERANCE_SECONDS = 60;

export function planRevoke(input: {
  grant: PlanGrantFacts;
  profile: FreeDaysProfile;
  sub: FreeDaysSubscription | null;
  /** The user's OTHER applied grants (newest first). */
  otherGrants: PlanGrantFacts[];
  now?: Date;
}): RevokePlan {
  const { grant, profile, sub } = input;
  const nowSec = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (grant.status !== "applied") return { kind: "refused", error: "Only an applied grant can be revoked." };

  const current = activeOverlayOf(profile, nowSec);
  const others = input.otherGrants.filter((g) => g.status === "applied" && (g.ends_at == null || (sec(g.ends_at) ?? 0) > nowSec));
  const othersTier = others.reduce<PaidTier | null>((best, g) => higher(best, g.tier), null);
  const othersEnd = others.some((g) => g.ends_at == null)
    ? null
    : others.reduce<number>((max, g) => Math.max(max, sec(g.ends_at) ?? 0), 0);

  let overlay: OverlayWrite;
  let trial: TrialMove | null = null;
  // The instant the grant's days end at: the overlay's end, else (the
  // overlay write failed, or was cleared by hand) the row's own.
  const anchorSec = current?.endSec ?? sec(grant.ends_at);
  const moveTrialBack = (seconds: number) => {
    // A Stripe trial held at that instant moves back with it.
    if (
      anchorSec != null &&
      sub &&
      sub.status === "trialing" &&
      typeof sub.trial_end === "number" &&
      Math.abs(sub.trial_end - anchorSec) <= HELD_TOLERANCE_SECONDS
    ) {
      const before = storedBefore(sub);
      if (before != null) {
        let target = sub.trial_end - seconds;
        let beforeComp = String(before);
        if (target <= before) {
          target = before;
          beforeComp = "";
        }
        trial = {
          subscriptionId: sub.id,
          trialEnd: target <= nowSec ? "now" : target,
          beforeComp: target <= nowSec ? "" : beforeComp,
        };
      }
    }
  };
  const grantSeconds = grantSecondsOf(grant);
  if (!current) {
    overlay = { comp_tier: paidTier(profile.comp_tier), comp_expires_at: profile.comp_expires_at ?? null };
    if (grantSeconds != null) moveTrialBack(grantSeconds);
  } else if (grantSeconds == null || current.endSec == null) {
    // An open-ended grant (or an overlay with no end, which only such a
    // grant makes): what the other live grants give, else nothing.
    overlay =
      othersTier && (othersEnd == null || othersEnd > nowSec)
        ? { comp_tier: othersTier, comp_expires_at: othersEnd == null ? null : isoOf(othersEnd) }
        : { comp_tier: null, comp_expires_at: null };
  } else {
    const seconds = grantSeconds;
    const newEnd = current.endSec - seconds;
    // The overlay stands for the grants: with no other live grant it goes
    // (a hold's overlay reached to the END of the paid period plus the
    // days — the paid plan carries its own perks until then).
    overlay =
      newEnd <= nowSec || othersTier == null
        ? { comp_tier: null, comp_expires_at: null }
        : { comp_tier: othersTier, comp_expires_at: isoOf(newEnd) };
    moveTrialBack(seconds);
  }
  return { kind: "revoke", overlay, trial };
}

export function revokeNote(plan: Extract<RevokePlan, { kind: "revoke" }>, tierName: (t: PaidTier) => string): string {
  const parts: string[] = [];
  if (plan.overlay.comp_tier == null) parts.push("Their complimentary access is cleared.");
  else if (plan.overlay.comp_expires_at == null) parts.push(`${tierName(plan.overlay.comp_tier)} stays open-ended (another grant).`);
  else parts.push(`Their complimentary ${tierName(plan.overlay.comp_tier)} now ends on ${formatUtcDateTime(plan.overlay.comp_expires_at)}.`);
  if (plan.trial) {
    parts.push(
      plan.trial.trialEnd === "now"
        ? "Their Stripe trial had already passed the end it had before the free days, so it ends now and is charged."
        : `Their Stripe trial is moved back to ${utcOf(plan.trial.trialEnd)}.`,
    );
  }
  return parts.join(" ");
}
