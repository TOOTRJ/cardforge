"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { SiteHeader, type HeaderUser } from "./site-header";
import { hasSupabaseSessionCookie } from "@/lib/supabase/session-cookie";

// ---------------------------------------------------------------------------
// SiteHeaderClient — the auth island that lets marketing pages be static.
//
// Server HTML (and first client render) is the anonymous header — byte-
// identical for every visitor, so the page around it can live on the CDN.
// After hydration:
//   - no Supabase session cookie → done. Anonymous visitors pay zero
//     extra network for this.
//   - session cookie present → fetch /api/me and swap in the signed-in
//     chrome (avatar menu, bell, credits). The brief anon flash for
//     signed-in users is the deliberate trade for cacheable pages.
//
// Re-fetches when the pathname changes so client-side navigations pick
// up sign-in/sign-out that happened on the previous page.
// ---------------------------------------------------------------------------

type SiteHeaderClientProps = {
  variant?: "marketing" | "app";
  className?: string;
};

export function SiteHeaderClient({
  variant = "marketing",
  className,
}: SiteHeaderClientProps) {
  const pathname = usePathname();
  const [user, setUser] = useState<HeaderUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // No session cookie → anonymous, zero network. (Async so React
      // batches the update instead of cascading a sync re-render.)
      if (!hasSupabaseSessionCookie()) {
        if (!cancelled) setUser(null);
        return;
      }
      try {
        const res = await fetch("/api/me");
        const data: { user: HeaderUser | null } = res.ok
          ? await res.json()
          : { user: null };
        if (!cancelled) setUser(data.user ?? null);
      } catch {
        // Network hiccup — keep the anonymous header; nothing breaks.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return <SiteHeader variant={variant} user={user} className={className} />;
}
