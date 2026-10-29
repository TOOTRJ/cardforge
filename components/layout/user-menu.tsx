"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Coins, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { logoutAction } from "@/app/(auth)/actions";
import { useLiveCredits } from "@/components/billing/credits-bus";
import { isBillingEnabled } from "@/lib/billing/flags";
import { formatCredits, isUnlimitedCredits } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";
import { accountLinkHref, siteConfig, type AccountNavLink } from "@/lib/site-config";
import { NAV_ICONS, NAV_LINK_ICONS } from "@/components/layout/nav-icons";
import { LocalDateText } from "@/components/ui/local-date";
import type { DateText } from "@/lib/format/dates";
import { NavDisclosure } from "./nav-disclosure";
import { NavPanelLink, activeHrefIn } from "./nav-links";
import { trackNavClick } from "./nav-click";
import type { NavSurface } from "@/lib/analytics/funnel-events";

// ---------------------------------------------------------------------------
// The Account menu (TODO NV1): the avatar's disclosure panel (same pattern as
// Community / Learn — nav-disclosure.tsx — so one panel is open at a time).
// A header line with the viewer's name, plan and credits, then their own
// pages from siteConfig.accountNav in two short runs, every admin page for an
// admin, and Sign out (a form action; everything else is a Link). Signed
// out, the same button place offers Sign in / Create account. The drawer
// draws the same parts below `lg` (mobile-menu.tsx: AccountLinks,
// AccountSummary).
// ---------------------------------------------------------------------------

/** The plan line under the name — "Pro plan", "Admin", "Pro · payment due",
 *  "Pro · ends Oct 23, 2026" — from accountPlanLine
 *  (lib/billing/account-plan-line.ts), as parts so a date is printed in the
 *  viewer's own zone. */
export type AccountPlan = DateText;

type UserMenuProps = {
  username: string | null;
  displayName: string | null;
  avatarUrl?: string | null;
  isAdmin?: boolean;
  /** Shows "Messages" — only for users with a support thread. */
  hasMessages?: boolean;
  unreadMessages?: number;
  /** Null while billing is off: nobody is shown a plan or credits then. */
  plan?: AccountPlan | null;
  credits?: number;
  creditsUsed?: number;
};

export function UserMenu({
  username,
  displayName,
  avatarUrl,
  isAdmin = false,
  hasMessages = false,
  unreadMessages = 0,
  plan = null,
  credits = 0,
  creditsUsed = 0,
}: UserMenuProps) {
  const label = displayName?.trim() || username || "Account";
  return (
    <NavDisclosure
      id="account"
      align="end"
      ariaLabel="Open account menu"
      label={<Avatar avatarUrl={avatarUrl ?? null} label={label} className="h-8 w-8" />}
      // Below `sm` the avatar alone (no caret): a 320 px row holds the mark,
      // ＋, the bell, the avatar and ☰ inside its 16 px gutters.
      buttonClassName="rounded-full px-0.5 sm:pr-1.5"
      caretClassName="max-sm:hidden"
      // An admin's panel is wider: its admin grid's two columns fit their
      // labels whole. Never wider than the screen allows: below `lg` the
      // avatar's right edge sits a gutter + ☰ + gap (60 px; 68 from `sm`) in
      // from the screen's, so the cap keeps the left edge on the gutter.
      panelClassName={cn(
        "max-h-[calc(100svh-5rem)] max-w-[calc(100vw-4.75rem)] overflow-y-auto sm:max-w-[calc(100vw-5.75rem)]",
        isAdmin ? "w-80" : "w-72",
      )}
    >
      <AccountSummary
        username={username}
        label={label}
        avatarUrl={avatarUrl ?? null}
        plan={plan}
        credits={credits}
        creditsUsed={creditsUsed}
      />
      <div className="my-1 h-px bg-border/60" />
      <AccountLinks
        username={username}
        hasMessages={hasMessages}
        unreadMessages={unreadMessages}
        surface="header"
      />
      {isAdmin ? (
        // Every admin page (audit I1), from the one list the dashboard
        // rail reads too — two compact columns so the menu stays short.
        <nav aria-label="Admin" className="mt-1 border-t border-border/60 pt-2">
          <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-subtle">Admin</p>
          <div className="grid grid-cols-2 gap-x-1">
            {siteConfig.adminNav.map((item) => {
              const Icon = NAV_ICONS[item.href] ?? ShieldCheck;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted transition-colors hover:bg-elevated hover:text-foreground focus-visible:bg-elevated focus-visible:outline-none"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      ) : null}
      <div className="my-1 h-px bg-border/60" />
      <form action={logoutAction}>
        <button
          type="submit"
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm text-muted transition-colors hover:bg-elevated hover:text-foreground focus-visible:bg-elevated focus-visible:outline-none"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          Sign out
        </button>
      </form>
    </NavDisclosure>
  );
}

/** Signed out: the two doors in, in the Account menu's place (from `lg`; the
 *  drawer carries them below it). */
export function SignedOutAccountMenu({ className }: { className?: string }) {
  return (
    <NavDisclosure
      id="account"
      align="end"
      className={className}
      label={
        <>
          <UserRound className="h-4 w-4" aria-hidden />
          Account
        </>
      }
      buttonClassName="gap-1.5"
      panelClassName="w-80"
    >
      <SignedOutAccountLinks surface="header" />
    </NavDisclosure>
  );
}

export function SignedOutAccountLinks({
  surface,
  onNavigate,
}: {
  surface: NavSurface;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-0.5">
      {siteConfig.accountNav.signedOut.map((link) => (
        <li key={link.id}>
          <NavPanelLink
            link={link}
            surface={surface}
            signedIn={false}
            active={pathname === link.href}
            onNavigate={onNavigate}
          />
        </li>
      ))}
    </ul>
  );
}

/** Avatar, name, @handle — and with billing on, the plan and the credits. */
export function AccountSummary({
  username,
  label,
  avatarUrl,
  plan,
  credits,
  creditsUsed,
}: {
  username: string | null;
  label: string;
  avatarUrl: string | null;
  plan: AccountPlan | null;
  credits: number;
  creditsUsed: number;
}) {
  const balance = useLiveCredits(credits);
  return (
    <div className="flex items-start gap-3 rounded-md px-2 py-2">
      <Avatar avatarUrl={avatarUrl} label={label} className="h-10 w-10" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 leading-tight">
        <span className="truncate text-sm font-semibold text-foreground">{label}</span>
        {username ? <span className="truncate font-mono text-[11px] text-muted">@{username}</span> : null}
        {plan ? (
          <>
            <span className="mt-1.5 text-xs font-medium text-foreground">
              <LocalDateText parts={plan} />
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <Coins className="h-3 w-3 shrink-0 text-gold-strong" aria-hidden />
              {isUnlimitedCredits(balance) ? "Unlimited credits" : `${formatCredits(balance)} credits`} ·{" "}
              {creditsUsed} used this month
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** The viewer's own pages, two runs of six or fewer (siteConfig.accountNav). */
export function AccountLinks({
  username,
  hasMessages,
  unreadMessages,
  surface,
  onNavigate,
}: {
  username: string | null;
  hasMessages: boolean;
  unreadMessages: number;
  surface: NavSurface;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const billingOn = isBillingEnabled();
  const shown = (link: AccountNavLink) =>
    link.when === "billing" ? billingOn : link.when === "messages" ? hasMessages : true;
  const sections = siteConfig.accountNav.signedIn.map((section) => ({
    id: section.id,
    links: section.items.filter(shown),
  }));
  const active = activeHrefIn(
    pathname,
    sections.flatMap((section) => section.links.map((link) => accountLinkHref(link, username))),
  );
  return (
    <div className="flex flex-col">
      {sections.map((section, index) => (
        <ul
          key={section.id}
          className={cn("flex flex-col gap-0.5", index > 0 && "mt-1 border-t border-border/60 pt-1")}
        >
          {section.links.map((link) => {
            const href = accountLinkHref(link, username);
            const Icon = NAV_LINK_ICONS[link.id] ?? NAV_ICONS[link.href] ?? UserRound;
            const isActive = href === active;
            const text =
              link.id === "account.messages" && unreadMessages > 0
                ? `${link.label} (${unreadMessages > 9 ? "9+" : unreadMessages})`
                : link.label;
            return (
              <li key={link.id}>
                <Link
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => {
                    trackNavClick(link.id, surface, true);
                    onNavigate?.();
                  }}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors",
                    "hover:bg-elevated hover:text-foreground focus-visible:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50",
                    isActive ? "bg-elevated text-foreground" : "text-muted",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {text}
                </Link>
              </li>
            );
          })}
        </ul>
      ))}
    </div>
  );
}

function Avatar({
  avatarUrl,
  label,
  className,
}: {
  avatarUrl: string | null;
  label: string;
  className?: string;
}) {
  const initial = (label[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/70 bg-linear-to-br from-primary to-accent text-xs font-semibold text-primary-foreground",
        className,
      )}
    >
      {avatarUrl ? (
        // Plain img keeps next/image from complaining about user-uploaded
        // hosts; the avatar is small enough that LCP isn't relevant.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        initial
      )}
    </span>
  );
}
