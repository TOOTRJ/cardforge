import Link from "next/link";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

type DashboardShellProps = {
  children: React.ReactNode;
  className?: string;
};

export function DashboardShell({ children, className }: DashboardShellProps) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <nav
            aria-label="Dashboard navigation"
            className="flex gap-1 overflow-x-auto rounded-lg border border-border/70 bg-surface p-1 text-sm lg:flex-col lg:overflow-visible lg:bg-transparent lg:p-0"
          >
            {siteConfig.dashboardNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="whitespace-nowrap rounded-md px-3 py-2 text-muted transition-colors hover:bg-elevated hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>

        <div className={cn("min-w-0", className)}>{children}</div>
      </div>
    </div>
  );
}
