import { describe, expect, it } from "vitest";

import { refillActiveSubscribers, refillTierFor, type CreditGrantClient, type RefillProfileRow } from "@/lib/billing/credit-refill";
import { effectiveTierForProfile, referralPlusActive } from "@/lib/billing/entitlements";
import { referralEmailFingerprint, referralEmailHashKey } from "@/lib/referrals/email-fingerprint";

// ---------------------------------------------------------------------------
// A referral's free month (owner 2026-11-02) is a regular Plus month WITH a
// Plus user's AI credits — exactly ONE allotment, granted once by
// grant_referral_plus_month (0164), never a second refill because the month
// crosses a calendar-month boundary. It lives in its own column,
// profiles.referral_plus_until, which the monthly refill never reads.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-11-20T12:00:00Z");
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();

const referralOnly = {
  id: "00000000-0000-4000-8000-000000000001",
  subscription_tier: "free",
  subscription_status: null,
  comp_tier: null,
  comp_expires_at: null,
  is_admin: false,
  created_at: at(-3),
  referral_plus_until: at(25), // runs 20 Nov → 15 Dec: two calendar months
};

describe("the referral month's credits come once", () => {
  it("the monthly refill owes a referral-only Plus month nothing, in either calendar month it spans", () => {
    expect(refillTierFor(referralOnly as RefillProfileRow, "2026-11", NOW)).toBeNull();
    expect(refillTierFor(referralOnly as RefillProfileRow, "2026-12", new Date(Date.parse(at(15))))).toBeNull();
  });

  it("the refill sweep grants it nothing (it doesn't even read the column)", async () => {
    const selects: string[] = [];
    const rpcs: unknown[] = [];
    const admin = {
      from: () => ({
        select: (columns: string) => {
          selects.push(columns);
          return { order: () => ({ range: async () => ({ data: [referralOnly], error: null }) }) };
        },
      }),
      rpc: async (...args: unknown[]) => {
        rpcs.push(args);
        return { data: null, error: null };
      },
    } as unknown as CreditGrantClient;
    expect(await refillActiveSubscribers(admin, "2026-12")).toEqual({ ok: true, processed: 1, granted: 0, failed: 0 });
    expect(rpcs).toEqual([]);
    expect(selects.join()).not.toContain("referral_plus_until");
  });
});

describe("the referral month as a plan", () => {
  it("is Plus while it runs, and only ever ADDS", () => {
    // effectiveTierForProfile reads the clock: dates relative to the real now.
    const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();
    const base = { subscription_tier: "free", subscription_status: null, is_admin: false, comp_tier: null, comp_expires_at: null };
    expect(effectiveTierForProfile({ ...base, referral_plus_until: at(5) })).toBe("plus");
    expect(effectiveTierForProfile({ ...base, referral_plus_until: at(-1) })).toBe("free");
    expect(effectiveTierForProfile({ ...base, referral_plus_until: null })).toBe("free");
    // A higher comp or a live Pro plan is never lowered by it.
    expect(effectiveTierForProfile({ ...base, comp_tier: "pro", comp_expires_at: at(3), referral_plus_until: at(5) })).toBe("pro");
    expect(effectiveTierForProfile({ ...base, subscription_tier: "pro", subscription_status: "active", referral_plus_until: at(5) })).toBe("pro");
  });

  it("referralPlusActive reads the date only", () => {
    expect(referralPlusActive({ referral_plus_until: at(1) }, NOW)).toBe(true);
    expect(referralPlusActive({ referral_plus_until: at(-1) }, NOW)).toBe(false);
    expect(referralPlusActive({ referral_plus_until: "not a date" }, NOW)).toBe(false);
    expect(referralPlusActive({}, NOW)).toBe(false);
  });
});

describe("the email fingerprint (a keyed hash, never the address)", () => {
  /** A TEST-ONLY fixture key — the real one is a server secret, never in git. */
  const key = "test-only-fixture-key-not-a-secret-0123456789";

  it("no key, or a short one, is NO key (the caller fails closed)", () => {
    expect(referralEmailHashKey({} as NodeJS.ProcessEnv)).toBeNull();
    expect(referralEmailHashKey({ REFERRAL_EMAIL_HASH_KEY: "   " } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(referralEmailHashKey({ REFERRAL_EMAIL_HASH_KEY: "short-key" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(referralEmailHashKey({ REFERRAL_EMAIL_HASH_KEY: ` ${key} ` } as unknown as NodeJS.ProcessEnv)).toBe(key);
  });

  it("one inbox, one fingerprint: 64 hex characters, equal for every spelling of the address, keyed", () => {
    const a = referralEmailFingerprint("Jo.Smith+promo@GoogleMail.com", key);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(referralEmailFingerprint("josmith@gmail.com", key)).toBe(a);
    expect(referralEmailFingerprint("j.o.smith+x@gmail.com", key)).toBe(a);
    expect(referralEmailFingerprint("jo.smith@outlook.com", key)).not.toBe(a);
    // Another key, another fingerprint: it can't be matched without the secret.
    expect(referralEmailFingerprint("josmith@gmail.com", `${key}-other`)).not.toBe(a);
    expect(a).not.toContain("josmith");
  });

  it("an address that doesn't normalize has no fingerprint", () => {
    expect(referralEmailFingerprint(null, key)).toBeNull();
    expect(referralEmailFingerprint("no-at-sign", key)).toBeNull();
  });
});
