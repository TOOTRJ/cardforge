"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { reartUndoDetail, reartUndoLine, reartUndoNote, type ReartUndoPlan } from "@/lib/tools/re-art/model";
import { planUndoReartRunAction, undoReartRunAction } from "@/lib/tools/re-art/actions";

/**
 * "Undo this run": what it would put back, card by card kind, BEFORE
 * anything changes — then the undo itself, a few cards a request (each is a
 * card edit), with its progress. Nothing is painted and no credit is
 * returned; each picture it takes off a card is kept (0215), so an undo can
 * be undone card by card. The deck's saved style is not a run's: undoing a
 * run leaves it as it is.
 */
export function ReartUndoDialog({
  open,
  onOpenChange,
  runId,
  onUndone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string;
  /** Cards were put back (the page re-reads): how many, and how many
   *  couldn't be. */
  onUndone: (undone: number, failed: number) => void;
}) {
  const [plan, setPlan] = useState<ReartUndoPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ undone: number; total: number } | null>(null);
  const [failures, setFailures] = useState<Array<{ name: string; reason: string }>>([]);
  /** Cards this opening of the dialog put back (null: no undo yet). */
  const [putBack, setPutBack] = useState<number | null>(null);
  const working = progress !== null;

  // Plan each time it opens on a run (reset during render; the effect only
  // fetches — one request per open, StrictMode's second run included).
  const [planKey, setPlanKey] = useState<string | null>(null);
  const wantKey = open ? runId : null;
  if (wantKey !== planKey) {
    setPlanKey(wantKey);
    setPlan(null);
    setError(null);
    setFailures([]);
    setProgress(null);
    setPutBack(null);
  }
  const pending = useRef<{ key: string; request: ReturnType<typeof planUndoReartRunAction> } | null>(null);
  useEffect(() => {
    if (!open || planKey === null) return;
    let cancelled = false;
    if (pending.current?.key !== planKey) {
      const request = planUndoReartRunAction(planKey);
      pending.current = { key: planKey, request };
      void request
        .finally(() => {
          if (pending.current?.request === request) pending.current = null;
        })
        .catch(() => undefined);
    }
    pending.current!.request.then(
      (result) => {
        if (cancelled) return;
        if (!result.ok) setError(result.error);
        else setPlan({ earlier: result.earlier, own: result.own, real: result.real, skipped: result.skipped });
      },
      () => {
        if (!cancelled) setError("We couldn't read this run — check your connection and try again.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, planKey]);

  const total = plan ? plan.earlier + plan.own + plan.real : 0;

  const undo = async () => {
    if (working || total === 0) return;
    setError(null);
    setFailures([]);
    setProgress({ undone: 0, total });
    let undone = 0;
    const failed: Array<{ name: string; reason: string; cardId: string }> = [];
    try {
      // A few cards a request, until none remain. Each request plans afresh;
      // the cards that couldn't be put back are named so they aren't tried
      // again in this undo.
      for (let request = 0; request < 200; request += 1) {
        const result = await undoReartRunAction(
          runId,
          failed.map((card) => card.cardId),
        );
        if (!result.ok) {
          setError(result.error);
          break;
        }
        undone += result.undone;
        failed.push(...result.failed);
        setProgress({ undone, total });
        setFailures(failed.map(({ name, reason }) => ({ name, reason })));
        if (result.remaining === 0) break;
        // A request that moved nothing would loop for ever.
        if (result.undone === 0 && result.failed.length === 0) break;
      }
    } catch {
      setError("We couldn't reach PipGlyph — the cards put back so far are saved. Try again for the rest.");
    }
    // What is left to undo now (nothing, when it all went back) — read
    // again, with what couldn't be put back still on show. The cards left
    // as they were stay the ones named BEFORE the undo: read again, the
    // list would name every card just put back ("has its own art back").
    const left = await planUndoReartRunAction(runId).catch(() => null);
    if (left?.ok) setPlan((before) => ({ earlier: left.earlier, own: left.own, real: left.real, skipped: before?.skipped ?? left.skipped }));
    setProgress(null);
    setPutBack(undone);
    if (undone > 0 || failed.length > 0) onUndone(undone, failed.length);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!working ? onOpenChange(next) : undefined)}>
      <DialogContent
        size="md"
        className="max-h-[92vh] overflow-y-auto"
        // Closed either way, the focus goes back to the run's Undo button.
        onCloseAutoFocus={(event) => {
          const opener = document.querySelector<HTMLElement>(`[data-reart-undo="${runId}"]`);
          if (!opener) return;
          event.preventDefault();
          opener.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Undo this run</DialogTitle>
          <DialogDescription>
            Puts each card this run painted back to what it showed before. Nothing changes until you press Undo.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 px-5 py-4">
          {error ? (
            <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
              {error}
            </p>
          ) : null}
          {!plan && !error ? (
            <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Reading the run…
            </p>
          ) : null}
          {putBack !== null && putBack > 0 && !working ? (
            <p role="status" className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm text-foreground">
              {putBack} card{putBack === 1 ? "" : "s"} put back.
            </p>
          ) : null}
          {plan ? (
            <>
              <div className="rounded-lg border border-border/60 bg-elevated/40 p-4">
                <p className="text-base font-semibold tabular-nums text-foreground">{reartUndoLine(plan)}</p>
                {reartUndoDetail(plan).map((line) => (
                  <p key={line} className="mt-1 text-sm text-muted">
                    {line}
                  </p>
                ))}
                {total > 0 ? <p className="mt-2 text-xs leading-5 text-subtle">{reartUndoNote(plan)}</p> : null}
              </div>
              {plan.skipped.length > 0 ? (
                <details className="rounded-lg border border-border/50">
                  <summary className="cursor-pointer select-none px-4 py-2.5 text-sm text-foreground">
                    {plan.skipped.length} left as {plan.skipped.length === 1 ? "it is" : "they are"}
                  </summary>
                  <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto px-4 pb-3 text-xs text-muted">
                    {plan.skipped.map((skip, index) => (
                      <li key={`${skip.name}-${index}`}>
                        <span className="text-foreground">{skip.name}</span> — {skip.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          ) : null}
          {progress ? (
            <p role="status" className="flex items-center gap-2 text-sm tabular-nums text-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Putting cards back… {progress.undone} of {progress.total}
            </p>
          ) : null}
          {failures.length > 0 ? (
            <div role="status" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
              <p className="font-medium">
                {failures.length} card{failures.length === 1 ? "" : "s"} couldn&apos;t be put back and {failures.length === 1 ? "was" : "were"} left as{" "}
                {failures.length === 1 ? "it is" : "they are"}:
              </p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {failures.map((failure, index) => (
                  <li key={`${failure.name}-${index}`}>
                    {failure.name} — {failure.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={working}>
            Close
          </Button>
          <Button
            onClick={() => void undo()}
            aria-disabled={!plan || total === 0 || working ? true : undefined}
            className={cn((!plan || total === 0 || working) && "cursor-not-allowed opacity-60")}
          >
            {working ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {total > 0 ? `Undo ${total} card${total === 1 ? "" : "s"}` : "Undo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
