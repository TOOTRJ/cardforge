// Client-safe Supabase session-cookie sniff.
//
// @supabase/ssr stores the session in `sb-<project-ref>-auth-token`
// cookies (chunked as `…-auth-token.0`, `.1`, … when large) and sets
// them httpOnly:false so the browser client can read its own session.
// Presence of one is a cheap, network-free hint that the visitor is
// signed in — used to decide whether fetching /api/me is worth it and
// whether a like-click should bounce to /login.
//
// It is a HINT, not an authority: server actions and API routes always
// re-validate the session. Callers must only ever use it to PROMOTE an
// anonymous default to "try the authed path" — never to deny a
// signed-in user something the server said they could do.

const SUPABASE_AUTH_COOKIE = /^sb-[^=]*-auth-token(\.\d+)?$/;

export function hasSupabaseSessionCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split("; ")
    .some((pair) => SUPABASE_AUTH_COOKIE.test(pair.split("=")[0] ?? ""));
}
