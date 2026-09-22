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
