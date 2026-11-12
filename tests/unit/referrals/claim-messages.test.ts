import { describe, expect, it } from "vitest";
import {
  REFERRAL_CODE_UNREADABLE,
  REFERRAL_LINK_COUNTED_INSTEAD,
  onboardingReferralNote,
  onboardingReferralToast,
  referralClaimError,
} from "@/lib/referrals/claim-messages";
import { REFERRAL_CLAIM_WINDOW_DAYS } from "@/lib/referrals/rules";
import type { RecordReferralSignupResult } from "@/lib/referrals/server";

// ---------------------------------------------------------------------------
// What a person READS when a referral code they typed is not taken (owner
// 2026-11-11: "Have a referral code?" — at onboarding and on the Refer a
// friend page). One sentence per refusal of the claim (recordReferralSignup),
// in one place: the words say what to do next, name the 14-day window from
// the rule's own constant, and are never a fraud reason.
//
// At ONBOARDING the account is finished whatever the claim says, so only the
// refusals a person can fix by retyping are told there (no code in what was
// typed, a code nobody has, their own code); the rest say nothing.
// ---------------------------------------------------------------------------

type Refusal = Extract<RecordReferralSignupResult, { ok: false }>["reason"];

/** EVERY refusal the claim can answer, with its words. Typed by the claim's
 *  own result: a reason added there fails this file until it has a sentence. */
const WORDS: Record<Refusal, string> = {
  bad_code: "That doesn't look like a referral code or link. Check it and try again.",
  unknown_code: "Nobody has that referral code. Check it with your friend and try again.",
  self: "That is your own code. Enter the code of the friend who told you about PipGlyph.",
  reciprocal: "That friend joined through your link, so their code can't be added to your account.",
  not_new: "A referral code can be added in an account's first 14 days, before a plan is started.",
  exists: "Your account already has a referral.",
  program_off: "The referral program is paused right now.",
  error: "Couldn't add the code. Try again in a moment.",
};
const REASONS = Object.keys(WORDS) as Refusal[];

describe("referralClaimError", () => {
  it("has a sentence for every refusal of the claim — these words", () => {
    expect(REASONS).toHaveLength(8);
    for (const reason of REASONS) expect(referralClaimError(reason), reason).toBe(WORDS[reason]);
  });

  it("every sentence is a whole one, and no two refusals read the same", () => {
    const said = REASONS.map((reason) => referralClaimError(reason));
    for (const sentence of said) {
      expect(sentence).toMatch(/^[A-Z].*\.$/);
      expect(sentence.length).toBeGreaterThan(20);
      expect(sentence.length).toBeLessThan(140);
    }
    expect(new Set(said).size).toBe(REASONS.length);
  });

  it("a value typed that is no code reads the same whoever finds it: the page (before any claim) or the claim itself", () => {
    expect(REFERRAL_CODE_UNREADABLE).toBe(WORDS.bad_code);
    expect(referralClaimError("bad_code")).toBe(REFERRAL_CODE_UNREADABLE);
  });

  it("\"not new\" names the claim window from the rule's own number", () => {
    expect(REFERRAL_CLAIM_WINDOW_DAYS).toBe(14);
    expect(referralClaimError("not_new")).toContain(`first ${REFERRAL_CLAIM_WINDOW_DAYS} days`);
    // The other half of "new": no plan started.
    expect(referralClaimError("not_new")).toMatch(/before a plan is started/);
    // Never the retired rule (saved cards made an account "not new").
    expect(referralClaimError("not_new")).not.toMatch(/card/i);
  });

  it("an answer it does not know (a failed read, a reason added later) is the try-again line, never blank", () => {
    expect(referralClaimError("error")).toBe("Couldn't add the code. Try again in a moment.");
    expect(referralClaimError("something_new" as Refusal)).toBe("Couldn't add the code. Try again in a moment.");
  });

  it("is never a fraud reason, an id or a code: the words accuse nobody and leak nothing", () => {
    for (const reason of REASONS) {
      const sentence = referralClaimError(reason);
      expect(sentence, reason).not.toMatch(/fraud|abuse|suspicious|blocked|banned|not eligible|duplicate|fingerprint|same (?:email|device|address)/i);
      expect(sentence, reason).not.toMatch(/[a-f0-9]{8}/);
      expect(sentence, reason).not.toMatch(/undefined|null|\[object/);
    }
  });
});

describe("onboardingReferralNote", () => {
  it("tells only what retyping can fix: no code in it, a code nobody has, their own", () => {
    expect(onboardingReferralNote("bad_code")).toBe(WORDS.bad_code);
    expect(onboardingReferralNote("unknown_code")).toBe(WORDS.unknown_code);
    expect(onboardingReferralNote("self")).toBe(WORDS.self);
  });

  it("says nothing for every other refusal — onboarding goes on, and there is nothing to retype", () => {
    const told: Refusal[] = ["bad_code", "unknown_code", "self"];
    const silent = REASONS.filter((reason) => !told.includes(reason));
    expect(silent.sort()).toEqual(["error", "exists", "not_new", "program_off", "reciprocal"]);
    for (const reason of silent) expect(onboardingReferralNote(reason), reason).toBeNull();
    expect(onboardingReferralNote("something_new" as Refusal)).toBeNull();
  });

  it("a note is always the claim's own sentence for that refusal", () => {
    for (const reason of REASONS) {
      const note = onboardingReferralNote(reason);
      if (note !== null) expect(note).toBe(referralClaimError(reason));
    }
  });
});

describe("onboardingReferralToast", () => {
  it("a code that was not taken can still be typed on the Refer a friend page: the note, then where", () => {
    expect(onboardingReferralToast(referralClaimError("unknown_code"), false)).toBe(
      "Nobody has that referral code. Check it with your friend and try again. You can add it later from Refer a friend.",
    );
  });

  it("the link counted in its place: the sentence alone — an account has one referral, so nothing can be added later", () => {
    expect(onboardingReferralToast(REFERRAL_LINK_COUNTED_INSTEAD, true)).toBe(REFERRAL_LINK_COUNTED_INSTEAD);
    expect(REFERRAL_LINK_COUNTED_INSTEAD).toBe(
      "The referral code you typed wasn't taken, so the friend's link you opened before was counted instead.",
    );
    expect(REFERRAL_LINK_COUNTED_INSTEAD).not.toMatch(/later|try again/i);
  });
});
