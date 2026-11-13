// The browser's read of the first-touch attribution (what
// components/analytics/attribution-capture.tsx stored): the referral code a
// `?ref=` landing brought, if any. Client only; never throws.

import {
  ATTRIBUTION_STORAGE_KEY,
  REFERRAL_CODE_STORAGE_KEY,
  keptReferralCode,
  referralCodeToKeep,
  sanitizeAttribution,
} from "@/lib/analytics/attribution";
import { REFERRAL_PARAM, normalizeReferralCode } from "@/lib/referrals/rules";

/** The tab's first-touch attribution without its referral code (that one
 *  travels by itself — storedReferralCode): what an account made with
 *  Google or Discord posts at onboarding, since it never saw the signup
 *  form's hidden fields. Empty when the tab holds none. */
export function storedAttribution(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY);
    if (!raw) return {};
    const { ref: _ref, ...rest } = sanitizeAttribution(JSON.parse(raw) as Record<string, unknown>);
    void _ref;
    return rest;
  } catch {
    return {};
  }
}

function tabCode(): string | undefined {
  try {
    const raw = sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY);
    return raw ? sanitizeAttribution(JSON.parse(raw) as Record<string, unknown>).ref : undefined;
  } catch {
    return undefined;
  }
}

/** The code on THIS page's address. The capture stores it in an effect of
 *  the root layout, which runs AFTER the effects of the page inside it — so
 *  a sign-up form opened straight at `/signup?ref=…` asked the tab too early
 *  and posted no code. Reading the address closes that. */
function addressCode(): string | undefined {
  try {
    return normalizeReferralCode(new URLSearchParams(window.location.search).get(REFERRAL_PARAM)) ?? undefined;
  } catch {
    return undefined;
  }
}

function browserCode(): string | undefined {
  try {
    return keptReferralCode(localStorage.getItem(REFERRAL_CODE_STORAGE_KEY), Date.now());
  } catch {
    return undefined;
  }
}

/**
 * The referral code this visitor arrived with: the tab's own first (the
 * first link a tab saw wins there), then the address being looked at, then
 * the one the browser kept from an earlier visit (30 days). Undefined when
 * there is none.
 */
export function storedReferralCode(): string | undefined {
  return tabCode() ?? addressCode() ?? browserCode();
}

/**
 * Where the code came from. "link" = this visit followed a friend's link
 * (the tab holds it, or it is on the address); "kept" = only the browser's
 * copy from an EARLIER visit — up to 30 days old, and possibly not the
 * friend this person has in mind, so the onboarding field stays open for a
 * code they type; null = none.
 */
export function referralCodeSource(): "link" | "kept" | null {
  if (tabCode() ?? addressCode()) return "link";
  return browserCode() ? "kept" : null;
}

/** Keep `code` in the browser past the tab — only where none is kept yet
 *  (the first link wins, as in the tab; an expired one is replaced). */
export function keepReferralCode(code: string, now: number = Date.now()): void {
  try {
    if (keptReferralCode(localStorage.getItem(REFERRAL_CODE_STORAGE_KEY), now)) return;
    localStorage.setItem(REFERRAL_CODE_STORAGE_KEY, referralCodeToKeep(code, now));
  } catch {
    // Storage unavailable (private mode, blocked): the tab's copy is all there is.
  }
}

/** Forget the kept code: the account it was for has been made, and the
 *  next person to sign up on this browser did not follow that link. */
export function forgetReferralCode(): void {
  try {
    localStorage.removeItem(REFERRAL_CODE_STORAGE_KEY);
  } catch {
    // Nothing to forget.
  }
}
