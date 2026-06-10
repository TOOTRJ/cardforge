// Centralized Supabase env-var access with safe fallbacks so missing config
// surfaces as a clean "not configured" boolean rather than crashing imports.
//
// Uses Supabase's new API keys (2026-06 migration): `sb_publishable_...`
// (browser-safe) via NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY here, and
// `sb_secret_...` (server-only) via SUPABASE_SECRET_KEY in
// lib/supabase/admin.ts. The legacy anon/service_role JWT keys are disabled
// in the Supabase dashboard and no longer read.

export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  return { url, anonKey };
}

export function isSupabaseConfigured() {
  const { url, anonKey } = getSupabaseEnv();
  return Boolean(url) && Boolean(anonKey);
}
