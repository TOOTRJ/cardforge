"use client";

import { useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  REART_SCENE_CREDITS,
  reartScenesLine,
  reartScenesReplaceLine,
  type ReartCardWords,
  type ReartStudioEntry,
} from "@/lib/tools/re-art/model";
import { requestReartScene, sceneFailureStopsBatch, scenesCredits } from "@/lib/tools/re-art/scene-client";

/**
 * "Write scenes…" for the cards picked in the list: an AI-written scene a
 * card (migration 0217, one credit each), one request after another. It
 * says what it will do and cost BEFORE anything is charged; each scene is
 * saved as its card's own words as it is written, so stopping — or closing
 * the tab — loses nothing that was paid for. A card whose scene can't be
 * written is named with why and the rest go on; out of credits (or of the
 * AI's limit) it stops and says so. Nothing is painted.
 */
export function ReartScenesDialog({
  open,
  onOpenChange,
  deckId,
  entries,
  balance,
  onWritten,
  onDone,
  onOutOfCredits,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deckId: string;
  /** The cards to write for (picked, paintable, not locked). */
  entries: ReartStudioEntry[];
  /** The credits the maker has, or null where they aren't charged. */
  balance: number | null;
  /** One scene landed (the studio shows it at once). */
  onWritten?: (entryId: string, words: ReartCardWords) => void;
  /** The batch is over: how many were written, how many couldn't be. */
  onDone: (written: number, failed: number) => void;
  onOutOfCredits?: () => void;
}) {
  const [phase, setPhase] = useState<"confirm" | "running" | "done">("confirm");
  const [progress, setProgress] = useState({ written: 0, at: 0 });
  const [failures, setFailures] = useState<Array<{ name: string; reason: string }>>([]);
  const [stopped, setStopped] = useState<string | null>(null);
  const stop = useRef(false);
  const [stopping, setStopping] = useState(false);

  // Each opening starts afresh (reset during render).
  const key = open ? entries.map((entry) => entry.id).join(",") : null;
  const [shown, setShown] = useState<string | null>(null);
  if (key !== shown) {
    setShown(key);
    setPhase("confirm");
    setProgress({ written: 0, at: 0 });
    setFailures([]);
    setStopped(null);
    setStopping(false);
  }

  const total = entries.length;
  const cost = scenesCredits(total);
  const replaced = entries.filter((entry) => entry.words).length;
  const short = balance !== null && balance < cost;
  const running = phase === "running";

  const run = async () => {
    if (running || total === 0) return;
    stop.current = false;
    setStopping(false);
    setStopped(null);
    setFailures([]);
    setPhase("running");
    let written = 0;
    const failed: Array<{ name: string; reason: string }> = [];
    for (let at = 0; at < entries.length; at += 1) {
      if (stop.current) {
        setStopped(`Stopped. ${entries.length - at} card${entries.length - at === 1 ? " was" : "s were"} left as ${entries.length - at === 1 ? "it is" : "they are"}.`);
        break;
      }
      setProgress({ written, at });
      const entry = entries[at];
      const result = await requestReartScene({ deckId, entryId: entry.id });
      if (result.ok) {
        written += 1;
        onWritten?.(entry.id, result.words);
        continue;
      }
      // The next card would be refused the same way: stop, and say why.
      if (sceneFailureStopsBatch(result)) {
        setStopped(result.error);
        if (result.code === "INSUFFICIENT_CREDITS") onOutOfCredits?.();
        break;
      }
      failed.push({ name: entry.name, reason: result.error });
      setFailures([...failed]);
    }
    setProgress({ written, at: entries.length });
    setPhase("done");
    onDone(written, failed.length);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!running ? onOpenChange(next) : undefined)}>
      <DialogContent
        size="md"
        className="max-h-[92vh] overflow-y-auto"
        // Closed either way, the focus goes back to the list's button.
        onCloseAutoFocus={(event) => {
          const opener = document.querySelector<HTMLElement>("[data-reart-scenes]");
          if (!opener) return;
          event.preventDefault();
          opener.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Write scenes with AI</DialogTitle>
          <DialogDescription>
            Each card gets a scene of its own for its picture, written from its name, type and text in the deck&apos;s world.
            Nothing is charged until you press Write.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="rounded-lg border border-border/60 bg-elevated/40 p-4">
            <p className="text-base font-semibold tabular-nums text-foreground">{reartScenesLine(total)}</p>
            {replaced > 0 ? <p className="mt-1 text-sm text-muted">{reartScenesReplaceLine(total, replaced)}</p> : null}
            <p className="mt-1 text-sm text-muted">
              Nothing is painted. Each scene is saved as its card&apos;s own words as it is written — change it under the
              card&apos;s “Edit its words…”. The picture painted from it later costs a picture&apos;s own credit.
            </p>
            {short && phase === "confirm" ? (
              <p className="mt-2 text-xs text-warning">
                You have {balance} credit{balance === 1 ? "" : "s"}: it writes {Math.floor((balance ?? 0) / REART_SCENE_CREDITS)} scene
                {Math.floor((balance ?? 0) / REART_SCENE_CREDITS) === 1 ? "" : "s"}, then stops.
              </p>
            ) : null}
          </div>

          {running ? (
            <p role="status" className="flex items-center gap-2 text-sm tabular-nums text-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Writing scenes… {Math.min(progress.at + 1, total)} of {total}
              {stopping ? " — stopping after this one" : ""}
            </p>
          ) : null}
          {phase === "done" ? (
            <p role="status" className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm tabular-nums text-foreground">
              {progress.written} scene{progress.written === 1 ? "" : "s"} written and saved
              {progress.written > 0 ? ` (${scenesCredits(progress.written)} credit${scenesCredits(progress.written) === 1 ? "" : "s"})` : ""}.
            </p>
          ) : null}
          {stopped ? (
            <p role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
              {stopped}
            </p>
          ) : null}
          {failures.length > 0 ? (
            <div role="status" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
              <p className="font-medium">
                {failures.length} card{failures.length === 1 ? "" : "s"} got no scene (nothing was charged for {failures.length === 1 ? "it" : "them"}):
              </p>
              <ul className="mt-1 flex max-h-40 flex-col gap-0.5 overflow-y-auto">
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
          {running ? (
            <Button
              variant="outline"
              onClick={() => {
                stop.current = true;
                setStopping(true);
              }}
              aria-disabled={stopping ? true : undefined}
              className={stopping ? "cursor-not-allowed opacity-60" : undefined}
            >
              Stop after this one
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                {phase === "done" ? "Close" : "Cancel"}
              </Button>
              {phase === "confirm" ? (
                <Button
                  onClick={() => void run()}
                  aria-disabled={total === 0 ? true : undefined}
                  className={cn(total === 0 && "cursor-not-allowed opacity-60")}
                >
                  <Sparkles className="h-4 w-4" aria-hidden />
                  Write {total} scene{total === 1 ? "" : "s"}
                </Button>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
