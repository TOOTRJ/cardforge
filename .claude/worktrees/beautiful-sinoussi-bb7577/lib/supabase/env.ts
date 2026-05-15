// Centralized Supabase env-var access with safe fallbacks so missing config
// surfaces as a clean "not configured" boolean rather than crashing imports.

export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return { url, anonKey };
}

export function isSupabaseConfigured() {
  const { url, anonKey } = getSupabaseEnv();
  return Boolean(url) && Boolean(anonKey);
}
