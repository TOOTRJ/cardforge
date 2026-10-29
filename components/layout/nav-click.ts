"use client";

import { trackFunnelEvent } from "@/lib/analytics/funnel-client";
import type { NavSurface } from "@/lib/analytics/funnel-events";
import { hasSupabaseSessionCookie } from "@/lib/supabase/session-cookie";

/** One nav link click (TODO NV10): the link's id from lib/site-config.ts and
 *  where it sat. `signedIn` is what the page knows — the footer, static,
 *  asks the session cookie — and /api/events stamps its own; an anonymous
 *  row carries no identifier. Fire-and-forget, like every funnel event. */
export function trackNavClick(item: string, surface: NavSurface, signedIn?: boolean): void {
  trackFunnelEvent("nav_click", {
    item,
    surface,
    signedIn: signedIn ?? hasSupabaseSessionCookie(),
  });
}
