import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  CardLimitForm,
  CompTierForm,
  GrantCreditsForm,
} from "@/components/admin/user-billing-controls";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Users",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const PROFILE_FIELDS =
  "id, username, display_name, avatar_url, subscription_tier, subscription_status, credits, is_admin, comp_tier, comp_expires_at, card_limit_override, created_at";

type UserRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  subscription_tier: string;
  subscription_status: string | null;
  credits: number;
  is_admin: boolean;
  comp_tier: string | null;
  comp_expires_at: string | null;
  card_limit_override: number | null;
  created_at: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function searchUsers(
  admin: ReturnType<typeof createAdminClient>,
  q: string,
): Promise<UserRow[]> {
  // Email lookup goes through the auth admin API (profiles doesn't store
  // email). listUsers can't filter server-side, so we scan the first page
  // (200 users) for an exact match — fine at current scale; revisit with a
  // SECURITY DEFINER lookup function if the user table outgrows one page.
  if (q.includes("@")) {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const needle = q.trim().toLowerCase();
    const ids = (data?.users ?? [])
      .filter((u) => u.email?.toLowerCase() === needle)
      .map((u) => u.id);
    if (ids.length === 0) return [];
    const { data: profiles } = await admin
      .from("profiles")
      .select(PROFILE_FIELDS)
      .in("id", ids);
    return (profiles ?? []) as UserRow[];
  }

  // PostgREST .or() filters are comma/paren delimited — strip those (and %,
  // the ilike wildcard) so a crafted query can't break out of the pattern.
  const safe = q.replace(/[,()%\\]/g, "").trim();
  if (!safe) return [];
  const { data } = await admin
    .from("profiles")
    .select(PROFILE_FIELDS)
    .or(`username.ilike.%${safe}%,display_name.ilike.%${safe}%`)
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []) as UserRow[];
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; u?: string }>;
}) {
  const profile = await getCurrentProfile();
  // Non-admins get a 404 (don't reveal the route exists).
  if (!profile?.is_admin) notFound();
  if (!isAdminConfigured()) notFound();

  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const selectedId = UUID_PATTERN.test(params.u ?? "") ? params.u! : null;

  const admin = createAdminClient();
  const results = q ? await searchUsers(admin, q) : [];

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Admin · Users"
        title="Users"
        description="Look up an account, grant credits, comp a plan, or raise a saved-card cap. Every write lands in the billing columns via the service role."
      />

      <form action="/admin/users" method="get" className="mt-6 flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by username, display name, or email…"
          className="h-10 w-full max-w-xl rounded-control border border-border bg-elevated px-3 text-sm text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
        />
        <button
          type="submit"
          className="h-10 rounded-control border border-border px-4 text-sm font-medium text-foreground transition-colors hover:border-border-strong hover:bg-elevated"
        >
          Search
        </button>
      </form>

      <div className="mt-6 flex flex-col gap-4">
        {!q ? (
          <p className="text-sm text-muted">
            Search for a user to see their billing snapshot. Email queries need
            an exact address; names match partially.
          </p>
        ) : results.length === 0 ? (
          <EmptyState
            title="No users match"
            description={
              q.includes("@")
                ? "No account uses that exact email (email search checks the first 200 auth users)."
                : `Nothing matches “${q}” in usernames or display names.`
            }
          />
        ) : (
          <SurfaceCard className="divide-y divide-border/50 overflow-hidden">
            {results.map((user) => (
              <Link
                key={user.id}
                href={`/admin/users?q=${encodeURIComponent(q)}&u=${user.id}`}
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 transition-colors hover:bg-elevated",
                  selectedId === user.id && "bg-primary/10",
                )}
              >
                <span className="text-sm font-medium text-foreground">
                  {user.username ? `@${user.username}` : "(no username)"}
                </span>
                {user.display_name ? (
                  <span className="text-sm text-muted">{user.display_name}</span>
                ) : null}
                <TierBadges user={user} />
                <span className="ml-auto text-xs text-subtle">
                  {user.credits} credits · joined{" "}
                  {new Date(user.created_at).toLocaleDateString()}
                </span>
              </Link>
            ))}
          </SurfaceCard>
        )}
      </div>

      {selectedId ? <UserDetail admin={admin} userId={selectedId} /> : null}
    </DashboardShell>
  );
}

function TierBadges({ user }: { user: UserRow }) {
  const compActive =
    user.comp_tier != null &&
    (user.comp_expires_at == null || new Date(user.comp_expires_at) > new Date());
  return (
    <span className="flex items-center gap-1.5">
      <Badge variant={user.subscription_tier === "free" ? "default" : "primary"}>
        {user.subscription_tier}
      </Badge>
      {compActive ? <Badge variant="accent">comp {user.comp_tier}</Badge> : null}
      {user.is_admin ? <Badge variant="gold">admin</Badge> : null}
    </span>
  );
}

async function UserDetail({
  admin,
  userId,
}: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
}) {
  const [{ data: user }, { data: authUser }, { count: cardCount }, { data: ledger }] =
    await Promise.all([
      admin
        .from("profiles")
        .select(
          `${PROFILE_FIELDS}, stripe_customer_id, current_period_end, cancel_at_period_end`,
        )
        .eq("id", userId)
        .maybeSingle(),
      admin.auth.admin.getUserById(userId),
      admin
        .from("cards")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", userId),
      admin
        .from("credit_ledger")
        .select("id, delta, reason, balance_after, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

  if (!user) {
    return (
      <div className="mt-8">
        <EmptyState title="User not found" description="That id doesn't match a profile." />
      </div>
    );
  }

  const email = authUser?.user?.email ?? null;
  const compTier =
    user.comp_tier === "plus" || user.comp_tier === "pro" ? user.comp_tier : null;

  return (
    <div className="mt-8 flex flex-col gap-4">
      <SurfaceCard className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold text-foreground">
            {user.username ? `@${user.username}` : "(no username)"}
          </h2>
          {user.display_name ? (
            <span className="text-sm text-muted">{user.display_name}</span>
          ) : null}
          <TierBadges user={user as UserRow} />
          {user.username ? (
            <Link
              href={`/profile/${user.username}`}
              className="ml-auto text-xs font-medium text-primary-bright hover:underline"
            >
              View profile
            </Link>
          ) : null}
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <Stat label="Email" value={email ?? "—"} />
          <Stat label="Tier" value={user.subscription_tier} />
          <Stat label="Status" value={user.subscription_status ?? "—"} />
          <Stat
            label="Period ends"
            value={
              user.current_period_end
                ? new Date(user.current_period_end).toLocaleString()
                : "—"
            }
          />
          <Stat label="Credits" value={String(user.credits)} />
          <Stat
            label="Comp"
            value={
              compTier
                ? `${compTier}${
                    user.comp_expires_at
                      ? ` until ${new Date(user.comp_expires_at).toLocaleString()}`
                      : " (no expiry)"
                  }`
                : "—"
            }
          />
          <Stat
            label="Card cap override"
            value={
              user.card_limit_override != null
                ? String(user.card_limit_override)
                : "— (tier default)"
            }
          />
          <Stat label="Saved cards" value={String(cardCount ?? 0)} />
          <Stat label="Stripe customer" value={user.stripe_customer_id ?? "—"} mono />
          <Stat label="User id" value={user.id} mono />
          <Stat label="Joined" value={new Date(user.created_at).toLocaleString()} />
          <Stat
            label="Cancels at period end"
            value={user.cancel_at_period_end ? "yes" : "no"}
          />
        </dl>
      </SurfaceCard>

      <SurfaceCard className="flex flex-col gap-6 p-5">
        <section className="flex flex-col gap-3">
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
          <CompTierForm
            userId={user.id}
            compTier={compTier}
            compExpiresAt={user.comp_expires_at}
          />
        </section>

        <section className="flex flex-col gap-3 border-t border-border/50 pt-5">
          <SectionTitle
            title="Card limit override"
            hint="Raises the saved-card cap above the tier default — it can only add headroom, never lower a paid cap."
          />
          <CardLimitForm
            userId={user.id}
            cardLimitOverride={user.card_limit_override}
          />
        </section>
      </SurfaceCard>

      <SurfaceCard className="p-5">
        <SectionTitle
          title="Credit ledger"
          hint="Last 10 entries, newest first."
        />
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
                    <td
                      className={cn(
                        "py-2 pr-4 font-medium tabular-nums",
                        entry.delta > 0 ? "text-primary-bright" : "text-danger",
                      )}
                    >
                      {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                    </td>
                    <td className="py-2 pr-4 tabular-nums text-foreground">
                      {entry.balance_after}
                    </td>
                    <td className="py-2 text-muted">{entry.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-subtle">
        {label}
      </dt>
      <dd
        className={cn(
          "break-all text-foreground",
          mono && "font-mono text-xs leading-5",
        )}
      >
        {value}
      </dd>
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
