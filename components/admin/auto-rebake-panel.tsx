import Link from "next/link";
import { AlertTriangle, CircleCheck, CirclePause, Loader2, TimerReset } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Badge } from "@/components/ui/badge";
import { AutoRebakeToggle, RetryPoisonedButton } from "@/components/admin/auto-rebake-controls";
import { formatRelativeTime, formatShortDate } from "@/lib/format/dates";
import type { AutoRebakeOverview } from "@/lib/cards/auto-rebake-queries";
import type { AutoRebakeStop } from "@/lib/cards/auto-rebake-state";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// /admin/renders — the automatic re-bake at a glance (server component; the
// buttons are auto-rebake-controls.tsx). Times are rendered on the server
// against the request's clock, so nothing re-renders differently on the
// client.
// ---------------------------------------------------------------------------

const STOP_LABELS: Record<AutoRebakeStop, string> = {
  done: "Finished — nothing left to re-bake",
  budget: "Used its time budget — the next run continues",
  yield: "Handed over to a manual re-bake",
  paused: "Paused by an admin mid-run",
  "lease-lost": "Lost the sweep lease mid-run",
  breaker: "Breaker tripped — paused",
  hung: "A batch hung — paused",
  error: "Stopped on an error",
  refused: "Refused — the billing flag is off (bakes would be clean)",
};

function when(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return "never";
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return iso;
  const clock = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(time);
  return `${formatRelativeTime(iso, nowMs)} (${formatShortDate(iso)}, ${clock} UTC)`;
}

/** End a stored reason with a full stop (the breaker's reasons have none). */
function sentence(text: string): string {
  return /[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
}

/** A future instant (the lease expiry): "in 4 min (4:44 PM UTC)". */
function until(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return "—";
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return iso;
  const clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(time);
  const minutes = Math.max(1, Math.ceil((time.getTime() - nowMs) / 60_000));
  return `in ${minutes} min (${clock} UTC)`;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border/50 bg-elevated/40 px-4 py-3">
      <span className="text-[11px] uppercase tracking-wider text-subtle">{label}</span>
      <span className="font-display text-2xl font-semibold tabular-nums text-foreground">{value}</span>
      {hint ? <span className="text-xs leading-5 text-muted">{hint}</span> : null}
    </div>
  );
}

export function AutoRebakePanel({ overview, nowMs }: { overview: AutoRebakeOverview; nowMs: number }) {
  const { state, pending, layoutVersion, sweepVersion, billingEnabled, poisonCards, error } = overview;
  const run = state.lastRun;
  const leaseLive =
    state.lease.holder != null &&
    state.lease.expiresAt != null &&
    Date.parse(state.lease.expiresAt) > nowMs;
  const status = state.paused
    ? { label: "Paused", variant: "gold" as const, Icon: CirclePause }
    : leaseLive && state.lease.holder === "cron" && state.lease.running
      ? { label: "Running now", variant: "primary" as const, Icon: Loader2 }
      : leaseLive
        ? { label: "Manual re-bake active", variant: "accent" as const, Icon: TimerReset }
        : { label: "On — every 10 minutes", variant: "default" as const, Icon: CircleCheck };

  return (
    <div className="flex flex-col gap-6" data-testid="auto-rebake-panel">
      {error ? (
        <SurfaceCard className="flex items-start gap-3 border-danger/40 p-5 text-sm text-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
          <p className="min-w-0">{error}</p>
        </SurfaceCard>
      ) : null}

      <SurfaceCard className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h2 className="font-display text-xl font-semibold text-foreground">Status</h2>
            <Badge variant={status.variant} className="gap-1.5" data-testid="auto-rebake-status">
              <status.Icon className={cn("h-3.5 w-3.5", status.label === "Running now" && "animate-spin")} aria-hidden />
              {status.label}
            </Badge>
          </div>
          <AutoRebakeToggle paused={state.paused} />
        </div>

        {state.paused ? (
          <div className="rounded-md border border-gold/50 bg-gold/5 px-4 py-3 text-sm leading-6 text-foreground" role="status">
            <strong className="mr-1">Paused {when(state.pausedAt, nowMs)}.</strong>
            {`${sentence(state.pausedReason ?? "No reason recorded.")} Cron runs skip until you resume; the manual script and the compare page’s “Re-bake now” still work.`}
          </div>
        ) : null}

        {!billingEnabled ? (
          <div className="rounded-md border border-danger/40 bg-danger/5 px-4 py-3 text-sm leading-6 text-foreground" role="status">
            <strong className="mr-1">NEXT_PUBLIC_BILLING_ENABLED is off on this deployment.</strong>
            The automatic re-bake refuses to run here: every render would lose the pipglyph.com mark.
          </div>
        ) : null}

        {leaseLive ? (
          <p className="text-sm leading-6 text-muted">
            {state.lease.holder === "cron"
              ? state.lease.running
                ? "An automatic run is baking right now."
                : "The automatic run holds the lease."
              : state.lease.running
                ? "A manual re-bake (the script or the compare page) is baking right now — automatic runs wait."
                : "A manual re-bake is between two calls — automatic runs wait until it finishes."}{" "}
            The lease lapses {until(state.lease.expiresAt, nowMs)} at the latest.
            {state.yieldRequestedAt ? " A manual run asked the automatic one to hand over." : ""}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Pending (estimate)"
            value={pending == null ? "—" : pending.toLocaleString("en-US")}
            hint="Published cards stamped below the newest sweep version, unstamped or never baked. Opt-in-only cards count here but are left alone."
          />
          <Stat
            label="Layout"
            value={`v${layoutVersion}`}
            hint={sweepVersion === layoutVersion ? "Newest bump is a sweep." : `Newest sweep bump: v${sweepVersion}.`}
          />
          <Stat
            label="Last run"
            value={run ? formatRelativeTime(run.finishedAt, nowMs) : "never"}
            hint={run ? `${run.rebaked} re-baked · ${run.failed} failed` : "No automatic run yet."}
          />
          <Stat
            label="Last check"
            value={state.lastCheckedAt ? formatRelativeTime(state.lastCheckedAt, nowMs) : "never"}
            hint="Idle checks cost two queries."
          />
        </div>

        {run ? (
          <div className="flex flex-col gap-3" data-testid="auto-rebake-last-run">
            <h3 className="text-sm font-semibold text-foreground">Last run — {when(run.finishedAt, nowMs)}</h3>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
              {[
                ["Re-baked", run.rebaked],
                ["Stamped", run.stamped],
                ["Failed", run.failed],
                ["Remaining", run.remaining ?? "?"],
                ["Superseded", run.superseded],
                ["Batches", run.batches],
                ["Took", `${Math.round(run.durationMs / 1000)} s`],
                ["Layout", `v${run.layoutVersion}`],
              ].map(([label, value]) => (
                <div key={label as string} className="flex min-w-0 flex-col">
                  <dt className="text-xs text-subtle">{label}</dt>
                  <dd className="tabular-nums text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sm text-muted">{STOP_LABELS[run.stop] ?? run.stop}.</p>
            {run.error ? <p className="break-words text-sm text-foreground">{run.error}</p> : null}
            {run.failures && run.failures.length > 0 ? (
              <ul className="flex flex-col gap-1 text-xs leading-5 text-muted">
                {run.failures.map((f) => (
                  <li key={f.id} className="break-words">
                    <code className="text-foreground">{f.id}</code> — {f.error}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted">No automatic run has re-baked anything yet.</p>
        )}
      </SurfaceCard>

      <SurfaceCard className="flex flex-col gap-4 p-5 sm:p-6" data-testid="auto-rebake-poison">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="font-display text-xl font-semibold text-foreground">Cards that keep failing</h2>
            <p className="text-sm leading-6 text-muted">
              A card that fails three runs in a row is skipped from then on — it keeps its old image
              and downloads render it live. Fix the cause (usually art that can&apos;t be fetched),
              then retry.
            </p>
          </div>
          <RetryPoisonedButton count={poisonCards.length} />
        </div>
        {poisonCards.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted">
            None — no card has failed three runs in a row.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/50 rounded-md border border-border/60">
            {poisonCards.map((card) => (
              <li key={card.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {card.href ? (
                    <Link href={card.href} className="font-medium text-foreground underline-offset-4 hover:underline">
                      {card.title ?? "Untitled card"}
                    </Link>
                  ) : (
                    <span className="font-medium text-foreground">{card.title ?? "Card no longer exists"}</span>
                  )}
                  {card.visibility ? <Badge variant="outline">{card.visibility}</Badge> : null}
                  <span className="text-xs text-subtle">
                    {card.failures} failed runs · last {formatRelativeTime(card.at, nowMs)}
                  </span>
                </div>
                <code className="break-all text-xs text-subtle">{card.id}</code>
                <p className="break-words text-xs leading-5 text-muted">{card.error}</p>
              </li>
            ))}
          </ul>
        )}
      </SurfaceCard>

      <SurfaceCard className="flex flex-col gap-2 p-5 text-sm leading-6 text-muted sm:p-6">
        <h2 className="font-display text-base font-semibold text-foreground">How it works</h2>
        <p>
          Every 10 minutes production checks whether any published card is still on an older render
          (a &ldquo;sweep&rdquo; layout bump, or a frame-layout change that marked it). If so it
          re-bakes them in batches for about four minutes, then continues in the next run. Opt-in
          looks are never touched — owners keep their &ldquo;newer look&rdquo; badge.
        </p>
        <p>
          One sweeper at a time: <code>scripts/rebake-renders.mjs</code>{" "}and the compare page&apos;s
          &ldquo;Re-bake now&rdquo; share the same lock — an automatic run hands over after its
          current batch and waits while a manual run is active.
        </p>
        <p>
          The breaker pauses it and alerts every admin when a whole batch fails, ten cards fail for
          the first time in one run, a batch hangs, or more than 50 cards keep failing.
        </p>
      </SurfaceCard>
    </div>
  );
}
