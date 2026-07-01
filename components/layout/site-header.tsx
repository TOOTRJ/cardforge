import Link from "next/link";
import { Coins, LayoutDashboard, Sparkles } from "lucide-react";
import { Logo } from "./logo";
import { Button } from "@/components/ui/button";
import { NavLinks } from "./nav-links";
import { UserMenu } from "./user-menu";
import { MobileMenu } from "./mobile-menu";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { siteConfig } from "@/lib/site-config";
import { isBillingEnabled } from "@/lib/billing/flags";
import { cn } from "@/lib/utils";

type HeaderUser = {
  username: string | null;
  displayName: string | null;
  avatarUrl?: string | null;
  /** Drives the header "Upgrade" CTA — hidden for paid users. */
  isPaid?: boolean;
  /** AI credit balance + credits spent this month, for the header indicator. */
  credits?: number;
  creditsUsed?: number;
  /** Unread in-app notification count for the header bell. */
  unreadNotifications?: number;
  /** Shows the admin (moderation) entry in the user menu. */
  isAdmin?: boolean;
};

type SiteHeaderProps = {
  /** Accepted for API stability (callers still pass it), but no longer used:
   *  the header search was removed and nav items don't depend on variant. */
  variant?: "marketing" | "app";
  user?: HeaderUser | null;
  className?: string;
};

export function SiteHeader({ user, className }: SiteHeaderProps) {
  const isAuthed = Boolean(user);
  const billingOn = isBillingEnabled();
  const unread = user?.unreadNotifications ?? 0;
  const navItems = billingOn
    ? siteConfig.primaryNav
    : siteConfig.primaryNav.filter((item) => item.href !== "/pricing");

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-gold/20 bg-background/70 backdrop-blur-md supports-[backdrop-filter]:bg-background/55",
        className,
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4 sm:gap-6 sm:px-6 lg:px-8">
        <Logo />

        <NavLinks
          className="hidden md:flex md:items-center md:gap-1"
          items={navItems}
          isAuthed={isAuthed}
          activeClassName="bg-elevated"
        />

        <div className="ml-auto flex items-center gap-2">
          {isAuthed ? (
            <>
              {billingOn ? (
                <Link
                  href="/settings#billing"
                  title="AI credits — balance · used this month"
                  className="hidden h-9 items-center gap-1.5 rounded-md border border-border/60 bg-elevated px-2.5 text-xs font-medium text-foreground transition-colors hover:border-border-strong sm:inline-flex"
                >
                  <Coins className="h-3.5 w-3.5 text-gold-strong" aria-hidden />
                  <span>{user?.credits ?? 0}</span>
                  <span className="text-subtle">
                    · {user?.creditsUsed ?? 0} used
                  </span>
                </Link>
              ) : null}
              <NotificationBell initialUnread={unread} />
              {billingOn && !user?.isPaid ? (
                <Button
                  asChild
                  variant="accent"
                  size="sm"
                  className="hidden sm:inline-flex"
                >
                  <Link href="/pricing">
                    <Sparkles className="h-4 w-4" aria-hidden /> Upgrade
                  </Link>
                </Button>
              ) : null}
              <Button asChild size="sm" className="hidden sm:inline-flex">
                <Link href="/create">New card</Link>
              </Button>
              <Button
                asChild
                variant="accent"
                size="sm"
                className="hidden sm:inline-flex"
              >
                <Link href="/dashboard">
                  <LayoutDashboard className="h-4 w-4" aria-hidden /> Dashboard
                </Link>
              </Button>
              <UserMenu
                username={user?.username ?? null}
                displayName={user?.displayName ?? null}
                avatarUrl={user?.avatarUrl ?? null}
                isPaid={user?.isPaid ?? false}
                isAdmin={user?.isAdmin ?? false}
              />
            </>
          ) : (
            <>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="hidden sm:inline-flex"
              >
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm" className="hidden sm:inline-flex">
                <Link href="/signup">Start creating</Link>
              </Button>
            </>
          )}
          <MobileMenu
            isAuthed={isAuthed}
            username={user?.username ?? null}
            isPaid={user?.isPaid ?? false}
            credits={user?.credits ?? 0}
            creditsUsed={user?.creditsUsed ?? 0}
          />
        </div>
      </div>
    </header>
  );
}

export type { HeaderUser };
