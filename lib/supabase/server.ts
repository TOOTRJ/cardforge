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

export const getCurrentProfile = cache(async () => {
  const user = await getCurrentUser();
  if (!user) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    return data ?? null;
  } catch {
    return null;
  }
});
