import { SiteHeader, type HeaderUser } from "./site-header";
import { SiteHeaderClient } from "./site-header-client";
import { Suspense } from "react";
import { SiteFooter } from "./site-footer";
import { UpdatesBanner } from "@/components/marketing/updates-banner";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

type AppShellProps = {
  children: React.ReactNode;
  user?: HeaderUser | null;
  /**
   * How the header learns who's signed in:
   *   - "server" (default): the layout fetched the viewer and passes
   *     `user` down — correct on first paint, but forces the route
   *     dynamic. Used by the (app) group, which is per-user anyway.
   *   - "client": renders the anonymous header statically and lets the
   *     SiteHeaderClient island fetch /api/me post-hydration. Used by
   *     the (marketing) group so those pages are CDN-cacheable.
   */
  authMode?: "server" | "client";
  hideFooter?: boolean;
  className?: string;
};

export function AppShell({
  children,
  user,
  authMode = "server",
  hideFooter = false,
  className,
}: AppShellProps) {
  return (
    <div className={cn("flex min-h-svh flex-col", className)}>
      {authMode === "client" ? (
        <SiteHeaderClient />
      ) : (
        <SiteHeader user={user} />
      )}
      {/* What's-new ribbon, right under the header on every page: the
          homepage shows every banner-flagged update, other pages only the
          ones the admin scoped to the whole site (or nothing when the admin
          has hidden the ribbon). Cookie-free cached read — static pages stay
          static. */}
      {isSupabaseConfigured() ? (
        <Suspense fallback={null}>
          <UpdatesBanner />
        </Suspense>
      ) : null}
      <main id="main" className="flex-1">
        {children}
      </main>
      {hideFooter ? null : <SiteFooter />}
    </div>
  );
}
