import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REFERRAL_BLOCK_WHY,
  referralRewardLines,
  referralRewardWords,
  sideRewardText,
  type RewardContext,
} from "@/lib/admin/analytics/referral-rewards";
import type { ReferredFriend, ReferralRewardFacts, RewardSideFacts } from "@/lib/admin/analytics/referrals";
import { REFERRAL_CONFIRM_WINDOW_DAYS, REFERRAL_GRANT_MAX_ATTEMPTS } from "@/lib/referrals/rules";

// ---------------------------------------------------------------------------
// WHY a referral's reward has not been given (owner 2026-11-11) — the
// Referred friends table's Rewards column. Each reason is one of the reward
// step's own conditions (lib/referrals/server.ts), in its order: billing
// (off, nothing moves), the friend's cards inside the window, a plan with a
// card on file, the program's switch, both emails, the hash key — then a
// claimed row's failed grant, and what a side that ended with nothing was
// refused for. "The hourly check does it" is said only of what the sweep
// really picks up, and a row that should have been claimed hours ago says
// the step is failing.
// ---------------------------------------------------------------------------

const ctx: RewardContext = {
  cardsRequired: 5,
  windowDays: 30,
  programEnabled: true,
  billingEnabled: true,
  hashKeySet: true,
  now: new Date("2026-11-10T12:00:00Z"),
};

const side = (over: Partial<RewardSideFacts> = {}): RewardSideFacts => ({ kind: null, days: null, credits: null, step: null, reason: null, spent: false, ...over });
const facts = (over: Partial<ReferralRewardFacts> = {}): ReferralRewardFacts => ({
  friend: side(),
  referrer: side(),
  grantAttempts: 0,
  friendEmailConfirmed: true,
  referrerEmailConfirmed: true,
  friendHasPlan: false,
  ...over,
});

/** A friend who joined on Nov 1 and has done nothing yet. */
const row = (over: Partial<ReferredFriend> = {}): ReferredFriend => ({
  referralId: "r1",
  refereeId: "u-friend",
  refereeUsername: "friend",
  refereeJoinedAt: "2026-11-01T00:00:00Z",
  referrerId: "u-ref",
  referrerUsername: "referrer",
  signedUpAt: "2026-11-01T00:00:00Z",
  status: "signed_up",
  blockReason: null,
  cardsSavedAt: null,
  cardOnFileAt: null,
  rewardedAt: null,
  ladderStep: null,
  tier: "free",
  cards: 0,
  publicCards: 0,
  lastCardAt: null,
  bankedDays: 0,
  rewards: facts(),
  ...over,
});

const words = (r: ReferredFriend, c: RewardContext = ctx) => referralRewardWords(r, c)!;
/** Half an hour after the qualified row's second bar landed. */
const justQualified: RewardContext = { ...ctx, now: new Date("2026-11-05T00:30:00Z") };
/** A row with both bars met (the second on Nov 5, 00:00) and nothing claimed yet. */
const qualified = (over: Partial<ReferredFriend> = {}) =>
  row({ status: "cards_saved", cards: 6, cardsSavedAt: "2026-11-03T00:00:00Z", cardOnFileAt: "2026-11-05T00:00:00Z", rewards: facts({ friendHasPlan: true }), ...over });

describe("a referral the reward step has not claimed yet", () => {
  it("names the cards the friend still has to save, with the day the window ends, and the missing plan", () => {
    const { friend, referrer } = words(row({ cards: 2 }));
    expect(friend).toEqual({
      state: "waiting",
      detail: "the friend has saved 2 of 5 cards (until Dec 1, 2026 UTC), and the friend has not started a plan with a card on file",
    });
    expect(referrer).toEqual(friend);
  });

  it("uses the program's own numbers", () => {
    const one = words(row({ cards: 0 }), { ...ctx, cardsRequired: 1, windowDays: 14 });
    expect(one.friend.detail).toContain("the friend has saved 0 of 1 card (until Nov 15, 2026 UTC)");
    const late = words(row({ cards: 0 }), { ...ctx, cardsRequired: 1, windowDays: 7 });
    expect(late.friend.detail).toContain("the friend did not save 1 card within 7 days of joining");
  });

  it("the cards saved, no plan: only the plan is missing", () => {
    const r = row({ status: "cards_saved", cards: 5, cardsSavedAt: "2026-11-03T00:00:00Z" });
    expect(words(r).referrer).toEqual({ state: "waiting", detail: "the friend has not started a plan with a card on file" });
  });

  it("a plan, not the cards: only the cards are missing", () => {
    const r = row({ cards: 3, cardOnFileAt: "2026-11-04T00:00:00Z", rewards: facts({ friendHasPlan: true }) });
    expect(words(r).friend.detail).toBe("the friend has saved 3 of 5 cards (until Dec 1, 2026 UTC)");
  });

  it("the friend has the cards but the save's step was lost: the hourly check records it", () => {
    expect(words(row({ cards: 7 })).friend.detail).toContain("the friend has 7 cards saved; the hourly check records it");
  });

  it("the friend holds a plan the referral has not recorded: the hourly check records it once the cards are saved", () => {
    const r = row({ status: "cards_saved", cards: 5, cardsSavedAt: "2026-11-03T00:00:00Z", rewards: facts({ friendHasPlan: true }) });
    expect(words(r).friend.detail).toBe("the friend's plan is not recorded on the referral yet; the hourly check records it");
  });

  it("…and before the cards are saved it is their next card that records it — the sweep never looks at that row", () => {
    const r = row({ cards: 2, rewards: facts({ friendHasPlan: true }) });
    expect(words(r).friend.detail).toBe(
      "the friend has saved 2 of 5 cards (until Dec 1, 2026 UTC), and the friend's plan is not recorded on the referral yet; their next saved card records it",
    );
    expect(words(r).friend.detail).not.toContain("hourly check");
  });

  it("past the window without the cards: it is about to expire, whatever the friend has now", () => {
    const late = row({ signedUpAt: "2026-10-01T00:00:00Z", cards: 9 });
    expect(words(late).friend.detail).toContain(
      "the friend did not save 5 cards within 30 days of joining; the hourly check will expire this referral",
    );
  });

  it("the window's last instant is still inside it", () => {
    const edge = row({ signedUpAt: "2026-10-11T12:00:00Z", cards: 1 });
    expect(words(edge).friend.detail).toContain("the friend has saved 1 of 5 cards (until Nov 10, 2026 UTC)");
  });

  it("a friend whose account is gone is an END for both sides, never 'not yet' — whatever the row was short of", () => {
    const none = { state: "none", detail: "the friend's account was deleted" };
    for (const gone of [
      row({ refereeId: null, refereeUsername: null, tier: null }),
      row({ refereeId: null, status: "cards_saved", cardsSavedAt: "2026-11-03T00:00:00Z" }),
      qualified({ refereeId: null }),
    ]) {
      expect(words(gone)).toEqual({ friend: none, referrer: none });
      // …and with billing off as well: the account is gone either way.
      expect(words(gone, { ...ctx, billingEnabled: false })).toEqual({ friend: none, referrer: none });
    }
  });

  it("billing off comes first on every row: nothing is rewarded and no hourly check runs", () => {
    const off = { ...ctx, billingEnabled: false, programEnabled: false };
    const said = "billing is switched off, so no referral is rewarded until it is on";
    expect(words(qualified(), off).friend.detail).toBe(said);
    expect(words(row({ cards: 7 }), off).referrer.detail).toBe(said);
    expect(words(row({ cards: 2 }), off).friend.detail).not.toContain("hourly check");
  });

  it("both bars met: the paused program comes before the emails and the key", () => {
    expect(words(qualified(), { ...ctx, programEnabled: false, hashKeySet: false }).friend.detail).toBe("the referral program is paused");
  });

  it("both bars met: says WHOSE email is not confirmed, and the day the referral expires without it", () => {
    const until = `(the referral expires on Dec 3, 2026 UTC without it)`;
    expect(REFERRAL_CONFIRM_WINDOW_DAYS).toBe(30);
    expect(words(qualified({ rewards: facts({ friendHasPlan: true, friendEmailConfirmed: false }) })).referrer.detail).toBe(
      `the friend's email is not confirmed ${until}`,
    );
    expect(words(qualified({ rewards: facts({ friendHasPlan: true, referrerEmailConfirmed: false }) })).friend.detail).toBe(
      `the referrer's email is not confirmed ${until}`,
    );
    expect(
      words(qualified({ rewards: facts({ friendHasPlan: true, friendEmailConfirmed: false, referrerEmailConfirmed: false }) })).friend.detail,
    ).toBe(`neither email is confirmed ${until}`);
  });

  it("an email whose state is unknown is not called unconfirmed", () => {
    const unknown = qualified({ rewards: facts({ friendHasPlan: true, friendEmailConfirmed: null, referrerEmailConfirmed: null }) });
    expect(words(unknown, justQualified).friend.detail).toBe("everything is in place; the hourly check gives the reward");
  });

  it("both bars met, emails confirmed, no hash key: the server's key is named", () => {
    expect(words(qualified(), { ...ctx, hashKeySet: false }).friend.detail).toBe(
      "the server's REFERRAL_EMAIL_HASH_KEY is not set, so the email check cannot run",
    );
  });

  it("nothing in the way, just qualified: the hourly check gives it", () => {
    const { friend, referrer } = words(qualified(), justQualified);
    expect(friend).toEqual({ state: "waiting", detail: "everything is in place; the hourly check gives the reward" });
    expect(referrer).toEqual(friend);
    // Two hours is still inside two runs of the hourly check.
    expect(words(qualified(), { ...ctx, now: new Date("2026-11-05T02:00:00Z") }).friend).toEqual(friend);
  });

  it("nothing in the way for hours: the reward step is failing, and it is not called fine", () => {
    const stuck = words(qualified(), { ...ctx, now: new Date("2026-11-05T02:00:01Z") }).friend;
    expect(stuck).toEqual({
      state: "waiting",
      detail: "everything is in place since Nov 5, 2026 UTC, but the reward step has not gone through; it is failing — the server log's [referrals] lines say why",
    });
    expect(words(qualified()).referrer).toEqual(stuck); // five days on
    // Counted from the LATER of the two bars, whichever it was.
    const cardsLast = qualified({ cardsSavedAt: "2026-11-10T11:30:00Z", cardOnFileAt: "2026-11-01T00:00:00Z" });
    expect(words(cardsLast).friend.detail).toBe("everything is in place; the hourly check gives the reward");
  });

  it("0177's first_card state reads as cards_saved does", () => {
    expect(words(qualified({ status: "first_card" }), justQualified).friend).toEqual({
      state: "waiting",
      detail: "everything is in place; the hourly check gives the reward",
    });
  });

  it("the friend's days banked ahead of their checkout are named on the friend's side only", () => {
    const pre = row({ status: "cards_saved", cards: 5, cardsSavedAt: "2026-11-03T00:00:00Z", bankedDays: 7 });
    const { friend, referrer } = words(pre);
    expect(friend.detail).toBe("the friend has not started a plan with a card on file. 7 free days are already banked for their checkout");
    expect(referrer.detail).toBe("the friend has not started a plan with a card on file");
    expect(words({ ...pre, bankedDays: 1 }).friend.detail).toContain("1 free day is already banked");
  });
});

describe("a claimed referral", () => {
  const rewarded = (over: Partial<ReferralRewardFacts> = {}) =>
    qualified({ status: "rewarded", rewardedAt: "2026-11-05T00:00:01Z", ladderStep: 2, rewards: facts({ friendHasPlan: true, ...over }) });

  it("says what each side was given: days, credits, the referrer's ladder step", () => {
    const { friend, referrer } = words(
      rewarded({ friend: side({ kind: "banked_days", days: 7 }), referrer: side({ kind: "credits", credits: 5, step: 2 }) }),
    );
    expect(friend).toEqual({ state: "given", detail: "7 free days" });
    expect(referrer).toEqual({ state: "given", detail: "5 AI credits (ladder step 2)" });
    expect(words(rewarded({ friend: side({ kind: "banked_days", days: 1 }), referrer: side({ kind: "credits", credits: 1, step: 4 }) }))).toEqual({
      friend: { state: "given", detail: "1 free day" },
      referrer: { state: "given", detail: "1 AI credit (ladder step 4)" },
    });
  });

  it("0177's 'free_days' reads as days given, like 0180's 'banked_days'", () => {
    const old = words(rewarded({ friend: side({ kind: "free_days", days: 30 }), referrer: side({ kind: "free_days", days: 30 }) }));
    expect(old.friend).toEqual({ state: "given", detail: "30 free days" });
    expect(old.referrer).toEqual({ state: "given", detail: "30 free days" });
  });

  it("a reward with no amount on record still reads as a reward", () => {
    const { friend, referrer } = words(rewarded({ friend: side({ kind: "banked_days" }), referrer: side({ kind: "credits" }) }));
    expect(friend).toEqual({ state: "given", detail: "Free days" });
    expect(referrer).toEqual({ state: "given", detail: "AI credits" });
  });

  it("a side still owed is a grant that has not gone through — with the failures counted", () => {
    const first = words(rewarded({ friend: side({ kind: "banked_days", days: 7 }) }));
    expect(first.referrer).toEqual({ state: "waiting", detail: "the grant has not finished; the hourly check completes it" });
    const failing = words(rewarded({ friend: side({ kind: "banked_days", days: 7 }), grantAttempts: 2 }));
    expect(failing.referrer.detail).toBe(`the grant failed 2 times; the hourly check retries it (up to ${REFERRAL_GRANT_MAX_ATTEMPTS})`);
    expect(words(rewarded({ grantAttempts: 1 })).friend.detail).toContain("the grant failed 1 time;");
    // No hourly check runs with billing off.
    expect(words(rewarded({ grantAttempts: 2 }), { ...ctx, billingEnabled: false }).referrer).toEqual({
      state: "waiting",
      detail: "billing is switched off, so the grant waits until it is on",
    });
  });

  it("a side recorded 'none' says why: an admin, the settings, a grant given up, a missing account", () => {
    const none = (reason: string, isReferrer = true) =>
      words(rewarded({ friend: side({ kind: "none", reason }), referrer: side({ kind: "none", reason }) }))[isReferrer ? "referrer" : "friend"];
    expect(none("admin")).toEqual({ state: "none", detail: "admin accounts get no referral reward" });
    expect(none("settings").detail).toBe("the ladder gives nothing at this step");
    expect(none("settings", false).detail).toBe("the program gives the friend no days");
    expect(none("grant_failed").detail).toBe(`the grant failed ${REFERRAL_GRANT_MAX_ATTEMPTS} times and was given up; it needs a look`);
    expect(none("no_profile").detail).toBe("the account has no profile");
    expect(none("account_deleted").detail).toBe("the account was deleted");
    expect(none("account_deleted", false).detail).toBe("the friend's account was deleted");
  });

  it("a reason it does not know reads as words, never as a raw code or nothing", () => {
    const odd = words(rewarded({ friend: side({ kind: "none", reason: "some_new_rule" }) })).friend;
    expect(odd).toEqual({ state: "none", detail: "some new rule" });
  });

  it("same company domain: the friend keeps theirs, the referrer gets none and is told why", () => {
    const r = qualified({
      status: "blocked",
      blockReason: "same_domain",
      rewards: facts({ friend: side({ kind: "banked_days", days: 7 }), referrer: side({ kind: "none" }) }),
    });
    expect(words(r)).toEqual({
      friend: { state: "given", detail: "7 free days" },
      referrer: { state: "none", detail: "both emails are on the same company domain" },
    });
    // …and a friend still owed on that row is a grant in progress, not "none".
    const pending = { ...r, rewards: facts({ referrer: side({ kind: "none" }) }) };
    expect(words(pending).friend.state).toBe("waiting");
  });

  it("a full block gives neither side anything, in the reason's own words — and names days the checkout already used", () => {
    const blocked = (reason: string, spent = false) =>
      qualified({
        status: "blocked",
        blockReason: reason,
        rewards: facts({ friend: side({ kind: "none", reason, spent }), referrer: side({ kind: "none" }) }),
      });
    expect(words(blocked("same_card"))).toEqual({
      friend: { state: "none", detail: "both accounts pay with the same card" },
      referrer: { state: "none", detail: "both accounts pay with the same card" },
    });
    expect(words(blocked("email_reused", true)).friend.detail).toBe(
      "the friend's email was already used by another account (the days banked for their checkout were already used)",
    );
  });

  it("over the monthly friend limit: neither side", () => {
    const capped = qualified({ status: "capped", rewards: facts({ friend: side({ kind: "none" }), referrer: side({ kind: "none" }) }) });
    expect(words(capped).friend).toEqual({ state: "none", detail: "the referrer was over the monthly limit of rewarded friends" });
    expect(words(capped).referrer).toEqual(words(capped).friend);
    const spent = qualified({ status: "capped", rewards: facts({ friend: side({ kind: "none", reason: "capped_friends", spent: true }), referrer: side({ kind: "none" }) }) });
    expect(words(spent).friend.detail).toContain("the referrer was over the monthly limit of rewarded friends (the days banked");
  });

  it("expired: for the cards when they were never saved, else for the emails", () => {
    const none = facts({ friend: side({ kind: "none" }), referrer: side({ kind: "none" }) });
    expect(words(row({ status: "expired", rewards: none })).friend).toEqual({
      state: "none",
      detail: "the friend did not save the required cards in time",
    });
    // Today's settings are not stated as the rule an old row broke.
    expect(words(row({ status: "expired", rewards: none }), { ...ctx, cardsRequired: 9, windowDays: 3 }).friend.detail).not.toMatch(/\d/);
    const emails = qualified({ status: "expired", rewards: facts({ friend: side({ kind: "none", reason: "expired" }), referrer: side({ kind: "none" }) }) });
    expect(words(emails).friend.detail).toBe("an email was not confirmed within 30 days of the friend qualifying");
    expect(words(emails).referrer.detail).toBe(words(emails).friend.detail);
  });

  it("an ended row whose side was never written is 'none', never 'not yet'", () => {
    expect(words(row({ status: "expired" })).referrer.state).toBe("none");
    expect(words(qualified({ status: "capped" })).referrer.state).toBe("none");
    expect(words(qualified({ status: "blocked", blockReason: "same_email" })).referrer).toEqual({
      state: "none",
      detail: "the friend's email is the referrer's own inbox",
    });
  });
});

describe("the block reasons", () => {
  it("has a reason for every block_reason in 0177's CHECK", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0177_referrals.sql"), "utf8");
    const check = /check \(block_reason is null or block_reason in \(([^)]*)\)/.exec(sql)?.[1] ?? "";
    const reasons = [...check.matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(reasons.length).toBeGreaterThanOrEqual(7);
    for (const reason of reasons) expect(REFERRAL_BLOCK_WHY[reason], reason).toBeTruthy();
  });
});

describe("a database that has not got 0206 yet", () => {
  it("says nothing rather than guess", () => {
    expect(referralRewardWords(row({ rewards: null }), ctx)).toBeNull();
    expect(referralRewardWords(qualified({ status: "rewarded", rewards: null }), ctx)).toBeNull();
  });
});

describe("the cell's lines", () => {
  it("one line when both sides wait, or ended, for the same reason", () => {
    expect(referralRewardLines(words(row({ cards: 2 })))).toEqual([
      {
        who: "Both sides",
        text: "not yet — the friend has saved 2 of 5 cards (until Dec 1, 2026 UTC), and the friend has not started a plan with a card on file",
      },
    ]);
    const capped = qualified({ status: "capped", rewards: facts({ friend: side({ kind: "none" }), referrer: side({ kind: "none" }) }) });
    expect(referralRewardLines(words(capped))).toEqual([
      { who: "Both sides", text: "none — the referrer was over the monthly limit of rewarded friends" },
    ]);
  });

  it("a line a side when they differ — and always when something was given", () => {
    const same = qualified({
      status: "rewarded",
      rewards: facts({ friend: side({ kind: "banked_days", days: 7 }), referrer: side({ kind: "banked_days", days: 7 }) }),
    });
    expect(referralRewardLines(words(same))).toEqual([
      { who: "Friend", text: "7 free days" },
      { who: "Referrer", text: "7 free days" },
    ]);
    const half = qualified({ status: "rewarded", rewards: facts({ friend: side({ kind: "banked_days", days: 7 }), grantAttempts: 3 }) });
    expect(referralRewardLines(words(half))).toEqual([
      { who: "Friend", text: "7 free days" },
      { who: "Referrer", text: `not yet — the grant failed 3 times; the hourly check retries it (up to ${REFERRAL_GRANT_MAX_ATTEMPTS})` },
    ]);
  });

  it("sideRewardText prefixes only what was not given", () => {
    expect(sideRewardText({ state: "given", detail: "7 free days" })).toBe("7 free days");
    expect(sideRewardText({ state: "waiting", detail: "x" })).toBe("not yet — x");
    expect(sideRewardText({ state: "none", detail: "x" })).toBe("none — x");
  });
});
