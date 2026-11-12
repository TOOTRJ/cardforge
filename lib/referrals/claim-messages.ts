import { REFERRAL_CLAIM_WINDOW_DAYS } from "@/lib/referrals/rules";
import type { RecordReferralSignupResult } from "@/lib/referrals/server";

// ---------------------------------------------------------------------------
// What a person reads when a referral code they TYPED is not taken (owner
// 2026-11-11: "Have a referral code?" for new accounts — at onboarding and
// on the Refer a friend page). Pure, so every refusal has its words in one
// place and a test. Never a fraud reason: these are the claim's own
// refusals (the code, the account's age), not the reward step's.
// ---------------------------------------------------------------------------

export type ClaimReferralResult = { ok: true } | { ok: false; error: string };

type Refusal = Extract<RecordReferralSignupResult, { ok: false }>["reason"];

/** A typed value that reads as no code at all. */
export const REFERRAL_CODE_UNREADABLE = "That doesn't look like a referral code or link. Check it and try again.";

export function referralClaimError(reason: Refusal): string {
  switch (reason) {
    case "bad_code":
      return REFERRAL_CODE_UNREADABLE;
    case "unknown_code":
      return "Nobody has that referral code. Check it with your friend and try again.";
    case "self":
      return "That is your own code. Enter the code of the friend who told you about PipGlyph.";
    case "reciprocal":
      return "That friend joined through your link, so their code can't be added to your account.";
    case "not_new":
      return `A referral code can be added in an account's first ${REFERRAL_CLAIM_WINDOW_DAYS} days, before a plan is started.`;
    case "exists":
      return "Your account already has a referral.";
    case "program_off":
      return "The referral program is paused right now.";
    default:
      return "Couldn't add the code. Try again in a moment.";
  }
}

/** Onboarding, when a code the person TYPED was not taken and the link the
 *  account arrived with was claimed in its place: an account has one
 *  referral, so there is nothing left to add later — it says what happened. */
export const REFERRAL_LINK_COUNTED_INSTEAD =
  "The referral code you typed wasn't taken, so the friend's link you opened before was counted instead.";

/** What onboarding's toast says about a code that was sent and not taken.
 *  `linkCounted`: the note already says the whole of it (above); otherwise
 *  the code can still be typed on the Refer a friend page. */
export function onboardingReferralToast(note: string, linkCounted: boolean): string {
  return linkCounted ? note : `${note} You can add it later from Refer a friend.`;
}

/** The refusals worth telling someone who typed a code at ONBOARDING, which
 *  goes on whatever the claim says: only what they can fix by retyping. */
export function onboardingReferralNote(reason: Refusal): string | null {
  return reason === "bad_code" || reason === "unknown_code" || reason === "self" ? referralClaimError(reason) : null;
}
