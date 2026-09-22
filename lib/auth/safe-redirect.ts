// A same-origin path only: one leading slash, then anything but whitespace,
// a second slash OR a backslash. `//evil.com` is protocol-relative, and
// `/\evil.com` is rewritten to `https://evil.com/` by the WHATWG URL parser
// (and by Next's client router), so both must be rejected. ONE copy — the
// login/signup actions, the OAuth button, /auth/callback and /auth/confirm
// all import it (they used to carry three regexes, one of them weaker).
const SAFE_REDIRECT = /^\/(?![\/\\])[^\s\\]*$/;

const DEFAULT_POST_AUTH_PATH = "/dashboard";

export function safeRedirectPath(
  value: unknown,
  fallback: string = DEFAULT_POST_AUTH_PATH,
): string {
  if (typeof value !== "string" || !value) return fallback;
  return SAFE_REDIRECT.test(value) ? value : fallback;
}
