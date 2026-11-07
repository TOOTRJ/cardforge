import Link from "next/link";
import { ArrowRight, FlaskConical, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/icon-tile";
import { SurfaceCard } from "@/components/ui/surface-card";
import { TOOL_ICONS } from "@/components/tools/tool-icon";
import { ToolInterestButton } from "@/components/tools/tool-interest-button";
import { adminToolHref, toolHref } from "@/lib/tools/catalog";
import { releaseLabel } from "@/lib/tools/access";
import type { ViewerTool } from "@/lib/tools/queries";
import { formatShortDate } from "@/lib/format/dates";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// One beta tool on the Tools hub. Three looks from ONE component:
//   * OPEN — the viewer may use it: "Open" (+ the Beta badge while testing);
//   * IN BETA — built, but not open to the viewer: "Notify me";
//   * COMING SOON — not built yet: what it will do + "Notify me".
// Admins also get a link to the tool's admin page.
// ---------------------------------------------------------------------------

export function ToolCard({ entry, isAdmin }: { entry: ViewerTool; isAdmin: boolean }) {
  const { tool, allowed, stage, grant, interested, via } = entry;
  const Icon = TOOL_ICONS[tool.icon];
  const comingSoon = !tool.built;
  const headingId = `tool-${tool.slug}`;

  return (
    <SurfaceCard
      as="article"
      aria-labelledby={headingId}
      tone={allowed ? "gold" : "default"}
      className={cn(
        "group relative flex h-full w-full min-w-0 flex-col overflow-hidden p-6",
        !allowed && "bg-surface/50",
      )}
    >
      {/* A soft glow behind the icon: purple while the tool is closed to
          the viewer, gold once it is theirs. Decoration only. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full blur-3xl transition-opacity",
          allowed ? "bg-gold/15 opacity-80" : "bg-primary/20 opacity-60 group-hover:opacity-90",
        )}
      />

      <div className="relative flex items-start justify-between gap-3">
        <IconTile tone={allowed ? "gold" : "purple"} size="lg">
          <Icon aria-hidden />
        </IconTile>
        <StatusBadge
          comingSoon={comingSoon}
          allowed={allowed}
          stage={stage}
          isNew={entry.isNew}
        />
      </div>

      <div className="relative mt-5 flex flex-col gap-2">
        <h3 id={headingId} className="font-display text-xl font-semibold tracking-tight text-foreground">
          {tool.name}
        </h3>
        <p className="text-sm leading-6 text-muted">{tool.tagline}</p>
      </div>

      <ul className="relative mt-4 flex flex-col gap-2 text-sm text-foreground/90">
        {tool.highlights.map((line) => (
          <li key={line} className="flex gap-2.5">
            <span
              aria-hidden
              className={cn(
                "mt-[0.55rem] h-1.5 w-1.5 shrink-0 rotate-45",
                allowed ? "bg-gold" : "bg-primary-bright/70",
              )}
            />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <div className="relative mt-auto flex flex-wrap items-center gap-x-4 gap-y-3 pt-6">
        {allowed ? (
          <Button asChild size="sm">
            <Link href={toolHref(tool.slug)}>
              Open {tool.name}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        ) : stage === "released" && entry.release?.releaseTier ? (
          // Released to a plan above the viewer's.
          <Button asChild size="sm" variant="secondary">
            <Link href="/pricing">
              Included with {releaseLabel(entry.release)}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        ) : grant && comingSoon ? null : (
          <ToolInterestButton slug={tool.slug} toolName={tool.name} interested={interested} />
        )}
        {allowed && via === "grant" && grant?.expiresAt ? (
          <span className="text-xs text-subtle">Beta access until {formatShortDate(grant.expiresAt)}</span>
        ) : null}
        {!allowed && grant && comingSoon ? (
          <span className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-3 py-1.5 text-xs font-medium text-gold-strong">
            <FlaskConical className="h-3.5 w-3.5" aria-hidden />
            You&rsquo;re a tester — it opens here first
          </span>
        ) : null}
        {isAdmin ? (
          <Link
            href={adminToolHref(tool.slug)}
            className="ml-auto inline-flex items-center gap-1 rounded-sm text-xs text-muted underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
          >
            <Settings2 className="h-3.5 w-3.5" aria-hidden />
            Manage<span className="sr-only"> {tool.name}</span>
          </Link>
        ) : null}
      </div>
    </SurfaceCard>
  );
}

function StatusBadge({
  comingSoon,
  allowed,
  stage,
  isNew,
}: {
  comingSoon: boolean;
  allowed: boolean;
  stage: ViewerTool["stage"];
  isNew: boolean;
}) {
  if (comingSoon) return <Badge variant="outline">Coming soon</Badge>;
  if (stage === "paused") return <Badge variant="danger">Paused</Badge>;
  if (stage === "beta") return <Badge variant={allowed ? "gold" : "primary"}>Beta</Badge>;
  if (!allowed) return <Badge variant="primary">Paid plans</Badge>;
  return isNew ? <Badge variant="gold">New</Badge> : null;
}
