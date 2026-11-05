import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { DEFAULT_POST_AUTH_PATH, safeRedirectPath } from "@/lib/auth/safe-redirect";
import { oauthCallbackErrorOf } from "@/lib/auth/oauth-callback-error";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const redirectTo = safeRedirectPath(searchParams.get("redirectTo"));

  // An OAuth provider's refusal comes back here instead of a code — the
  // visitor pressed Cancel on the provider's screen, or the provider's email
  // isn't verified. The login page says it calmly (in words that name no
  // account) and keeps the redirect, so a retry goes where they were going.
  const providerError = oauthCallbackErrorOf(searchParams);
  if (providerError) {
    if (providerError !== "oauth-cancelled") {
      console.warn(
        "[auth/callback] provider error",
        searchParams.get("error"),
        searchParams.get("error_code"),
      );
    }
    const url = loginWithError(origin, providerError);
    if (redirectTo !== DEFAULT_POST_AUTH_PATH) url.searchParams.set("redirectTo", redirectTo);
    return NextResponse.redirect(url);
  }

  // Any other `error` (an expired or used email link: `otp_expired`) is never
  // exchanged, and falls through with a failed exchange to the email-link
  // message — WITHOUT the redirect: a reset link's /reset-password must not
  // follow a plain password sign-in.
  const linkError = searchParams.has("error") || searchParams.has("error_code");
  if (code && !linkError && isSupabaseConfigured()) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        return NextResponse.redirect(`${origin}${redirectTo}`);
      }
    } catch {
      // fall through to error redirect
    }
  }

  return NextResponse.redirect(loginWithError(origin, "auth-callback-failed"));
}

function loginWithError(origin: string, error: string): URL {
  const url = new URL("/login", origin);
  url.searchParams.set("error", error);
  return url;
}
