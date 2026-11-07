import Link from "next/link";
import { ChevronLeft, MessageSquarePlus } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { IconTile } from "@/components/ui/icon-tile";
import { TOOL_ICONS } from "@/components/tools/tool-icon";
import { formatShortDate } from "@/lib/format/dates";
import type { ViewerTool } from "@/lib/tools/queries";

/**
 * The frame every beta tool's page draws in: back to Tools, the tool's
 * name and icon, its stage (Beta while testing, with the tester's end date)
 * and the feedback door — testers' words are what the beta is for.
 * A page: `const entry = await openTool("<slug>")` then
 * `<ToolShell entry={entry}>…</ToolShell>`.
 */
export function ToolShell({
  entry,
  children,
  actions,
}: {
  entry: ViewerTool;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const { tool, stage, via, grant } = entry;
  const Icon = TOOL_ICONS[tool.icon];
  return (
    <DashboardShell>
      <Link
        href="/dashboard/tools"
        className="inline-flex items-center gap-1 rounded-sm text-sm text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        Tools
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
              {stage === "beta" ? <Badge variant="gold">Beta</Badge> : null}
              {stage === "paused" ? <Badge variant="danger">Paused — admins only</Badge> : null}
            </div>
            <p className="max-w-2xl text-sm leading-6 text-muted">{tool.tagline}</p>
            {via === "grant" && grant?.expiresAt ? (
              <p className="text-xs text-subtle">Your beta access runs until {formatShortDate(grant.expiresAt)}.</p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          <Link
            href="/feedback"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-foreground hover:border-border-strong hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
          >
            <MessageSquarePlus className="h-4 w-4" aria-hidden />
            Send feedback
          </Link>
        </div>
      </header>
      <div className="mt-8">{children}</div>
    </DashboardShell>
  );
}
