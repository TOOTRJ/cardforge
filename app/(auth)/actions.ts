"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  fieldErrorsFromZod,
  loginSchema,
  signupSchema,
  type ActionState,
  type LoginInput,
  type SignupInput,
} from "@/lib/auth/schemas";

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
  const headerList = await headers();
  const origin =
    headerList.get("origin") ?? headerList.get("x-forwarded-host") ?? "";
  const emailRedirectTo = origin
    ? `${origin.startsWith("http") ? origin : `https://${origin}`}/auth/callback`
    : undefined;

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
    return {
      status: "error",
      formError: error.message,
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
