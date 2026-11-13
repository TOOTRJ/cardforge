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
  /** recordReferralSignup: what the claim of the account's referral answers. */
  claim: vi.fn<(admin: unknown, input: { refereeId: string; code: unknown }) => Promise<ClaimAnswer>>(async () => ({ ok: true, referralId: "ref-1" })),
  /** hitKeyedLimit: the code-entry limit the claim is counted against. */
  limit: vi.fn<(input: Record<string, unknown>) => Promise<LimitAnswer>>(async () => ({ ok: true })),
  /** The limit and the claim, in the order they were asked. */
  order: [] as string[],
  /** How often the profile's `onboarded_at` write was made: the account FINISHED. */
  finishes: 0,
}));
type ClaimAnswer = { ok: true; referralId: string } | { ok: false; reason: string };
type LimitAnswer = { ok: true } | { ok: false; retryAfterSeconds: number; message: string };

vi.mock("next/server", () => ({ after: (task: () => Promise<void>) => void s.afterTasks.push(task) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => s.user,
  createClient: async () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const method of ["update", "eq", "is"]) chain[method] = () => chain;
      chain.select = async () => {
        s.finishes += 1;
        return { data: s.finished, error: null };
      };
      // email_preferences.update(...).eq(...) is awaited directly.
      chain.then = (resolve: (value: { error: null }) => void) => resolve({ error: null });
      return chain;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ marker: "admin" }), isAdminConfigured: () => s.admin }));
vi.mock("@/lib/analytics/funnel-server", () => ({ recordSignup: s.signup }));
vi.mock("@/lib/referrals/server", () => ({ recordReferralSignup: s.claim }));
vi.mock("@/lib/api/keyed-limit", () => ({ hitKeyedLimit: s.limit }));
vi.mock("@/lib/billing/day-bank", () => ({ ensureSignupBankEntry: vi.fn() }));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => false }));
vi.mock("@/lib/email/send", () => ({ isEmailConfigured: () => false, sendEmail: vi.fn() }));
vi.mock("@/lib/email/preferences", () => ({ getRecipientFor: vi.fn() }));
vi.mock("@/lib/email/messages", () => ({ welcomeEmail: vi.fn() }));

import { completeOnboardingAction } from "@/lib/onboarding/actions";
import {
  REFERRAL_CODE_NOT_SAVED,
  REFERRAL_CODE_TOO_MANY_TRIES,
  REFERRAL_CODE_UNREADABLE,
  onboardingCodeError,
  onboardingReferralNote,
} from "@/lib/referrals/claim-messages";

const runDeferred = async () => {
  for (const task of s.afterTasks.splice(0)) await task();
};

beforeEach(() => {
  s.user = { id: "user-1", app_metadata: { provider: "google" } };
  s.finished = [{ username: "ember_sphinx_4821", display_name: null }];
  s.admin = true;
  s.afterTasks = [];
  s.signup.mockClear();
  s.order = [];
  s.finishes = 0;
  s.claim.mockReset().mockImplementation(async () => {
    s.order.push("claim");
    return { ok: true, referralId: "ref-1" };
  });
  s.limit.mockReset().mockImplementation(async () => {
    s.order.push("limit");
    return { ok: true };
  });
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

// ---------------------------------------------------------------------------
// The referral the account arrived with is claimed HERE (the first step with
// a confirmed email) and nowhere else. A claim that failed on a READ
// (`reason: "error"`) is tried exactly ONCE more (owner 2026-11-11: nothing
// else retries it, and a friend's link lost here is lost for good); every
// other answer is final. Onboarding goes on whatever the claim says.
//
// Since the code can be TYPED at onboarding (owner 2026-11-11, "Have a
// referral code?"), a code that was sent and not taken is said — only where
// retyping it could help: a value that is no code, a code nobody has, the
// account's own (`referralNote` on the success). Every other refusal (the
// account is not new, it already has a referral, the program is off, the
// friend joined through this account) and a claim that failed twice say
// nothing: the result is exactly `{ ok: true }`, with no `referralNote` key.
//
// WHICH code is claimed: the one the person typed on this step
// (`typedReferralCode` — their own word for who brought them), else the one
// the signup put on the account (app_metadata), else the link the browser
// remembered (`referralCode` — possibly weeks old and somebody else's).
//
// The claim is COUNTED against the Refer a friend page's limit (this action
// can be called again after onboarding, and its answer says whether a code
// exists): one hit per finish that carries a code — `referral-code-entry`,
// per user, 5 a minute, 20 an hour. Past it the code is not looked at: no
// claim, no note, and onboarding completes all the same.
// ---------------------------------------------------------------------------
describe("completeOnboardingAction — the referral claim", () => {
  const CODE = "abcd2345";
  const claimCalls = () => s.claim.mock.calls.map((call) => call[1]);

  it("claims once, with the service role, for this account and the tab's code", async () => {
    expect(await completeOnboardingAction({ referralCode: CODE })).toEqual({ ok: true });
    expect(s.claim.mock.calls).toEqual([[{ marker: "admin" }, { refereeId: "user-1", code: CODE }]]);
  });

  it("the code the signup put on the account (app_metadata, the server's) wins over the tab's", async () => {
    s.user = { id: "user-1", app_metadata: { provider: "email", referral_code: "0000aaaa" } };
    await completeOnboardingAction({ referralCode: CODE });
    expect(claimCalls()).toEqual([{ refereeId: "user-1", code: "0000aaaa" }]);
    // A malformed value on the account is no code: the tab's is used.
    s.claim.mockClear();
    s.user = { id: "user-1", app_metadata: { provider: "email", referral_code: "not-a-code" } };
    await completeOnboardingAction({ referralCode: CODE });
    expect(claimCalls()).toEqual([{ refereeId: "user-1", code: CODE }]);
  });

  it("a claim that FAILED (error) is tried once more — error then ok: two calls, the same claim", async () => {
    s.claim.mockReset().mockResolvedValueOnce({ ok: false, reason: "error" }).mockResolvedValue({ ok: true, referralId: "ref-1" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await completeOnboardingAction({ referralCode: CODE })).toEqual({ ok: true });
    expect(s.claim.mock.calls).toEqual([
      [{ marker: "admin" }, { refereeId: "user-1", code: CODE }],
      [{ marker: "admin" }, { refereeId: "user-1", code: CODE }],
    ]);
    // The second try landed: nothing to report.
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("error twice: exactly two calls — never a third — it is logged, and onboarding still completes (funnel row included)", async () => {
    s.claim.mockReset().mockResolvedValue({ ok: false, reason: "error" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await completeOnboardingAction({ referralCode: CODE })).toEqual({ ok: true });
    expect(s.claim).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);
    // The log names the account, never the code.
    expect(String(error.mock.calls[0][0])).toContain("user-1");
    expect(JSON.stringify(error.mock.calls)).not.toContain(CODE);
    error.mockRestore();
    await runDeferred();
    expect(s.signup).toHaveBeenCalledTimes(1);
    expect(s.signup.mock.calls[0][1].props).toEqual({ referred: true, method: "google" });
  });

  it.each(["exists", "not_new", "program_off", "reciprocal"])(
    "a final answer (%s) is not retried: one call, onboarding completes with NO note — exactly { ok: true }",
    async (reason) => {
      s.claim.mockReset().mockResolvedValue({ ok: false, reason });
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await completeOnboardingAction({ referralCode: CODE });
      expect(result).toEqual({ ok: true });
      // Not even an empty key: the wizard toasts whatever the key holds.
      expect(Object.keys(result)).toEqual(["ok"]);
      expect(s.claim).toHaveBeenCalledTimes(1);
      expect(error).not.toHaveBeenCalled();
      error.mockRestore();
    },
  );

  it.each([
    ["self", "That is your own code. Enter the code of the friend who told you about PipGlyph."],
    ["unknown_code", "Nobody has that referral code. Check it with your friend and try again."],
    ["bad_code", REFERRAL_CODE_UNREADABLE],
  ] as const)(
    "a final answer (%s) is not retried: one call, onboarding COMPLETES and carries the note — the claim's own sentence",
    async (reason, sentence) => {
      s.claim.mockReset().mockResolvedValue({ ok: false, reason });
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await completeOnboardingAction({ referralCode: CODE });
      // Still a success: a referral never blocks an account.
      expect(result).toEqual({ ok: true, referralNote: sentence });
      expect(onboardingReferralNote(reason)).toBe(sentence);
      expect(s.claim).toHaveBeenCalledTimes(1);
      expect(error).not.toHaveBeenCalled();
      error.mockRestore();
      // …and the funnel row is written all the same.
      await runDeferred();
      expect(s.signup).toHaveBeenCalledTimes(1);
    },
  );

  it("the note is the FINAL answer's: error then unknown_code carries the note; error then ok, error twice and a clean claim carry none", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    s.claim.mockReset().mockResolvedValueOnce({ ok: false, reason: "error" }).mockResolvedValue({ ok: false, reason: "unknown_code" });
    expect(await completeOnboardingAction({ referralCode: CODE })).toEqual({
      ok: true,
      referralNote: "Nobody has that referral code. Check it with your friend and try again.",
    });
    expect(s.claim).toHaveBeenCalledTimes(2);

    // A first answer that was final is never replaced by a second try.
    s.claim.mockReset().mockResolvedValueOnce({ ok: false, reason: "self" }).mockResolvedValue({ ok: true, referralId: "ref-1" });
    expect(await completeOnboardingAction({ referralCode: CODE })).toMatchObject({ ok: true, referralNote: expect.stringContaining("your own code") });
    expect(s.claim).toHaveBeenCalledTimes(1);

    for (const answers of [
      [{ ok: false, reason: "error" }, { ok: true, referralId: "ref-1" }],
      [{ ok: false, reason: "error" }, { ok: false, reason: "error" }],
      [{ ok: true, referralId: "ref-1" }],
    ] as ClaimAnswer[][]) {
      s.claim.mockReset();
      for (const answer of answers) s.claim.mockResolvedValueOnce(answer);
      const result = await completeOnboardingAction({ referralCode: CODE });
      expect(result).toEqual({ ok: true });
      expect("referralNote" in result).toBe(false);
      expect(s.claim).toHaveBeenCalledTimes(answers.length);
    }
    error.mockRestore();
  });

  it("a code the person TYPED wins: over the code the signup put on the account, and over the link the browser remembered", async () => {
    const TYPED = "dddd4444";
    // Over the tab's / the kept link's.
    expect(await completeOnboardingAction({ referralCode: CODE, typedReferralCode: TYPED })).toEqual({ ok: true });
    expect(claimCalls()).toEqual([{ refereeId: "user-1", code: TYPED }]);
    // Over the account's own metadata code.
    s.claim.mockClear();
    s.user = { id: "user-1", app_metadata: { provider: "email", referral_code: "0000aaaa" } };
    await completeOnboardingAction({ typedReferralCode: TYPED });
    expect(claimCalls()).toEqual([{ refereeId: "user-1", code: TYPED }]);
    // Over both at once.
    s.claim.mockClear();
    await completeOnboardingAction({ referralCode: CODE, typedReferralCode: TYPED });
    expect(claimCalls()).toEqual([{ refereeId: "user-1", code: TYPED }]);
    // Typed alone: it is the claim.
    s.claim.mockClear();
    s.user = { id: "user-1", app_metadata: { provider: "google" } };
    await completeOnboardingAction({ typedReferralCode: TYPED });
    expect(claimCalls()).toEqual([{ refereeId: "user-1", code: TYPED }]);
    // One claim each time — never the typed code AND the link's.
    expect(s.claim).toHaveBeenCalledTimes(1);
  });

  it("the typed code is claimed in its own shape (capitals are the same code); a typed value that is NO code is nobody's word — the account's or the link's code stands", async () => {
    await completeOnboardingAction({ typedReferralCode: " DDDD4444 " });
    expect(claimCalls()).toEqual([{ refereeId: "user-1", code: "dddd4444" }]);
    for (const typed of ["nope", "", "dddd444", "zzzzzzzz", "<script>"]) {
      s.claim.mockClear();
      s.user = { id: "user-1", app_metadata: { provider: "google" } };
      await completeOnboardingAction({ referralCode: CODE, typedReferralCode: typed });
      expect(claimCalls(), typed).toEqual([{ refereeId: "user-1", code: CODE }]);
      s.claim.mockClear();
      s.user = { id: "user-1", app_metadata: { provider: "email", referral_code: "0000aaaa" } };
      await completeOnboardingAction({ referralCode: CODE, typedReferralCode: typed });
      expect(claimCalls(), typed).toEqual([{ refereeId: "user-1", code: "0000aaaa" }]);
    }
    // …and with nothing else to claim, a junk typed value claims nothing.
    s.claim.mockClear();
    s.limit.mockClear();
    s.user = { id: "user-1", app_metadata: { provider: "google" } };
    expect(await completeOnboardingAction({ typedReferralCode: "nope" })).toEqual({ ok: true });
    expect(s.claim).not.toHaveBeenCalled();
    expect(s.limit).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown_code", "Nobody has that referral code. Check it with your friend and try again."],
    ["self", "That is your own code. Enter the code of the friend who told you about PipGlyph."],
  ] as const)(
    "a TYPED code nobody can be credited for (%s) STOPS the step with the claim's own words — nothing is finished, and the link is never claimed in its place",
    async (reason, sentence) => {
      s.claim.mockReset().mockResolvedValue({ ok: false, reason });
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      for (const [input, metadata] of [
        // No link behind it.
        [{ typedReferralCode: "dddd4444" }, {}],
        // The link the browser remembered.
        [{ referralCode: CODE, typedReferralCode: "dddd4444" }, {}],
        // The code the signup put on the account.
        [{ typedReferralCode: "dddd4444" }, { referral_code: "0000aaaa" }],
        // "Finish" (preferences sent) is stopped the same way as "Skip" (the three above).
        [{ referralCode: CODE, typedReferralCode: "dddd4444", preferences: { account: true, activity: true, newsletter: false } }, { referral_code: "0000aaaa" }],
      ] as const) {
        s.claim.mockClear();
        s.finishes = 0;
        s.user = { id: "user-1", app_metadata: { provider: "email", ...metadata } };
        const result = await completeOnboardingAction(input);
        expect(result).toEqual({ ok: false, error: `${sentence} You can also clear the field and finish without a code.`, referralCodeRefused: true });
        expect(result).toEqual({ ok: false, error: onboardingCodeError(sentence), referralCodeRefused: true });
        // ONE claim, the typed code's: an account has one referral for good,
        // so a typo is never answered by crediting somebody else.
        expect(claimCalls()).toEqual([{ refereeId: "user-1", code: "dddd4444" }]);
        // The account is NOT finished: no onboarded_at, no funnel row.
        expect(s.finishes).toBe(0);
        await runDeferred();
        expect(s.signup).not.toHaveBeenCalled();
      }
      expect(error).not.toHaveBeenCalled();
      error.mockRestore();
    },
  );

  it("the field emptied after that: the next finish claims the link the account arrived with, and the account is finished", async () => {
    s.claim.mockReset().mockResolvedValueOnce({ ok: false, reason: "unknown_code" }).mockResolvedValue({ ok: true, referralId: "ref-1" });
    expect(await completeOnboardingAction({ referralCode: CODE, typedReferralCode: "dddd4444" })).toMatchObject({ ok: false, referralCodeRefused: true });
    expect(s.finishes).toBe(0);
    expect(await completeOnboardingAction({ referralCode: CODE })).toEqual({ ok: true });
    expect(claimCalls()).toEqual([
      { refereeId: "user-1", code: "dddd4444" },
      { refereeId: "user-1", code: CODE },
    ]);
    expect(s.finishes).toBe(1);
  });

  it("the same refusals of a LINK (nothing typed) never stop anything: the account is finished and the note is a toast's", async () => {
    for (const reason of ["unknown_code", "self", "bad_code"] as const) {
      s.claim.mockReset().mockResolvedValue({ ok: false, reason });
      s.finishes = 0;
      const result = await completeOnboardingAction({ referralCode: CODE });
      expect(result, reason).toEqual({ ok: true, referralNote: onboardingReferralNote(reason) });
      expect("referralCodeRefused" in result, reason).toBe(false);
      expect(s.finishes, reason).toBe(1);
    }
  });

  it("a typed code with a FINAL answer that retyping cannot change (exists, not_new, program_off, reciprocal) stops nothing and claims nothing else: one claim, the account finished, no note", async () => {
    for (const reason of ["exists", "not_new", "program_off", "reciprocal"] as const) {
      s.claim.mockReset().mockResolvedValue({ ok: false, reason });
      s.finishes = 0;
      expect(await completeOnboardingAction({ referralCode: CODE, typedReferralCode: "dddd4444" }), reason).toEqual({ ok: true });
      expect(claimCalls(), reason).toEqual([{ refereeId: "user-1", code: "dddd4444" }]);
      expect(s.finishes, reason).toBe(1);
    }
  });

  it("a typed code the database could not save (error twice): the account is finished, the link is NOT claimed in its place, and the note says it can be added later", async () => {
    s.claim.mockReset().mockResolvedValue({ ok: false, reason: "error" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await completeOnboardingAction({ referralCode: CODE, typedReferralCode: "dddd4444" })).toEqual({
      ok: true,
      referralNote: REFERRAL_CODE_NOT_SAVED,
    });
    expect(REFERRAL_CODE_NOT_SAVED).toBe("We couldn't add your referral code just now.");
    expect(claimCalls()).toEqual([
      { refereeId: "user-1", code: "dddd4444" },
      { refereeId: "user-1", code: "dddd4444" },
    ]);
    expect(s.finishes).toBe(1);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
    // A LINK that failed twice says nothing: nobody typed anything to be told about.
    s.claim.mockClear();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await completeOnboardingAction({ referralCode: CODE })).toEqual({ ok: true });
    quiet.mockRestore();
  });

  it("a typed claim whose first try FAILED and whose retry says the row is there (exists): two calls, both the typed code — never the link's, and no note", async () => {
    s.claim.mockReset().mockResolvedValueOnce({ ok: false, reason: "error" }).mockResolvedValue({ ok: false, reason: "exists" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await completeOnboardingAction({ referralCode: CODE, typedReferralCode: "dddd4444" })).toEqual({ ok: true });
    expect(claimCalls()).toEqual([
      { refereeId: "user-1", code: "dddd4444" },
      { refereeId: "user-1", code: "dddd4444" },
    ]);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("a typed claim whose retry answers unknown_code (error, then nobody has it) stops the step like a first answer", async () => {
    s.claim.mockReset().mockResolvedValueOnce({ ok: false, reason: "error" }).mockResolvedValue({ ok: false, reason: "unknown_code" });
    expect(await completeOnboardingAction({ typedReferralCode: "dddd4444" })).toEqual({
      ok: false,
      error: onboardingCodeError("Nobody has that referral code. Check it with your friend and try again."),
      referralCodeRefused: true,
    });
    expect(s.claim).toHaveBeenCalledTimes(2);
    expect(s.finishes).toBe(0);
  });

  it("the claim is counted against the code-entry limit BEFORE it is made: one hit per finish, for this user — 5 a minute, 20 an hour", async () => {
    await completeOnboardingAction({ referralCode: CODE });
    expect(s.limit.mock.calls).toEqual([[{ context: "referral-code-entry", subject: "user-1", perMinute: 5, perHour: 20, message: "" }]]);
    expect(s.order).toEqual(["limit", "claim"]);
    // The same counter whichever code is claimed: typed, the account's, the link's.
    for (const [input, metadata] of [
      [{ typedReferralCode: "dddd4444" }, {}],
      [{}, { referral_code: "0000aaaa" }],
      [{ referralCode: CODE, typedReferralCode: "dddd4444" }, { referral_code: "0000aaaa" }],
    ] as const) {
      s.limit.mockClear();
      s.user = { id: "user-2", app_metadata: { provider: "email", ...metadata } };
      await completeOnboardingAction(input);
      expect(s.limit.mock.calls).toEqual([[{ context: "referral-code-entry", subject: "user-2", perMinute: 5, perHour: 20, message: "" }]]);
    }
  });

  it("a claim that is retried (error, then again) is still ONE hit of the limit", async () => {
    s.claim.mockReset().mockResolvedValue({ ok: false, reason: "error" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await completeOnboardingAction({ referralCode: CODE });
    expect(s.claim).toHaveBeenCalledTimes(2);
    expect(s.limit).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("past the limit a LINK is not looked at: no claim, no note — and onboarding completes all the same (funnel row included)", async () => {
    s.limit.mockReset().mockResolvedValue({ ok: false, retryAfterSeconds: 42, message: "" });
    // A claim that WOULD have answered with a note, had it been made.
    s.claim.mockReset().mockResolvedValue({ ok: false, reason: "unknown_code" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const metadata of [{}, { referral_code: "0000aaaa" }]) {
      s.signup.mockClear();
      s.user = { id: "user-1", app_metadata: { provider: "google", ...metadata } };
      const result = await completeOnboardingAction({ referralCode: CODE });
      expect(result).toEqual({ ok: true });
      expect(Object.keys(result)).toEqual(["ok"]);
      // The account is finished: its funnel row is written as for any other.
      await runDeferred();
      expect(s.signup).toHaveBeenCalledTimes(1);
    }
    expect(s.limit).toHaveBeenCalledTimes(2);
    expect(s.claim).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("past the limit a TYPED code is told to wait — it is somebody trying codes: no claim, nothing finished, and the code is not quietly dropped", async () => {
    s.limit.mockReset().mockResolvedValue({ ok: false, retryAfterSeconds: 42, message: "" });
    for (const input of [{ typedReferralCode: "dddd4444" }, { referralCode: CODE, typedReferralCode: "dddd4444" }]) {
      s.finishes = 0;
      expect(await completeOnboardingAction(input)).toEqual({
        ok: false,
        error: "That's a lot of tries. Wait a minute and try again. You can also clear the field and finish without a code.",
        referralCodeRefused: true,
      });
      expect(s.finishes).toBe(0);
      await runDeferred();
      expect(s.signup).not.toHaveBeenCalled();
    }
    expect(onboardingCodeError(REFERRAL_CODE_TOO_MANY_TRIES)).toBe(
      "That's a lot of tries. Wait a minute and try again. You can also clear the field and finish without a code.",
    );
    expect(s.claim).not.toHaveBeenCalled();
    // …while a typed value that is NO code is nobody's word: the link's rule applies.
    s.finishes = 0;
    expect(await completeOnboardingAction({ referralCode: CODE, typedReferralCode: "nope" })).toEqual({ ok: true });
    expect(s.finishes).toBe(1);
  });

  it("no code at all — or no service role — never touches the limiter", async () => {
    await completeOnboardingAction({});
    await completeOnboardingAction({ attribution: { ref: CODE, referrer: "x.com" } });
    s.admin = false;
    await completeOnboardingAction({ referralCode: CODE, typedReferralCode: "dddd4444" });
    s.admin = true;
    s.user = null;
    await completeOnboardingAction({ referralCode: CODE });
    expect(s.limit).not.toHaveBeenCalled();
    expect(s.claim).not.toHaveBeenCalled();
  });

  it("no claim, no note: no code, or no service role, completes as exactly { ok: true }", async () => {
    s.claim.mockReset().mockResolvedValue({ ok: false, reason: "unknown_code" });
    expect(await completeOnboardingAction({})).toEqual({ ok: true });
    s.admin = false;
    expect(await completeOnboardingAction({ referralCode: CODE })).toEqual({ ok: true });
    expect(s.claim).not.toHaveBeenCalled();
  });

  it("error, then a final answer on the retry (the first try landed after all: exists): two calls, nothing logged", async () => {
    s.claim.mockReset().mockResolvedValueOnce({ ok: false, reason: "error" }).mockResolvedValue({ ok: false, reason: "exists" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await completeOnboardingAction({ referralCode: CODE })).toEqual({ ok: true });
    expect(s.claim).toHaveBeenCalledTimes(2);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("no code, a signed-out caller or no service role: no claim at all", async () => {
    await completeOnboardingAction({});
    s.admin = false;
    await completeOnboardingAction({ referralCode: CODE });
    s.admin = true;
    s.user = null;
    await completeOnboardingAction({ referralCode: CODE });
    expect(s.claim).not.toHaveBeenCalled();
  });
});
