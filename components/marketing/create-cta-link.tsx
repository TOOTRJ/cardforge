"use client";

import Link from "next/link";
import { trackFunnelEvent } from "@/lib/analytics/funnel-client";
import { rememberSignupSurface } from "@/lib/analytics/attribution";
import { CREATE_CTA_LABEL, type CtaSurface } from "@/lib/marketing/create-cta";
import { hasSupabaseSessionCookie } from "@/lib/supabase/session-cookie";

/** A home-page "Make a card — free" link to /create. The page is static;
 *  this island reads nothing until the click, which records a
 *  create_cta_click with its surface and, for a signed-out visitor,
 *  remembers the surface for the signup that may follow. `className` comes
 *  from `<Button asChild>`. */
export function CreateCtaLink({
  surface,
  className,
  children,
}: {
  surface: CtaSurface;
  className?: string;
  /** Extra content after the label (an arrow icon). */
  children?: React.ReactNode;
}) {
  return (
    <Link
      href="/create"
      className={className}
      onClick={() => {
        const signedIn = hasSupabaseSessionCookie();
        trackFunnelEvent("create_cta_click", { surface, signedIn });
        // Only a visitor can sign up next — as the header's button.
        if (!signedIn) rememberSignupSurface(surface);
      }}
    >
      {CREATE_CTA_LABEL}
      {children}
    </Link>
  );
}
