"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  LayoutDashboard,
  Layers,
  Rss,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

// Icon per dashboard-nav destination, keyed by href so the config stays a
// plain data array (no JSX in site-config.ts).
const NAV_ICONS: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard,
  "/feed": Rss,
  "/dashboard/sets": Layers,
  "/notifications": Bell,
  "/settings": Settings,
};

// Dashboard left-rail nav with active-route highlighting (the header + mobile
// menu already highlight; this brings the rail in line). The active item is the
// one whose href is the LONGEST prefix of the current path (exact, or
// `${href}/...`), so "Overview" (/dashboard) doesn't also light up on
// /dashboard/sets — only "My Sets" does.
export function DashboardNav() {
  const pathname = usePathname();
  const activeHref = siteConfig.dashboardNav
    .map((item) => item.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <nav
      aria-label="Dashboard navigation"
      className="flex gap-1 overflow-x-auto rounded-lg border border-border/70 bg-surface p-1 text-sm lg:flex-col lg:overflow-visible lg:bg-transparent lg:p-0"
    >
      {siteConfig.dashboardNav.map((item) => {
        const isActive = item.href === activeHref;
        const Icon = NAV_ICONS[item.href];
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 font-medium transition-colors",
              isActive
                ? "bg-elevated text-foreground"
                : "text-muted hover:bg-elevated hover:text-foreground",
            )}
          >
            {Icon ? (
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0",
                  isActive ? "text-accent" : "text-subtle",
                )}
                aria-hidden
              />
            ) : null}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
