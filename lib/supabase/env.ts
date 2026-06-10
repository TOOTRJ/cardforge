// Centralized Supabase env-var access with safe fallbacks so missing config
// surfaces as a clean "not configured" boolean rather than crashing imports.
//
// Key migration (2026-06): Supabase's new API keys are preferred —
// `sb_publishable_...` (browser-safe, replaces the legacy anon JWT) via
// NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, and `sb_secret_...` (server-only,
// replaces the legacy service_role JWT) via SUPABASE_SECRET_KEY in
// lib/supabase/admin.ts. The legacy variable names keep working as fallbacks
// so environments can flip over one at a time; once all environments carry
// the new keys, disable the legacy JWT keys in the Supabase dashboard.

export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "";
  return { url, anonKey };
}

export function isSupabaseConfigured() {
  const { url, anonKey } = getSupabaseEnv();
  return Boolean(url) && Boolean(anonKey);
}
