"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bell,
  BookOpen,
  Frame,
  GalleryVerticalEnd,
  Inbox,
  LayoutDashboard,
  MessageSquare,
  MessageSquarePlus,
  Rss,
  Settings,
  ShieldCheck,
  Sparkles,
  Megaphone,
  Users,
  Star,
  Trophy,
  type LucideIcon,
  FlaskConical,
} from "lucide-react";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

// Icon per dashboard-nav destination, keyed by href so the config stays a
// plain data array (no JSX in site-config.ts).
const NAV_ICONS: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard,
  "/dashboard/cards": GalleryVerticalEnd,
  "/dashboard/decks": BookOpen,
  "/feed": Rss,
  "/dashboard/usage": Sparkles,
  "/notifications": Bell,
  "/messages": MessageSquare,
  "/feedback": MessageSquarePlus,
  "/admin/users": Users,
  "/admin/messages": MessageSquare,
  "/settings": Settings,
  "/admin/moderation": ShieldCheck,
  "/admin/feedback": Inbox,
  "/admin/featured": Star,
  "/admin/challenges": Trophy,
  "/admin/updates": Megaphone,
  "/admin/scryfall": Activity,
  "/admin/frame-compare": Frame,
  "/admin/creator-lab": FlaskConical,
};

type DashboardNavProps = {
  /** Renders the Admin rail section. Set by DashboardShell from the
   *  caller's profile — never from client-side state. */
  isAdmin?: boolean;
  /** The user has at least one support thread — shows "Messages". Never
   *  rendered for users the team hasn't written to. */
  showMessages?: boolean;
  /** Unread counts per href, rendered as a pill (0/undefined = none). */
  badges?: Record<string, number>;
};

const MESSAGES_ITEM = { label: "Messages", href: "/messages" } as const;

/** dashboardNav with "Messages" slotted right after Notifications. */
function userItems(showMessages: boolean) {
  const items = [...siteConfig.dashboardNav];
  if (!showMessages) return items;
  const at = items.findIndex((item) => item.href === "/notifications");
  items.splice(at >= 0 ? at + 1 : items.length, 0, MESSAGES_ITEM);
  return items;
}

// Dashboard left-rail nav with active-route highlighting (the header + mobile
// menu already highlight; this brings the rail in line). The active item is the
// one whose href is the LONGEST prefix of the current path (exact, or
// `${href}/...`), so "Overview" (/dashboard) doesn't also light up on
// a sibling section.
export function DashboardNav({
  isAdmin = false,
  showMessages = false,
  badges = {},
}: DashboardNavProps) {
  const pathname = usePathname();
  const base = userItems(showMessages);
  const items = isAdmin ? [...base, ...siteConfig.adminNav] : base;
  const activeHref = items
    .map((item) => item.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];

  const renderItem = (item: (typeof items)[number]) => {
    const isActive = item.href === activeHref;
    const Icon = NAV_ICONS[item.href];
    const badge = badges[item.href] ?? 0;
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
        {badge > 0 ? (
          <span
            className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground"
            aria-label={`${badge} unread`}
          >
            {badge > 9 ? "9+" : badge}
          </span>
        ) : null}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Dashboard navigation"
      className="flex gap-1 overflow-x-auto rounded-lg border border-border/70 bg-surface p-1 text-sm lg:flex-col lg:overflow-visible lg:bg-transparent lg:p-0"
    >
      {base.map(renderItem)}
      {isAdmin ? (
        <>
          <div
            aria-hidden
            className="hidden lg:my-2 lg:block lg:h-px lg:bg-border/60"
          />
          <span className="hidden px-3 text-[10px] font-semibold uppercase tracking-wider text-subtle lg:block">
            Admin
          </span>
          {siteConfig.adminNav.map(renderItem)}
        </>
      ) : null}
    </nav>
  );
}
