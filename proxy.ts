import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import {
  GALLERY_FILTER_PARAMS,
  SETS_FILTER_PARAMS,
  hasAnyParam,
} from "@/lib/routing/browse-params";

export async function proxy(request: NextRequest) {
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
