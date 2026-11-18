import "server-only";

import { createServerClient } from "@supabase/ssr";
import { getSupabaseEnv } from "@/lib/supabase/env";

// ---------------------------------------------------------------------------
// A session refresh that can never sign its user out.
//
// The hand-over of a Re-art run (lib/tools/re-art/background-actions.ts)
// refreshes the maker's session EARLY, so the run has the best part of an
// hour. An early refresh is optional — the token still works — and the
// sign-in library REMOVES the session when a refresh fails for any reason it
// does not count as a network error (a 429, a 500): on the request's own
// client that clears the browser's cookies, and the maker who pressed Paint
// would be signed out with most of an hour left.
//
// So the refresh is made on a COPY of the cookies. Only a refresh that
// succeeded is written to the real ones (exactly the cookies the library
// wrote, in its order); one that failed changes nothing, and the caller
// goes on with the token it had.
// ---------------------------------------------------------------------------

type CookieOptions = Record<string, unknown>;
/** The request's cookie store, as next/headers hands it to a server action. */
export type RequestCookies = {
  getAll(): Array<{ name: string; value: string }>;
  set(name: string, value: string, options?: CookieOptions): unknown;
};

/** The refreshed access token — null when the refresh did not succeed (the
 *  request's cookies are then exactly as they were). */
export async function refreshSessionOnACopy(store: RequestCookies): Promise<string | null> {
  const { url, anonKey } = getSupabaseEnv();
  const jar = new Map(store.getAll().map((cookie) => [cookie.name, cookie.value]));
  const written: Array<{ name: string; value: string; options?: CookieOptions }> = [];
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const cookie of cookies) {
          if (cookie.value) jar.set(cookie.name, cookie.value);
          else jar.delete(cookie.name);
          written.push({ name: cookie.name, value: cookie.value, options: cookie.options as CookieOptions | undefined });
        }
      },
    },
  });
  let accessToken: string | null = null;
  try {
    const { data, error } = await client.auth.refreshSession();
    if (!error && data.session?.access_token) accessToken = data.session.access_token;
  } catch {
    accessToken = null;
  }
  // Refused, or it wrote no session: nothing of it reaches the browser.
  if (!accessToken || !written.some((cookie) => cookie.value)) return null;
  try {
    for (const cookie of written) store.set(cookie.name, cookie.value, cookie.options);
  } catch {
    // The new session couldn't be written where the browser will read it:
    // the old token is the one to go on with. (The sign-in service hands
    // the browser's older refresh token its newer session at its next use.)
    return null;
  }
  return accessToken;
}
