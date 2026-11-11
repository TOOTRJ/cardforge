import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The `signup` funnel row of an account made with Google or Discord
// (2026-11-10). Only the email form wrote one, so those accounts were in no
// "Signups" count, no source list and no signup → first card rate. They post
// no signup form; the first thing every account does is finish onboarding —
// so that is where the row is written, once, after the response, with how
// the account was made and the tab's first touch.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  user: null as null | { id: string; app_metadata?: Record<string, unknown> },
  /** What the profile update answers: a row = THIS call finished onboarding. */
  finished: [{ username: "ember_sphinx_4821", display_name: null }] as Array<Record<string, unknown>>,
  admin: true,
  afterTasks: [] as Array<() => Promise<void>>,
  signup: vi.fn<(admin: unknown, input: { userId: string; props: Record<string, unknown> }) => Promise<string>>(async () => "enriched"),
}));

vi.mock("next/server", () => ({ after: (task: () => Promise<void>) => void s.afterTasks.push(task) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => s.user,
  createClient: async () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const method of ["update", "eq", "is"]) chain[method] = () => chain;
      chain.select = async () => ({ data: s.finished, error: null });
      // email_preferences.update(...).eq(...) is awaited directly.
      chain.then = (resolve: (value: { error: null }) => void) => resolve({ error: null });
      return chain;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ marker: "admin" }), isAdminConfigured: () => s.admin }));
vi.mock("@/lib/analytics/funnel-server", () => ({ recordSignup: s.signup }));
vi.mock("@/lib/referrals/server", () => ({ recordReferralSignup: vi.fn() }));
vi.mock("@/lib/billing/day-bank", () => ({ ensureSignupBankEntry: vi.fn() }));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => false }));
vi.mock("@/lib/email/send", () => ({ isEmailConfigured: () => false, sendEmail: vi.fn() }));
vi.mock("@/lib/email/preferences", () => ({ getRecipientFor: vi.fn() }));
vi.mock("@/lib/email/messages", () => ({ welcomeEmail: vi.fn() }));

import { completeOnboardingAction } from "@/lib/onboarding/actions";

const runDeferred = async () => {
  for (const task of s.afterTasks.splice(0)) await task();
};

beforeEach(() => {
  s.user = { id: "user-1", app_metadata: { provider: "google" } };
  s.finished = [{ username: "ember_sphinx_4821", display_name: null }];
  s.admin = true;
  s.afterTasks = [];
  s.signup.mockClear();
});

describe("completeOnboardingAction — the signup funnel row", () => {
  it("writes it AFTER the response: how the account was made, and the tab's first touch", async () => {
    const result = await completeOnboardingAction({
      attribution: { referrer: "reddit.com", utmSource: "newsletter", surface: "home_hero" },
    });
    expect(result).toEqual({ ok: true });
    // Nothing during the request…
    expect(s.signup).not.toHaveBeenCalled();
    await runDeferred();
    // …then once, for this account.
    expect(s.signup).toHaveBeenCalledTimes(1);
    expect(s.signup.mock.calls[0][1]).toEqual({
      userId: "user-1",
      props: { referrer: "reddit.com", utmSource: "newsletter", surface: "home_hero", method: "google" },
    });
  });

  it.each([
    ["discord", "discord"],
    ["email", "email"],
    [undefined, "email"],
    ["github", "other"],
  ])("names the method from the account's provider (%s → %s)", async (provider, method) => {
    s.user = { id: "user-1", app_metadata: provider ? { provider } : {} };
    await completeOnboardingAction({});
    await runDeferred();
    expect(s.signup.mock.calls[0][1].props).toEqual({ method });
  });

  it("the referral code never becomes a funnel prop — only that the account was referred, as the email form's row says it", async () => {
    // What the wizard really posts: the code by itself (storedReferralCode), the first touch without it.
    await completeOnboardingAction({ referralCode: "abcd2345", attribution: { referrer: "x.com" } });
    await runDeferred();
    expect(s.signup.mock.calls[0][1].props).toEqual({ referrer: "x.com", referred: true, method: "google" });

    // The code the signup put on the account's metadata counts the same.
    s.signup.mockClear();
    s.user = { id: "user-1", app_metadata: { provider: "google", referral_code: "abcd2345" } };
    await completeOnboardingAction({});
    await runDeferred();
    expect(s.signup.mock.calls[0][1].props).toEqual({ referred: true, method: "google" });

    // No code: no `referred`, and a code smuggled into the attribution blob is not one.
    s.signup.mockClear();
    s.user = { id: "user-1", app_metadata: { provider: "google" } };
    await completeOnboardingAction({ attribution: { ref: "abcd2345", referrer: "x.com" } });
    await runDeferred();
    expect(s.signup.mock.calls[0][1].props).toEqual({ referrer: "x.com", method: "google" });
  });

  it("drops what is not attribution: an unknown key, an unsafe value", async () => {
    await completeOnboardingAction({ attribution: { email: "a@b.c", referrer: "<script>", utmMedium: "social" } });
    await runDeferred();
    expect(s.signup.mock.calls[0][1].props).toEqual({ utmMedium: "social", method: "google" });
  });

  it("only the call that FINISHED onboarding writes it (a second tab, a double submit: nothing)", async () => {
    s.finished = [];
    expect(await completeOnboardingAction({})).toEqual({ ok: true });
    await runDeferred();
    expect(s.signup).not.toHaveBeenCalled();
  });

  it("a signed-out caller and a deployment with no service role record nothing", async () => {
    s.user = null;
    expect(await completeOnboardingAction({})).toEqual({ ok: false, error: "You're not signed in." });
    s.user = { id: "user-1", app_metadata: { provider: "google" } };
    s.admin = false;
    await completeOnboardingAction({});
    await runDeferred();
    expect(s.signup).not.toHaveBeenCalled();
  });

  it("a failed funnel write never fails onboarding", async () => {
    s.signup.mockRejectedValueOnce(new Error("database is away"));
    expect(await completeOnboardingAction({})).toEqual({ ok: true });
    await expect(runDeferred()).resolves.toBeUndefined();
  });

  it("an attribution blob in the wrong shape never refuses onboarding: it is dropped, the method still recorded", async () => {
    for (const attribution of [{ referrer: "<b>".repeat(80) }, { referrer: 7, utmSource: null }, "nope", ["a"]]) {
      s.signup.mockClear();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(await completeOnboardingAction({ attribution: attribution as any })).toEqual({ ok: true });
      await runDeferred();
      expect(s.signup.mock.calls[0][1].props).toEqual({ method: "google" });
    }
    // An over-long value is cut to the sanitizer's length, as on the signup form.
    s.signup.mockClear();
    expect(await completeOnboardingAction({ attribution: { referrer: "x".repeat(200) } })).toEqual({ ok: true });
    await runDeferred();
    expect(s.signup.mock.calls[0][1].props).toEqual({ referrer: "x".repeat(48), method: "google" });
  });
});
