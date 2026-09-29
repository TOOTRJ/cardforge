"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleSlash, Loader2, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import {
  cancelScoreBatch,
  dismissScoreBatch,
  getScoreBatchState,
  scoreBatchCounts,
  startScoreBatch,
  useScoreBatch,
  type ComboProgress,
  type ScoreBatchState,
} from "@/components/admin/score-batch-store";
import type { ScoreBatchCombo } from "@/lib/frames/score-batch";
import { frameMatchPct, isLowFrameScore } from "@/lib/cards/frame-signoff";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Progress of the tab's scoring job (TODO 4.12): a bar, the combo being
// scored, the elapsed time, and one chip per combo grouped by template — its
// match when done, why when failed or skipped. Shown on every sign-off view
// while a job runs or until its summary is dismissed; Cancel stops the job
// (what was scored stays recorded).
// ---------------------------------------------------------------------------

/** Start a job from a button: toasts the outcome and refreshes the page so
 *  the recorded scores (and the sign-off's "ready") show. No-op while a job
 *  runs. */
export function useStartScoreJob() {
  const router = useRouter();
  return useCallback(
    async (input: { scopeKey: string; label: string; combos: ScoreBatchCombo[] }): Promise<ScoreBatchState | null> => {
      if (getScoreBatchState().status === "running" || input.combos.length === 0) return null;
      const final = await startScoreBatch(input);
      const counts = scoreBatchCounts(final);
      const tail = `${counts.failed > 0 ? `, ${counts.failed} failed` : ""}${
        counts.skipped > 0 ? `, ${counts.skipped} skipped (no printing)` : ""
      }`;
      if (final.status === "done") {
        (counts.failed > 0 ? toast.error : toast.success)(`${input.label}: ${counts.done} scored${tail}.`);
      } else if (final.status === "cancelled") {
        toast.info(`${input.label}: cancelled after ${counts.done} scored${tail}.`);
      } else if (final.status === "error") {
        toast.error(`${input.label}: ${final.error ?? "the scoring job failed."}`);
      }
      router.refresh();
      return final;
    },
    [router],
  );
}

function elapsed(from: number | null, to: number | null): string {
  if (from === null) return "0:00";
  const seconds = Math.max(0, Math.round(((to ?? Date.now()) - from) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function ComboChip({
  comboKey,
  progress,
}: {
  /** "template/colour". */
  comboKey: string;
  progress: ComboProgress | undefined;
}) {
  const colorKey = comboKey.split("/")[1] ?? comboKey;
  const status = progress?.status ?? "queued";
  const title =
    status === "failed"
      ? progress?.error
      : status === "skipped"
        ? progress?.reason
        : status === "done" && progress?.overall !== undefined
          ? `frame ${progress.overall}% · ${frameMatchPct(progress.overall)}% match`
          : status;
  return (
    <li
      title={title}
      data-testid={`score-job-chip-${comboKey}`}
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] tabular-nums",
        status === "done" &&
          (isLowFrameScore(progress?.overall ?? null)
            ? "border-gold/50 text-gold-strong"
            : "border-primary/40 text-foreground"),
        status === "failed" && "border-danger/50 text-danger",
        status === "skipped" && "border-border/40 text-subtle",
        status === "scoring" && "border-sky-400/50 text-sky-200",
        status === "queued" && "border-border/40 text-muted",
      )}
    >
      {status === "scoring" ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      ) : status === "done" ? (
        <CheckCircle2 className="h-3 w-3" aria-hidden />
      ) : status === "failed" ? (
        <XCircle className="h-3 w-3" aria-hidden />
      ) : status === "skipped" ? (
        <CircleSlash className="h-3 w-3" aria-hidden />
      ) : null}
      <span className="font-semibold uppercase">{colorKey}</span>
      {status === "done" && progress?.overall !== undefined ? (
        <span>{frameMatchPct(progress.overall)}%</span>
      ) : null}
    </li>
  );
}

export function ScoreBatchPanel() {
  const job = useScoreBatch();
  const [, tick] = useState(0);
  // Tick the elapsed clock once a second while the job runs.
  useEffect(() => {
    if (job.status !== "running") return;
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [job.status]);

  if (job.status === "idle") return null;
  const counts = scoreBatchCounts(job);
  const pct = counts.total === 0 ? 0 : Math.round((counts.finished / counts.total) * 100);
  const scoringNow = job.order.filter((key) => job.progress[key]?.status === "scoring");

  // Group the chips by template, keeping the job's order.
  const groups: Array<{ template: string; keys: string[] }> = [];
  for (const key of job.order) {
    const template = key.split("/")[0];
    const last = groups[groups.length - 1];
    if (last?.template === template) last.keys.push(key);
    else groups.push({ template, keys: [key] });
  }

  const headline =
    job.status === "running"
      ? `Scoring ${counts.finished}/${counts.total}`
      : job.status === "done"
        ? `Scored ${counts.done} of ${counts.total}`
        : job.status === "cancelled"
          ? `Cancelled — ${counts.done} of ${counts.total} scored`
          : "The scoring job stopped";

  return (
    <SurfaceCard className="flex flex-col gap-3 p-4" data-testid="score-job-panel" data-status={job.status}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex min-w-[12rem] flex-1 flex-col leading-tight">
          <span className="text-sm font-semibold text-foreground">
            {headline}
            {job.label ? <span className="font-normal text-muted"> · {job.label}</span> : null}
          </span>
          <span className="text-[11px] text-subtle tabular-nums">
            {elapsed(job.startedAt, job.finishedAt)} elapsed
            {counts.failed > 0 ? ` · ${counts.failed} failed` : ""}
            {counts.skipped > 0 ? ` · ${counts.skipped} skipped (no printing)` : ""}
            {job.rounds > 1 ? ` · ${job.rounds} requests` : ""}
            {scoringNow.length > 0 ? ` · now ${scoringNow.join(", ")}` : ""}
          </span>
        </span>
        {job.status === "running" ? (
          <Button type="button" size="sm" variant="outline" onClick={cancelScoreBatch}>
            Cancel
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={dismissScoreBatch}
            aria-label="Dismiss the scoring summary"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        )}
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-elevated"
        role="progressbar"
        aria-label="Scoring progress"
        aria-valuemin={0}
        aria-valuemax={counts.total}
        aria-valuenow={counts.finished}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            job.status === "error" ? "bg-danger" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {job.error ? <p className="text-xs text-danger">{job.error}</p> : null}
      <div className="flex flex-col gap-1.5">
        {groups.map((group) => (
          <div key={group.template} className="flex flex-wrap items-center gap-2">
            {groups.length > 1 ? (
              <span className="w-40 shrink-0 truncate text-[11px] font-medium text-muted">
                {group.template}
              </span>
            ) : null}
            <ul className="flex flex-wrap gap-1">
              {group.keys.map((key) => (
                <ComboChip key={key} comboKey={key} progress={job.progress[key]} />
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="text-[10px] leading-4 text-subtle">
        Each score is recorded like the per-colour Score. Nothing is ticked —
        publishing stays your click.
      </p>
    </SurfaceCard>
  );
}
