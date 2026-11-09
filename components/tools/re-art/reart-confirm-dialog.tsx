"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";
import { publishCredits } from "@/components/billing/credits-bus";
import { describeCapacity } from "@/lib/billing/capacity-copy";
import { cn } from "@/lib/utils";
import type { GenerationJobView } from "@/lib/ai/generation-jobs";
import { reartCostDetail, reartCostLine, type ReartRunInput } from "@/lib/tools/re-art/model";
import { planReartAction, startReartAction, type ReartPlanned } from "@/lib/tools/re-art/actions";

// ---------------------------------------------------------------------------
// Re-art's confirm: what a run paints and what it costs, BEFORE anything is
// charged — "Re-arts 64 cards · 64 credits · 12 slots left". It plans on
// open (the server's own plan: the real cards' Scryfall read once, the
// maker's cards from their session) and Start asks the server to plan again
// and decide. Over the card limit or short of credits → the upgrade /
// credits prompt, as everywhere else.
// ---------------------------------------------------------------------------

export function ReartConfirmDialog({
  open,
  onOpenChange,
  input,
  title,
  description,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The run (the style shown in the form; null style = the saved one). */
  input: ReartRunInput;
  title: string;
  description: string;
  onStarted: (job: GenerationJobView, skipped: Array<{ name: string; reason: string }>, styleVersion: number) => void;
}) {
  const [planned, setPlanned] = useState<ReartPlanned | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, startTransition] = useTransition();
  const upgrade = useUpgradeModal();
  const inputKey = JSON.stringify(input);

  // Plan each time it opens on a new run (reset during render; the effect
  // only fetches — one request per open, StrictMode's second run included).
  const [planKey, setPlanKey] = useState<string | null>(null);
  const wantKey = open ? inputKey : null;
  if (wantKey !== planKey) {
    setPlanKey(wantKey);
    setPlanned(null);
    setError(null);
    setStartError(null);
  }
  const pending = useRef<{ key: string; request: ReturnType<typeof planReartAction> } | null>(null);
  useEffect(() => {
    if (!open || planKey === null) return;
    let cancelled = false;
    if (pending.current?.key !== planKey) {
      const request = planReartAction(input);
      pending.current = { key: planKey, request };
      // A finished read is dropped, so the next open plans afresh.
      void request
        .finally(() => {
          if (pending.current?.request === request) pending.current = null;
        })
        .catch(() => undefined);
    }
    pending.current!.request.then(
      (result) => {
        if (cancelled) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setPlanned(result);
        if (typeof result.balance === "number") publishCredits(result.balance);
      },
      () => {
        if (!cancelled) setError("We couldn't read the deck — check your connection and try again.");
      },
    );
    return () => {
      cancelled = true;
    };
    // The run's identity, not the object's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, planKey]);

  const cost = planned?.cost;
  const capacityMessage = planned && cost ? describeCapacity(planned.capacity, cost.makes) : null;
  const overCapacity = Boolean(cost && cost.slotsLeftAfter !== null && cost.slotsLeftAfter < 0);
  const shortOfCredits = Boolean(planned && cost && planned.balance !== null && cost.credits > planned.balance);
  const blockReason = !planned
    ? null
    : !planned.aiAvailable
      ? "AI art isn't available right now — try again later."
      : planned.lines.length === 0
        ? planned.inStyle > 0
          ? "Every card here is in the deck's style already."
          : "None of these cards can be re-arted."
        : overCapacity
          ? (capacityMessage?.message ?? "Not enough card slots left for the real cards.")
          : shortOfCredits
            ? `This run costs ${cost!.credits} credits and you have ${planned.balance ?? 0}.`
            : null;

  const start = () => {
    setStartError(null);
    startTransition(async () => {
      const result = await startReartAction(input);
      if (!result.ok) {
        setStartError(result.error);
        if (result.code === "CARD_CAPACITY") upgrade.open("capacity", "reart_deck");
        if (result.code === "INSUFFICIENT_CREDITS") upgrade.open("credits", "reart_deck");
        return;
      }
      onStarted(result.job, result.skipped, result.version);
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!starting ? onOpenChange(next) : undefined)}>
      <DialogContent size="lg" className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {error ? (
          <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            {error}
          </p>
        ) : !planned || !cost ? (
          <p role="status" className="flex items-center gap-2 py-8 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Reading the deck and pricing the run…
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-border/60 bg-elevated/40 p-4">
              <p className="text-base font-semibold tabular-nums text-foreground">{reartCostLine(cost)}</p>
              {reartCostDetail(cost) ? <p className="mt-1 text-sm text-muted">{reartCostDetail(cost)}</p> : null}
              {planned.inStyle > 0 ? (
                <p className="mt-1 text-sm text-muted">
                  {planned.inStyle} card{planned.inStyle === 1 ? " is" : "s are"} in this style already and left as{" "}
                  {planned.inStyle === 1 ? "it is" : "they are"}.
                </p>
              ) : null}
              {capacityMessage ? (
                <p className={cn("mt-2 text-xs", capacityMessage.tone === "danger" ? "text-danger" : "text-warning")}>
                  {capacityMessage.message}
                </p>
              ) : null}
            </div>
            {planned.lines.length > 0 ? (
              <details className="group rounded-lg border border-border/50">
                <summary className="cursor-pointer select-none px-4 py-2.5 text-sm text-foreground">
                  The {planned.lines.length} card{planned.lines.length === 1 ? "" : "s"} it paints
                </summary>
                <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto px-4 pb-3 text-sm">
                  {planned.lines.map((line) => (
                    <li key={line.entryId} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-foreground">
                        {line.name}
                        <span className="text-xs text-muted">
                          {" "}
                          — {line.kind === "printing" ? "becomes your card" : "new art on your card"}
                          {line.notes.length ? ` · ${line.notes.join(" ")}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted">
                        {line.credits} credit{line.credits === 1 ? "" : "s"}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {planned.skipped.length > 0 ? (
              <details className="rounded-lg border border-border/50">
                <summary className="cursor-pointer select-none px-4 py-2.5 text-sm text-foreground">
                  {planned.skipped.length} left as {planned.skipped.length === 1 ? "it is" : "they are"}
                </summary>
                <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto px-4 pb-3 text-xs text-muted">
                  {planned.skipped.map((skip, index) => (
                    <li key={`${skip.name}-${index}`}>
                      <span className="text-foreground">{skip.name}</span> — {skip.reason}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        )}

        <DialogFooter className="flex-col items-stretch gap-3 sm:flex-col">
          {startError ? (
            <p role="alert" className="text-sm text-danger">
              {startError}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {blockReason ? (
              <p id="reart-start-blocked" className="mr-auto max-w-prose text-xs text-muted">
                {blockReason}
              </p>
            ) : null}
            {overCapacity ? (
              <Button variant="outline" onClick={() => upgrade.open("capacity", "reart_deck")}>
                More card slots
              </Button>
            ) : shortOfCredits ? (
              <Button variant="outline" onClick={() => upgrade.open("credits", "reart_deck")}>
                Get credits
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={starting}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (planned && !blockReason && !starting) start();
              }}
              aria-disabled={!planned || blockReason || starting ? true : undefined}
              aria-describedby={blockReason ? "reart-start-blocked" : undefined}
              className={cn((!planned || blockReason || starting) && "cursor-not-allowed opacity-60")}
            >
              {starting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {cost ? `Paint ${cost.cards} card${cost.cards === 1 ? "" : "s"}` : "Paint"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
