// The browser's read of the tab's first-touch attribution (what
// components/analytics/attribution-capture.tsx stored): the referral code a
// `?ref=` landing brought, if any. Client only; never throws.

import { ATTRIBUTION_STORAGE_KEY, sanitizeAttribution } from "@/lib/analytics/attribution";

export function storedReferralCode(): string | undefined {
  try {
    const raw = sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY);
    if (!raw) return undefined;
    return sanitizeAttribution(JSON.parse(raw) as Record<string, unknown>).ref;
  } catch {
    return undefined;
  }
}
