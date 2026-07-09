import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getCurrentProfile,
  getCurrentUser,
} from "@/lib/supabase/server";
import { getEntitlements } from "@/lib/billing/entitlements";
import { getCreditsUsedThisMonth } from "@/lib/ai/usage-queries";
import { isBillingEnabled } from "@/lib/billing/flags";
import { getUnreadNotificationCount } from "@/lib/notifications/queries";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { HeaderUser } from "@/components/layout/site-header";

// ---------------------------------------------------------------------------
// GET /api/me — the header auth island's data source.
//
// Marketing pages render statically with an anonymous header; the client
// island calls this to swap in the signed-in chrome. The response is the
// exact HeaderUser shape the SiteHeader expects.
//
// Anonymous requests are the hot path: no Supabase auth cookie → instant
// `{ user: null }` without touching the network. Always `private,
// no-store` — this is per-visitor data and must never enter a shared
// cache.
// ---------------------------------------------------------------------------

const NO_STORE = { "cache-control": "private, no-store" };

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ user: null }, { headers: NO_STORE });
  }

  const store = await cookies();
  const hasSessionCookie = store
    .getAll()
    .some(({ name }) => /^sb-.*-auth-token(\.\d+)?$/.test(name));
  if (!hasSessionCookie) {
    return NextResponse.json({ user: null }, { headers: NO_STORE });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ user: null }, { headers: NO_STORE });
  }

  const [profile, entitlements, creditsUsed, unreadNotifications] =
    await Promise.all([
      getCurrentProfile(),
      getEntitlements(),
      isBillingEnabled() ? getCreditsUsedThisMonth() : Promise.resolve(0),
      getUnreadNotificationCount(),
    ]);

  const headerUser: HeaderUser = {
    username: profile?.username ?? null,
    displayName: profile?.display_name ?? null,
    avatarUrl: profile?.avatar_url ?? null,
    isPaid: entitlements?.isPaid ?? false,
    tier: entitlements?.tier ?? null,
    credits: entitlements?.credits ?? 0,
    creditsUsed,
    unreadNotifications,
    isAdmin: profile?.is_admin ?? false,
  };

  return NextResponse.json({ user: headerUser }, { headers: NO_STORE });
}
