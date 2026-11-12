"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { usernameSchema } from "@/lib/auth/schemas";
import { recordReferralSignup } from "@/lib/referrals/server";
import { ensureSignupBankEntry } from "@/lib/billing/day-bank";
import { isBillingEnabled } from "@/lib/billing/flags";
import { normalizeReferralCode } from "@/lib/referrals/rules";
import { sanitizeAttribution } from "@/lib/analytics/attribution";
import { signupMethodOf } from "@/lib/analytics/funnel-events";
import { recordSignup } from "@/lib/analytics/funnel-server";
import { REFERRAL_LINK_COUNTED_INSTEAD, onboardingReferralNote } from "@/lib/referrals/claim-messages";
import { hitKeyedLimit } from "@/lib/api/keyed-limit";
import { welcomeEmail } from "@/lib/email/messages";
import { getRecipientFor } from "@/lib/email/preferences";
import { isEmailConfigured, sendEmail } from "@/lib/email/send";

// ---------------------------------------------------------------------------
// First-run onboarding (/onboarding). Three small writes, all on the caller's
// own rows through their RLS session:
//   1. identity  — username + display name (+ optional bio)
//   2. look      — avatar/banner, handled by lib/profile/upload-server.ts
//   3. email     — the three opt-in/out switches, then profiles.onboarded_at
// Skipping is allowed at every step: the account already has a unique handle
// (0094) and a random default avatar + banner (0095), and email defaults are
// the conservative ones (newsletter off).
// ---------------------------------------------------------------------------

export type UsernameCheck =
  | { status: "available" }
  | { status: "taken" | "invalid"; message: string };

/** Live availability for the username field. Public information (profiles are
 *  world-readable), so there is nothing to leak. */
export async function checkUsernameAction(value: string): Promise<UsernameCheck> {
  const parsed = usernameSchema.safeParse(value);
  if (!parsed.success) {
    return { status: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid username." };
  }
  const user = await getCurrentUser();
  if (!user) return { status: "invalid", message: "You're not signed in." };
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", parsed.data)
    .neq("id", user.id)
    .maybeSingle();
  return data
    ? { status: "taken", message: "That username is taken — try another." }
    : { status: "available" };
}

const identitySchema = z.object({
  username: usernameSchema,
  display_name: z
    .string()
    .trim()
    .min(1, "Display name is required.")
    .max(64, "Display name must be 64 characters or fewer."),
  bio: z.string().trim().max(280, "Bio must be 280 characters or fewer.").optional(),
});

export type IdentityResult =
  | { ok: true; username: string }
  | { ok: false; fieldErrors: Partial<Record<"username" | "display_name" | "bio", string>>; error?: string };

export async function saveOnboardingIdentityAction(input: {
  username: string;
  display_name: string;
  bio?: string;
}): Promise<IdentityResult> {
  const parsed = identitySchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<"username" | "display_name" | "bio", string>> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if ((key === "username" || key === "display_name" || key === "bio") && !fieldErrors[key]) {
        fieldErrors[key] = issue.message;
      }
    }
    return { ok: false, fieldErrors };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, fieldErrors: {}, error: "You're not signed in." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      username: parsed.data.username,
      display_name: parsed.data.display_name,
      bio: parsed.data.bio ? parsed.data.bio : null,
    })
    .eq("id", user.id);
  if (error) {
    // Unique index / reserved-handle guard (migration 0094) are the authority.
    if (error.code === "23505") {
      return { ok: false, fieldErrors: { username: "That username is taken — try another." } };
    }
    if (error.code === "23514") {
      return { ok: false, fieldErrors: { username: "That username is reserved — try another." } };
    }
    console.warn("saveOnboardingIdentityAction:", error.message);
    return { ok: false, fieldErrors: {}, error: "We couldn't save that. Please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true, username: parsed.data.username };
}

const completeSchema = z.object({
  preferences: z
    .object({
      account: z.boolean(),
      activity: z.boolean(),
      newsletter: z.boolean(),
    })
    .optional(),
  /** The tab's first-touch referral code (a Google sign-up never posts the
   *  signup form's hidden fields — this is its one chance). */
  referralCode: z.string().max(16).optional(),
  /** A code the person TYPED on this step ("Have a referral code?"): their
   *  own word for who brought them, so it wins over the link the browser
   *  remembered — which may be weeks old and somebody else's. */
  typedReferralCode: z.string().max(16).optional(),
  /** The tab's first-touch attribution, for the same reason: an account
   *  made with Google or Discord has no `signup` funnel row until here.
   *  Sanitized on the server like the signup form's hidden fields
   *  (sanitizeAttribution keeps the known keys' short safe strings) — and
   *  NEVER a reason to refuse: a blob in any other shape is dropped. */
  attribution: z.record(z.string(), z.unknown()).optional().catch(undefined),
});

export type CompleteResult =
  // `referralNote`: a referral code that was sent and not taken, in words —
  // only where retyping it could help (a code nobody has, their own).
  // Onboarding is finished all the same: a referral never blocks an account.
  // `referralLinkCounted`: the code TYPED was not taken and the link the
  // account arrived with was claimed in its place (the note says so).
  | { ok: true; referralNote?: string; referralLinkCounted?: true }
  | { ok: false; error: string };

/** Finish (or skip) onboarding. `preferences` is omitted on "Skip" — the
 *  row's defaults stand, which never include the newsletter. */
export async function completeOnboardingAction(input: {
  typedReferralCode?: string;
  preferences?: { account: boolean; activity: boolean; newsletter: boolean };
  referralCode?: string;
  attribution?: Record<string, unknown>;
}): Promise<CompleteResult> {
  const parsed = completeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid preferences." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You're not signed in." };

  const supabase = await createClient();
  if (parsed.data.preferences) {
    const { error } = await supabase
      .from("email_preferences")
      .update({
        account_emails: parsed.data.preferences.account,
        activity_emails: parsed.data.preferences.activity,
        newsletter: parsed.data.preferences.newsletter,
      })
      .eq("user_id", user.id);
    if (error) {
      console.warn("completeOnboardingAction: preferences", error.message);
      return { ok: false, error: "Couldn't save your email preferences. Please try again." };
    }
  }

  // The referral the account arrived with is claimed HERE — the first step
  // an account takes with a confirmed email (a session needs one) — from
  // the code the signup put on the account's app_metadata (the server's),
  // else the tab's first touch (a Google sign-up posts no signup form).
  // recordReferralSignup checks the account is new, the program is on, and
  // keeps the first claim (a repeat is "exists", harmless). A claim that
  // FAILED on a read is tried once more: nothing else retries it (onboarding
  // goes on either way — a referral never blocks an account), and a friend's
  // link lost here is lost for good.
  const metadataCode = normalizeReferralCode((user.app_metadata as { referral_code?: unknown } | null)?.referral_code);
  const typedCode = normalizeReferralCode(parsed.data.typedReferralCode);
  // The link this account arrived with — what stands when nothing readable
  // was typed, and what a typed code that is NOT taken falls back to (a
  // typo must not cost the friend whose link was followed).
  const arrivedCode = metadataCode ?? normalizeReferralCode(parsed.data.referralCode);
  const referralCode = typedCode ?? arrivedCode;
  let referralNote: string | null = null;
  let referralLinkCounted = false;
  // The claim is counted against the same limit as the Refer a friend
  // page's form (this action can be called again after onboarding, and its
  // answer says whether a code exists): past it the code is not looked at.
  const withinLimit =
    referralCode && isAdminConfigured()
      ? (
          await hitKeyedLimit({
            context: "referral-code-entry",
            subject: user.id,
            perMinute: 5,
            perHour: 20,
            message: "",
          })
        ).ok
      : false;
  if (referralCode && withinLimit) {
    const admin = createAdminClient();
    const claimCode = async (code: string) => {
      let answer = await recordReferralSignup(admin, { refereeId: user.id, code });
      if (!answer.ok && answer.reason === "error") {
        answer = await recordReferralSignup(admin, { refereeId: user.id, code });
        if (!answer.ok && answer.reason === "error") {
          console.error(`[referrals] the claim for ${user.id} failed twice; the referral is not recorded.`);
        }
      }
      return answer;
    };
    const claim = await claimCode(referralCode);
    if (!claim.ok) referralNote = onboardingReferralNote(claim.reason);
    // A TYPED code nobody can be credited for (nobody has it, it is their
    // own): the link the account arrived with is claimed in its place — a
    // typo must not cost the friend whose link was really followed, nor the
    // new account its own days. Said in the note: an account has one
    // referral, so the typed code can no longer be added afterwards. A link
    // that is not taken either leaves the typed code's note as it was.
    if (!claim.ok && referralNote && typedCode && arrivedCode && arrivedCode !== typedCode) {
      const fallback = await claimCode(arrivedCode);
      if (fallback.ok) {
        referralNote = REFERRAL_LINK_COUNTED_INSTEAD;
        referralLinkCounted = true;
      }
    }
  }
  // The signup days (the days bank, 0179): every new account's free period
  // in waiting. Once per account; the first checkout judges whether they
  // are owed (lib/stripe/actions.ts) and applies them.
  if (isBillingEnabled() && isAdminConfigured()) {
    try {
      await ensureSignupBankEntry(createAdminClient(), user.id);
    } catch {
      // Best effort: the checkout writes the entry itself if this was lost.
    }
  }

  // `is null` makes a double submit (or a second tab) a no-op, so the welcome
  // email below goes out exactly once.
  const { data: finished, error } = await supabase
    .from("profiles")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("id", user.id)
    .is("onboarded_at", null)
    .select("username, display_name");
  if (error) {
    console.warn("completeOnboardingAction: profile", error.message);
    return { ok: false, error: "Couldn't finish setting up. Please try again." };
  }

  const profile = finished?.[0];
  if (profile && isAdminConfigured()) {
    // Funnel: the tab's first touch on the account's `signup` row. An
    // account made with Google or Discord was recorded at /auth/callback
    // with its method alone (the server has no attribution there); this is
    // where the tab hands it over — and a second chance to write the row
    // if the callback's write was lost. `referred` from the code this
    // account is claimed with, as the email form's row has it. Only by the
    // call that finished onboarding, after the response, and never able to
    // fail it. Identity as plain values (never re-auth in after()).
    const userId = user.id;
    // `referred` only from the code the account is really claimed with —
    // never from a `ref` inside the posted blob.
    const { ref: _blobRef, ...firstTouch } = sanitizeAttribution(parsed.data.attribution ?? null);
    void _blobRef;
    const props = {
      ...firstTouch,
      ...(referralCode ? { referred: true } : {}),
      method: signupMethodOf((user.app_metadata as { provider?: unknown } | null)?.provider),
    };
    after(async () => {
      try {
        await recordSignup(createAdminClient(), { userId, props });
      } catch {
        // best-effort
      }
    });
  }
  if (profile && isEmailConfigured() && isAdminConfigured()) {
    // After the response, identity passed in as plain values — never re-auth
    // inside after() (it can rotate the session cookie with nowhere to set it).
    const userId = user.id;
    after(async () => {
      try {
        const recipient = await getRecipientFor(createAdminClient(), userId, "account");
        if (!recipient) return;
        await sendEmail(
          welcomeEmail(recipient, {
            displayName: profile.display_name || profile.username,
            username: profile.username,
          }),
          { idempotencyKey: `welcome:${userId}` },
        );
      } catch {
        // best-effort
      }
    });
  }

  revalidatePath("/", "layout");
  if (!referralNote) return { ok: true };
  return referralLinkCounted ? { ok: true, referralNote, referralLinkCounted: true } : { ok: true, referralNote };
}
