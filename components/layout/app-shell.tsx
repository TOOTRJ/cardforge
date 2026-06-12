import { SiteHeader, type HeaderUser } from "./site-header";
import { SiteHeaderClient } from "./site-header-client";
import { SiteFooter } from "./site-footer";
import { cn } from "@/lib/utils";

type AppShellProps = {
  children: React.ReactNode;
  variant?: "marketing" | "app";
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
  variant = "marketing",
  user,
  authMode = "server",
  hideFooter = false,
  className,
}: AppShellProps) {
  return (
    <div className={cn("flex min-h-svh flex-col", className)}>
      {authMode === "client" ? (
        <SiteHeaderClient variant={variant} />
      ) : (
        <SiteHeader variant={variant} user={user} />
      )}
      <main id="main" className="flex-1">
        {children}
      </main>
      {hideFooter ? null : <SiteFooter />}
    </div>
  );
}
