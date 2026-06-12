import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { getSupabaseEnv } from "./env";

// ---------------------------------------------------------------------------
// Cookie-free anonymous Supabase client.
//
// Identical RLS visibility to anonymous traffic through the cookie-bound
// server client — it just never touches `cookies()`, so it's usable from
// contexts that have no request cookie store (OG image routes) and from
// pages that must stay static/ISR-cacheable. Never use this for queries
// whose results depend on the signed-in viewer.
// ---------------------------------------------------------------------------

export function createPublicClient() {
  const { url, anonKey } = getSupabaseEnv();
  return createSupabaseClient<Database>(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
