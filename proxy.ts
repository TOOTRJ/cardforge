import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseAuthCookieName } from "@/lib/supabase/session-cookie";
import { updateSession } from "@/lib/supabase/middleware";
import {
  DECKS_FILTER_PARAMS,
  GALLERY_FILTER_PARAMS,
  hasAnyParam,
} from "@/lib/routing/browse-params";

/** @supabase/ssr session cookies: sb-<ref>-auth-token(.N). Presence is a
 *  HINT (the (app) create page re-validates) — enough to pick which creator
 *  to serve. */

const RETIRED_TAG_HUBS: Record<string, string> = {
  "/articles/tag/templating": "/articles/tag/oracle-text",
  "/articles/tag/abilities": "/articles/tag/oracle-text",
  "/articles/tag/proxies": "/articles/tag/printing",
};

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
  // The sets feature was removed (PR #337, migration 0105) after months of
  // inbound links and indexed copy for /sets and /set/<slug>. Send that
  // equity to the nearest living collection surface instead of 404ing.
  // Guide tag hubs were consolidated on 2026-09-22 (content refresh): the
  // three retired hubs that had been indexable keep resolving.
  const retiredTagHub = RETIRED_TAG_HUBS[requestPath];
  if (retiredTagHub) {
    const url = request.nextUrl.clone();
    url.pathname = retiredTagHub;
    url.search = "";
    return NextResponse.redirect(url, 308);
  }
  if (requestPath === "/sets" || requestPath.startsWith("/set/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/decks";
    url.search = "";
    return NextResponse.redirect(url, 308);
  }
  if (requestPath === "/create") {
    const signedIn = request.cookies
      .getAll()
      .some((c) => isSupabaseAuthCookieName(c.name));
    if (!signedIn) {
      const url = request.nextUrl.clone();
      url.pathname = "/create-guest";
      return NextResponse.rewrite(url, { request });
    }
  }

  const sessionResponse = await updateSession(request);

  // /gallery and /decks are prerendered (ISR) landings that never read
  // searchParams; searching, filtering, sorting and paging live on their
  // VISIBLE dynamic siblings (/gallery/browse, /decks/browse). A landing
  // request that still carries a REAL filter/search/pagination param (an old
  // inbound link, a bookmark) is 308'd to the sibling with its query intact.
  //
  // This used to be a hidden rewrite. It broke every in-app filter/sort/
  // search click: Next's client router reuses the cached static route tree
  // for a same-path query-string change and never asks the server, so the
  // rewrite was invisible to soft navigations and the grid stayed frozen on
  // the landing's content. Junk params (utm_*, fbclid, …) fall through to
  // the CDN-cached static page.
  const { pathname } = request.nextUrl;
  const browseParams =
    pathname === "/gallery"
      ? GALLERY_FILTER_PARAMS
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
    const redirected = NextResponse.redirect(url, 308);
    // Preserve any auth cookies updateSession refreshed on this response.
    for (const cookie of sessionResponse.cookies.getAll()) {
      redirected.cookies.set(cookie);
    }
    return redirected;
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
