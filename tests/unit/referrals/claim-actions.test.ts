import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// claimReferralCodeAction — "Joined because of a friend?" on the Refer a
// friend page (owner 2026-11-11: code entry for NEW accounts only). A new
// account whose browser lost its friend's link types the code, or pastes the
// link, and the referral is recorded AS THE LINK WOULD HAVE RECORDED IT: by
// the same function (recordReferralSignup, the service role), under the same
// rules — nothing here is a second way in.
//
// Pinned:
//   * the gates, in order: the program's switches (billing on, a service
//     role) → a signed-in user → the rate limit → a readable code → the
//     claim. A refused gate never reaches the next one;
//   * the rate limit is hitKeyedLimit under its own context, per user, 5 a
//     minute and 20 an hour — a refused try says so and is NOT a claim;
//   * the code is read with extractReferralCode (a code or a pasted link);
//     what is claimed is the 8-hex code, for the SESSION's user — never an
//     id the browser sent;
//   * every refusal of the claim comes back in words (claim-messages.ts);
//   * a claim that lands schedules the reward step AFTER the response
//     (next/server `after`, never awaited — the friend has often made their
//     cards already), revalidates the page and answers { ok: true }; a step
//     that throws is caught and logged, never the caller's problem.
// ---------------------------------------------------------------------------

const USER = "22222222-2222-4222-8222-222222222222";
const OTHER = "99999999-9999-4999-8999-999999999999";
const CODE = "ab12cd34";

type Claim = { ok: true; referralId: string } | { ok: false; reason: string };
type Limit = { ok: true } | { ok: false; retryAfterSeconds: number; message: string };

const s = vi.hoisted(() => ({
  billing: true,
  adminConfigured: true,
  stripeConfigured: false,
  user: null as null | { id: string },
  /** What happened, in order. */
  order: [] as string[],
  /** The callbacks handed to `after()`, in order. */
  deferred: [] as Array<() => Promise<void> | void>,
  adminClient: { name: "the service-role client" },
  stripeClient: { name: "the Stripe client" },
  createAdminClient: vi.fn<() => unknown>(),
  limit: vi.fn<(input: Record<string, unknown>) => Promise<Limit>>(),
  claim: vi.fn<(admin: unknown, input: Record<string, unknown>) => Promise<Claim>>(),
  advance: vi.fn<(admin: unknown, refereeId: string, deps: Record<string, unknown>) => Promise<unknown>>(),
  revalidatePath: vi.fn<(path: string, type?: string) => void>(),
}));

vi.mock("next/server", () => ({
  after: (task: () => Promise<void> | void) => {
    s.order.push("after");
    s.deferred.push(task);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: s.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => {
    s.order.push("user");
    return s.user;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: s.createAdminClient,
  isAdminConfigured: () => s.adminConfigured,
}));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => s.billing }));
vi.mock("@/lib/api/keyed-limit", () => ({ hitKeyedLimit: s.limit }));
vi.mock("@/lib/stripe/client", () => ({
  isStripeConfigured: () => s.stripeConfigured,
  getStripe: () => s.stripeClient,
}));
vi.mock("@/lib/referrals/server", () => ({ recordReferralSignup: s.claim, advanceReferral: s.advance }));

import { claimReferralCodeAction } from "@/lib/referrals/claim-actions";
import { REFERRAL_CODE_UNREADABLE, referralClaimError } from "@/lib/referrals/claim-messages";

const runDeferred = async () => {
  for (const task of s.deferred.splice(0)) await task();
};

beforeEach(() => {
  s.billing = true;
  s.adminConfigured = true;
  s.stripeConfigured = false;
  s.user = { id: USER };
  s.order = [];
  s.deferred = [];
  s.createAdminClient.mockReset().mockImplementation(() => s.adminClient);
  s.limit.mockReset().mockImplementation(async () => {
    s.order.push("limit");
    return { ok: true };
  });
  s.claim.mockReset().mockImplementation(async () => {
    s.order.push("claim");
    return { ok: true, referralId: "ref-1" };
  });
  s.advance.mockReset().mockImplementation(async () => {
    s.order.push("advance");
    return { status: "waiting", reason: "not_qualified" };
  });
  s.revalidatePath.mockReset().mockImplementation(() => void s.order.push("revalidate"));
});

describe("claimReferralCodeAction — a code that lands", () => {
  it("claims for the SESSION's user with the service role, then: the reward step after the response, the page revalidated, { ok: true }", async () => {
    expect(await claimReferralCodeAction({ code: CODE })).toEqual({ ok: true });
    expect(s.claim.mock.calls).toEqual([[s.adminClient, { refereeId: USER, code: CODE }]]);
    expect(s.revalidatePath.mock.calls).toEqual([["/dashboard/referrals"]]);
    // Scheduled, not run: the answer never waits for the reward step.
    expect(s.order).toEqual(["user", "limit", "claim", "after", "revalidate"]);
    expect(s.advance).not.toHaveBeenCalled();
    expect(s.deferred).toHaveLength(1);
    await runDeferred();
    // The same client, the same account — the friend's own row.
    expect(s.advance.mock.calls).toEqual([[s.adminClient, USER, { stripe: null }]]);
    // One service-role client for the claim and its step.
    expect(s.createAdminClient).toHaveBeenCalledTimes(1);
  });

  it("the step is handed Stripe only where Stripe is configured", async () => {
    s.stripeConfigured = true;
    await claimReferralCodeAction({ code: CODE });
    await runDeferred();
    expect(s.advance.mock.calls).toEqual([[s.adminClient, USER, { stripe: s.stripeClient }]]);
  });

  it("reads what was typed as a person types it: capitals, spaces, or the friend's whole link", async () => {
    for (const typed of [
      "AB12CD34",
      `  ${CODE}\n`,
      `https://pipglyph.com/?ref=${CODE}`,
      `pipglyph.com/?ref=${CODE.toUpperCase()}`,
      `https://pipglyph.com/card/kesh/ember-sphinx?via=copy&ref=${CODE}#top`,
    ]) {
      s.claim.mockClear();
      expect(await claimReferralCodeAction({ code: typed }), typed).toEqual({ ok: true });
      // The claim is handed the code alone — never the text as typed.
      expect(s.claim.mock.calls, typed).toEqual([[s.adminClient, { refereeId: USER, code: CODE }]]);
    }
  });

  it("an account id in the input is nobody's: the claim is always for the signed-in user", async () => {
    expect(await claimReferralCodeAction({ code: CODE, refereeId: OTHER, userId: OTHER, user: { id: OTHER } })).toEqual({ ok: true });
    expect(s.claim.mock.calls[0][1]).toEqual({ refereeId: USER, code: CODE });
    expect(s.limit.mock.calls[0][0]).toMatchObject({ subject: USER });
    await runDeferred();
    expect(s.advance.mock.calls[0][1]).toBe(USER);
    expect(JSON.stringify([s.claim.mock.calls, s.limit.mock.calls, s.advance.mock.calls.map((call) => call[1])])).not.toContain(OTHER);
  });

  it("a reward step that THROWS after the response is caught and logged — the claim's answer was already { ok: true }", async () => {
    s.advance.mockRejectedValue(new Error("stripe is away"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await claimReferralCodeAction({ code: CODE })).toEqual({ ok: true });
    await expect(runDeferred()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    // The log names the account, never the code.
    expect(String(error.mock.calls[0][0])).toContain(USER);
    expect(JSON.stringify(error.mock.calls.map((call) => call.map(String)))).not.toContain(CODE);
    error.mockRestore();
  });

  it("a reward step that only WAITS, or rewards, changes nothing in the answer", async () => {
    for (const result of [{ status: "none" }, { status: "waiting", reason: "not_qualified" }, { status: "rewarded", step: 1 }]) {
      s.advance.mockResolvedValue(result);
      expect(await claimReferralCodeAction({ code: CODE })).toEqual({ ok: true });
      await expect(runDeferred()).resolves.toBeUndefined();
    }
  });
});

describe("claimReferralCodeAction — the gates", () => {
  const untouched = () => {
    expect(s.claim).not.toHaveBeenCalled();
    expect(s.advance).not.toHaveBeenCalled();
    expect(s.deferred).toEqual([]);
    expect(s.revalidatePath).not.toHaveBeenCalled();
  };

  it("billing off: the paused-program sentence — nobody is asked who they are, nothing is counted or claimed", async () => {
    s.billing = false;
    expect(await claimReferralCodeAction({ code: CODE })).toEqual({ ok: false, error: referralClaimError("program_off") });
    expect(referralClaimError("program_off")).toBe("The referral program is paused right now.");
    expect(s.order).toEqual([]);
    expect(s.limit).not.toHaveBeenCalled();
    expect(s.createAdminClient).not.toHaveBeenCalled();
    untouched();
  });

  it("no service role configured: the same sentence, and no admin client is ever asked for", async () => {
    s.adminConfigured = false;
    expect(await claimReferralCodeAction({ code: CODE })).toEqual({ ok: false, error: "The referral program is paused right now." });
    expect(s.order).toEqual([]);
    expect(s.createAdminClient).not.toHaveBeenCalled();
    untouched();
  });

  it("signed out: asked to sign in — no limit counted, no claim", async () => {
    s.user = null;
    expect(await claimReferralCodeAction({ code: CODE })).toEqual({ ok: false, error: "Sign in to add a referral code." });
    expect(s.order).toEqual(["user"]);
    expect(s.limit).not.toHaveBeenCalled();
    expect(s.createAdminClient).not.toHaveBeenCalled();
    untouched();
  });

  it("the rate limit: its own counter, per user — 5 a minute, 20 an hour, with words for a refused try", async () => {
    await claimReferralCodeAction({ code: CODE });
    expect(s.limit.mock.calls).toEqual([
      [
        {
          context: "referral-code-entry",
          subject: USER,
          perMinute: 5,
          perHour: 20,
          message: "That's a lot of tries. Wait a minute and try again.",
        },
      ],
    ]);
  });

  it("a REFUSED limit returns its message and is not a claim: recordReferralSignup is never called", async () => {
    s.limit.mockImplementation(async (input) => {
      s.order.push("limit");
      return { ok: false, retryAfterSeconds: 42, message: String(input.message) };
    });
    expect(await claimReferralCodeAction({ code: CODE })).toEqual({
      ok: false,
      error: "That's a lot of tries. Wait a minute and try again.",
    });
    expect(s.order).toEqual(["user", "limit"]);
    expect(s.createAdminClient).not.toHaveBeenCalled();
    untouched();
    // The limiter's own words are what is said, whatever they are.
    s.limit.mockResolvedValue({ ok: false, retryAfterSeconds: 60, message: "Slow down." });
    expect(await claimReferralCodeAction({ code: CODE })).toEqual({ ok: false, error: "Slow down." });
    untouched();
  });

  it("EVERY try is counted before the code is read — a wrong guess costs a try too", async () => {
    for (const code of [CODE, "nope", "", undefined]) {
      s.limit.mockClear();
      await claimReferralCodeAction({ code });
      expect(s.limit, String(code)).toHaveBeenCalledTimes(1);
    }
  });

  it("a value that reads as no code: REFERRAL_CODE_UNREADABLE, and no claim", async () => {
    for (const input of [
      { code: "" },
      { code: "   " },
      { code: "hello" },
      { code: "ab12cd3" },
      { code: "ab12cd345" },
      { code: "zzzzzzzz" },
      { code: "https://pipglyph.com/" },
      { code: "https://pipglyph.com/?ref=nope" },
      { code: "https://pipglyph.com/?ref=%zz" },
      { code: 12345678 },
      { code: null },
      { code: [CODE] },
      { code: { code: CODE } },
      {},
      null,
      undefined,
      CODE,
      42,
    ]) {
      expect(await claimReferralCodeAction(input), JSON.stringify(input)).toEqual({ ok: false, error: REFERRAL_CODE_UNREADABLE });
    }
    expect(REFERRAL_CODE_UNREADABLE).toBe("That doesn't look like a referral code or link. Check it and try again.");
    expect(s.createAdminClient).not.toHaveBeenCalled();
    untouched();
  });
});

describe("claimReferralCodeAction — a claim that is refused", () => {
  it.each([
    ["bad_code", "That doesn't look like a referral code or link. Check it and try again."],
    ["unknown_code", "Nobody has that referral code. Check it with your friend and try again."],
    ["self", "That is your own code. Enter the code of the friend who told you about PipGlyph."],
    ["reciprocal", "That friend joined through your link, so their code can't be added to your account."],
    ["not_new", "A referral code can be added in an account's first 14 days, before a plan is started."],
    ["exists", "Your account already has a referral."],
    ["program_off", "The referral program is paused right now."],
    ["error", "Couldn't add the code. Try again in a moment."],
  ])("%s: said in words, and nothing follows — no reward step, no revalidation", async (reason, sentence) => {
    s.claim.mockImplementation(async () => {
      s.order.push("claim");
      return { ok: false, reason };
    });
    expect(await claimReferralCodeAction({ code: CODE })).toEqual({ ok: false, error: sentence });
    expect(referralClaimError(reason as Parameters<typeof referralClaimError>[0])).toBe(sentence);
    // One call: a refusal is not retried here (the person presses again).
    expect(s.claim).toHaveBeenCalledTimes(1);
    expect(s.order).toEqual(["user", "limit", "claim"]);
    expect(s.deferred).toEqual([]);
    expect(s.advance).not.toHaveBeenCalled();
    expect(s.revalidatePath).not.toHaveBeenCalled();
  });

  it("the answer is only ever { ok: true } or { ok: false, error: <a sentence> } — never a reason code, a referral id or the code typed", async () => {
    const answers = [await claimReferralCodeAction({ code: CODE })];
    for (const reason of ["unknown_code", "not_new", "exists", "error"]) {
      s.claim.mockResolvedValue({ ok: false, reason });
      answers.push(await claimReferralCodeAction({ code: CODE }));
    }
    expect(Object.keys(answers[0])).toEqual(["ok"]);
    for (const answer of answers.slice(1)) {
      expect(Object.keys(answer).sort()).toEqual(["error", "ok"]);
      expect(JSON.stringify(answer)).not.toMatch(/ref-1|unknown_code|not_new|"exists"|ab12cd34/);
    }
  });
});
