import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/supabase";
import { getSupabaseEnv, isSupabaseConfigured } from "./env";

// /sets is now the PUBLIC community browse (mirrors /gallery) and is not
// protected. Personal sets live under /dashboard/sets and are covered by
// the /dashboard prefix.
const PROTECTED_PREFIXES = ["/dashboard", "/create", "/settings"];
const AUTH_REDIRECT_PREFIXES = ["/login", "/signup"];

function pathMatches(path: string, prefixes: readonly string[]) {
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`));
}

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // If Supabase isn't configured, let everything through. Protected pages
  // will render their own friendly "configure Supabase" state.
  if (!isSupabaseConfigured()) {
    return NextResponse.next({ request });
  }

  // No Supabase auth cookie → anonymous visitor → there is no session to
  // refresh, so skip the auth.getUser() network round trip (~50–200ms)
  // that would otherwise tax every page view. Protected pages still get
  // their login redirect; auth pages need no redirect for a signed-out
  // viewer. Signed-in users (cookie present) take the full path below.
  const hasAuthCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-"));
  if (!hasAuthCookie) {
    if (pathMatches(path, PROTECTED_PREFIXES)) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login";
      redirectUrl.searchParams.set("redirectTo", path);
      return NextResponse.redirect(redirectUrl);
    }
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const { url, anonKey } = getSupabaseEnv();
  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  let user = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch {
    user = null;
  }

  const isProtected = pathMatches(path, PROTECTED_PREFIXES);
  const isAuthPage = pathMatches(path, AUTH_REDIRECT_PREFIXES);

  if (!user && isProtected) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("redirectTo", path);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && isAuthPage) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
