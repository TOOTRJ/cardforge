"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getSiteBaseUrl } from "@/lib/site-url";
import {
  fieldErrorsFromZod,
  loginSchema,
  signupSchema,
  type ActionState,
  type LoginInput,
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
        "Supabase isn't configured yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local.",
      values: { email: parsed.data.email },
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return {
      status: "error",
      formError: error.message,
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
        "Supabase isn't configured yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local.",
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
