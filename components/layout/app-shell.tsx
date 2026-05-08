import { SiteHeader, type HeaderUser } from "./site-header";
import { SiteFooter } from "./site-footer";
import { cn } from "@/lib/utils";

type AppShellProps = {
  children: React.ReactNode;
  variant?: "marketing" | "app";
  user?: HeaderUser | null;
  hideFooter?: boolean;
  className?: string;
};

export function AppShell({
  children,
  variant = "marketing",
  user,
  hideFooter = false,
  className,
}: AppShellProps) {
  return (
    <div className={cn("flex min-h-svh flex-col", className)}>
      <SiteHeader variant={variant} user={user} />
      <main className="flex-1">{children}</main>
      {hideFooter ? null : <SiteFooter />}
    </div>
  );
}
