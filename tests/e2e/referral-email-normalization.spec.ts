import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// One email, one referral month (owner 2026-11-02): the app's
// normalizeReferralEmail (lib/referrals/fraud.ts) and its SQL twin
// normalize_referral_email (the referrals migration) must answer every case
// of ONE table, tests/unit/referrals/email-normalization-cases.json — the
// unit test holds the TypeScript side, this spec the database's. The SQL
// function is the service role's alone (a user is refused). Needs the local
// stack (tests/README.md); CI boots one with every migration applied.
// ---------------------------------------------------------------------------

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? "";
const hasStack = Boolean(url && publishableKey && serviceKey) && /127\.0\.0\.1|localhost/.test(url);

const cases = JSON.parse(
  readFileSync(join(process.cwd(), "tests/unit/referrals/email-normalization-cases.json"), "utf8"),
) as Array<[string | null, string | null]>;

test.describe("referral email normalization (SQL twin)", () => {
  test.skip(!hasStack, "Needs the local Supabase stack (.env.e2e).");

  test("normalize_referral_email answers the shared case table", async () => {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    for (const [input, expected] of cases) {
      const { data, error } = await admin.rpc("normalize_referral_email", { p_email: input as string });
      expect(error, JSON.stringify(input)).toBeNull();
      expect(data, JSON.stringify(input)).toBe(expected);
    }
  });

  test("a user can't call it (nor the live-account check)", async () => {
    const anon = createClient(url, publishableKey, { auth: { persistSession: false } });
    const normalize = await anon.rpc("normalize_referral_email", { p_email: "a@b.c" });
    expect(normalize.error).not.toBeNull();
    const inUse = await anon.rpc("referral_email_in_use", {
      p_user_id: "99999999-9999-4999-8999-999999999999",
      p_normalized: "a@b.c",
    });
    expect(inUse.error).not.toBeNull();
  });
});
