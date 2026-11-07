import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, BellRing, FlaskRound, MousePointerClick, Users } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { IconTile } from "@/components/ui/icon-tile";
import { AdminLoadError } from "@/components/admin/admin-load-error";
import { TOOL_ICONS } from "@/components/tools/tool-icon";
import { ToolStageBadge } from "@/components/admin/tools/tool-stage-badge";
import { StatTile } from "@/components/admin/tools/stat-tile";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getAdminToolsOverview, type AdminToolRow } from "@/lib/tools/admin-queries";
import { adminToolHref } from "@/lib/tools/catalog";
import { releaseLabel } from "@/lib/tools/access";
import { formatRelativeTime } from "@/lib/format/dates";

// ---------------------------------------------------------------------------
// /admin/tools — every beta tool (lib/tools/catalog.ts): its stage, its
// testers and waiting list, and how much it is used. One tool's controls
// and analytics are /admin/tools/[slug].
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "Tools",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminToolsPage() {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) notFound();

  const rows = isAdminConfigured() ? await getAdminToolsOverview(createAdminClient()) : null;

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Admin"
        title="Tools"
        description="New tools start in beta: admins and the testers you let in. Release one to Free, Plus or Pro when it's ready, or pause it to close it to everyone but admins."
      />

      {rows === null ? (
        <AdminLoadError className="mt-6" what="the tools overview" />
      ) : (
        <>
          <Totals rows={rows} />
          <ul className="mt-6 flex flex-col gap-3">
            {rows.map((row) => (
              <li key={row.tool.slug}>
                <ToolRow row={row} />
              </li>
            ))}
          </ul>
        </>
      )}

      <details className="group mt-10 rounded-card border border-border/70 bg-surface/50 p-5 open:bg-surface/80">
        <summary className="cursor-pointer list-none text-sm font-medium text-foreground marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60">
          <span className="inline-flex items-center gap-2">
            <FlaskRound className="h-4 w-4 text-gold-strong" aria-hidden />
            Adding a new tool
            <span className="text-xs font-normal text-subtle group-open:hidden">— show the steps</span>
          </span>
        </summary>
        <ol className="mt-4 flex list-decimal flex-col gap-2 pl-5 text-sm leading-6 text-muted">
          <li>
            Declare it in <code className="font-mono text-xs text-foreground">lib/tools/catalog.ts</code> with{" "}
            <code className="font-mono text-xs">built: false</code>. It shows as Coming soon, and you can enrol
            testers here already.
          </li>
          <li>
            Build its page at <code className="font-mono text-xs">app/(app)/dashboard/tools/&lt;slug&gt;</code>:
            the first line is <code className="font-mono text-xs">await openTool(&quot;&lt;slug&gt;&quot;)</code>,
            and the page draws inside <code className="font-mono text-xs">ToolShell</code>.
          </li>
          <li>
            Its tables gate RLS with <code className="font-mono text-xs">public.has_tool_access(&apos;&lt;slug&gt;&apos;)</code>;
            its actions call <code className="font-mono text-xs">checkToolAccess</code> and record uses with{" "}
            <code className="font-mono text-xs">recordToolEvent</code>.
          </li>
          <li>
            Flip <code className="font-mono text-xs">built: true</code>. Admins and testers can open it; release it from
            here when it&apos;s ready.
          </li>
        </ol>
      </details>
    </DashboardShell>
  );
}

function Totals({ rows }: { rows: AdminToolRow[] }) {
  const sum = (pick: (row: AdminToolRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
  return (
    <dl className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile icon={Users} label="Testers" value={sum((r) => r.testers)} hint="Live grants, all tools" />
      <StatTile icon={BellRing} label="Waiting list" value={sum((r) => r.interested)} hint="Pressed Notify me" />
      <StatTile
        icon={Users}
        label="Active users, 7 days"
        value={sum((r) => r.users7d)}
        hint="Summed per tool"
      />
      <StatTile icon={MousePointerClick} label="Uses, 30 days" value={sum((r) => r.uses30d)} hint="Actions, not page opens" />
    </dl>
  );
}

function ToolRow({ row }: { row: AdminToolRow }) {
  const Icon = TOOL_ICONS[row.tool.icon];
  return (
    <SurfaceCard className="relative flex flex-col gap-4 p-5 transition-colors hover:border-border-strong lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <IconTile tone={row.stage === "released" ? "gold" : "purple"}>
          <Icon aria-hidden />
        </IconTile>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-base font-semibold text-foreground">
              <Link
                href={adminToolHref(row.tool.slug)}
                className="rounded-sm after:absolute after:inset-0 after:rounded-card focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-primary-bright/60"
              >
                {row.tool.name}
              </Link>
            </h2>
            <ToolStageBadge built={row.tool.built} stage={row.stage} label={releaseLabel(row.release)} />
          </div>
          <p className="truncate text-sm text-muted">{row.tool.tagline}</p>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-x-6 gap-y-2 text-sm sm:grid-cols-6 lg:shrink-0">
        <Metric label="Testers" value={row.testers} />
        <Metric label="Waiting" value={row.interested} />
        <Metric label="Users 7d" value={row.users7d} />
        <Metric label="Users 30d" value={row.users30d} />
        <Metric label="Uses 30d" value={row.uses30d} />
        <div className="flex flex-col">
          <dt className="text-[11px] uppercase tracking-wider text-subtle">Last use</dt>
          <dd className="whitespace-nowrap text-foreground">
            {row.lastEventAt ? formatRelativeTime(row.lastEventAt) : "—"}
          </dd>
        </div>
      </dl>
      <ArrowRight className="hidden h-4 w-4 shrink-0 text-subtle lg:block" aria-hidden />
    </SurfaceCard>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] uppercase tracking-wider text-subtle">{label}</dt>
      <dd className="font-mono tabular-nums text-foreground">{value.toLocaleString("en-US")}</dd>
    </div>
  );
}
