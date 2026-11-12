import type { ReferredFriend, RewardSideFacts } from "@/lib/admin/analytics/referrals";
import { REFERRAL_CONFIRM_WINDOW_DAYS, REFERRAL_GRANT_MAX_ATTEMPTS } from "@/lib/referrals/rules";
import { formatUtcDate } from "@/lib/format/dates";

// ---------------------------------------------------------------------------
// WHY a referral's reward has not been given (owner 2026-11-11: "include
// the reason a referrer or referred user has not received their reward
// yet") — the Referred friends table's "Rewards" column, in plain words.
//
// Pure: a row (0206 / 0208's facts) and what only the app knows (the
// program's settings, whether billing is on, whether the email hash key is
// set) in, each side's standing out. The reasons are the reward step's OWN
// tests (lib/referrals/server.ts advanceReferral / rewardReferral /
// grantOwedSides), in the order it makes them — when that step gains or
// loses a condition, this changes with it. Since 2026-11-11 a referral
// qualifies on the friend's CARDS ALONE (with artwork); a plan with a card
// on file is no condition, so no reason here names one:
//
//   not claimed yet   billing off (nothing is rewarded and the hourly
//                     sweep does not run, so it is said first); the friend's
//                     cards with artwork (the settings' number, inside the
//                     window); the program on, both emails confirmed, the
//                     hash key — else "the hourly check gives the reward"
//                     (/api/cron/referral-rewards, every hour), and a row
//                     still unclaimed hours after it qualified says the step
//                     is FAILING, never "all fine";
//   claimed           a side still NULL is a grant that failed and is
//                     retried; a side recorded 'none' says why (its detail's
//                     reason, else the row's status and block reason).
//
// "The hourly check records it" is said only of what the sweep really picks
// up (sweepReferralRewards): a signed-up friend who has the cards
// (referrals_stranded_signups) and a row with its cards stamp. A friend
// whose account is gone is never rewarded.
//
// An admin page: a fraud reason is named here. The referrer's own dashboard
// never names one (REFERRAL_STATUS_LABELS: "Not eligible").
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
/** A row whose cards stand is claimed when they land, else by the next
 *  hourly sweep. Still unclaimed this long after, the step ran and did not
 *  finish (an email check or the claim itself is erroring). */
const STUCK_AFTER_MS = 2 * 3_600_000;

export type RewardContext = {
  /** The settings' `activation.cardsRequired`. */
  cardsRequired: number;
  /** The settings' `activation.windowDays`. */
  windowDays: number;
  /** The settings' `enabled` (an admin's pause switch). */
  programEnabled: boolean;
  billingEnabled: boolean;
  /** REFERRAL_EMAIL_HASH_KEY is set (no key, no reward: fail closed). */
  hashKeySet: boolean;
  now: Date;
};

export type SideReward = {
  /** given = the side has its reward; waiting = it is still owed; none = the
   *  referral ended with nothing for this side. */
  state: "given" | "waiting" | "none";
  /** What was given, or why not — a phrase that reads after "Friend: " or
   *  "not yet — ". */
  detail: string;
};

export type ReferralRewards = { friend: SideReward; referrer: SideReward };

/** Why a blocked referral rewards nobody (or, for `same_domain`, not the
 *  referrer) — one phrase per reason in 0177's block_reason CHECK. */
export const REFERRAL_BLOCK_WHY: Record<string, string> = {
  same_email: "the friend's email is the referrer's own inbox",
  // Only where both accounts already had a card with Stripe when the
  // referral was judged (a friend rewarded on their cards usually has none).
  same_card: "both accounts pay with the same card",
  same_domain: "both emails are on the same company domain",
  disposable_email: "the friend joined with a throwaway email",
  not_new: "the friend's account was not new",
  email_reused: "the friend's email was already used by another account",
  account_deleted: "the friend's account was deleted",
};

const spaced = (code: string) => code.replace(/_/g, " ").trim();
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const cardsWords = (n: number) => plural(n, "card", "cards");
const dayOf = (ms: number) => formatUtcDate(new Date(ms).toISOString());

const UNCLAIMED = new Set(["signed_up", "first_card", "cards_saved"]);

/** A recorded reward, in words: "7 free days", "10 AI credits (ladder step 4)". */
function givenWords(side: RewardSideFacts, isReferrer: boolean): string {
  const what =
    side.kind === "credits"
      ? side.credits != null
        ? plural(side.credits, "AI credit", "AI credits")
        : "AI credits"
      : side.days != null
        ? plural(side.days, "free day", "free days")
        : "Free days";
  return isReferrer && side.step != null ? `${what} (ladder step ${side.step})` : what;
}

/** Why a row that ended gave this side nothing, from the row alone. */
function endedWhy(row: ReferredFriend): string {
  switch (row.status) {
    case "expired":
      // No numbers for the cards: the settings may have changed since this
      // row expired, and today's would be stated as the rule it broke.
      return row.cardsSavedAt
        ? `an email was not confirmed within ${REFERRAL_CONFIRM_WINDOW_DAYS} days of the friend qualifying`
        : "the friend did not save the required cards in time";
    case "capped":
      return "the referrer was over the monthly limit of rewarded friends";
    case "blocked":
      return row.blockReason ? (REFERRAL_BLOCK_WHY[row.blockReason] ?? spaced(row.blockReason)) : "the referral was blocked";
    default:
      return "no reward was recorded";
  }
}

/** Why a side was recorded 'none'. */
function noneWhy(row: ReferredFriend, side: RewardSideFacts, isReferrer: boolean): string {
  switch (side.reason) {
    case null:
      return endedWhy(row);
    case "admin":
      return "admin accounts get no referral reward";
    case "settings":
      return isReferrer ? "the ladder gives nothing at this step" : "the program gives the friend no days";
    case "grant_failed":
      return `the grant failed ${REFERRAL_GRANT_MAX_ATTEMPTS} times and was given up; it needs a look`;
    case "no_profile":
      return "the account has no profile";
    case "account_deleted":
      return isReferrer ? "the account was deleted" : "the friend's account was deleted";
    case "expired":
      return endedWhy({ ...row, status: "expired" });
    case "capped_friends":
      return endedWhy({ ...row, status: "capped" });
    default:
      return REFERRAL_BLOCK_WHY[side.reason] ?? spaced(side.reason);
  }
}

/** Why a row the reward step has not claimed yet rewards nobody so far —
 *  the step's own conditions, in its order. The friend's account exists
 *  (the caller answers for one that is gone). */
function unclaimedWhy(row: ReferredFriend, ctx: RewardContext): string {
  // Nothing is rewarded and the hourly sweep does not run while billing is
  // off: every "the hourly check…" below would be untrue.
  if (!ctx.billingEnabled) return "billing is switched off, so no referral is rewarded until it is on";
  const facts = row.rewards;
  if (!row.cardsSavedAt) {
    // The cards a referral counts carry artwork (0208). A database before
    // 0208 has no such count: every card is read, as the rule then was.
    const counted = facts?.friendQualifyingCards ?? row.cards;
    const without = Math.max(0, row.cards - counted);
    const deadline = Date.parse(row.signedUpAt) + ctx.windowDays * DAY_MS;
    if (Number.isFinite(deadline) && ctx.now.getTime() > deadline) {
      return `the friend did not save ${cardsWords(ctx.cardsRequired)} within ${ctx.windowDays} days of joining; the hourly check will expire this referral`;
    }
    if (counted >= ctx.cardsRequired) return `the friend has ${cardsWords(counted)} saved; the hourly check records it`;
    const until = Number.isFinite(deadline) ? ` (until ${dayOf(deadline)})` : "";
    const saved = `the friend has saved ${counted} of ${cardsWords(ctx.cardsRequired)}${until}`;
    return without > 0 ? `${saved}; ${cardsWords(without)} more ${without === 1 ? "has" : "have"} no artwork and ${without === 1 ? "does" : "do"} not count` : saved;
  }

  // The cards stand: what the reward step still checks before the claim.
  if (!ctx.programEnabled) return "the referral program is paused";
  const friendUnconfirmed = facts?.friendEmailConfirmed === false;
  const referrerUnconfirmed = facts?.referrerEmailConfirmed === false;
  if (friendUnconfirmed || referrerUnconfirmed) {
    const who =
      friendUnconfirmed && referrerUnconfirmed
        ? "neither email is confirmed"
        : friendUnconfirmed
          ? "the friend's email is not confirmed"
          : "the referrer's email is not confirmed";
    const deadline = Date.parse(row.cardsSavedAt) + REFERRAL_CONFIRM_WINDOW_DAYS * DAY_MS;
    return Number.isFinite(deadline) ? `${who} (the referral expires on ${dayOf(deadline)} without it)` : who;
  }
  if (!ctx.hashKeySet) return "the server's REFERRAL_EMAIL_HASH_KEY is not set, so the email check cannot run";
  // The step ran when the cards landed and runs again every hour. A row
  // that has waited longer than that did not go through: its email check
  // or its claim is erroring — never report that as "all fine".
  const qualified = Date.parse(row.cardsSavedAt);
  if (Number.isFinite(qualified) && ctx.now.getTime() - qualified > STUCK_AFTER_MS) {
    return `everything is in place since ${dayOf(qualified)}, but the reward step has not gone through; it is failing — the server log's [referrals] lines say why`;
  }
  return "everything is in place; the hourly check gives the reward";
}

/** A claimed row's side that is still NULL: its grant has not gone through. */
function owedWhy(row: ReferredFriend, ctx: RewardContext): string {
  if (!ctx.billingEnabled) return "billing is switched off, so the grant waits until it is on";
  const attempts = row.rewards?.grantAttempts ?? 0;
  return attempts > 0
    ? `the grant failed ${plural(attempts, "time", "times")}; the hourly check retries it (up to ${REFERRAL_GRANT_MAX_ATTEMPTS})`
    : "the grant has not finished; the hourly check completes it";
}

function sideReward(row: ReferredFriend, isReferrer: boolean, ctx: RewardContext): SideReward {
  const facts = row.rewards!;
  const side = isReferrer ? facts.referrer : facts.friend;
  // 'free_days' is 0177's name for a reward in days (a dated grant then, the
  // days bank since 0180): given all the same.
  if (side.kind === "banked_days" || side.kind === "free_days" || side.kind === "credits") {
    return { state: "given", detail: givenWords(side, isReferrer) };
  }
  if (side.kind === "none") return { state: "none", detail: noneWhy(row, side, isReferrer) };
  if (side.kind != null) return { state: "given", detail: spaced(side.kind) };

  // Nothing recorded for this side yet.
  if (UNCLAIMED.has(row.status)) {
    // A friend whose account is gone is never rewarded, and neither is
    // their referrer: that is an end, not a wait (a row short of its
    // stamps is never looked at again, so "not yet" would stand for ever).
    if (!row.refereeId) return { state: "none", detail: "the friend's account was deleted" };
    return { state: "waiting", detail: unclaimedWhy(row, ctx) };
  }
  // A claimed row: the friend is owed on any of them, the referrer only on
  // a rewarded one (a capped or blocked row gives the referrer nothing).
  if (row.status === "rewarded" || (!isReferrer && (row.status === "blocked" || row.status === "capped"))) {
    return { state: "waiting", detail: owedWhy(row, ctx) };
  }
  return { state: "none", detail: endedWhy(row) };
}

/** Each side's reward, or why it has none (yet). Null when the row carries
 *  no reward facts (a database before 0206): say nothing rather than guess. */
export function referralRewardWords(row: ReferredFriend, ctx: RewardContext): ReferralRewards | null {
  if (!row.rewards) return null;
  return { friend: sideReward(row, false, ctx), referrer: sideReward(row, true, ctx) };
}

/** One side as the cell prints it after its label: "7 free days", "not yet —
 *  the friend has saved 2 of 5 cards", "none — …". */
export function sideRewardText(side: SideReward): string {
  if (side.state === "given") return side.detail;
  return `${side.state === "waiting" ? "not yet" : "none"} — ${side.detail}`;
}

/**
 * The cell's lines. Both sides waiting (or ended) for the SAME reason read
 * as one line — "Both sides: not yet — …" — instead of the sentence twice;
 * anything else is one line a side.
 */
export function referralRewardLines(rewards: ReferralRewards): Array<{ who: string; text: string }> {
  const { friend, referrer } = rewards;
  if (friend.state !== "given" && friend.state === referrer.state && friend.detail === referrer.detail) {
    return [{ who: "Both sides", text: sideRewardText(friend) }];
  }
  return [
    { who: "Friend", text: sideRewardText(friend) },
    { who: "Referrer", text: sideRewardText(referrer) },
  ];
}
