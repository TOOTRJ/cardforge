import { SiteHeader, type HeaderUser } from "./site-header";
import { SiteFooter } from "./site-footer";
import { getTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

type AppShellProps = {
  children: React.ReactNode;
  variant?: "marketing" | "app";
  user?: HeaderUser | null;
  hideFooter?: boolean;
  className?: string;
};

export async function AppShell({
  children,
  variant = "marketing",
  user,
  hideFooter = false,
  className,
}: AppShellProps) {
  // Read the theme cookie once at the shell level and pass it down to the
  // header's <ThemeToggle>. The shell is already async-friendly (rendered
  // from the app + marketing layouts which are async); reading a cookie
  // here is cheap and avoids prop-drilling theme through page components.
  const theme = await getTheme();

  return (
    <div className={cn("flex min-h-svh flex-col", className)}>
      <SiteHeader variant={variant} user={user} theme={theme} />
      <main id="main" className="flex-1">
        {children}
      </main>
      {hideFooter ? null : <SiteFooter />}
    </div>
  );
}
