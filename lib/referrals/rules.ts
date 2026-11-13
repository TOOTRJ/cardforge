// ---------------------------------------------------------------------------
// The referral program's rules (2026-10-30; research and numbers:
// docs/research/conversion-2026-10.md §8, the rules in docs/BILLING.md
// "Referrals"). Client-safe: the dashboard and the server read the same
// numbers. The database's claim_referral_reward() takes the caps as
// arguments — the live values are the settings row's
// (lib/referrals/settings.ts); the constants here are its defaults.
// ---------------------------------------------------------------------------

/** Both emails must be confirmed before either side is rewarded (owner
 *  2026-11-02). A first card whose emails are still unconfirmed this many
 *  days later expires. There is NO hold after the friend qualifies (owner
 *  2026-11-02: the 72-hour hold was dropped — rewards land at once). */
export const REFERRAL_CONFIRM_WINDOW_DAYS = 30;
/** A side whose grant failed is retried by the sweep this many times, then
 *  recorded as "none" (reason grant_failed) for an admin to look at. */
export const REFERRAL_GRANT_MAX_ATTEMPTS = 5;
/** Rows the retry sweep reads per run, per kind. */
export const REFERRAL_SWEEP_BATCH = 100;
/** DEFAULT activation window (the settings' `activation.windowDays` is the
 *  live value): the friend's cards must be saved within this many days of
 *  the signup. */
export const REFERRAL_ACTIVATION_WINDOW_DAYS = 30;
/** DEFAULT cards a friend must save (the settings' `activation.cardsRequired`). */
export const REFERRAL_ACTIVATION_CARDS = 5;
/** A referral can be claimed for an account this young that never started a
 *  plan — at onboarding (the link the tab arrived with) or typed in later
 *  on the Refer a friend page (owner 2026-11-11: code entry for NEW
 *  accounts only; it recovers a link the browser lost). Past it the account
 *  is not new: nobody brought it in. */
export const REFERRAL_CLAIM_WINDOW_DAYS = 14;

/** my_referral_code(): 8 lowercase hex characters (0177). */
export const REFERRAL_CODE_RE = /^[a-f0-9]{8}$/;

/** The query parameter a referral link carries (`/?ref=<code>`). */
export const REFERRAL_PARAM = "ref";

export function normalizeReferralCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toLowerCase();
  return REFERRAL_CODE_RE.test(code) ? code : null;
}

/**
 * A code as a person TYPES or pastes it: the code alone, or any link that
 * carries it (`…/?ref=<code>`, with or without the scheme). Null when
 * nothing in it reads as a code.
 */
export function extractReferralCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const typed = value.trim();
  if (!typed) return null;
  const plain = normalizeReferralCode(typed);
  if (plain) return plain;
  const carried = new RegExp(`[?&]${REFERRAL_PARAM}=([^&#\\s]+)`, "i").exec(typed)?.[1];
  if (!carried) return null;
  try {
    return normalizeReferralCode(decodeURIComponent(carried));
  } catch {
    return null;
  }
}

/**
 * `search` for a redirect that would otherwise DROP the query: empty, or
 * `?ref=<code>` when the address being left carried a referral code. A
 * friend's link that lands on an address we redirect (an old card address,
 * a renamed deck, a retired page, a page that needs a sign-in) must still
 * arrive with its code. Only the code is carried — never the rest of the
 * query.
 */
export function referralSearch(params: { get(name: string): string | null } | Record<string, unknown> | null | undefined): string {
  if (!params) return "";
  const raw = typeof (params as { get?: unknown }).get === "function"
    ? (params as { get(name: string): string | null }).get(REFERRAL_PARAM)
    : (params as Record<string, unknown>)[REFERRAL_PARAM];
  const code = normalizeReferralCode(Array.isArray(raw) ? raw[0] : raw);
  return code ? `?${REFERRAL_PARAM}=${code}` : "";
}

/** The link a user shares: the home page, which explains the product. */
export function referralLink(baseUrl: string, code: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/?${REFERRAL_PARAM}=${code}`;
}

/** `first_card` is 0177's name for the qualified-not-claimed state; 0180
 *  writes `cards_saved` (the friend saved the required cards) — both read
 *  the same way. */
export type ReferralStatus = "signed_up" | "first_card" | "cards_saved" | "rewarded" | "capped" | "blocked" | "expired";

/** What the referrer's dashboard says about each friend. Never a fraud
 *  reason: a blocked referral reads "Not eligible". */
export const REFERRAL_STATUS_LABELS: Record<ReferralStatus, string> = {
  signed_up: "Signed up",
  first_card: "Cards saved",
  cards_saved: "Cards saved",
  rewarded: "Rewarded",
  capped: "Limit reached",
  blocked: "Not eligible",
  expired: "Expired",
};

export function isReferralStatus(value: unknown): value is ReferralStatus {
  return typeof value === "string" && value in REFERRAL_STATUS_LABELS;
}
