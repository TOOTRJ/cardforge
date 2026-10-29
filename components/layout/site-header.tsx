import { Logo } from "./logo";
import { HeaderNav } from "./nav-links";
import { HeaderDisclosures } from "./nav-disclosure";
import { SignedOutAccountMenu, UserMenu, type AccountPlan } from "./user-menu";
import { MobileMenu } from "./mobile-menu";
import { HeaderCreditsChip } from "./header-credits-chip";
import { HeaderCreateLink } from "./header-create-link";
import { WIDE_FRAME_CLASS } from "./wide-frame";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { RealtimeAlerts } from "@/components/notifications/realtime-alerts";
import { siteConfig } from "@/lib/site-config";
import { isBillingEnabled } from "@/lib/billing/flags";
import type { PlanTier } from "@/lib/billing/plans";
import { accountPlanLine } from "@/lib/billing/account-plan-line";
import { cn } from "@/lib/utils";

type HeaderUser = {
  /** auth.users id — the real-time notification subscriber filters on it. */
  id?: string | null;
  username: string | null;
  displayName: string | null;
  avatarUrl?: string | null;
  /** Hides Pricing — a paid account manages its plan on /dashboard/billing. */
  isPaid?: boolean;
  /** Subscription tier — lets billing surfaces (e.g. /pricing) hydrate the
   *  viewer's plan client-side while the page itself stays static/ISR, and
   *  names the plan in the Account menu. */
  tier?: PlanTier | null;
  /** The plan subscribed to, even while its payment is broken
   *  (Entitlements.tier) — the Account menu's "Pro · payment due". */
  subscribedTier?: PlanTier | null;
  /** Raw Stripe status (`active`, `past_due`, `canceled`, …) — lets /pricing
   *  offer "update your payment" instead of a second checkout when a
   *  subscription's payment is broken. */
  subscriptionStatus?: string | null;
  /** AI credit balance + credits spent this month, for the header indicator. */
  credits?: number;
  creditsUsed?: number;
  /** Unread in-app notification count for the header bell. */
  unreadNotifications?: number;
  /** The user has at least one support thread — the mobile drawer and the
   *  Account menu show "Messages" (never for users without one). */
  hasMessages?: boolean;
  /** Unread admin posts across their threads. */
  unreadMessages?: number;
  /** True once the user has EVER held a subscription (any status) — gates the
   *  "free trial" CTA copy on /pricing so lapsed subscribers aren't promised
   *  a trial checkout won't grant. */
  hasSubscribed?: boolean;
  /** A Stripe customer exists for this user — the billing portal can open.
   *  False for comped/admin accounts that never checked out. */
  hasBillingAccount?: boolean;
  /** A subscription Stripe is still billing (active or trialing) — the
   *  storefront offers "Switch to …", not a fresh subscription. */
  hasLiveSubscription?: boolean;
  /** That subscription is set to stop at the end of its period (cancelled,
   *  not yet ended) — the storefront offers nothing to "manage" down to Free. */
  subscriptionEnding?: boolean;
  /** ISO date it stops, and whether it is a cancelled trial — the Account
   *  menu's "Pro · ends Oct 23, 2026" line (lib/billing/plan-ending.ts). */
  subscriptionEndsAt?: string | null;
  subscriptionEndingKind?: "plan" | "trial" | null;
  /** Shows the admin pages in the Account menu. */
  isAdmin?: boolean;
};

type SiteHeaderProps = {
  user?: HeaderUser | null;
  /** The current challenge's "Ends in N days" pill for the Community panel
   *  (AppShell: a cached server read in a Suspense boundary). */
  challengeBadge?: React.ReactNode;
  className?: string;
};

// ---------------------------------------------------------------------------
// The site header (TODO NV1 / WD2). From `lg` (1024 px), for everyone:
//
//   Logo · Community ▾ · Learn ▾ · Pricing ······ credits · ＋ Create a card · bell · Account ▾
//
// Below `lg`: Logo ······ ＋ Create · bell · avatar · ☰ (the drawer holds the
// nav and the Account links). The groups come from siteConfig.primaryNav;
// Community, Learn and Account are disclosure panels, one open at a time
// (nav-disclosure.tsx). Pricing shows only where a plan can be bought
// (billing on, not already paid). The row is the WIDE frame: the logo sits in
// the same place on every page (owner decision D7).
//
// Measured with billing on, a 4-digit balance and a long handle (the
// handle never reaches the row — the avatar stands for it): a signed-in
// free row needs ~900 px at `lg`, so nothing waits for `xl` any more (TODO
// 3b.27's free-account `xl` nav is gone with the Upgrade and Dashboard
// buttons it made room for).
// ---------------------------------------------------------------------------

export function SiteHeader({ user, challengeBadge, className }: SiteHeaderProps) {
  const isAuthed = Boolean(user);
  const billingOn = isBillingEnabled();
  const unread = user?.unreadNotifications ?? 0;
  // Pricing is for accounts that can buy a plan: billing on AND not already
  // paid (a Plus/Pro/comped/admin account manages its plan — and buys credit
  // packs — on /dashboard/billing instead; /pricing redirects them there).
  const showPricing = billingOn && !user?.isPaid;
  const entries = showPricing
    ? siteConfig.primaryNav
    : siteConfig.primaryNav.filter((entry) => !(entry.kind === "link" && entry.href === "/pricing"));
  // The Account menu's plan line ("Admin", "Pro · payment due", "Pro · ends
  // Oct 23, 2026", "Pro · complimentary", "Pro plan") — the billing page's
  // decisions, from the facts /api/me and the (app) layout carry.
  const plan: AccountPlan | null = billingOn && user ? accountPlanLine(user) : null;

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-gold/20 bg-background/70 backdrop-blur-md supports-[backdrop-filter]:bg-background/55",
        className,
      )}
    >
      <HeaderDisclosures>
        <div className={cn(WIDE_FRAME_CLASS, "flex h-16 items-center gap-3 sm:gap-6")}>
          {/* Under 360 px the mark stands alone: the signed-in row (＋, bell,
              avatar, ☰) and the wordmark don't fit a 320 px screen together
              (WCAG 1.4.10 reflow). */}
          <Logo className="shrink-0" wordmarkClassName="max-[359px]:hidden" />

          <HeaderNav
            className="hidden lg:block"
            entries={entries}
            isAuthed={isAuthed}
            challengeBadge={challengeBadge}
          />

          <div className="ml-auto flex items-center gap-2">
            {isAuthed && billingOn ? (
              <HeaderCreditsChip credits={user?.credits ?? 0} creditsUsed={user?.creditsUsed ?? 0} />
            ) : null}
            {user?.id ? <RealtimeAlerts userId={user.id} isAdmin={user.isAdmin ?? false} /> : null}
            <HeaderCreateLink isAuthed={isAuthed} />
            {isAuthed ? (
              <>
                {/* Bell sits right beside the avatar — one "you" cluster. */}
                <NotificationBell initialUnread={unread} isAdmin={user?.isAdmin ?? false} />
                <UserMenu
                  username={user?.username ?? null}
                  displayName={user?.displayName ?? null}
                  avatarUrl={user?.avatarUrl ?? null}
                  isAdmin={user?.isAdmin ?? false}
                  hasMessages={user?.hasMessages ?? false}
                  unreadMessages={user?.unreadMessages ?? 0}
                  plan={plan}
                  credits={user?.credits ?? 0}
                  creditsUsed={user?.creditsUsed ?? 0}
                />
              </>
            ) : (
              <SignedOutAccountMenu className="hidden lg:block" />
            )}
            <MobileMenu
              entries={entries}
              isAuthed={isAuthed}
              username={user?.username ?? null}
              displayName={user?.displayName ?? null}
              avatarUrl={user?.avatarUrl ?? null}
              isAdmin={user?.isAdmin ?? false}
              plan={plan}
              credits={user?.credits ?? 0}
              creditsUsed={user?.creditsUsed ?? 0}
              hasMessages={user?.hasMessages ?? false}
              unreadMessages={user?.unreadMessages ?? 0}
              challengeBadge={challengeBadge}
            />
          </div>
        </div>
      </HeaderDisclosures>
    </header>
  );
}

export type { HeaderUser };
