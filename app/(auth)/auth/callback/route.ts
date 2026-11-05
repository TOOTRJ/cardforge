import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { DEFAULT_POST_AUTH_PATH, safeRedirectPath } from "@/lib/auth/safe-redirect";
import { oauthCallbackErrorOf } from "@/lib/auth/oauth-callback-error";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const redirectTo = safeRedirectPath(searchParams.get("redirectTo"));

  // GoTrue sends a provider's refusal back here instead of a code — the
  // visitor pressed Cancel on the provider's screen, or the provider's email
  // isn't verified. Never exchange anything then; the login page says it
  // calmly (and in words that name no account).
  const providerError = oauthCallbackErrorOf(searchParams);
  if (providerError) {
    if (providerError !== "oauth-cancelled") {
      console.warn(
        "[auth/callback] provider error",
        searchParams.get("error"),
        searchParams.get("error_code"),
      );
    }
    return NextResponse.redirect(loginWithError(origin, providerError, redirectTo));
  }

  if (code && isSupabaseConfigured()) {
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

  return NextResponse.redirect(loginWithError(origin, "auth-callback-failed", redirectTo));
}

// Back to the login page with the error and — so a retry lands where the
// visitor was going — the redirect, unless it is the default.
function loginWithError(origin: string, error: string, redirectTo: string): URL {
  const url = new URL("/login", origin);
  url.searchParams.set("error", error);
  if (redirectTo !== DEFAULT_POST_AUTH_PATH) url.searchParams.set("redirectTo", redirectTo);
  return url;
}
