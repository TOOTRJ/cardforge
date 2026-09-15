"use client";

// ---------------------------------------------------------------------------
// GenerationDetailsDialog — opened by clicking the floating progress widget.
// Live counts, elapsed time, an estimate from the measured pace of finished
// steps, the per-step list with Retry, and a link to the target.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { GenerationJobPhase, GenerationJobStep } from "@/components/ai/use-generation-job";
import { cn } from "@/lib/utils";

export type GenerationStats = {
  /** When the run (or resume) began, ms epoch. */
  startedAt: number | null;
  /** Completion instants of steps that finished during this session. */
  completions: number[];
  /** Steps run in parallel — divides the remaining time. */
  concurrency: number;
};

export function estimateRemainingMs(
  stats: GenerationStats,
  remaining: number,
  now: number = Date.now(),
): number | null {
  if (remaining <= 0) return 0;
  if (stats.startedAt == null || stats.completions.length === 0) return null;
  // Wall-clock pace per finished step already reflects the worker pool, so
  // the remaining time is simply pace × remaining.
  const elapsed = Math.max(1, now - stats.startedAt);
  const perStep = elapsed / stats.completions.length;
  return Math.round(perStep * remaining);
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return rest ? `${m}m ${rest}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function GenerationDetailsDialog({
  open,
  onOpenChange,
  label,
  phase,
  steps,
  stats,
  targetHref,
  targetLabel,
  onRetryStep,
  onRetryFailed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  phase: GenerationJobPhase;
  steps: GenerationJobStep[];
  stats: GenerationStats;
  targetHref?: string;
  targetLabel?: string;
  onRetryStep: (key: string) => void;
  onRetryFailed: () => void;
}) {
  // A ticking clock for elapsed / remaining while the job runs.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);

  const done = steps.filter((s) => s.status === "done").length;
  const failed = steps.filter((s) => s.status === "failed").length;
  const running = steps.filter((s) => s.status === "running").length;
  const pending = steps.filter((s) => s.status === "pending").length;
  const remaining = pending + running;
  const busy = phase === "planning" || phase === "stepping";
  const elapsed = stats.startedAt ? now - stats.startedAt : 0;
  const eta = busy ? estimateRemainingMs(stats, remaining, now) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden />
            ) : failed > 0 ? (
              <TriangleAlert className="h-4 w-4 text-danger" aria-hidden />
            ) : (
              <Check className="h-4 w-4 text-primary-bright" aria-hidden />
            )}
            {label}
          </DialogTitle>
          <DialogDescription>
            {phase === "planning"
              ? "The AI is designing the deck — names, colours, curve and every card's text. Painting starts right after."
              : busy
                ? "Each card is designed and painted in turn. Safe to keep browsing; it continues in the background."
                : failed > 0
                  ? "Finished with some failures — retry them below; nothing is generated twice."
                  : "All done."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 px-5 py-4 sm:grid-cols-4">
          <Stat label="Done" value={done} />
          <Stat label="Remaining" value={remaining} />
          <Stat label="Failed" value={failed} tone={failed > 0 ? "danger" : undefined} />
          <Stat
            label={busy ? "Estimated left" : "Elapsed"}
            value={
              busy
                ? phase === "planning"
                  ? "designing…"
                  : eta == null
                    ? "measuring…"
                    : `~${formatDuration(eta)}`
                : formatDuration(elapsed)
            }
            hint={busy && stats.startedAt ? `${formatDuration(elapsed)} elapsed` : undefined}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {steps.length === 0 ? (
            <p className="text-sm text-muted">Steps appear here once the plan is ready.</p>
          ) : (
            <ol className="flex flex-col gap-1.5" aria-label="Generation steps">
              {steps.map((step) => (
                <li
                  key={step.key}
                  className="flex items-center gap-2 rounded-md border border-border/50 bg-elevated/30 px-3 py-1.5 text-sm"
                >
                  {step.status === "done" ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-primary-bright" aria-hidden />
                  ) : step.status === "failed" ? (
                    <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />
                  ) : step.status === "running" ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" aria-hidden />
                  ) : (
                    <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-border" aria-hidden />
                  )}
                  <span className={cn("min-w-0 flex-1 truncate", step.status === "pending" && "text-muted")}>
                    {step.label}
                  </span>
                  {step.status === "failed" && step.error ? (
                    <span className="hidden max-w-[40%] truncate text-xs text-danger sm:inline" title={step.error}>
                      {step.error}
                    </span>
                  ) : null}
                  {step.status === "failed" && !busy ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => onRetryStep(step.key)}>
                      <RotateCcw className="h-3 w-3" aria-hidden />
                      Retry
                    </Button>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-subtle">
            {busy ? "Closing this keeps the job running." : `${done} done · ${failed} failed`}
          </span>
          <div className="flex items-center gap-2">
            {!busy && failed > 0 ? (
              <Button type="button" variant="secondary" onClick={onRetryFailed}>
                <RotateCcw className="h-4 w-4" aria-hidden />
                Retry all failed
              </Button>
            ) : null}
            {targetHref ? (
              <Button asChild>
                <Link href={targetHref} onClick={() => onOpenChange(false)}>
                  {targetLabel ?? "Open"}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "danger";
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border/60 bg-elevated/30 px-3 py-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{label}</span>
      <span className={cn("font-display text-lg font-semibold tabular-nums", tone === "danger" ? "text-danger" : "text-foreground")}>
        {value}
      </span>
      {hint ? <span className="text-[11px] text-subtle">{hint}</span> : null}
    </div>
  );
}
