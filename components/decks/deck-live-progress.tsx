"use client";

// ---------------------------------------------------------------------------
// DeckLiveProgress — owner-only strip on the deck page while an AI job is
// painting THIS deck. Two jobs:
//   1. Keep the card list filling in live: as steps land in the global
//      runner, refresh the server-rendered page (debounced — at most one
//      refresh every few seconds, never per card) and once more at the end.
//   2. Pick up an interrupted build: the page loads knowing a job is still
//      "generating" (a reload mid-build, or a reload during the long plan
//      request); if the runner isn't already on it, resume it here.
// ---------------------------------------------------------------------------

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { useGenerationJob } from "@/components/ai/use-generation-job";

const REFRESH_EVERY_MS = 6_000;

export function DeckLiveProgress({
  deckId,
  pendingJob,
}: {
  deckId: string;
  /** Server-side snapshot of a still-generating job for this deck. */
  pendingJob: { jobId: string; done: number; total: number } | null;
}) {
  const router = useRouter();
  const { activeJob, steps, busy, phase, resumeJob, openDetails } = useGenerationJob();
  const mine = activeJob?.deckId === deckId;
  const done = mine ? steps.filter((s) => s.status === "done").length : 0;
  const failed = mine ? steps.filter((s) => s.status === "failed").length : 0;
  const total = mine ? steps.length : 0;
  const settled = done + failed;

  // Debounced refresh while cards land, plus a final one when the run ends.
  const lastRefreshRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasBusyRef = useRef(false);
  useEffect(() => {
    if (!mine) return;
    const schedule = (delay: number) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        lastRefreshRef.current = Date.now();
        router.refresh();
      }, delay);
    };
    if (busy) {
      wasBusyRef.current = true;
      if (settled > 0) {
        const since = Date.now() - lastRefreshRef.current;
        schedule(Math.max(500, REFRESH_EVERY_MS - since));
      }
    } else if (wasBusyRef.current) {
      wasBusyRef.current = false;
      schedule(300);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [mine, busy, settled, router]);

  // Resume an interrupted job once the runner has had a moment to auto-adopt
  // it on its own (its mount check races this effect).
  const [resuming, setResuming] = useState(false);
  const triedRef = useRef(false);
  useEffect(() => {
    if (!pendingJob || triedRef.current) return;
    const timer = setTimeout(() => {
      if (triedRef.current || busy || mine) return;
      triedRef.current = true;
      setResuming(true);
      void resumeJob(pendingJob.jobId).finally(() => setResuming(false));
    }, 1500);
    return () => clearTimeout(timer);
  }, [pendingJob, busy, mine, resumeJob]);

  const showing = (mine && (busy || phase === "planning")) || (pendingJob && (resuming || !mine));
  if (!showing) return null;
  const label = mine && total > 0 ? `${settled}/${total}` : pendingJob ? `${pendingJob.done}/${pendingJob.total}` : "";
  const percent = mine && total > 0 ? Math.round((settled / total) * 100) : pendingJob ? Math.round((pendingJob.done / Math.max(1, pendingJob.total)) * 100) : 0;

  return (
    <SurfaceCard className="mt-8 flex flex-wrap items-center gap-4 border-accent/40 bg-accent/5 p-5" role="status" aria-live="polite">
      <Loader2 className="h-5 w-5 shrink-0 animate-spin text-accent" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex items-center justify-between gap-3 text-sm font-semibold text-foreground">
          <span>{mine ? "Painting this deck" : resuming ? "Resuming this deck's build" : "This deck is still being built"}</span>
          <span className="text-xs tabular-nums text-muted">{label}</span>
        </span>
        <span className="h-1.5 overflow-hidden rounded-full bg-elevated" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <span className="block h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
        </span>
        <span className="text-xs leading-5 text-muted">
          Cards appear below as they finish{failed > 0 ? ` · ${failed} failed so far — Regenerate them when the run ends` : ""}. Safe to browse elsewhere; the run continues.
        </span>
      </div>
      {mine ? (
        <Button type="button" variant="outline" size="sm" onClick={openDetails}>
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          Details
        </Button>
      ) : null}
    </SurfaceCard>
  );
}
