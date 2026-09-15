import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

// Service-role Supabase client. BYPASSES Row-Level Security. Allowed only
// where the user's own client cannot do the write: the Stripe webhook and
// cron sweeps, credit grants/refunds (grant_credits is service-role only),
// trigger-protected billing columns (stripe_customer_id etc.), and admin
// tooling behind an is_admin gate. NEVER import it from a client component,
// and every non-cron caller must authenticate/authorize the caller itself.

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
