"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getSiteBaseUrl } from "@/lib/site-url";
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

const SAFE_REDIRECT = /^\/[^\s]*$/;

function safeRedirectTo(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value) return "/dashboard";
  if (!SAFE_REDIRECT.test(value)) return "/dashboard";
  if (value.startsWith("//")) return "/dashboard";
  return value;
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
    return {
      status: "error",
      formError: GENERIC_LOGIN_ERROR,
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
  // Build the email confirmation redirect from our own resolver instead of
  // trusting the Origin / X-Forwarded-Host request headers. Supabase's
  // allow-list still gates the final destination, but using the canonical
  // site URL means an attacker can't spoof the email's destination via a
  // crafted Host header on the signup request.
  const emailRedirectTo = `${getSiteBaseUrl()}/auth/callback`;

  const { error } = await supabase.auth.signUp({
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
    return {
      status: "error",
      formError: GENERIC_SIGNUP_ERROR,
      values: { email: parsed.data.email, username: parsed.data.username },
    };
  }

  // If email confirmation is OFF, signUp also signs the user in.
  // If it's ON, the user must click the email link before being authenticated.
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session) {
    const redirectTo = safeRedirectTo(formData.get("redirectTo"));
    revalidatePath("/", "layout");
    redirect(redirectTo);
  }

  redirect("/login?notice=check-email");
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
  // the email's destination. The recovery link lands on /auth/callback,
  // which exchanges the code and forwards to /reset-password.
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
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    console.warn("resetPasswordAction: updateUser error", error.message);
    return {
      status: "error",
      formError:
        "We couldn't update your password — the reset link may have expired. Request a new one and try again.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
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
