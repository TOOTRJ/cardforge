"use server";

import { recordFunnelEvent } from "@/lib/analytics/funnel-server";
import { ATTRIBUTION_FIELDS, sanitizeAttribution } from "@/lib/analytics/attribution";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isRecoverySession } from "@/lib/auth/recovery-session";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getSiteBaseUrl } from "@/lib/site-url";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";
import { EMAIL_LINK_COPY, parseEmailLinkType } from "@/lib/auth/email-links";
import {
  fieldErrorsFromZod,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
  type ActionState,
  type ForgotPasswordInput,
  type LoginInput,
  type ResetPasswordInput,
  type SignupInput,
} from "@/lib/auth/schemas";

// Generic signup error — Supabase's raw "User already registered" / "rate
// limit" / etc. messages leak signal that helps account enumeration. We
// normalize to a single message and rely on the email verification flow to
// surface "already registered" via the confirmation email path. We still
// log the underlying error to the server for debugging; nothing reaches the
// client.
const GENERIC_SIGNUP_ERROR =
  "We couldn't create your account. Double-check your details and try again.";

// Generic sign-in error, for the same anti-enumeration reason as signup:
// Supabase's raw messages (notably "Email not confirmed") reveal whether an
// account exists. We normalize to one message and log the real reason server-
// side. The common "invalid credentials" failure is already generic.
const GENERIC_LOGIN_ERROR =
  "Invalid email or password. Check your details and try again.";

const UNCONFIRMED_LOGIN_ERROR =
  "Confirm your email address before signing in — the link is in your inbox.";

const RATE_LIMITED_ERROR =
  "Too many attempts. Wait a minute, then try again.";

function safeRedirectTo(value: FormDataEntryValue | null) {
  return safeRedirectPath(value);
}

/** Supabase auth error codes that are safe to surface: none of them says
 *  whether an account exists for the address. */
function isRateLimited(error: { code?: string; status?: number }) {
  return (
    error.status === 429 ||
    error.code === "over_email_send_rate_limit" ||
    error.code === "over_request_rate_limit"
  );
}

export async function loginAction(
  _prev: ActionState<LoginInput>,
  formData: FormData,
): Promise<ActionState<LoginInput>> {
  const raw = {
    email: formData.get("email"),
    password: formData.get("password"),
  };

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: fieldErrorsFromZod<LoginInput>(parsed.error.issues),
      values: { email: typeof raw.email === "string" ? raw.email : "" },
    };
  }

  if (!isSupabaseConfigured()) {
    return {
      status: "error",
      formError:
        "Supabase isn't configured yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local.",
      values: { email: parsed.data.email },
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Log the underlying reason for debugging; never surface it to the client.
    console.warn("loginAction: signInWithPassword error", error.message);
    // GoTrue verifies the password BEFORE the confirmation check, so this
    // code only ever reaches someone who already knows the credentials.
    if (error.code === "email_not_confirmed") {
      return {
        status: "error",
        formError: UNCONFIRMED_LOGIN_ERROR,
        unconfirmed: true,
        values: { email: parsed.data.email },
      };
    }
    return {
      status: "error",
      formError: isRateLimited(error) ? RATE_LIMITED_ERROR : GENERIC_LOGIN_ERROR,
      values: { email: parsed.data.email },
    };
  }

  const redirectTo = safeRedirectTo(formData.get("redirectTo"));
  revalidatePath("/", "layout");
  redirect(redirectTo);
}

export async function signupAction(
  _prev: ActionState<SignupInput>,
  formData: FormData,
): Promise<ActionState<SignupInput>> {
  const raw = {
    email: formData.get("email"),
    username: formData.get("username"),
    password: formData.get("password"),
  };

  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: fieldErrorsFromZod<SignupInput>(parsed.error.issues),
      values: {
        email: typeof raw.email === "string" ? raw.email : "",
        username: typeof raw.username === "string" ? raw.username : "",
      },
    };
  }

  if (!isSupabaseConfigured()) {
    return {
      status: "error",
      formError:
        "Supabase isn't configured yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local.",
      values: { email: parsed.data.email, username: parsed.data.username },
    };
  }

  const supabase = await createClient();

  // The profile trigger replaces a username that is already taken with a
  // generated one — without this check the user landed on the dashboard with a
  // handle and no explanation. Check first and say so. The schema has
  // already lowercased the value and the column only admits lowercase, so
  // this is an exact match (ilike would treat the `_` in a handle as a
  // wildcard and report free names as taken). The trigger (0094) still
  // settles a race by minting a generated handle.
  const { data: taken } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", parsed.data.username)
    .maybeSingle();
  if (taken) {
    return {
      status: "error",
      fieldErrors: { username: "That username is taken — try another." },
      values: { email: parsed.data.email, username: parsed.data.username },
    };
  }

  // Build the email confirmation redirect from our own resolver instead of
  // trusting the Origin / X-Forwarded-Host request headers. Supabase's
  // allow-list still gates the final destination, but using the canonical
  // site URL means an attacker can't spoof the email's destination via a
  // crafted Host header on the signup request.
  const emailRedirectTo = `${getSiteBaseUrl()}/auth/callback`;

  const { data: signUpData, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo,
      data: {
        username: parsed.data.username,
        display_name: parsed.data.username,
      },
    },
  });

  if (error) {
    // Surface a generic message so attackers can't distinguish
    // "already-registered" / "rate-limited" / "weak-password" via response
    // timing or text. Real signup failures still log to the server.
    console.warn("signupAction: supabase.auth.signUp error", error.message);
    // A rejected password (project password policy / leaked-password
    // protection) says nothing about the address — tell the user what to fix.
    if (error.code === "weak_password") {
      return {
        status: "error",
        fieldErrors: {
          password:
            "That password is too weak or has appeared in a data breach — choose a different one.",
        },
        values: { email: parsed.data.email, username: parsed.data.username },
      };
    }
    return {
      status: "error",
      formError: isRateLimited(error) ? RATE_LIMITED_ERROR : GENERIC_SIGNUP_ERROR,
      values: { email: parsed.data.email, username: parsed.data.username },
    };
  }

  // Funnel: the signup with its first-touch attribution (hidden fields the
  // form read from sessionStorage — referrer host + UTM, no cookie). Only
  // for a REAL new user: an already-registered address gets an obfuscated
  // user with no identities, and that must record nothing.
  const newUser = signUpData.user;
  if (newUser?.id && (newUser.identities?.length ?? 0) > 0 && isAdminConfigured()) {
    await recordFunnelEvent(createAdminClient(), {
      event: "signup",
      userId: newUser.id,
      props: sanitizeAttribution({
        referrer: formData.get(ATTRIBUTION_FIELDS.referrer),
        utmSource: formData.get(ATTRIBUTION_FIELDS.utmSource),
        utmMedium: formData.get(ATTRIBUTION_FIELDS.utmMedium),
        utmCampaign: formData.get(ATTRIBUTION_FIELDS.utmCampaign),
      }),
    });
  }

  // If email confirmation is OFF, signUp also signs the user in.
  // If it's ON, the user must click the email link before being authenticated.
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session) {
    const redirectTo = safeRedirectTo(formData.get("redirectTo"));
    revalidatePath("/", "layout");
    redirect(redirectTo);
  }

  // Same answer whether the address is new or already registered (Supabase
  // returns an obfuscated user for the latter) — the form swaps to a
  // check-your-inbox panel with a resend control.
  return { status: "sent", values: { email: parsed.data.email } };
}

/** Re-send the signup confirmation email. Always reports success: whether
 *  the address has a pending signup is not the caller's business. Supabase
 *  rate-limits the send per address (60s) on its side. */
export async function resendConfirmationAction(
  email: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Same shape as the forgot-password form: one validated email.
  const parsed = forgotPasswordSchema.safeParse({ email });
  if (!parsed.success) return { ok: false, error: "Enter a valid email address." };
  if (!isSupabaseConfigured()) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
    options: { emailRedirectTo: `${getSiteBaseUrl()}/auth/callback` },
  });
  if (error) {
    console.warn("resendConfirmationAction: resend error", error.message);
    if (isRateLimited(error)) return { ok: false, error: RATE_LIMITED_ERROR };
  }
  return { ok: true };
}

/** Request a password-reset email. ALWAYS lands on the same confirmation
 *  notice whether or not the address has an account — revealing which
 *  emails are registered would enable account enumeration (same reasoning
 *  as the generic login/signup errors above). */
export async function forgotPasswordAction(
  _prev: ActionState<ForgotPasswordInput>,
  formData: FormData,
): Promise<ActionState<ForgotPasswordInput>> {
  const raw = { email: formData.get("email") };
  const parsed = forgotPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: fieldErrorsFromZod<ForgotPasswordInput>(
        parsed.error.issues,
      ),
      values: { email: typeof raw.email === "string" ? raw.email : "" },
    };
  }

  if (!isSupabaseConfigured()) {
    return {
      status: "error",
      formError:
        "Supabase isn't configured yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local.",
      values: { email: parsed.data.email },
    };
  }

  const supabase = await createClient();
  // Same canonical-URL reasoning as signup: never trust request headers for
  // the email's destination. The branded template links straight to
  // /auth/confirm (token hash — works in any browser); this redirectTo only
  // matters for a project still on Supabase's default template, whose PKCE
  // link lands on /auth/callback and forwards to /reset-password.
  const { error } = await supabase.auth.resetPasswordForEmail(
    parsed.data.email,
    {
      redirectTo: `${getSiteBaseUrl()}/auth/callback?redirectTo=/reset-password`,
    },
  );
  if (error) {
    // Log for debugging, but the user-facing result is identical either way.
    console.warn("forgotPasswordAction: resetPasswordForEmail error", error.message);
  }

  redirect("/login?notice=reset-sent");
}

/** Set a new password for the RECOVERY session established by the email
 *  link (auth/callback exchanged the code before redirecting here). */
export async function resetPasswordAction(
  _prev: ActionState<ResetPasswordInput>,
  formData: FormData,
): Promise<ActionState<ResetPasswordInput>> {
  const raw = { password: formData.get("password") };
  const parsed = resetPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: fieldErrorsFromZod<ResetPasswordInput>(parsed.error.issues),
    };
  }

  if (!isSupabaseConfigured()) {
    return {
      status: "error",
      formError:
        "Supabase isn't configured yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local.",
    };
  }

  const supabase = await createClient();
  // Only a session from a recent recovery link may change the password
  // without the current one — never an ordinary signed-in session (an
  // unattended browser must not be enough to take the account; Settings is
  // the current-password path). Same copy as the page's expired state so a
  // stale link and a forged request look identical.
  if (!(await isRecoverySession(supabase))) {
    return {
      status: "error",
      formError:
        "This reset link has expired or was already used. Request a new one and try again.",
    };
  }
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    console.warn("resetPasswordAction: updateUser error", error.message);
    return {
      status: "error",
      formError:
        error.code === "weak_password"
          ? "That password is too weak or has appeared in a data breach — choose a different one."
          : error.code === "same_password"
            ? "Choose a password you haven't used on this account before."
            : "We couldn't update your password — the reset link may have expired. Request a new one and try again.",
    };
  }

  // A reset usually means the old password is compromised or forgotten:
  // revoke every OTHER session so a stolen one dies with it. Best-effort.
  try {
    await supabase.auth.signOut({ scope: "others" });
  } catch {
    // non-fatal
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export type ConfirmLinkState =
  | { status: "idle" }
  | { status: "error"; error: string };

/** Exchange an email link's token hash for a session — the POST half of
 *  /auth/confirm (the page explains why this isn't a GET). */
export async function confirmEmailLinkAction(
  _prev: ConfirmLinkState,
  formData: FormData,
): Promise<ConfirmLinkState> {
  const tokenHash = formData.get("token_hash");
  const type = parseEmailLinkType(formData.get("type"));
  if (typeof tokenHash !== "string" || !tokenHash || !type || !isSupabaseConfigured()) {
    return { status: "error", error: "This link isn't valid." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    console.warn("confirmEmailLinkAction: verifyOtp error", error.message);
    return {
      status: "error",
      error: "This link has expired or was already used.",
    };
  }

  revalidatePath("/", "layout");
  redirect(safeRedirectPath(formData.get("next"), EMAIL_LINK_COPY[type].next));
}

export async function logoutAction() {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await createClient();
      await supabase.auth.signOut();
    } catch {
      // best-effort: swallow and still redirect
    }
  }
  revalidatePath("/", "layout");
  redirect("/");
}
