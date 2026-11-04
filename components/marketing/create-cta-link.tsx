"use client";

import Link from "next/link";
import { trackFunnelEvent } from "@/lib/analytics/funnel-client";
import { rememberSignupSurface } from "@/lib/analytics/attribution";
import { CREATE_CTA_LABEL, type CtaSurface } from "@/lib/marketing/create-cta";
import { hasSupabaseSessionCookie } from "@/lib/supabase/session-cookie";

/** A home-page "Make a card — free" link to /create. The page is static;
 *  this island reads nothing until the click, which records a cta_click
 *  with its surface and remembers the surface for the signup that may
 *  follow. `className` comes from `<Button asChild>`. */
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
        trackFunnelEvent("cta_click", { surface, kind: "create", signedIn: hasSupabaseSessionCookie() });
        rememberSignupSurface(surface);
      }}
    >
      {CREATE_CTA_LABEL}
      {children}
    </Link>
  );
}
