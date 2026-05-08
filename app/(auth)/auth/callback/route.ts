import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

const SAFE_REDIRECT = /^\/[^\s]*$/;

function safeRedirectTo(value: string | null) {
  if (!value || !SAFE_REDIRECT.test(value) || value.startsWith("//")) {
    return "/dashboard";
  }
  return value;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const redirectTo = safeRedirectTo(searchParams.get("redirectTo"));

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

  const errorUrl = new URL("/login", origin);
  errorUrl.searchParams.set("error", "auth-callback-failed");
  return NextResponse.redirect(errorUrl);
}
