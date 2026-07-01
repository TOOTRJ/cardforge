"use client";

import Link from "next/link";
import {
  Activity,
  CreditCard,
  Frame,
  LayoutDashboard,
  Layers,
  LogOut,
  Settings,
  ShieldCheck,
  Trophy,
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
};

export function UserMenu({
  username,
  displayName,
  avatarUrl,
  isPaid = false,
  isAdmin = false,
}: UserMenuProps) {
  const label = displayName?.trim() || username || "Account";
  const initial = (label[0] ?? "?").toUpperCase();

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
        className="w-60 p-2"
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
        <MenuItem href="/dashboard/sets" icon={Layers} label="My sets" />
        <MenuItem href="/settings" icon={Settings} label="Settings" />
        {isBillingEnabled() ? (
          <>
            <MenuItem
              href="/settings#billing"
              icon={CreditCard}
              label="Plans & billing"
            />
            {isPaid ? null : (
              <MenuItem href="/pricing" icon={Sparkles} label="Upgrade to Pro" />
            )}
          </>
        ) : null}
        {isAdmin ? (
          <>
          <MenuItem
            href="/admin/moderation"
            icon={ShieldCheck}
            label="Moderation"
          />
          <MenuItem
            href="/admin/challenges"
            icon={Trophy}
            label="Challenges"
          />
          <MenuItem
            href="/admin/scryfall"
            icon={Activity}
            label="Scryfall usage"
          />
          <MenuItem
            href="/admin/frame-compare"
            icon={Frame}
            label="Frame compare"
          />
          </>
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
}: {
  href: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-muted transition-colors hover:bg-elevated hover:text-foreground focus-visible:outline-none focus-visible:bg-elevated"
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </Link>
  );
}
