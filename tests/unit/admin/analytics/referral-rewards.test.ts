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
// (off, nothing moves), the friend's cards WITH ARTWORK inside the window,
// the program's switch, both emails, the hash key — then a claimed row's
// failed grant, and what a side that ended with nothing was refused for.
// A plan with a card on file is NO condition (owner 2026-11-11: a referral
// rewards on the cards alone), so no reason names one. "The hourly check
// does it" is said only of what the sweep really picks up, and a row that
// should have been claimed hours ago says the step is failing.
// ---------------------------------------------------------------------------

const ctx: RewardContext = {
  cardsRequired: 5,
  windowDays: 30,
  programEnabled: true,
  billingEnabled: true,
  hashKeySet: true,
  now: new Date("2026-11-10T12:00:00Z"),
};

const side = (over: Partial<RewardSideFacts> = {}): RewardSideFacts => ({ kind: null, days: null, credits: null, step: null, reason: null, ...over });
const facts = (over: Partial<ReferralRewardFacts> = {}): ReferralRewardFacts => ({
  friend: side(),
  referrer: side(),
  grantAttempts: 0,
  friendEmailConfirmed: true,
  referrerEmailConfirmed: true,
  friendHasPlan: false,
  friendQualifyingCards: 0,
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

/** The friend's cards now: `all` of them, `withArt` of those carrying
 *  artwork — the ones a referral counts (0208). */
const saved = (all: number, withArt: number = all, over: Partial<ReferralRewardFacts> = {}): Partial<ReferredFriend> => ({
  cards: all,
  rewards: facts({ friendQualifyingCards: withArt, ...over }),
});

const words = (r: ReferredFriend, c: RewardContext = ctx) => referralRewardWords(r, c)!;
/** Half an hour after the qualified row's cards landed. */
const justQualified: RewardContext = { ...ctx, now: new Date("2026-11-05T00:30:00Z") };
/** A row whose cards stand (saved on Nov 5, 00:00) and nothing claimed yet —
 *  with NO plan and NO card on file: the cards alone qualify it. */
const qualified = (over: Partial<ReferredFriend> = {}) =>
  row({ status: "cards_saved", cardsSavedAt: "2026-11-05T00:00:00Z", ...saved(6), ...over });
const IN_PLACE = "everything is in place; the hourly check gives the reward";

describe("a referral the reward step has not claimed yet", () => {
  it("names the cards the friend still has to save, with the day the window ends — and nothing else", () => {
    const { friend, referrer } = words(row(saved(2)));
    expect(friend).toEqual({ state: "waiting", detail: "the friend has saved 2 of 5 cards (until Dec 1, 2026 UTC)" });
    expect(referrer).toEqual(friend);
  });

  it("uses the program's own numbers", () => {
    const one = words(row(saved(0)), { ...ctx, cardsRequired: 1, windowDays: 14 });
    expect(one.friend.detail).toBe("the friend has saved 0 of 1 card (until Nov 15, 2026 UTC)");
    const late = words(row(saved(0)), { ...ctx, cardsRequired: 1, windowDays: 7 });
    expect(late.friend.detail).toContain("the friend did not save 1 card within 7 days of joining");
  });

  it("counts only the cards WITH ARTWORK, and says how many more the friend has that do not count", () => {
    expect(words(row(saved(5, 3))).friend.detail).toBe(
      "the friend has saved 3 of 5 cards (until Dec 1, 2026 UTC); 2 cards more have no artwork and do not count",
    );
    expect(words(row(saved(5, 4))).referrer.detail).toBe(
      "the friend has saved 4 of 5 cards (until Dec 1, 2026 UTC); 1 card more has no artwork and does not count",
    );
    // No artwork at all: none of them counts.
    expect(words(row(saved(3, 0))).friend.detail).toBe(
      "the friend has saved 0 of 5 cards (until Dec 1, 2026 UTC); 3 cards more have no artwork and do not count",
    );
  });

  it("cards without artwork never reach the bar, however many there are", () => {
    const many = words(row(saved(40, 4))).friend.detail;
    expect(many).toBe("the friend has saved 4 of 5 cards (until Dec 1, 2026 UTC); 36 cards more have no artwork and do not count");
    expect(many).not.toContain("hourly check");
  });

  it("every card carrying artwork adds no second sentence", () => {
    expect(words(row(saved(3, 3))).friend.detail).not.toContain("artwork");
    // A count that says more than the friend has cards (it cannot) is read as it is.
    expect(words(row(saved(2, 3))).friend.detail).toBe("the friend has saved 3 of 5 cards (until Dec 1, 2026 UTC)");
  });

  it("a database before 0208 has no artwork count: every card is read, as the rule then was", () => {
    const before = (cards: number) => row({ cards, rewards: facts({ friendQualifyingCards: null }) });
    expect(words(before(2)).friend.detail).toBe("the friend has saved 2 of 5 cards (until Dec 1, 2026 UTC)");
    expect(words(before(7)).friend.detail).toBe("the friend has 7 cards saved; the hourly check records it");
  });

  it("a plan does not stand in for the cards: only the cards are named", () => {
    const r = row({ ...saved(3, 3, { friendHasPlan: true }), cardOnFileAt: "2026-11-04T00:00:00Z" });
    expect(words(r).friend.detail).toBe("the friend has saved 3 of 5 cards (until Dec 1, 2026 UTC)");
    expect(words(r).referrer.detail).toBe(words(r).friend.detail);
  });

  it("the friend has the cards but the save's step was lost: the hourly check records it — with or without a plan", () => {
    const said = "the friend has 7 cards saved; the hourly check records it";
    for (const friendHasPlan of [false, true, null]) {
      const { friend, referrer } = words(row(saved(7, 7, { friendHasPlan })));
      expect(friend).toEqual({ state: "waiting", detail: said });
      expect(referrer).toEqual(friend);
    }
    // The number said is the cards that count.
    expect(words(row(saved(9, 7))).friend.detail).toBe(said);
    // Exactly the bar is the bar.
    expect(words(row(saved(5))).friend.detail).toBe("the friend has 5 cards saved; the hourly check records it");
    expect(words(row(saved(1)), { ...ctx, cardsRequired: 1 }).friend.detail).toBe("the friend has 1 card saved; the hourly check records it");
  });

  it("the cards saved and NO card on file: nothing is in the way — the cards alone qualify a referral", () => {
    const r = qualified();
    expect(r.cardOnFileAt).toBeNull();
    expect(r.rewards?.friendHasPlan).toBe(false);
    const { friend, referrer } = words(r, justQualified);
    expect(friend).toEqual({ state: "waiting", detail: IN_PLACE });
    expect(referrer).toEqual(friend);
  });

  it("a plan, recorded on the referral or not, changes nothing on a row whose cards are saved", () => {
    const plain = words(qualified(), justQualified);
    const unrecorded = qualified(saved(6, 6, { friendHasPlan: true }));
    const recorded = qualified({ ...saved(6, 6, { friendHasPlan: true }), cardOnFileAt: "2026-11-05T00:10:00Z" });
    expect(words(unrecorded, justQualified)).toEqual(plain);
    expect(words(recorded, justQualified)).toEqual(plain);
  });

  it("no reason names a plan, a card on file or a checkout — on any unclaimed row", () => {
    const contexts: RewardContext[] = [
      ctx,
      justQualified,
      { ...ctx, billingEnabled: false },
      { ...ctx, programEnabled: false },
      { ...ctx, hashKeySet: false },
      { ...ctx, cardsRequired: 1, windowDays: 7 },
    ];
    const said = new Set<string>();
    for (const status of ["signed_up", "first_card", "cards_saved"]) {
      for (const cardsSavedAt of [null, "2026-11-05T00:00:00Z"]) {
        for (const cardOnFileAt of [null, "2026-11-04T00:00:00Z", "2026-11-09T00:00:00Z"]) {
          for (const friendHasPlan of [false, true, null]) {
            for (const [all, withArt] of [[0, 0], [2, 2], [5, 3], [5, 4], [9, 9]] as const) {
              for (const confirmed of [true, false]) {
                for (const bankedDays of [0, 7]) {
                  const r = row({
                    status,
                    cardsSavedAt,
                    cardOnFileAt,
                    bankedDays,
                    ...saved(all, withArt, { friendHasPlan, friendEmailConfirmed: confirmed, referrerEmailConfirmed: confirmed }),
                  });
                  for (const c of contexts) {
                    const { friend, referrer } = words(r, c);
                    expect(friend.state).toBe("waiting");
                    expect(referrer).toEqual(friend);
                    said.add(friend.detail);
                  }
                }
              }
            }
          }
        }
      }
    }
    // Every kind of reason was reached…
    expect(said.size).toBeGreaterThanOrEqual(10);
    // …and none of them speaks of a plan.
    for (const detail of said) expect(detail).not.toMatch(/plan|card on file|checkout|banked/i);
  });

  it("past the window without the cards: it is about to expire, whatever the friend has now", () => {
    const late = row({ signedUpAt: "2026-10-01T00:00:00Z", ...saved(9) });
    expect(words(late).friend.detail).toBe(
      "the friend did not save 5 cards within 30 days of joining; the hourly check will expire this referral",
    );
  });

  it("the window's last instant is still inside it", () => {
    const edge = row({ signedUpAt: "2026-10-11T12:00:00Z", ...saved(1) });
    expect(words(edge).friend.detail).toBe("the friend has saved 1 of 5 cards (until Nov 10, 2026 UTC)");
  });

  it("a friend whose account is gone is an END for both sides, never 'not yet' — whatever the row was short of", () => {
    const none = { state: "none", detail: "the friend's account was deleted" };
    for (const gone of [
      row({ refereeId: null, refereeUsername: null, tier: null }),
      row({ refereeId: null, ...saved(7) }),
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
    expect(words(row(saved(7)), off).referrer.detail).toBe(said);
    expect(words(row(saved(2)), off).friend.detail).toBe(said);
    expect(words(row(saved(5, 3)), off).friend.detail).toBe(said);
  });

  it("the cards saved: the paused program comes before the emails and the key", () => {
    const paused = { ...ctx, programEnabled: false, hashKeySet: false };
    expect(words(qualified(), paused).friend.detail).toBe("the referral program is paused");
    expect(words(qualified(saved(6, 6, { friendEmailConfirmed: false })), paused).referrer.detail).toBe("the referral program is paused");
    // …but never before the cards: a friend still short of them is told so.
    expect(words(row(saved(2)), paused).friend.detail).toBe("the friend has saved 2 of 5 cards (until Dec 1, 2026 UTC)");
  });

  it("the cards saved: says WHOSE email is not confirmed, and the day the referral expires without it", () => {
    const until = `(the referral expires on Dec 5, 2026 UTC without it)`;
    expect(REFERRAL_CONFIRM_WINDOW_DAYS).toBe(30);
    expect(words(qualified(saved(6, 6, { friendEmailConfirmed: false }))).referrer.detail).toBe(`the friend's email is not confirmed ${until}`);
    expect(words(qualified(saved(6, 6, { referrerEmailConfirmed: false }))).friend.detail).toBe(`the referrer's email is not confirmed ${until}`);
    expect(words(qualified(saved(6, 6, { friendEmailConfirmed: false, referrerEmailConfirmed: false }))).friend.detail).toBe(
      `neither email is confirmed ${until}`,
    );
  });

  it("…counted from the day the cards were saved, whenever a plan was started", () => {
    const until = `(the referral expires on Dec 5, 2026 UTC without it)`;
    for (const cardOnFileAt of [null, "2026-11-01T00:00:00Z", "2026-11-09T00:00:00Z"]) {
      const r = qualified({ ...saved(6, 6, { friendEmailConfirmed: false, friendHasPlan: cardOnFileAt != null }), cardOnFileAt });
      expect(words(r).friend.detail).toBe(`the friend's email is not confirmed ${until}`);
    }
    const later = qualified({ ...saved(6, 6, { referrerEmailConfirmed: false }), cardsSavedAt: "2026-11-08T23:59:59Z" });
    expect(words(later).friend.detail).toBe("the referrer's email is not confirmed (the referral expires on Dec 8, 2026 UTC without it)");
  });

  it("an email whose state is unknown is not called unconfirmed", () => {
    const unknown = qualified(saved(6, 6, { friendEmailConfirmed: null, referrerEmailConfirmed: null }));
    expect(words(unknown, justQualified).friend.detail).toBe(IN_PLACE);
  });

  it("the cards saved, emails confirmed, no hash key: the server's key is named", () => {
    expect(words(qualified(), { ...ctx, hashKeySet: false }).friend.detail).toBe(
      "the server's REFERRAL_EMAIL_HASH_KEY is not set, so the email check cannot run",
    );
  });

  it("nothing in the way, just qualified: the hourly check gives it", () => {
    const { friend, referrer } = words(qualified(), justQualified);
    expect(friend).toEqual({ state: "waiting", detail: IN_PLACE });
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
  });

  it("…counted from the cards' stamp ALONE: when a plan was started moves nothing", () => {
    const stuck = words(qualified()).friend;
    expect(stuck.detail).toContain("it is failing");
    // A plan stamped half an hour ago does not make an old row "just qualified"…
    const planJustNow = qualified({ ...saved(6, 6, { friendHasPlan: true }), cardOnFileAt: "2026-11-10T11:30:00Z" });
    expect(words(planJustNow).friend).toEqual(stuck);
    // …and one stamped long before the cards does not make a new row late.
    const cardsJustNow = qualified({ ...saved(6, 6, { friendHasPlan: true }), cardsSavedAt: "2026-11-10T11:30:00Z", cardOnFileAt: "2026-11-01T00:00:00Z" });
    expect(words(cardsJustNow).friend.detail).toBe(IN_PLACE);
    expect(words(qualified({ cardsSavedAt: "2026-11-10T11:30:00Z" })).friend.detail).toBe(IN_PLACE);
  });

  it("0177's first_card state reads as cards_saved does", () => {
    expect(words(qualified({ status: "first_card" }), justQualified).friend).toEqual({ state: "waiting", detail: IN_PLACE });
  });

  it("days already in the friend's bank add no sentence: both sides read the same", () => {
    const pre = qualified({ bankedDays: 7 });
    const { friend, referrer } = words(pre, justQualified);
    expect(friend).toEqual({ state: "waiting", detail: IN_PLACE });
    expect(referrer).toEqual(friend);
    const short = words(row({ ...saved(2), bankedDays: 1 }));
    expect(short.friend.detail).toBe("the friend has saved 2 of 5 cards (until Dec 1, 2026 UTC)");
    expect(short.referrer).toEqual(short.friend);
  });
});

describe("a claimed referral", () => {
  const rewarded = (over: Partial<ReferralRewardFacts> = {}) =>
    qualified({ status: "rewarded", rewardedAt: "2026-11-05T00:00:01Z", ladderStep: 2, rewards: facts({ friendQualifyingCards: 6, ...over }) });

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

  it("a full block gives neither side anything, in the reason's own words — and nothing about a checkout", () => {
    const blocked = (reason: string) =>
      qualified({
        status: "blocked",
        blockReason: reason,
        rewards: facts({ friend: side({ kind: "none", reason }), referrer: side({ kind: "none" }) }),
      });
    expect(words(blocked("same_card"))).toEqual({
      friend: { state: "none", detail: "both accounts pay with the same card" },
      referrer: { state: "none", detail: "both accounts pay with the same card" },
    });
    expect(words(blocked("email_reused"))).toEqual({
      friend: { state: "none", detail: "the friend's email was already used by another account" },
      referrer: { state: "none", detail: "the friend's email was already used by another account" },
    });
    // A detail an older reward step wrote (days banked ahead of a checkout
    // and used by it) adds no words: the reason alone is said.
    const old = blocked("email_reused");
    old.rewards!.friend = { ...side({ kind: "none", reason: "email_reused" }), spent: true } as RewardSideFacts;
    expect(words(old).friend.detail).toBe("the friend's email was already used by another account");
  });

  it("over the monthly friend limit: neither side", () => {
    const capped = qualified({ status: "capped", rewards: facts({ friend: side({ kind: "none" }), referrer: side({ kind: "none" }) }) });
    expect(words(capped).friend).toEqual({ state: "none", detail: "the referrer was over the monthly limit of rewarded friends" });
    expect(words(capped).referrer).toEqual(words(capped).friend);
    // The claim's own reason on the friend's side reads the same, and no more.
    const named = qualified({ status: "capped", rewards: facts({ friend: side({ kind: "none", reason: "capped_friends" }), referrer: side({ kind: "none" }) }) });
    expect(words(named).friend).toEqual({ state: "none", detail: "the referrer was over the monthly limit of rewarded friends" });
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
    expect(referralRewardLines(words(row(saved(2))))).toEqual([
      { who: "Both sides", text: "not yet — the friend has saved 2 of 5 cards (until Dec 1, 2026 UTC)" },
    ]);
    expect(referralRewardLines(words(row(saved(5, 4))))).toEqual([
      {
        who: "Both sides",
        text: "not yet — the friend has saved 4 of 5 cards (until Dec 1, 2026 UTC); 1 card more has no artwork and does not count",
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
