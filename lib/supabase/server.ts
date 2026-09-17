import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/supabase";
import { getSupabaseEnv, isSupabaseConfigured } from "./env";

export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseEnv();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // `cookies().set` throws when called from a Server Component.
          // Middleware refreshes the session on every request, so this is fine.
        }
      },
    },
  });
}

// Wrapped in React's per-request `cache()` so multiple call sites within a
// single render (layout + page + nested queries) share one auth lookup
// instead of hitting Supabase's rate limit. Same memoization works for the
// profile query below.
export const getCurrentUser = cache(async () => {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user ?? null;
  } catch {
    return null;
  }
});

/** The columns anon/authenticated may read from profiles (migration 0074
 *  replaced the blanket grant with this list). The billing/admin slice is
 *  private and comes back through get_my_billing() for the user's OWN row. */
export const PUBLIC_PROFILE_COLUMNS =
  "id, username, display_name, avatar_url, bio, website_url, created_at, updated_at, banner_url, accent_color, twitter_url, bluesky_url, instagram_url, youtube_url, tiktok_url, discord_url, github_url, pinned_card_ids, featured_at, export_watermark_text, onboarded_at";

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

/** Billing defaults when the RPC is unavailable — the FREE tier, never a
 *  paid one, so a read hiccup can only under-entitle. */
export const PUBLIC_PROFILE_DEFAULTS: Pick<
  ProfileRow,
  | "subscription_tier"
  | "subscription_status"
  | "stripe_customer_id"
  | "stripe_subscription_id"
  | "current_period_end"
  | "cancel_at_period_end"
  | "credits"
  | "comp_tier"
  | "comp_expires_at"
  | "card_limit_override"
  | "is_admin"
> = {
  subscription_tier: "free",
  subscription_status: null,
  stripe_customer_id: null,
  stripe_subscription_id: null,
  current_period_end: null,
  cancel_at_period_end: false,
  credits: 0,
  comp_tier: null,
  comp_expires_at: null,
  card_limit_override: null,
  is_admin: false,
};

// The full profile row for the signed-in user: the public columns through
// the normal RLS read, plus their own billing/admin slice through the
// SECURITY DEFINER get_my_billing() RPC (those columns are no longer
// readable directly — migration 0074). Same shape as before, so every
// consumer (entitlements, layouts, settings) is unchanged.
export const getCurrentProfile = cache(async (): Promise<ProfileRow | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  try {
    const supabase = await createClient();
    const [{ data: profile }, { data: billing }] = await Promise.all([
      supabase
        .from("profiles")
        .select(PUBLIC_PROFILE_COLUMNS)
        .eq("id", user.id)
        .maybeSingle(),
      supabase.rpc("get_my_billing"),
    ]);
    if (!profile) return null;
    const own = billing?.[0];
    return { ...profile, ...(own ?? PUBLIC_PROFILE_DEFAULTS) } as ProfileRow;
  } catch {
    return null;
  }
});
