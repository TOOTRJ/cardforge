import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Search,
  Users,
} from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BillingHealthPanel,
  CardLimitForm,
  CompTierForm,
  GrantCreditsForm,
  ResyncSubscriptionButton,
} from "@/components/admin/user-billing-controls";
import { RevenuePanel } from "@/components/admin/revenue-panel";
import { getRevenueSummary } from "@/lib/admin/revenue-queries";
import { NewMessageDialog } from "@/components/admin/new-message-dialog";
import { ThreadList } from "@/components/messages/thread-list";
import { formatRelativeTime } from "@/components/messages/format";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import {
  getAdminUserStats,
  listAdminUsers,
  type AdminUserRow,
} from "@/lib/admin/users-queries";
import {
  DEFAULT_USER_SORT,
  FLAG_LABELS,
  SORT_LABELS,
  USER_FLAG_FILTERS,
  USER_SORTS,
  USER_STATUS_FILTERS,
  USER_TIER_FILTERS,
  parseUserListParams,
  totalPages,
  userListHref,
  type UserListParams,
} from "@/lib/admin/users-params";
import { listThreadsForUser } from "@/lib/messages/queries";
import { cn } from "@/lib/utils";
import { isUuid } from "@/lib/ids";

export const metadata: Metadata = {
  title: "Users",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// /admin/users — the user directory. URL is the state (?q=&tier=&status=
// &flag=&sort=&page=) so every view is linkable and refresh-safe; the list
// comes from ONE service-role RPC (admin_list_users, migration 0071) that
// aggregates counts + email server-side. `?u=<id>` opens the detail view
// with stats, billing tools, and the messaging thread list.
// ---------------------------------------------------------------------------

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await getCurrentProfile();
  // Non-admins get a 404 (don't reveal the route exists).
  if (!profile?.is_admin) notFound();
  if (!isAdminConfigured()) notFound();

  const raw = await searchParams;
  const params = parseUserListParams(raw);
  const selectedRaw = Array.isArray(raw.u) ? raw.u[0] : raw.u;
  const selectedId = selectedRaw && isUuid(selectedRaw) ? selectedRaw : null;

  if (selectedId) {
    return (
      <DashboardShell>
        <UserDetail userId={selectedId} backHref={userListHref(params, { page: params.page })} />
      </DashboardShell>
    );
  }

  const [page, revenue] = await Promise.all([listAdminUsers(params), getRevenueSummary()]);
  if (!page) notFound();
  const pages = totalPages(page.total, page.pageSize);

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Admin · Users"
        title="Users"
        description="Every account, with plan, credits, activity and support context. Open a user to grant credits, comp a plan, resync billing, or message them."
        actions={<Badge variant="primary">{page.total.toLocaleString()} total</Badge>}
      />

      {revenue ? (
        <div className="mt-6">
          <RevenuePanel summary={revenue} />
        </div>
      ) : null}

      <div className="mt-6">
        <BillingHealthPanel />
      </div>

      <UserFilters params={params} />

      {page.rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={Users}
            title="No users match"
            description={
              params.q
                ? `Nothing matches “${params.q}” in usernames, display names, or email.`
                : "No accounts match these filters."
            }
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/users">Clear filters</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <SurfaceCard className="mt-6 overflow-hidden p-0">
            {/* Desktop: table. */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-left text-[11px] font-medium uppercase tracking-wide text-subtle">
                    <th className="px-4 py-2.5">User</th>
                    <th className="px-3 py-2.5">Plan</th>
                    <th className="px-3 py-2.5 text-right">Credits</th>
                    <th className="px-3 py-2.5 text-right">Cards</th>
                    <th className="px-3 py-2.5 text-right">Decks</th>
                    <th className="px-3 py-2.5">Active</th>
                    <th className="px-3 py-2.5">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {page.rows.map((user) => (
                    <tr
                      key={user.id}
                      className={cn(
                        "border-b border-border/30 transition-colors hover:bg-elevated/60",
                        user.tierMismatch && "bg-danger/5",
                      )}
                    >
                      <td className="px-4 py-2.5">
                        <UserCell user={user} params={params} />
                      </td>
                      <td className="px-3 py-2.5">
                        <PlanBadges user={user} />
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
                        {user.credits.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
                        {user.cardCount.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
                        {user.deckCount.toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted">
                        {user.lastActiveAt ? formatRelativeTime(user.lastActiveAt) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Phones: stacked cards. */}
            <ul className="divide-y divide-border/40 md:hidden">
              {page.rows.map((user) => (
                <li key={user.id} className={cn("flex flex-col gap-2 px-4 py-3", user.tierMismatch && "bg-danger/5")}>
                  <UserCell user={user} params={params} />
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    <PlanBadges user={user} />
                    <span>{user.credits} credits</span>
                    <span>{user.cardCount} cards</span>
                    <span>{user.deckCount} decks</span>
                    <span>
                      active {user.lastActiveAt ? formatRelativeTime(user.lastActiveAt) : "—"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </SurfaceCard>

          <Pagination params={params} page={page.page} pages={pages} total={page.total} pageSize={page.pageSize} />
        </>
      )}
    </DashboardShell>
  );
}

// ---------------------------------------------------------------------------
// Filter bar — a plain GET form: no JS needed, and the URL stays the state.
// ---------------------------------------------------------------------------

const selectClass =
  "h-9 rounded-control border border-border bg-elevated px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50";

function UserFilters({ params }: { params: UserListParams }) {
  return (
    <form action="/admin/users" method="get" className="mt-6 flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <label className="relative flex-1 basis-64">
          <span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            type="search"
            name="q"
            defaultValue={params.q}
            placeholder="Username, display name, or email…"
            className="h-10 w-full rounded-control border border-border bg-elevated pl-9 pr-3 text-sm text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
          />
        </label>
        <select name="tier" defaultValue={params.tier} className={selectClass} aria-label="Tier">
          {USER_TIER_FILTERS.map((t) => (
            <option key={t} value={t}>
              {t ? `Tier: ${t}` : "Any tier"}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={params.status} className={selectClass} aria-label="Subscription status">
          {USER_STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s ? `Status: ${s}` : "Any status"}
            </option>
          ))}
        </select>
        <select name="flag" defaultValue={params.flag} className={selectClass} aria-label="Segment">
          {USER_FLAG_FILTERS.map((f) => (
            <option key={f} value={f}>
              {FLAG_LABELS[f]}
            </option>
          ))}
        </select>
        <select name="sort" defaultValue={params.sort} className={selectClass} aria-label="Sort">
          {USER_SORTS.map((s) => (
            <option key={s} value={s}>
              Sort: {SORT_LABELS[s]}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" size="sm" className="h-9">
          Apply
        </Button>
        {params.q || params.tier || params.status || params.flag || params.sort !== DEFAULT_USER_SORT ? (
          <Button asChild variant="ghost" size="sm" className="h-9">
            <Link href="/admin/users">Reset</Link>
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-subtle">
        Email matches by prefix; names match anywhere. “Tier mismatch” = a live Stripe status on the free tier — open the user and Resync from Stripe.
      </p>
    </form>
  );
}

function Pagination({
  params,
  page,
  pages,
  total,
  pageSize,
}: {
  params: UserListParams;
  page: number;
  pages: number;
  total: number;
  pageSize: number;
}) {
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="mt-4 flex flex-wrap items-center justify-between gap-3" aria-label="Pagination">
      <span className="text-xs text-muted">
        Showing {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-2">
        <Button asChild variant="outline" size="sm" className={cn(page <= 1 && "pointer-events-none opacity-50")}>
          <Link href={userListHref(params, { page: Math.max(1, page - 1) })} aria-disabled={page <= 1}>
            <ChevronLeft className="h-4 w-4" aria-hidden /> Previous
          </Link>
        </Button>
        <span className="text-xs tabular-nums text-muted">
          Page {page} of {pages}
        </span>
        <Button asChild variant="outline" size="sm" className={cn(page >= pages && "pointer-events-none opacity-50")}>
          <Link href={userListHref(params, { page: Math.min(pages, page + 1) })} aria-disabled={page >= pages}>
            Next <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
      </div>
    </nav>
  );
}

function UserCell({ user, params }: { user: AdminUserRow; params: UserListParams }) {
  const label = user.username ? `@${user.username}` : "(no username)";
  return (
    <Link
      href={userListHref(params, { page: params.page }, { u: user.id })}
      className="flex items-center gap-3"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-elevated text-xs font-semibold text-muted">
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          (user.displayName ?? user.username ?? "?").slice(0, 1).toUpperCase()
        )}
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-sm font-medium text-foreground hover:underline">
          {label}
          {user.displayName ? <span className="font-normal text-muted"> · {user.displayName}</span> : null}
        </span>
        <span className="truncate font-mono text-[11px] text-subtle">{user.email ?? "no email"}</span>
      </span>
    </Link>
  );
}

function PlanBadges({ user }: { user: AdminUserRow }) {
  const compActive =
    user.compTier != null &&
    (user.compExpiresAt == null || new Date(user.compExpiresAt) > new Date());
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Badge variant={user.subscriptionTier === "free" ? "default" : "primary"}>
        {user.subscriptionTier}
        {user.subscriptionStatus && user.subscriptionTier !== "free" ? ` · ${user.subscriptionStatus}` : ""}
      </Badge>
      {compActive ? <Badge variant="accent">comp {user.compTier}</Badge> : null}
      {user.isAdmin ? <Badge variant="gold">admin</Badge> : null}
      {user.tierMismatch ? <Badge variant="danger">tier mismatch</Badge> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Detail view — everything about one account + the support tools.
// ---------------------------------------------------------------------------

async function UserDetail({ userId, backHref }: { userId: string; backHref: string }) {
  const admin = createAdminClient();
  const [{ data: user }, { data: authUser }, stats, { data: ledger }, threads] =
    await Promise.all([
      admin
        .from("profiles")
        .select(
          "id, username, display_name, avatar_url, subscription_tier, subscription_status, credits, is_admin, comp_tier, comp_expires_at, card_limit_override, created_at, stripe_customer_id, stripe_subscription_id, current_period_end, cancel_at_period_end, export_watermark_text",
        )
        .eq("id", userId)
        .maybeSingle(),
      admin.auth.admin.getUserById(userId),
      getAdminUserStats(userId),
      admin
        .from("credit_ledger")
        .select("id, delta, reason, balance_after, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(12),
      listThreadsForUser(userId),
    ]);

  if (!user) {
    return (
      <>
        <BackLink href={backHref} />
        <div className="mt-6">
          <EmptyState title="User not found" description="That id doesn't match a profile." />
        </div>
      </>
    );
  }

  const email = authUser?.user?.email ?? null;
  const lastSignIn = authUser?.user?.last_sign_in_at ?? null;
  const compTier = user.comp_tier === "plus" || user.comp_tier === "pro" ? user.comp_tier : null;
  const label = user.display_name || (user.username ? `@${user.username}` : "this user");
  const tierMismatch =
    user.subscription_tier === "free" &&
    (user.subscription_status === "active" || user.subscription_status === "trialing");

  const statTiles = stats
    ? [
        { label: "Cards", value: stats.cardsTotal, hint: `${stats.cardsPublic} public · ${stats.cardsUnlisted} unlisted · ${stats.cardsPrivate} private` },
        { label: "Decks", value: stats.decks },
        { label: "Likes received", value: stats.likesReceived },
        { label: "Credits spent this month", value: stats.creditsSpentMonth },
        { label: "Feedback sent", value: stats.feedbackCount },
        { label: "Conversations", value: stats.threadCount, hint: stats.unreadFromUser > 0 ? `${stats.unreadFromUser} awaiting reply` : undefined },
      ]
    : [];

  return (
    <>
      <BackLink href={backHref} />
      <PageHeader
        className="mt-3"
        eyebrow="Admin · User"
        title={user.username ? `@${user.username}` : "(no username)"}
        description={user.display_name ?? undefined}
        actions={
          <>
            {user.username ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/profile/${user.username}`}>View profile</Link>
              </Button>
            ) : null}
            <NewMessageDialog userId={user.id} userLabel={label} variant="primary" />
          </>
        }
      />

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Badge variant={user.subscription_tier === "free" ? "default" : "primary"}>
          {user.subscription_tier}
          {user.subscription_status ? ` · ${user.subscription_status}` : ""}
        </Badge>
        {compTier ? <Badge variant="accent">comp {compTier}</Badge> : null}
        {user.is_admin ? <Badge variant="gold">admin</Badge> : null}
        {tierMismatch ? <Badge variant="danger">tier mismatch — resync below</Badge> : null}
      </div>

      {statTiles.length > 0 ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {statTiles.map((tile) => (
            <SurfaceCard key={tile.label} className="flex flex-col gap-0.5 p-4">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
                {tile.label}
              </span>
              <span className="font-display text-2xl font-semibold text-foreground">
                {tile.value.toLocaleString()}
              </span>
              {tile.hint ? <span className="text-xs text-muted">{tile.hint}</span> : null}
            </SurfaceCard>
          ))}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          <SurfaceCard className="p-5">
            <SectionTitle title="Account" hint="Identity + subscription state as the profile row stores it." />
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              <Stat label="Email" value={email ?? "—"} />
              <Stat label="Last sign-in" value={lastSignIn ? new Date(lastSignIn).toLocaleString() : "—"} />
              <Stat label="Joined" value={new Date(user.created_at).toLocaleString()} />
              <Stat label="Tier" value={user.subscription_tier} />
              <Stat label="Status" value={user.subscription_status ?? "—"} />
              <Stat
                label="Period ends"
                value={user.current_period_end ? new Date(user.current_period_end).toLocaleString() : "—"}
              />
              <Stat label="Credits" value={String(user.credits)} />
              <Stat
                label="Comp"
                value={
                  compTier
                    ? `${compTier}${user.comp_expires_at ? ` until ${new Date(user.comp_expires_at).toLocaleString()}` : " (no expiry)"}`
                    : "—"
                }
              />
              <Stat
                label="Card cap override"
                value={user.card_limit_override != null ? String(user.card_limit_override) : "— (tier default)"}
              />
              <Stat label="Cancels at period end" value={user.cancel_at_period_end ? "yes" : "no"} />
              <Stat label="Export footer mark" value={user.export_watermark_text ?? "—"} />
              <Stat label="Stripe customer" value={user.stripe_customer_id ?? "—"} mono />
              <Stat label="Stripe subscription" value={user.stripe_subscription_id ?? "—"} mono />
              <Stat label="User id" value={user.id} mono />
            </dl>
          </SurfaceCard>

          <SurfaceCard className="flex flex-col gap-6 p-5">
            <section className="flex flex-col gap-3">
              <SectionTitle
                title="Subscription"
                hint="Rewrites tier/status/period from the customer's live Stripe subscriptions (the webhook's own sync) and grants any monthly credits the tier is owed. Use it when Stripe and the profile disagree."
              />
              <div>
                <ResyncSubscriptionButton
                  userId={user.id}
                  hasStripeCustomer={Boolean(user.stripe_customer_id)}
                />
              </div>
            </section>
            <section className="flex flex-col gap-3 border-t border-border/50 pt-5">
              <SectionTitle
                title="Grant credits"
                hint="Adds to the balance via the grant_credits ledger RPC. The note lands in the ledger reason."
              />
              <GrantCreditsForm userId={user.id} />
            </section>
            <section className="flex flex-col gap-3 border-t border-border/50 pt-5">
              <SectionTitle
                title="Comp a plan"
                hint="The higher of the comp and the Stripe tier applies while unexpired. None clears the comp and its expiry."
              />
              <CompTierForm userId={user.id} compTier={compTier} compExpiresAt={user.comp_expires_at} />
            </section>
            <section className="flex flex-col gap-3 border-t border-border/50 pt-5">
              <SectionTitle
                title="Card limit override"
                hint="Raises the saved-card cap above the tier default — it can only add headroom, never lower a paid cap."
              />
              <CardLimitForm userId={user.id} cardLimitOverride={user.card_limit_override} />
            </section>
          </SurfaceCard>

          <SurfaceCard className="p-5">
            <SectionTitle title="Credit ledger" hint="Last 12 entries, newest first." />
            {!ledger || ledger.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No ledger entries yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 text-left text-[11px] font-medium uppercase tracking-wide text-subtle">
                      <th className="py-2 pr-4">When</th>
                      <th className="py-2 pr-4">Delta</th>
                      <th className="py-2 pr-4">Balance after</th>
                      <th className="py-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((entry) => (
                      <tr key={entry.id} className="border-b border-border/30">
                        <td className="whitespace-nowrap py-2 pr-4 text-muted">
                          {new Date(entry.created_at).toLocaleString()}
                        </td>
                        <td className={cn("py-2 pr-4 font-medium tabular-nums", entry.delta > 0 ? "text-primary-bright" : "text-danger")}>
                          {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                        </td>
                        <td className="py-2 pr-4 tabular-nums text-foreground">{entry.balance_after}</td>
                        <td className="py-2 text-muted">{entry.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SurfaceCard>
        </div>

        <SurfaceCard className="flex flex-col overflow-hidden p-0 self-start">
          <div className="flex items-center gap-2 border-b border-border/50 px-4 py-3">
            <MessageSquare className="h-4 w-4 text-gold" aria-hidden />
            <h3 className="text-sm font-semibold text-foreground">Conversations</h3>
            <span className="ml-auto text-xs text-subtle">{threads?.length ?? 0}</span>
          </div>
          {!threads || threads.length === 0 ? (
            <div className="flex flex-col items-start gap-3 px-4 py-5">
              <p className="text-sm text-muted">No conversations with {label} yet.</p>
              <NewMessageDialog userId={user.id} userLabel={label} />
            </div>
          ) : (
            <ThreadList threads={threads} basePath="/admin/messages" />
          )}
        </SurfaceCard>
      </div>
    </>
  );
}

function BackLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-foreground"
    >
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All users
    </Link>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-subtle">{label}</dt>
      <dd className={cn("break-all text-foreground", mono && "font-mono text-xs leading-5")}>{value}</dd>
    </div>
  );
}

function SectionTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="text-xs text-muted">{hint}</p>
    </div>
  );
}
