import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

// Service-role Supabase client. BYPASSES Row-Level Security, so it must NEVER be
// imported from a client component or a user-facing route. Only the Stripe
// webhook (app/api/stripe/webhook) and server-side reconcile jobs use it to
// write billing/entitlement columns that the user's own client is not trusted
// to set.

// The new `sb_secret_...` key (individually rotatable/revocable) — grants
// RLS-bypassing privileges. The legacy service_role JWT is disabled in the
// Supabase dashboard and no longer read.
function adminKey(): string {
  return process.env.SUPABASE_SECRET_KEY ?? "";
}

export function isAdminConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) && Boolean(adminKey());
}

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = adminKey();
  if (!url || !key) {
    throw new Error("Supabase admin key is not configured (SUPABASE_SECRET_KEY).");
  }
  return createSupabaseClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
