import "server-only";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getEntitlements } from "@/lib/billing/entitlements";
import type { CardCapacity } from "@/lib/billing/capacity-copy";

/**
 * The signed-in user's saved-card usage against their plan cap — for the
 * warnings the creator, deck wizard and My Cards show BEFORE an action, and
 * for the jobs route's pre-check. The database enforces the same cap
 * (migration 0104); this is the friendly layer in front of it. Null when
 * signed out or Supabase isn't configured.
 */
export async function getCardCapacity(): Promise<CardCapacity | null> {
  if (!isSupabaseConfigured()) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  const entitlements = await getEntitlements();
  try {
    const supabase = await createClient();
    const { count } = await supabase
      .from("cards")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", user.id);
    return {
      used: count ?? 0,
      cap: entitlements.cardCapacity,
      tier: entitlements.effectiveTier,
    };
  } catch {
    return null;
  }
}
