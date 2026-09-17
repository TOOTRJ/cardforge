"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";
import { getSiteBaseUrl } from "@/lib/site-url";
import {
  changeEmailSchema,
  changePasswordSchema,
  fieldErrorsFromZod,
  type ActionState,
  type ChangeEmailInput,
  type ChangePasswordInput,
} from "@/lib/auth/schemas";

// ---------------------------------------------------------------------------
// Sign-in & security (settings): change email, change / set password, sign out
// everywhere. All three act on the caller's own session through Supabase Auth
// — no service role.
// ---------------------------------------------------------------------------

export type SecurityActionState<T extends Record<string, unknown>> =
  ActionState<T> & { success?: string };

const WEAK_PASSWORD =
  "That password is too weak or has appeared in a data breach — choose a different one.";

export async function changeEmailAction(
  _prev: SecurityActionState<ChangeEmailInput>,
  formData: FormData,
): Promise<SecurityActionState<ChangeEmailInput>> {
  const raw = { email: formData.get("email") };
  const parsed = changeEmailSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: fieldErrorsFromZod<ChangeEmailInput>(parsed.error.issues),
    };
  }

  const user = await getCurrentUser();
  if (!user) return { status: "error", formError: "You're not signed in." };
  if (parsed.data.email === user.email?.toLowerCase()) {
    return {
      status: "error",
      fieldErrors: { email: "That's already your email address." },
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser(
    { email: parsed.data.email },
    { emailRedirectTo: `${getSiteBaseUrl()}/auth/callback?redirectTo=/settings` },
  );
  if (error) {
    console.warn("changeEmailAction: updateUser error", error.message);
    // "email_exists" is deliberately NOT distinguished: that would let a
    // signed-in user probe which addresses have accounts.
    return {
      status: "error",
      formError:
        error.status === 429 || error.code === "over_email_send_rate_limit"
          ? "Too many attempts. Wait a minute, then try again."
          : "We couldn't start the email change. Check the address and try again.",
    };
  }

  // Nothing changes until the link is confirmed (both addresses when the
  // project has "secure email change" on).
  return {
    status: "idle",
    success: `Confirmation sent. Open the link we emailed to ${parsed.data.email} to finish — your current address keeps working until then.`,
  };
}

export async function changePasswordAction(
  _prev: SecurityActionState<ChangePasswordInput>,
  formData: FormData,
): Promise<SecurityActionState<ChangePasswordInput>> {
  const raw = {
    current_password: formData.get("current_password") ?? "",
    password: formData.get("password"),
  };
  const parsed = changePasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: fieldErrorsFromZod<ChangePasswordInput>(parsed.error.issues),
    };
  }

  const user = await getCurrentUser();
  if (!user?.email) return { status: "error", formError: "You're not signed in." };

  // Accounts that already sign in with a password must prove they know it —
  // an unattended, signed-in browser must not be enough to take the account.
  // The check runs on a throwaway cookie-less client so it can't disturb the
  // caller's session. (Google-only accounts have no password to check; this
  // form is how they add one.)
  const hasPassword = (user.identities ?? []).some((i) => i.provider === "email");
  if (hasPassword) {
    if (!parsed.data.current_password) {
      return {
        status: "error",
        fieldErrors: { current_password: "Enter your current password." },
      };
    }
    const verifier = createPublicClient();
    const { error: verifyError } = await verifier.auth.signInWithPassword({
      email: user.email,
      password: parsed.data.current_password,
    });
    if (verifyError) {
      return {
        status: "error",
        fieldErrors: {
          current_password:
            verifyError.status === 429
              ? "Too many attempts. Wait a minute, then try again."
              : "That isn't your current password.",
        },
      };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    console.warn("changePasswordAction: updateUser error", error.message);
    return {
      status: "error",
      ...(error.code === "weak_password"
        ? { fieldErrors: { password: WEAK_PASSWORD } }
        : error.code === "same_password"
          ? { fieldErrors: { password: "That's already your password." } }
          : { formError: "We couldn't update your password. Please try again." }),
    };
  }

  // Every other device is signed out; this one stays.
  try {
    await supabase.auth.signOut({ scope: "others" });
  } catch {
    // non-fatal
  }

  revalidatePath("/settings");
  return {
    status: "idle",
    success: hasPassword
      ? "Password updated. Your other devices were signed out."
      : "Password set. You can now sign in with your email and password too.",
  };
}

/** Revoke every session for this account — all devices, this one included. */
export async function signOutEverywhereAction() {
  const user = await getCurrentUser();
  if (user) {
    try {
      const supabase = await createClient();
      await supabase.auth.signOut({ scope: "global" });
    } catch {
      // best-effort: still leave this browser
    }
  }
  revalidatePath("/", "layout");
  redirect("/login?notice=signed-out-everywhere");
}
