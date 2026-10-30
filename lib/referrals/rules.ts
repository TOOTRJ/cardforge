// ---------------------------------------------------------------------------
// The referral program's rules (2026-10-30; research and numbers:
// docs/research/conversion-2026-10.md §8, the rules in docs/BILLING.md
// "Referrals"). Client-safe: the dashboard and the server read the same
// numbers. The database's claim_referral_reward() takes the caps as
// arguments — these constants are the one source.
// ---------------------------------------------------------------------------

/** Rewarded referrals a referrer can earn a month for, per UTC calendar
 *  month. Past it the referral is "capped": the friend still gets theirs. */
export const REFERRAL_MONTHLY_CAP = 3;
/** Months a referrer can ever earn (a year free). */
export const REFERRAL_LIFETIME_CAP = 12;
/** "One free month" as a comp: days added to a comp's end. */
export const REFERRAL_MONTH_DAYS = 30;
/** The first card must come within this many days of the signup. */
export const REFERRAL_ACTIVATION_WINDOW_DAYS = 30;
/** A referral claimed after signup (the Google sign-in path claims it at
 *  onboarding) counts only for an account this young with no saved card. */
export const REFERRAL_CLAIM_WINDOW_DAYS = 7;

/** my_referral_code(): 8 lowercase hex characters (0153). */
export const REFERRAL_CODE_RE = /^[a-f0-9]{8}$/;

/** The query parameter a referral link carries (`/?ref=<code>`). */
export const REFERRAL_PARAM = "ref";

export function normalizeReferralCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toLowerCase();
  return REFERRAL_CODE_RE.test(code) ? code : null;
}

/** The link a user shares: the home page, which explains the product. */
export function referralLink(baseUrl: string, code: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/?${REFERRAL_PARAM}=${code}`;
}

export type ReferralStatus = "signed_up" | "first_card" | "rewarded" | "capped" | "blocked" | "expired";

/** What the referrer's dashboard says about each friend. Never a fraud
 *  reason: a blocked referral reads "Not eligible". */
export const REFERRAL_STATUS_LABELS: Record<ReferralStatus, string> = {
  signed_up: "Signed up",
  first_card: "First card saved",
  rewarded: "Rewarded",
  capped: "Monthly limit reached",
  blocked: "Not eligible",
  expired: "Expired",
};

export function isReferralStatus(value: unknown): value is ReferralStatus {
  return typeof value === "string" && value in REFERRAL_STATUS_LABELS;
}
