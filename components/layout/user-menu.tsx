"use client";

import Link from "next/link";
import {
  CreditCard,
  GalleryVerticalEnd,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Settings,
  ShieldCheck,
  Sparkles,
  UserCircle,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { logoutAction } from "@/app/(auth)/actions";
import { isBillingEnabled } from "@/lib/billing/flags";
import { cn } from "@/lib/utils";
import { siteConfig } from "@/lib/site-config";
import { NAV_ICONS } from "@/components/layout/nav-icons";
import { useLocalDateText } from "@/components/ui/local-date";
import type { DateText } from "@/lib/format/dates";

// ---------------------------------------------------------------------------
// UserMenu — avatar dropdown that consolidates account links. Replaces the
// standalone @username chip + separate sign-out button in the header.
// Sign-out submits a form action; everything else is a Link.
// ---------------------------------------------------------------------------

type UserMenuProps = {
  username: string | null;
  displayName: string | null;
  avatarUrl?: string | null;
  isPaid?: boolean;
  isAdmin?: boolean;
  /** Shows "Messages" — only for users with a support thread. */
  hasMessages?: boolean;
  unreadMessages?: number;
  /** "Pro ends Oct 23, 2026" — the plan is cancelled and still running; the
   *  billing row says so (lib/billing/plan-ending.ts). */
  /** "Pro ends Oct 23, 2026" — parts, so the date is printed in the
   *  viewer's time zone (a plain string is printed as it is). */
  planEndingNote?: DateText | string | null;
};

export function UserMenu({
  username,
  displayName,
  avatarUrl,
  isPaid = false,
  isAdmin = false,
  hasMessages = false,
  unreadMessages = 0,
  planEndingNote = null,
}: UserMenuProps) {
  const label = displayName?.trim() || username || "Account";
  const initial = (label[0] ?? "?").toUpperCase();
  const billingLabel = useLocalDateText([
    "Billing · ",
    ...(typeof planEndingNote === "string" ? [planEndingNote] : (planEndingNote ?? [])),
  ]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Open account menu"
          className={cn(
            "inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-border/70 bg-elevated text-xs font-semibold text-foreground transition-colors",
            "hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50",
          )}
        >
          {avatarUrl ? (
            // Plain img keeps next/image from complaining about user-uploaded
            // hosts; the menu trigger is small enough that LCP isn't relevant.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <span aria-hidden>{initial}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        // An admin's menu is wider: its admin grid's two columns fit their
        // labels whole.
        className={cn("p-2", isAdmin ? "w-72" : "w-60")}
      >
        <div className="flex items-center gap-3 rounded-md px-2 py-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-linear-to-br from-primary to-accent text-xs font-semibold text-primary-foreground">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              initial
            )}
          </span>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-semibold text-foreground">
              {label}
            </span>
            {username ? (
              <span className="truncate font-mono text-[11px] text-muted">
                @{username}
              </span>
            ) : null}
          </div>
        </div>
        <div className="my-1 h-px bg-border/60" />
        <MenuItem
          href={username ? `/profile/${username}` : "/settings"}
          icon={UserCircle}
          label="View profile"
        />
        <MenuItem
          href="/dashboard"
          icon={LayoutDashboard}
          label="Dashboard"
        />
        <MenuItem
          href="/dashboard/cards"
          icon={GalleryVerticalEnd}
          label="My cards"
        />
        {hasMessages ? (
          <MenuItem
            href="/messages"
            icon={MessageSquare}
            label={unreadMessages > 0 ? `Messages (${unreadMessages > 9 ? "9+" : unreadMessages})` : "Messages"}
          />
        ) : null}
        <MenuItem href="/settings" icon={Settings} label="Settings" />
        {isBillingEnabled() ? (
          <>
            <MenuItem
              href="/dashboard/billing"
              icon={CreditCard}
              label={planEndingNote ? billingLabel : "Billing & subscription"}
            />
            {isPaid ? null : (
              <MenuItem href="/pricing" icon={Sparkles} label="Upgrade to Pro" />
            )}
          </>
        ) : null}
        {isAdmin ? (
          // Every admin page (audit I1), from the one list the dashboard
          // rail reads too — two compact columns so the menu stays short.
          <nav aria-label="Admin" className="mt-1 border-t border-border/60 pt-2">
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-subtle">Admin</p>
            <div className="grid grid-cols-2 gap-x-1">
              {siteConfig.adminNav.map((item) => (
                <MenuItem
                  key={item.href}
                  href={item.href}
                  icon={NAV_ICONS[item.href] ?? ShieldCheck}
                  label={item.label}
                  compact
                />
              ))}
            </div>
          </nav>
        ) : null}
        <div className="my-1 h-px bg-border/60" />
        <form action={logoutAction}>
          <button
            type="submit"
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm text-muted transition-colors hover:bg-elevated hover:text-foreground focus-visible:outline-none focus-visible:bg-elevated"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Sign out
          </button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function MenuItem({
  href,
  icon: Icon,
  label,
  compact = false,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  /** The admin grid's smaller row. */
  compact?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-foreground focus-visible:outline-none focus-visible:bg-elevated",
        compact ? "min-w-0 gap-1.5 px-2 py-1.5 text-xs" : "gap-2.5 px-2 py-2 text-sm",
      )}
    >
      <Icon className={cn("shrink-0", compact ? "h-3.5 w-3.5" : "h-4 w-4")} aria-hidden />
      <span className={compact ? "truncate" : undefined}>{label}</span>
    </Link>
  );
}
