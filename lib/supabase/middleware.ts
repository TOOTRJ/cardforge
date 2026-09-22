import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/supabase";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";
import { getSupabaseEnv, isSupabaseConfigured } from "./env";

// /sets is now the PUBLIC community browse (mirrors /gallery) and is not
// protected. Personal sets live under /dashboard/sets and are covered by
// the /dashboard prefix.
// /create: proxy.ts rewrites COOKIE-LESS visitors to the guest creator before
// this runs, so the no-cookie fast path below never sees /create; keeping it
// protected here means a visitor whose cookie no longer holds a valid
// session still gets the proper /login?redirectTo=/create redirect.
//
// Every signed-in-only route is listed so a signed-out visitor keeps their
// destination (`/login?redirectTo=…`). The (app) layout's own bare
// redirect("/login") stays as defense in depth, but it cannot know the path.
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/create",
  "/settings",
  "/onboarding",
  "/feed",
  "/notifications",
  "/messages",
  "/feedback",
  "/admin",
];
// /card/…, /deck/… and /set/… are public; only their editors are private.
const PROTECTED_PATTERN = /^\/(card|deck)\/.+\/edit\/?$/;
const AUTH_REDIRECT_PREFIXES = ["/login", "/signup"];

function pathMatches(path: string, prefixes: readonly string[]) {
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`));
}

function isProtectedPath(path: string) {
  return pathMatches(path, PROTECTED_PREFIXES) || PROTECTED_PATTERN.test(path);
}

function loginRedirect(request: NextRequest) {
  const redirectUrl = request.nextUrl.clone();
  const destination = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  redirectUrl.pathname = "/login";
  redirectUrl.search = "";
  redirectUrl.searchParams.set("redirectTo", destination);
  return NextResponse.redirect(redirectUrl);
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
    if (isProtectedPath(path)) return loginRedirect(request);
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

  const isProtected = isProtectedPath(path);
  const isAuthPage = pathMatches(path, AUTH_REDIRECT_PREFIXES);

  if (!user && isProtected) return loginRedirect(request);

  if (user && isAuthPage) {
    // Already signed in: go where the login link was headed, not always the
    // dashboard (an expired tab re-opening /login?redirectTo=/create).
    const destination = new URL(
      safeRedirectPath(request.nextUrl.searchParams.get("redirectTo")),
      request.nextUrl.origin,
    );
    return NextResponse.redirect(destination);
  }

  return response;
}
