import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CircleCheck,
  CirclePause,
  Frame,
  ListOrdered,
  Loader2,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/format/dates";
import { cn } from "@/lib/utils";
import {
  templatesNeedingReverification,
  type AdminOpsSummary,
  type FrameDemandSummary,
  type FrameVerificationSummary,
  type RebakeTileSummary,
} from "@/lib/admin/ops-summary";
import { SIGN_OFF_LOW_MATCH_PCT } from "@/lib/cards/frame-signoff";
import { FRAME_ERA_LABELS, FRAME_ERA_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// The admin dashboard tile (TODO 7.4) on /dashboard: frame verification, the
// automatic re-bake and frame-request demand at a glance, each linking to its
// admin page. Server component, no client JS: it prints counts only — no
// card id, title or poison error from render_sweep_state reaches the page.
// The data is lib/admin/ops-summary-queries.ts (admin-gated); the numbers are
// the admin pages' own (lib/admin/ops-summary.ts).
// ---------------------------------------------------------------------------

const fmt = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const pct = (part: number, whole: number) => (whole > 0 ? `${(part / whole) * 100}%` : "0%");

/** Re-verify chips shown before "+N more". */
const ATTENTION_CHIPS = 4;

function Section({
  icon: Icon,
  title,
  href,
  linkLabel,
  testId,
  children,
}: {
  icon: LucideIcon;
  title: string;
  href: string;
  linkLabel: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-border/50 bg-elevated/40 p-4"
      data-testid={testId}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
          <Icon className="h-4 w-4 shrink-0 text-gold" aria-hidden />
          {title}
        </h3>
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary-bright underline-offset-2 hover:underline"
        >
          {linkLabel}
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>
      {children}
    </section>
  );
}

function BigNumber({ value, label }: { value: string; label: string }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2">
      <span className="font-display text-3xl font-semibold leading-tight tabular-nums text-foreground">
        {value}
      </span>
      <span className="text-xs text-muted">{label}</span>
    </p>
  );
}

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-xs leading-5 text-foreground" role="status">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

function FramesSection({ frames }: { frames: FrameVerificationSummary }) {
  const current = frames.verified - frames.stale;
  const attention = templatesNeedingReverification(frames);
  return (
    <Section
      icon={Frame}
      title="Frame verification"
      href="/admin/frame-compare"
      linkLabel="Checklist"
      testId="admin-ops-frames"
    >
      <BigNumber value={`${fmt(frames.verified)}/${fmt(frames.combos)}`} label="combos verified" />
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-elevated"
        role="img"
        aria-label={`${fmt(current)} verified and current, ${fmt(frames.stale)} need re-verification, ${fmt(frames.unverified)} unverified`}
      >
        <span className="h-full bg-primary-bright" style={{ width: pct(current, frames.combos) }} />
        <span className="h-full bg-gold" style={{ width: pct(frames.stale, frames.combos) }} />
      </div>
      <ul className="flex flex-col gap-1 text-xs text-muted">
        <li className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-primary-bright" aria-hidden />
          <span data-testid="admin-ops-frames-current">{fmt(current)} verified and current</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-gold" aria-hidden />
          <span data-testid="admin-ops-frames-stale">{fmt(frames.stale)} need re-verification</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full border border-border bg-elevated" aria-hidden />
          <span data-testid="admin-ops-frames-unverified">{fmt(frames.unverified)} unverified</span>
        </li>
      </ul>
      <p className="text-xs text-subtle">
        {`${fmt(frames.completeTemplates)} of ${plural(frames.templates.length, "template")} fully verified.`}
        {frames.lowMatch > 0 ? (
          <span className="text-gold" data-testid="admin-ops-frames-low-match">
            {` ${plural(frames.lowMatch, "current tick")} scored under a ${SIGN_OFF_LOW_MATCH_PCT}% frame match.`}
          </span>
        ) : null}
      </p>
      {attention.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="admin-ops-reverify">
          <span className="text-[11px] uppercase tracking-wider text-subtle">Re-verify</span>
          {attention.slice(0, ATTENTION_CHIPS).map((row) => (
            <Link
              key={row.template}
              href={`/admin/frame-compare?template=${row.template}`}
              className="rounded-md border border-gold/40 bg-gold/5 px-2 py-0.5 text-[11px] font-medium text-foreground transition-colors hover:border-gold"
              title={`${row.stale} of ${row.combos} colours ${row.stale === 1 ? "needs" : "need"} re-verification`}
            >
              {row.fullLabel} · {row.stale}
            </Link>
          ))}
          {attention.length > ATTENTION_CHIPS ? (
            <span className="text-[11px] text-subtle">+{attention.length - ATTENTION_CHIPS} more</span>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}

const STATUS: Record<
  RebakeTileSummary["status"],
  { label: string; variant: "default" | "primary" | "gold"; Icon: LucideIcon }
> = {
  idle: { label: "Idle", variant: "default", Icon: CircleCheck },
  running: { label: "Running", variant: "primary", Icon: Loader2 },
  paused: { label: "Paused", variant: "gold", Icon: CirclePause },
};

function RebakeSection({ rebake, nowMs }: { rebake: RebakeTileSummary; nowMs: number }) {
  const status = STATUS[rebake.status];
  const run = rebake.lastRun;
  return (
    <Section
      icon={RefreshCw}
      title="Automatic re-bake"
      href="/admin/renders"
      linkLabel="Status"
      testId="admin-ops-rebake"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={status.variant} className="gap-1.5" data-testid="admin-ops-rebake-status">
          <status.Icon className={cn("h-3.5 w-3.5", rebake.status === "running" && "animate-spin")} aria-hidden />
          {status.label}
          {rebake.status === "running" && rebake.runner === "manual" ? " · manual" : null}
        </Badge>
        <span className="text-xs text-subtle">
          layout v{rebake.layoutVersion}
          {rebake.sweepVersion !== rebake.layoutVersion ? ` · sweep v${rebake.sweepVersion}` : null}
        </span>
      </div>
      {rebake.error ? <Problem>{rebake.error}</Problem> : null}
      <BigNumber
        value={rebake.owed == null ? "—" : fmt(rebake.owed)}
        label={rebake.owed === 1 ? "card owed a re-bake" : "cards owed a re-bake"}
      />
      {rebake.status === "paused" ? (
        <p className="text-xs leading-5 text-foreground" data-testid="admin-ops-rebake-paused">
          <strong className="mr-1">
            Paused{rebake.pausedAt ? ` ${formatRelativeTime(rebake.pausedAt, nowMs)}` : ""}:
          </strong>
          {rebake.pausedReason ?? "no reason recorded"}
        </p>
      ) : null}
      <p className="text-xs text-muted" data-testid="admin-ops-rebake-poison">
        {rebake.poisoned > 0 ? (
          <Badge variant="danger">{plural(rebake.poisoned, "card keeps", "cards keep")} failing</Badge>
        ) : (
          "No card keeps failing."
        )}
      </p>
      <p className="text-xs text-muted">
        {run
          ? `Last run ${formatRelativeTime(run.finishedAt, nowMs)}: ${fmt(run.rebaked)} re-baked · ${fmt(run.failed)} failed.`
          : "No automatic run yet."}
      </p>
      {!rebake.billingEnabled ? (
        <Problem>Billing is off on this deployment, so the automatic re-bake refuses to run here.</Problem>
      ) : null}
    </Section>
  );
}

function RequestsSection({ requests }: { requests: FrameDemandSummary }) {
  const windowLabel = requests.window === "all" ? "all time" : `the last ${requests.window} days`;
  return (
    <Section
      icon={ListOrdered}
      title="Frame requests"
      href="/admin/frame-requests"
      linkLabel="All requests"
      testId="admin-ops-requests"
    >
      {requests.error ? <Problem>{requests.error}</Problem> : null}
      <BigNumber value={fmt(requests.requests)} label={`${requests.requests === 1 ? "import" : "imports"} in ${windowLabel}`} />
      <p className="text-xs text-muted">
        {`${plural(requests.missing, "frame")} to build · ${plural(requests.unverified, "frame")} to verify`}
      </p>
      {requests.top.length === 0 ? (
        <p className="text-xs text-subtle">No open requests.</p>
      ) : (
        <ol className="flex flex-col gap-1.5" data-testid="admin-ops-requests-top">
          {requests.top.map((row) => (
            <li key={`${row.signature}/${row.setCode ?? ""}/${row.cause}`} className="flex min-w-0 items-start justify-between gap-2 text-xs">
              <span className="min-w-0 break-words text-foreground">
                {row.label}
                {row.setCode ? <span className="text-subtle"> ({row.setCode.toUpperCase()})</span> : null}
              </span>
              <span className="flex shrink-0 items-center gap-1.5 tabular-nums text-muted">
                {`${plural(row.users, "user")} · ${fmt(row.count)}`}
                <Badge variant={row.cause === "missing" ? "outline" : "gold"} className="px-1.5 py-0 text-[10px]">
                  {row.cause === "missing" ? "build" : "verify"}
                </Badge>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function TemplateTable({ frames }: { frames: FrameVerificationSummary }) {
  return (
    <details className="group rounded-lg border border-border/50" data-testid="admin-ops-templates">
      <summary className="cursor-pointer px-4 py-2.5 text-xs font-medium text-muted hover:text-foreground">
        Every template ({frames.templates.length})
      </summary>
      <div className="overflow-x-auto border-t border-border/50">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-subtle">
              <th className="px-4 py-2 font-medium">Frame</th>
              <th className="px-3 py-2 text-right font-medium">Verified</th>
              <th className="px-3 py-2 text-right font-medium">Re-verify</th>
              <th className="px-3 py-2 text-right font-medium">Unverified</th>
              <th
                className="px-4 py-2 text-right font-medium"
                title="The worst frame match recorded with a current tick (100 − the recorded edge difference). Ticks that need re-verification are left out: their scores were measured before the renderer or the layout override changed."
              >
                Worst match
              </th>
            </tr>
          </thead>
          {FRAME_ERA_VALUES.map((era) => {
            const rows = frames.templates.filter((row) => row.era === era);
            if (rows.length === 0) return null;
            return (
              <tbody key={era}>
                <tr>
                  <th colSpan={5} className="bg-elevated/40 px-4 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-subtle">
                    {FRAME_ERA_LABELS[era]}
                  </th>
                </tr>
                {rows.map((row) => (
                  <tr key={row.template} className="border-t border-border/30" data-template={row.template}>
                    <td className="px-4 py-1.5">
                      <Link
                        href={`/admin/frame-compare?template=${row.template}`}
                        className="text-foreground underline-offset-2 hover:underline"
                      >
                        {row.label}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-foreground">
                      {row.verified}/{row.combos}
                    </td>
                    <td className={cn("px-3 py-1.5 text-right tabular-nums", row.stale > 0 ? "font-semibold text-gold" : "text-subtle")}>
                      {row.stale}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted">{row.unverified}</td>
                    <td className={cn("px-4 py-1.5 text-right tabular-nums", row.lowMatch > 0 ? "font-semibold text-gold" : "text-muted")}>
                      {row.worstMatchPct == null ? "—" : `${row.worstMatchPct}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
    </details>
  );
}

export function AdminOpsTile({ summary }: { summary: AdminOpsSummary }) {
  return (
    <SurfaceCard className="mt-6 flex flex-col gap-4 p-5 sm:p-6" data-testid="admin-ops-tile">
      <div className="flex flex-col gap-0.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Admin</p>
        <h2 className="font-display text-lg font-semibold text-foreground">Frames and re-bakes</h2>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <FramesSection frames={summary.frames} />
        <RebakeSection rebake={summary.rebake} nowMs={summary.readAt} />
        <RequestsSection requests={summary.requests} />
      </div>
      <TemplateTable frames={summary.frames} />
    </SurfaceCard>
  );
}
