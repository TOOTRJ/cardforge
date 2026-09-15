import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import {
  DECKS_FILTER_PARAMS,
  GALLERY_FILTER_PARAMS,
  SETS_FILTER_PARAMS,
  hasAnyParam,
} from "@/lib/routing/browse-params";

/** @supabase/ssr session cookies: sb-<ref>-auth-token(.N). Presence is a
 *  HINT (the (app) create page re-validates) — enough to pick which creator
 *  to serve. */
const SUPABASE_AUTH_COOKIE = /^sb-[^=]*-auth-token(\.\d+)?$/;

export async function proxy(request: NextRequest) {
  const { pathname: requestPath } = request.nextUrl;

  // The card creator lives at ONE URL. /create serves the signed-in creator
  // (app/(app)/create) to visitors with a session cookie and the static,
  // hourly-cached guest creator (app/(marketing)/create-guest — no cookies,
  // ISR) to everyone else, via an internal rewrite so the visible URL never
  // changes. The old /preview URL (and the internal path) 308 to /create so
  // inbound links and search rankings carry over.
  if (requestPath === "/preview" || requestPath === "/create-guest") {
    const url = request.nextUrl.clone();
    url.pathname = "/create";
    return NextResponse.redirect(url, 308);
  }
  if (requestPath === "/create") {
    const signedIn = request.cookies
      .getAll()
      .some((c) => SUPABASE_AUTH_COOKIE.test(c.name));
    if (!signedIn) {
      const url = request.nextUrl.clone();
      url.pathname = "/create-guest";
      return NextResponse.rewrite(url, { request });
    }
  }

  const sessionResponse = await updateSession(request);

  // /gallery and /sets are prerendered (ISR) and never read searchParams
  // themselves; a request carrying a REAL filter/search/pagination param is
  // rewritten to the dynamic /browse sibling, which renders it per-request.
  // The visitor-facing URL is unchanged. Junk params (utm_*, fbclid, …)
  // fall through to the CDN-cached static page.
  const { pathname } = request.nextUrl;
  const browseParams =
    pathname === "/gallery"
      ? GALLERY_FILTER_PARAMS
      : pathname === "/sets"
        ? SETS_FILTER_PARAMS
        : pathname === "/decks"
          ? DECKS_FILTER_PARAMS
          : null;
  if (
    browseParams &&
    hasAnyParam(request.nextUrl.searchParams, browseParams) &&
    // Defensive: never clobber a redirect from updateSession (it doesn't
    // redirect these public paths today).
    !sessionResponse.headers.has("location")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = `${pathname}/browse`;
    const rewritten = NextResponse.rewrite(url, { request });
    // Preserve any auth cookies updateSession refreshed on this response.
    for (const cookie of sessionResponse.cookies.getAll()) {
      rewritten.cookies.set(cookie);
    }
    return rewritten;
  }

  return sessionResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon)
     * - static asset extensions (svg, png, jpg, jpeg, gif, webp, ico)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
