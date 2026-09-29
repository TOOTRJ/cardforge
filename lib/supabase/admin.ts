import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

// Service-role Supabase client. BYPASSES Row-Level Security. Allowed only
// where the user's own client cannot do the write: the Stripe webhook and
// cron sweeps, credit grants/refunds (grant_credits is service-role only),
// trigger-protected billing columns (stripe_customer_id etc.), admin
// tooling behind an is_admin gate, storage writes into a user's own
// folder through lib/media/user-storage.ts (users hold no storage write
// policy since migration 0126; card renders go through lib/cards/bake-core.ts,
// which opens the owner's folder the same way — and, before the first such
// write, this deployment's own storage origin in public.storage_origins,
// lib/media/storage-origin.ts), and a card's render pointer
// (rendered_image_url / rendered_thumb_url / rendered_at / layout_version —
// 0126's cards_guard_render_columns lets an API role only clear them; the
// save bake persists a new one in lib/cards/bake-render.ts). NEVER import it
// from a client component, and every non-cron caller must
// authenticate/authorize the caller itself.

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
