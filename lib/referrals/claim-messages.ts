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

/** Too many codes tried in a short time (both places share one counter). */
export const REFERRAL_CODE_TOO_MANY_TRIES = "That's a lot of tries. Wait a minute and try again.";

/** Onboarding: a code the person TYPED could not be saved (the database did
 *  not answer, twice). The account is finished all the same. */
export const REFERRAL_CODE_NOT_SAVED = "We couldn't add your referral code just now.";

/** ONBOARDING, a code the person TYPED that cannot be used (no code in it,
 *  nobody has it, their own, too many tries): said while they are still on
 *  the step, so they can fix it — an account has ONE referral, so guessing
 *  for them (crediting the link the browser remembered instead) could never
 *  be undone. The field is optional: emptying it is always a way on. */
export function onboardingCodeError(sentence: string): string {
  return `${sentence} You can also clear the field and finish without a code.`;
}

/** What onboarding's toast says about a code that was sent and not taken
 *  once the account is finished: the sentence, then where it can still be
 *  typed (the Refer a friend page's form, open while no referral exists). */
export function onboardingReferralToast(note: string): string {
  return `${note} You can add it later from Refer a friend.`;
}

/** The refusals a person can fix by retyping. At ONBOARDING a code they
 *  TYPED stops the step with these words (onboardingCodeError); the link an
 *  account merely arrived with never stops anything — it is a toast. */
export function onboardingReferralNote(reason: Refusal): string | null {
  return reason === "bad_code" || reason === "unknown_code" || reason === "self" ? referralClaimError(reason) : null;
}
