// The card page an admin pastes into /admin/featured (a hero slot, the hero's
// pool): `/card/<username>/<slug>`, as a bare path or an absolute URL on THIS
// deployment's own origin (`getSiteBaseUrl()`, its `www.` twin, and on Vercel
// the branch and deployment URLs it is also served on — the same database).
// Any other host — another preview, a localhost, a foreign site — is refused:
// its handle and slug would resolve to whatever card this database holds under
// the same names.

import { getSiteBaseUrl } from "@/lib/site-url";

const CARD_PATH = /^\/card\/([a-z0-9_]+)\/([a-z0-9-]+)\/?$/i;

export type CardPageUrl =
  | { ok: true; username: string; slug: string }
  | { ok: false; error: string };

function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

/** Every origin this deployment answers on, the site's own first. */
export function siteOrigins(): string[] {
  const vercel = [process.env.VERCEL_BRANCH_URL, process.env.VERCEL_URL]
    .filter((host): host is string => Boolean(host?.trim()))
    .map((host) => `https://${host.trim()}`);
  return [getSiteBaseUrl(), ...vercel];
}

/** Parse a pasted card page URL against this deployment's origins (the first
 *  is named in the refusal and resolves a bare path). The handle and slug
 *  come back lower-cased; a query or hash is ignored. */
export function parseCardPageUrl(
  input: string,
  origins: readonly string[] = siteOrigins(),
): CardPageUrl {
  const site = new URL(origins[0]);
  const hosts = new Set(origins.map((origin) => bareHost(new URL(origin).host)));
  const example = `Paste a ${bareHost(site.host)} card URL, e.g. /card/username/card-slug.`;
  const text = input.trim();
  let url: URL;
  try {
    url = new URL(text, site);
  } catch {
    return { ok: false, error: example };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: example };
  }
  if (!hosts.has(bareHost(url.host))) return { ok: false, error: example };
  const match = url.pathname.match(CARD_PATH);
  if (!match) return { ok: false, error: example };
  return { ok: true, username: match[1].toLowerCase(), slug: match[2].toLowerCase() };
}
