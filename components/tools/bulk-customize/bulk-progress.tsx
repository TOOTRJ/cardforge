"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw, XCircle } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import type { useBulkRunner } from "./use-bulk-runner";

// ---------------------------------------------------------------------------
// A running batch's progress — shared by Bulk Customize's dialog and the
// tools built on it (Re-art deck's studio): the count, the bar, each card's
// line as it lands, Stop, Continue / Try the failed ones again.
// ---------------------------------------------------------------------------

export function BulkProgress({
  runner,
  total,
  doneCount,
  failedCount,
  settled,
  paused,
  skipped,
  finishedAction,
  noun = "made",
  doing = "Making",
  unit = "batch",
  pausedNote = "Closing ends this batch; the cards made so far stay saved.",
}: {
  runner: ReturnType<typeof useBulkRunner>;
  total: number;
  doneCount: number;
  failedCount: number;
  settled: boolean;
  paused: boolean;
  skipped: Array<{ name: string; reason: string }>;
  /** What a finished batch offers (default: My Cards). */
  finishedAction?: ReactNode;
  /** The past tense the count says ("made", "painted"). */
  noun?: string;
  /** The present tense ("Making", "Painting"). */
  doing?: string;
  /** What the whole thing is called ("batch", "run"). */
  unit?: string;
  /** What a paused batch says about leaving it. */
  pausedNote?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!runner.waitingUntil) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [runner.waitingUntil]);
  const waitSeconds = runner.waitingUntil ? Math.max(0, Math.ceil((runner.waitingUntil - now) / 1000)) : 0;
  // The panel's words follow the tool's own (Re-art PAINTS cards in a RUN;
  // it said "made" and "batch" there).
  const done = `${noun.charAt(0).toUpperCase()}${noun.slice(1)}`;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-center justify-between text-sm">
          <span role="status" className="text-foreground">
            {settled || paused
              ? `${doneCount} of ${total} ${noun}${failedCount ? ` · ${failedCount} didn't` : ""}${paused ? " · paused" : ""}`
              : `${doing} ${doneCount + failedCount + 1 > total ? total : doneCount + failedCount + 1} of ${total}…`}
          </span>
          {waitSeconds > 0 ? (
            // Any of the per-minute limits a step can meet (Scryfall's
            // lookups or art, uploads, the AI calls): the runner knows the
            // wait, not which one — it used to name Scryfall's art limit
            // for all of them.
            <span className="text-xs text-muted">Waiting {waitSeconds}s for a per-minute limit to clear…</span>
          ) : null}
        </div>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-elevated"
          role="progressbar"
          aria-label={`Cards ${noun}`}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={doneCount}
        >
          <div className="h-full bg-primary transition-[width]" style={{ width: `${total ? (doneCount / total) * 100 : 0}%` }} />
        </div>
      </div>

      {runner.error ? (
        <p role="alert" className="text-sm text-danger">
          {runner.error}
        </p>
      ) : null}
      {runner.stoppedBy ? (
        <p role="alert" className="flex items-center gap-2 text-sm text-warning">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          {runner.stoppedBy === "CARD_CAPACITY"
            ? `Your card limit is full — the ${unit} stopped. The cards ${noun} so far are saved.`
            : `You're out of credits — the ${unit} stopped. The cards ${noun} so far are saved.`}
        </p>
      ) : null}

      <ul className="flex max-h-[26rem] flex-col gap-1.5 overflow-y-auto pr-1">
        {runner.steps.map((step) => (
          <li key={step.key} className="flex items-start gap-2 text-sm">
            {step.status === "done" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label={done} />
            ) : step.status === "failed" ? (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-label={`Not ${noun}`} />
            ) : step.status === "running" ? (
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted" aria-label={doing} />
            ) : (
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-border" aria-label="Waiting" />
            )}
            <span className="min-w-0 flex-1">
              <span className="text-foreground">{step.label}</span>
              {step.status === "failed" && step.error ? (
                <span className="block text-xs text-danger">
                  {step.error}
                  {step.refunded ? " Your credit was returned." : ""}
                </span>
              ) : null}
              {step.note ? <span className="block text-xs text-muted">{step.note}</span> : null}
              {step.forced_private ? (
                <span className="block text-xs text-muted">Saved private: its text has strong language.</span>
              ) : null}
            </span>
          </li>
        ))}
        {skipped.map((skip) => (
          <li key={`skip-${skip.name}-${skip.reason}`} className="text-xs text-muted">
            {skip.name} — skipped: {skip.reason}
          </li>
        ))}
      </ul>

      {runner.running ? (
        <div className="flex justify-end">
          <Button variant="outline" onClick={runner.stop}>
            Stop after the cards being {noun}
          </Button>
        </div>
      ) : settled || paused ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {paused ? (
            <p className="mr-auto text-xs text-muted">{pausedNote}</p>
          ) : null}
          {paused ? (
            <Button variant="outline" onClick={runner.retryFailed}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              Continue the {unit}
            </Button>
          ) : failedCount > 0 ? (
            <Button variant="outline" onClick={runner.retryFailed}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              Try the failed ones again
            </Button>
          ) : null}
          {finishedAction ?? (
            <Link href="/dashboard/cards" className={buttonVariants()}>
              See them in My Cards
            </Link>
          )}
        </div>
      ) : null}
    </div>
  );
}
