// The browser's read of the tab's first-touch attribution (what
// components/analytics/attribution-capture.tsx stored): the referral code a
// `?ref=` landing brought, if any. Client only; never throws.

import { ATTRIBUTION_STORAGE_KEY, sanitizeAttribution } from "@/lib/analytics/attribution";

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

export function storedReferralCode(): string | undefined {
  try {
    const raw = sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY);
    if (!raw) return undefined;
    return sanitizeAttribution(JSON.parse(raw) as Record<string, unknown>).ref;
  } catch {
    return undefined;
  }
}
