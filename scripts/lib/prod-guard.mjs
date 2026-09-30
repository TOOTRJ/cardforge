// ---------------------------------------------------------------------------
// prod-guard.mjs — the ONE place that knows what "production" looks like, for
// every script that must never touch it by accident (dev server startup check,
// seed-dev, db-dev). Project refs and hostnames are not secrets: they are in
// every request the browser makes.
// ---------------------------------------------------------------------------

export const PRODUCTION_SUPABASE_REF = "zkwkisxoqdhdchqyjwdc";

/** Every hostname the production project answers on. */
export const PRODUCTION_SUPABASE_HOSTS = [
  `${PRODUCTION_SUPABASE_REF}.supabase.co`,
  "auth.pipglyph.com", // custom domain (2026-07)
];

/** True when `url` points at the production Supabase project — by host, or by
 *  the project ref appearing anywhere in it (pooler usernames carry the ref:
 *  `postgres.<ref>`). Malformed input is treated as NOT production; callers
 *  that need a valid target validate that separately. */
export function isProductionSupabaseUrl(url) {
  if (typeof url !== "string" || !url.trim()) return false;
  if (url.includes(PRODUCTION_SUPABASE_REF)) return true;
  try {
    return PRODUCTION_SUPABASE_HOSTS.includes(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Production's app (Vercel Production) — where an owner-run script sends
 *  production's CRON_SECRET, and nowhere else. */
export const PRODUCTION_APP_URL = "https://www.pipglyph.com";

/** Every hostname the production app answers on (the apex redirects to www). */
export const PRODUCTION_APP_HOSTS = ["www.pipglyph.com", "pipglyph.com"];

/** True when `url` is on the production app's hostnames, whatever the scheme,
 *  port or path (a trailing root dot and upper case count too). Malformed
 *  input is NOT production; callers that need a valid URL check that. */
export function isProductionAppUrl(url) {
  if (typeof url !== "string" || !url.trim()) return false;
  try {
    const host = new URL(url.trim()).hostname.toLowerCase().replace(/\.$/, "");
    return PRODUCTION_APP_HOSTS.includes(host);
  } catch {
    return false;
  }
}
