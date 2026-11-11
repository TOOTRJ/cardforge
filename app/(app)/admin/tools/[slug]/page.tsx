import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BellRing, ChevronLeft, MousePointerClick, Repeat, UserCheck, Users } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { SurfaceCard } from "@/components/ui/surface-card";
import { IconTile } from "@/components/ui/icon-tile";
import { AdminLoadError } from "@/components/admin/admin-load-error";
import { TOOL_ICONS } from "@/components/tools/tool-icon";
import { ToolStageBadge } from "@/components/admin/tools/tool-stage-badge";
import { StatTile } from "@/components/admin/tools/stat-tile";
import { UsageChart } from "@/components/admin/tools/usage-chart";
import { ReleaseControls } from "@/components/admin/tools/release-controls";
import { TestersPanel, PersonLabel } from "@/components/admin/tools/testers-panel";
import { InterestPanel } from "@/components/admin/tools/interest-panel";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import {
  TOOL_DETAIL_RANGES,
  getAdminToolDetail,
  toolDetailRangeOf,
  type ToolDetail,
} from "@/lib/tools/admin-queries";
import { toolBySlug, toolHref } from "@/lib/tools/catalog";
import { toolAnalyticsHref } from "@/lib/admin/analytics/tools-view";
import { releaseLabel } from "@/lib/tools/access";
import { formatRelativeTime, formatShortDate } from "@/lib/format/dates";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// /admin/tools/[slug] — one beta tool: who can open it (release, pause),
// its testers and waiting list, and its usage over 7 / 30 / 90 days.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: `${toolBySlug(slug)?.name ?? "Tool"} · Tools`,
    robots: { index: false, follow: false },
  };
}

const ACCESS_LABEL: Record<string, string> = {
  admin: "Admins",
  grant: "Testers",
  release: "Plan release",
  unknown: "Unknown",
};

export default async function AdminToolPage({ params, searchParams }: Props) {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) notFound();
  const { slug } = await params;
  const tool = toolBySlug(slug);
  if (!tool) notFound();
  const days = toolDetailRangeOf((await searchParams).days);

  const detail = isAdminConfigured() ? await getAdminToolDetail(createAdminClient(), slug, days) : null;
  const Icon = TOOL_ICONS[tool.icon];

  return (
    <DashboardShell>
      <Link
        href="/admin/tools"
        className="inline-flex items-center gap-1 rounded-sm text-sm text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        All tools
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <IconTile tone="gold" size="lg">
            <Icon aria-hidden />
          </IconTile>
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                {tool.name}
              </h1>
              {detail ? (
                <ToolStageBadge built={tool.built} stage={detail.stage} label={releaseLabel(detail.release)} />
              ) : null}
            </div>
            <p className="max-w-2xl text-sm leading-6 text-muted">{tool.description}</p>
            {detail?.release?.releasedAt ? (
              <p className="text-xs text-subtle">First released {formatShortDate(detail.release.releasedAt)}</p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={toolAnalyticsHref(tool.slug, days)}
            className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm text-foreground hover:border-border-strong hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
          >
            See who used it →
          </Link>
          {tool.built ? (
            <Link
              href={toolHref(tool.slug)}
              className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm text-foreground hover:border-border-strong hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
            >
              Open the tool
            </Link>
          ) : null}
        </div>
      </header>

      {detail === null ? (
        <AdminLoadError className="mt-6" what={`${tool.name}'s data`} />
      ) : (
        <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <div className="flex min-w-0 flex-col gap-6">
            <Panel title="Release" description="Who can open it right now.">
              <ReleaseControls
                slug={tool.slug}
                toolName={tool.name}
                built={tool.built}
                releaseTier={detail.release?.releaseTier ?? null}
                paused={detail.release?.paused ?? false}
              />
            </Panel>
            <Analytics detail={detail} />
          </div>
          <div className="flex min-w-0 flex-col gap-6">
            <Panel
              title="Testers"
              description="Let people in before release. Testers keep access when you release to a plan."
              count={detail.testers.filter((t) => t.live).length}
            >
              <TestersPanel slug={tool.slug} toolName={tool.name} testers={detail.testers} />
            </Panel>
            <Panel
              title="Waiting list"
              description="People who pressed Notify me on the Tools hub."
              count={detail.interested.length}
            >
              <InterestPanel slug={tool.slug} toolName={tool.name} interested={detail.interested} />
            </Panel>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}

function Panel({
  title,
  description,
  count,
  actions,
  children,
}: {
  title: string;
  description: string;
  count?: number;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <SurfaceCard as="section" aria-label={title} className="flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-foreground">
            {title}
            {count !== undefined ? (
              <span className="rounded-full bg-elevated px-2 py-0.5 font-sans text-xs font-medium tabular-nums text-muted">
                {count}
              </span>
            ) : null}
          </h2>
          <p className="text-sm text-muted">{description}</p>
        </div>
        {actions}
      </div>
      {children}
    </SurfaceCard>
  );
}

function RangeSwitch({ slug, days }: { slug: string; days: number }) {
  return (
    <nav aria-label="Period" className="flex rounded-lg border border-border p-0.5">
      {TOOL_DETAIL_RANGES.map((range) => (
        <Link
          key={range}
          href={`/admin/tools/${slug}?days=${range}`}
          aria-current={range === days ? "page" : undefined}
          scroll={false}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60",
            range === days ? "bg-elevated text-foreground" : "text-muted hover:text-foreground",
          )}
        >
          {range} days
        </Link>
      ))}
    </nav>
  );
}

function pct(part: number, whole: number): string {
  return whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`;
}

function Analytics({ detail }: { detail: ToolDetail }) {
  const { totals, days } = detail;
  const liveTesters = detail.testers.filter((t) => t.live).length;
  return (
    <Panel
      title="Usage"
      description={`Last ${days} days, UTC. An open is a page view; a use is anything the tool records beyond that.`}
      actions={<RangeSwitch slug={detail.tool.slug} days={days} />}
    >
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={Users} label="People" value={totals.users} hint={`${totals.opens.toLocaleString("en-US")} opens`} />
        <StatTile
          icon={UserCheck}
          label="Activated"
          value={pct(totals.usingUsers, totals.users)}
          hint={`${totals.usingUsers} used it, not just opened it`}
        />
        <StatTile icon={MousePointerClick} label="Uses" value={totals.uses} hint={`${(totals.users ? totals.uses / totals.users : 0).toFixed(1)} per person`} />
        <StatTile
          icon={Repeat}
          label="Came back"
          value={pct(totals.returningUsers, totals.users)}
          hint={`${totals.returningUsers} on 2+ days`}
        />
      </dl>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-foreground">Uses per day</h3>
        <UsageChart daily={detail.daily} caption={`${detail.tool.name}: uses per day over the last ${days} days`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-foreground">How people got in</h3>
          {detail.access.length === 0 ? (
            <p className="text-sm text-muted">No activity yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-subtle">
                <tr>
                  <th scope="col" className="pb-1.5 font-medium">Access</th>
                  <th scope="col" className="pb-1.5 text-right font-medium">People</th>
                  <th scope="col" className="pb-1.5 text-right font-medium">Uses</th>
                </tr>
              </thead>
              <tbody>
                {detail.access.map((row) => (
                  <tr key={row.access} className="border-t border-border/40">
                    <th scope="row" className="py-1.5 font-normal text-foreground">{ACCESS_LABEL[row.access] ?? row.access}</th>
                    <td className="py-1.5 text-right tabular-nums">{row.users}</td>
                    <td className="py-1.5 text-right tabular-nums">{row.uses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {liveTesters > 0 ? (
            <p className="text-xs text-subtle">
              {detail.access.find((a) => a.access === "grant")?.users ?? 0} of {liveTesters}{" "}
              {liveTesters === 1 ? "tester was" : "testers were"} active in this period.
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-foreground">Events</h3>
          {detail.events.length === 0 ? (
            <p className="text-sm text-muted">No events recorded yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-subtle">
                <tr>
                  <th scope="col" className="pb-1.5 font-medium">Event</th>
                  <th scope="col" className="pb-1.5 text-right font-medium">Count</th>
                  <th scope="col" className="pb-1.5 text-right font-medium">People</th>
                </tr>
              </thead>
              <tbody>
                {detail.events.map((row) => (
                  <tr key={row.event} className="border-t border-border/40">
                    <th scope="row" className="py-1.5 font-mono text-xs font-normal text-foreground">{row.event}</th>
                    <td className="py-1.5 text-right tabular-nums">{row.count}</td>
                    <td className="py-1.5 text-right tabular-nums">{row.users}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-foreground">Most active</h3>
        {detail.topUsers.length === 0 ? (
          <p className="text-sm text-muted">Nobody has used it in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-subtle">
                <tr>
                  <th scope="col" className="pb-1.5 font-medium">Person</th>
                  <th scope="col" className="pb-1.5 font-medium">Via</th>
                  <th scope="col" className="pb-1.5 text-right font-medium">Uses</th>
                  <th scope="col" className="pb-1.5 text-right font-medium">Opens</th>
                  <th scope="col" className="pb-1.5 text-right font-medium">Days</th>
                  <th scope="col" className="pb-1.5 text-right font-medium">Last</th>
                </tr>
              </thead>
              <tbody>
                {detail.topUsers.map((u) => (
                  <tr key={u.id} className="border-t border-border/40">
                    <td className="py-2 pr-3"><PersonLabel person={u} /></td>
                    <td className="py-2 pr-3 text-muted">{u.access ? (ACCESS_LABEL[u.access] ?? u.access) : "—"}</td>
                    <td className="py-2 text-right tabular-nums">{u.uses}</td>
                    <td className="py-2 text-right tabular-nums">{u.opens}</td>
                    <td className="py-2 text-right tabular-nums">{u.activeDays}</td>
                    <td className="whitespace-nowrap py-2 pl-3 text-right text-muted">{formatRelativeTime(u.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail.interested.length > 0 && detail.tool.built === false ? (
        <p className="flex items-center gap-2 text-xs text-subtle">
          <BellRing className="h-3.5 w-3.5" aria-hidden />
          {detail.interested.length} waiting — usage starts once the tool is built.
        </p>
      ) : null}
    </Panel>
  );
}
