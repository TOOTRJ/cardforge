// ---------------------------------------------------------------------------
// The one test a profile link or store URL passes before it is stored or
// drawn as an href (lib/profile/link-kinds.ts, lib/profile/store-platforms.ts).
// Pure and dependency-free: the Settings editors run it as you type, the
// server actions run it again, and the profile page runs it once more on
// every row it reads (a row written straight through PostgREST skips the
// actions — the database only holds the https:// prefix).
//
// https only, no credentials, no port, a real host — never a bare
// `z.url()`, which accepts `javascript:` (CLAUDE.md "Validation").
// ---------------------------------------------------------------------------

/** Longest URL a link may hold — the profile columns' limit (lib/auth/schemas.ts). */
export const PROFILE_LINK_URL_MAX = 2048;

/** The URL parsed, or null when it is not a plain public https:// address. */
export function parseHttpsLink(raw: string): URL | null {
  const value = raw.trim();
  if (!value || value.length > PROFILE_LINK_URL_MAX) return null;
  if (!value.toLowerCase().startsWith("https://")) return null;
  // No whitespace or control characters anywhere: a URL never needs them and
  // a stored one is printed as written.
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  // A dotted name with a letter in its last label: no IP literal, no
  // "localhost", no bare word.
  if (!/^[a-z0-9.-]+\.[a-z][a-z0-9-]*$/.test(host)) return null;
  return url;
}

/** True when `host` is one of `allowed` or a subdomain of one
 *  ("www.ebay.com" for "ebay.com"; never "notebay.com"). */
export function hostMatches(host: string, allowed: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return allowed.some((suffix) => h === suffix || h.endsWith(`.${suffix}`));
}

/** The URL as the profile prints it: no scheme, no trailing slash. */
export function displayLink(url: string): string {
  return url.replace(/^https:\/\//i, "").replace(/\/$/, "");
}
