import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, Database, Gauge, Users } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { UsageBarChart } from "@/components/settings/usage-bar-chart";
import {
  getScryfallAdminUsageSnapshot,
  type ScryfallAdminUsageSnapshot,
} from "@/lib/scryfall/admin-usage-queries";

// ---------------------------------------------------------------------------
// Admin — app-wide Scryfall API usage.
//
// The per-user usage pane on Settings shows one account's quota; this page
// aggregates every account so we can see how close the WHOLE app gets to
// Scryfall's hard limits (2 req/sec on search/named). Per-user quotas sum
// across users, so N heavy users could on paper exceed the global budget —
// this page is the early-warning signal for that.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "Scryfall usage",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const ACTION_LABELS: Record<string, string> = {
  search: "Search",
  named: "Named lookup",
  import_art: "Art import",
};

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border/50 bg-elevated/40 px-4 py-3">
      <span className="text-[11px] uppercase tracking-wider text-subtle">
        {label}
      </span>
      <span className="font-display text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </span>
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}

function PerActionTable({
  snapshot,
}: {
  snapshot: ScryfallAdminUsageSnapshot;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-[11px] uppercase tracking-wider text-subtle">
          <th className="pb-2 font-medium">Action</th>
          <th className="pb-2 text-right font-medium">Last minute</th>
          <th className="pb-2 text-right font-medium">Today</th>
          <th className="pb-2 text-right font-medium">Per-user cap</th>
        </tr>
      </thead>
      <tbody>
        {snapshot.perAction.map((row) => {
          const limits = snapshot.limits[row.action];
          return (
            <tr key={row.action} className="border-t border-border/40">
              <td className="py-2 text-foreground">
                {ACTION_LABELS[row.action] ?? row.action}
              </td>
              <td className="py-2 text-right tabular-nums text-foreground">
                {row.minute}
              </td>
              <td className="py-2 text-right tabular-nums text-foreground">
                {row.today}
              </td>
              <td className="py-2 text-right text-xs text-muted">
                {limits.perMinute}/min · {limits.perDay}/day
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default async function AdminScryfallPage() {
  const snapshot = await getScryfallAdminUsageSnapshot();
  // Non-admins get a 404 (don't reveal the route exists).
  if (snapshot === null) notFound();

  // Collapse the per-action daily rows into one combined trendline.
  const dailyCombined = Object.values(
    snapshot.daily.reduce<Record<string, { day: string; count: number }>>(
      (acc, row) => {
        acc[row.day] = {
          day: row.day,
          count: (acc[row.day]?.count ?? 0) + row.count,
        };
        return acc;
      },
      {},
    ),
  );

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Admin"
        title="Scryfall usage"
        description="App-wide calls to the Scryfall proxy across every account, next to Scryfall's hard limits."
        actions={
          <Badge variant="primary">{snapshot.todayTotal} calls today</Badge>
        }
      />

      <div className="mt-10 flex flex-col gap-10">
        {/* Today at a glance */}
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-subtle">
            Today at a glance
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile
              label="Calls today"
              value={String(snapshot.todayTotal)}
              hint="All actions, all users"
            />
            <StatTile
              label="Last minute"
              value={String(snapshot.minuteTotal)}
              hint="Scryfall allows 120/min on search + named"
            />
            <StatTile
              label="30-day total"
              value={String(
                snapshot.daily.reduce((sum, row) => sum + row.count, 0),
              )}
              hint="Trend below"
            />
          </div>
          <SurfaceCard className="p-4">
            <PerActionTable snapshot={snapshot} />
          </SurfaceCard>
        </section>

        {/* Trend */}
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-subtle">
            30-day trend
          </h2>
          <SurfaceCard className="p-4">
            {dailyCombined.length === 0 ? (
              <EmptyState
                icon={Activity}
                title="No calls yet"
                description="No Scryfall calls recorded in the last 30 days."
              />
            ) : (
              <UsageBarChart data={dailyCombined} unitLabel="Scryfall calls" />
            )}
          </SurfaceCard>
        </section>

        {/* Top users */}
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-subtle">
            Top users (30 days)
          </h2>
          {snapshot.topUsers.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No usage"
              description="No accounts have called the Scryfall proxy recently."
            />
          ) : (
            <SurfaceCard className="p-4">
              <ul className="flex flex-col">
                {snapshot.topUsers.map((user, i) => (
                  <li
                    key={user.userId}
                    className="flex items-center justify-between border-t border-border/40 py-2 first:border-t-0"
                  >
                    <span className="flex items-center gap-3 text-sm">
                      <span className="w-5 text-right text-xs tabular-nums text-subtle">
                        {i + 1}.
                      </span>
                      {user.username ? (
                        <Link
                          href={`/profile/${user.username}`}
                          className="text-foreground underline-offset-2 hover:underline"
                        >
                          {user.username}
                        </Link>
                      ) : (
                        <span className="text-muted">(no username)</span>
                      )}
                    </span>
                    <span className="text-sm tabular-nums text-foreground">
                      {user.calls} calls
                    </span>
                  </li>
                ))}
              </ul>
            </SurfaceCard>
          )}
        </section>

        {/* Limits + bulk-data posture */}
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-subtle">
            Scryfall limits &amp; data posture
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <SurfaceCard className="flex flex-col gap-3 p-5 text-sm leading-6 text-muted">
              <span className="inline-flex items-center gap-2 font-medium text-foreground">
                <Gauge className="h-4 w-4 text-primary-bright" aria-hidden />
                Hard API limits (scryfall.com/docs/api)
              </span>
              <ul className="flex list-disc flex-col gap-1 pl-5">
                <li>
                  <code className="text-xs">/cards/search</code> and{" "}
                  <code className="text-xs">/cards/named</code>: 2 requests/sec
                  (500ms) — our client throttles to match.
                </li>
                <li>All other API endpoints: 10 requests/sec (100ms).</li>
                <li>
                  <code className="text-xs">cards.scryfall.io</code> image CDN:
                  no rate limit.
                </li>
                <li>
                  A 429 locks the caller out for 30 seconds; repeated overload
                  risks a permanent ban. The client retries with Retry-After
                  and backs off.
                </li>
              </ul>
              <p className="text-xs text-subtle">
                Per-user quotas (table above) sum across users, so many heavy
                users could on paper exceed the global 120/min search budget.
                Watch the &ldquo;last minute&rdquo; counter here — sustained
                triple-digit numbers mean it&rsquo;s time to revisit.
              </p>
            </SurfaceCard>
            <SurfaceCard className="flex flex-col gap-3 p-5 text-sm leading-6 text-muted">
              <span className="inline-flex items-center gap-2 font-medium text-foreground">
                <Database className="h-4 w-4 text-primary-bright" aria-hidden />
                Bulk data: not worth mirroring (for now)
              </span>
              <p>
                Scryfall publishes daily bulk exports (Oracle Cards ~171&nbsp;MB,
                Default Cards ~530&nbsp;MB uncompressed). Mirroring them — or
                rehosting card images — adds storage cost, a sync job, and
                staleness for zero benefit at our current volume: search is
                on-demand, per-user capped, and far below the hard limits.
              </p>
              <p className="text-xs text-subtle">
                Revisit if app-wide search sustains ~1 request/sec (visible on
                this page). The right first step then is the slim Oracle Cards
                file as a local search index — not full data or image
                mirroring. Images stay hotlinked to the unlimited CDN, and
                imported art is already copied into our own card-art bucket at
                import time.
              </p>
            </SurfaceCard>
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
