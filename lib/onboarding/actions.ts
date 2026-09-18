"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { usernameSchema } from "@/lib/auth/schemas";
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
});

export type CompleteResult = { ok: true } | { ok: false; error: string };

/** Finish (or skip) onboarding. `preferences` is omitted on "Skip" — the
 *  row's defaults stand, which never include the newsletter. */
export async function completeOnboardingAction(input: {
  preferences?: { account: boolean; activity: boolean; newsletter: boolean };
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
  return { ok: true };
}
