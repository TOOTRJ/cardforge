"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, Download, Loader2, Package, Printer, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { estimateRemainingMs, formatDuration } from "@/components/ai/generation-details-dialog";
import { useGenerationContext } from "@/components/ai/generation-provider";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";
import {
  DeckExportError,
  formatBytes,
  runDeckExport,
  type DeckExportKind,
  type DeckExportProgress,
  type DeckExportRequest,
} from "@/lib/decks/export-client";

// ---------------------------------------------------------------------------
// DeckExportProvider — runs a Pro whole-deck export (ZIP or print PDF) in
// the background, at the ROOT layout so navigation never interrupts it.
// Mirrors the AI generation runner's UX: a floating progress card (bottom
// right, above the generation card when both are up) that is safe to
// ignore, clickable for stats + time left, with cancel; a toast + auto-save
// when the file is ready, and a "Save file" fallback in case the browser
// blocked the automatic download. One export at a time.
// ---------------------------------------------------------------------------

export type DeckExportState = {
  id: number;
  kind: DeckExportKind;
  deckTitle: string;
  status: "preparing" | "rendering" | "packaging" | "done" | "failed" | "cancelled";
  total: number;
  done: number;
  failed: string[];
  startedAt: number;
  completions: number[];
  finishedAt: number | null;
  error: string | null;
  file: { url: string; name: string; bytes: number; cards: number } | null;
};

type DeckExportContextValue = {
  active: DeckExportState | null;
  busy: boolean;
  start: (request: DeckExportRequest) => void;
  cancel: () => void;
  openDetails: () => void;
};

const DeckExportContext = createContext<DeckExportContextValue | null>(null);

export function useDeckExport(): DeckExportContextValue {
  const value = useContext(DeckExportContext);
  if (!value) throw new Error("useDeckExport must be used inside DeckExportProvider.");
  return value;
}

const KIND_LABEL: Record<DeckExportKind, string> = {
  zip: "Building deck ZIP",
  pdf: "Building print PDF",
};

function saveBlobUrl(url: string, name: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function DeckExportProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DeckExportState | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const upgrade = useUpgradeModal();
  const generation = useGenerationContext();

  const busy = state !== null && (state.status === "preparing" || state.status === "rendering" || state.status === "packaging");

  // Revoke the object URL when a finished export is replaced or unmounted.
  const fileUrl = state?.file?.url ?? null;
  useEffect(() => {
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    };
  }, [fileUrl]);

  const start = useCallback(
    (request: DeckExportRequest) => {
      if (busy) {
        toast.message("An export is already running — it'll finish first.");
        setDetailsOpen(true);
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      const id = Date.now();
      setDismissed(false);
      setState({
        id,
        kind: request.kind,
        deckTitle: "",
        status: "preparing",
        total: 0,
        done: 0,
        failed: [],
        startedAt: Date.now(),
        completions: [],
        finishedAt: null,
        error: null,
        file: null,
      });
      toast.message(request.kind === "zip" ? "Building your deck ZIP in the background" : "Building your print PDF in the background", {
        description:
          "Every card renders clean at full resolution, so a big deck can take a few minutes. Keep browsing — we'll let you know when it's ready.",
        duration: 8000,
      });

      const onProgress = (progress: DeckExportProgress) => {
        setState((prev) => {
          if (!prev || prev.id !== id) return prev;
          const completions =
            progress.done > prev.done ? [...prev.completions, Date.now()] : prev.completions;
          return {
            ...prev,
            status: progress.phase,
            deckTitle: progress.deckTitle || prev.deckTitle,
            total: progress.total,
            done: progress.done,
            failed: progress.failed,
            completions,
          };
        });
      };

      void runDeckExport(request, { onProgress, signal: controller.signal })
        .then((result) => {
          const url = URL.createObjectURL(result.blob);
          setState((prev) =>
            prev && prev.id === id
              ? {
                  ...prev,
                  status: "done",
                  deckTitle: result.deck.title,
                  finishedAt: Date.now(),
                  file: { url, name: result.filename, bytes: result.blob.size, cards: result.cardsIncluded },
                }
              : prev,
          );
          saveBlobUrl(url, result.filename);
          toast.success(`${result.deck.title} — ${request.kind === "zip" ? "deck ZIP" : "print PDF"} ready`, {
            description:
              result.failed.length > 0
                ? `${result.failed.length} card${result.failed.length === 1 ? "" : "s"} couldn't render and ${result.failed.length === 1 ? "was" : "were"} skipped. Check your downloads.`
                : "Check your downloads. If nothing appeared, use Save file on the progress card.",
            duration: 10000,
          });
        })
        .catch((error: unknown) => {
          const cancelled = error instanceof DeckExportError && error.code === "CANCELLED";
          const message = error instanceof Error ? error.message : "Export failed — try again.";
          setState((prev) =>
            prev && prev.id === id
              ? { ...prev, status: cancelled ? "cancelled" : "failed", finishedAt: Date.now(), error: cancelled ? null : message }
              : prev,
          );
          if (cancelled) {
            toast.message("Export cancelled.");
            return;
          }
          if (error instanceof DeckExportError && error.code === "UPGRADE_REQUIRED") {
            upgrade.open("deck_export");
          }
          toast.error(message);
        })
        .finally(() => {
          if (abortRef.current === controller) abortRef.current = null;
        });
    },
    [busy, upgrade],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const openDetails = useCallback(() => setDetailsOpen(true), []);

  const value = useMemo<DeckExportContextValue>(
    () => ({ active: state, busy, start, cancel, openDetails }),
    [state, busy, start, cancel, openDetails],
  );

  const showWidget = state !== null && !dismissed && state.status !== "cancelled";
  const generationActive = generation.phase !== "idle";
  const percent =
    state && state.total > 0 ? Math.round((state.done / state.total) * 100) : state?.status === "done" ? 100 : 0;
  const label = state ? (state.status === "done" ? (state.kind === "zip" ? "Deck ZIP ready" : "Print PDF ready") : state.status === "failed" ? "Export failed" : KIND_LABEL[state.kind]) : "";

  return (
    <DeckExportContext.Provider value={value}>
      {children}

      {showWidget && state ? (
        <div
          className={cn(
            "fixed right-4 z-50 w-80 rounded-xl border border-border bg-surface/95 shadow-xl backdrop-blur transition-[bottom]",
            generationActive ? "bottom-[17.5rem] sm:bottom-[18.5rem]" : "bottom-24 sm:bottom-28",
          )}
          role="status"
          aria-live="polite"
        >
          <button
            type="button"
            onClick={openDetails}
            className="flex w-full flex-col gap-2 rounded-xl p-4 text-left transition-colors hover:bg-elevated/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
            aria-label={`${label} — open details`}
          >
            <span className="flex items-center gap-2 pr-6 text-sm font-semibold text-foreground">
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden />
              ) : state.status === "failed" ? (
                <TriangleAlert className="h-4 w-4 text-danger" aria-hidden />
              ) : (
                <Check className="h-4 w-4 text-primary-bright" aria-hidden />
              )}
              {label}
            </span>
            {state.deckTitle ? (
              <span className="-mt-1 truncate text-xs text-subtle">{state.deckTitle}</span>
            ) : null}
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "h-1.5 flex-1 overflow-hidden rounded-full bg-elevated",
                  (state.status === "preparing" || state.status === "packaging") && "animate-pulse",
                )}
                role="progressbar"
                aria-valuenow={state.done}
                aria-valuemin={0}
                aria-valuemax={state.total || undefined}
              >
                <span
                  className="block h-full rounded-full bg-accent transition-[width]"
                  style={{ width: state.status === "preparing" ? "10%" : `${percent}%` }}
                />
              </span>
              <span className="text-xs tabular-nums text-muted">
                {state.status === "preparing"
                  ? "prep"
                  : state.status === "packaging"
                    ? "zip"
                    : `${state.done}/${state.total}`}
              </span>
            </span>
            <span className="text-xs leading-5 text-muted">
              {state.status === "preparing" ? (
                <>Reading the deck…</>
              ) : state.status === "rendering" ? (
                <>Rendering cards clean at full size. Tap for time left — safe to keep browsing.</>
              ) : state.status === "packaging" ? (
                <>Packaging the file…</>
              ) : state.status === "failed" ? (
                <>{state.error ?? "Something went wrong."}</>
              ) : (
                <>
                  {state.file ? `${formatBytes(state.file.bytes)} · ${state.file.cards} card${state.file.cards === 1 ? "" : "s"}` : ""}
                  {state.failed.length > 0 ? ` · ${state.failed.length} skipped` : ""}
                </>
              )}
            </span>
            {state.status === "done" && state.file ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-primary-bright">
                <Download className="h-3 w-3" aria-hidden />
                Save file again
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => {
              if (busy) cancel();
              setDismissed(true);
            }}
            aria-label={busy ? "Cancel export" : "Hide export status"}
            className="absolute right-3 top-3 rounded p-0.5 text-subtle transition-colors hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ) : null}

      <DeckExportDetailsDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        state={state}
        busy={busy}
        onCancel={cancel}
      />
    </DeckExportContext.Provider>
  );
}

function DeckExportDetailsDialog({
  open,
  onOpenChange,
  state,
  busy,
  onCancel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: DeckExportState | null;
  busy: boolean;
  onCancel: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open || !busy) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open, busy]);

  if (!state) return null;
  const remaining = Math.max(0, state.total - state.done);
  const eta = busy
    ? estimateRemainingMs({ startedAt: state.startedAt, completions: state.completions, concurrency: 1 }, remaining, now)
    : 0;
  const elapsed = (state.finishedAt ?? now) - state.startedAt;
  const Icon = state.kind === "zip" ? Package : Printer;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-accent" aria-hidden />
            {state.kind === "zip" ? "Deck ZIP" : "Print PDF"}
            {state.deckTitle ? <span className="font-normal text-muted">· {state.deckTitle}</span> : null}
          </DialogTitle>
          <DialogDescription>
            {busy
              ? "Every card is rendered clean at full resolution on our servers, three at a time. You can keep using PipGlyph — this card follows you around."
              : state.status === "done"
                ? "Your file is ready. If your browser didn't save it automatically, use Save file."
                : state.status === "cancelled"
                  ? "This export was cancelled."
                  : (state.error ?? "The export failed.")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Cards" value={state.total ? `${state.done}/${state.total}` : "—"} />
          <Stat label="Skipped" value={state.failed.length} tone={state.failed.length > 0 ? "danger" : undefined} />
          <Stat
            label={busy ? "Time left" : "Took"}
            value={busy ? (eta === null ? "estimating…" : eta === 0 && remaining > 0 ? "almost done" : `~${formatDuration(eta)}`) : formatDuration(elapsed)}
            hint={busy ? `${formatDuration(elapsed)} elapsed` : undefined}
          />
          <Stat
            label="File"
            value={state.file ? formatBytes(state.file.bytes) : busy ? "building…" : "—"}
            hint={state.file ? state.file.name : undefined}
          />
        </div>

        {state.failed.length > 0 ? (
          <div className="flex flex-col gap-1 rounded-lg border border-danger/30 bg-danger/5 p-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-danger">Skipped cards</span>
            <ul className="text-sm leading-6 text-muted">
              {state.failed.map((title, index) => (
                <li key={`${title}-${index}`}>{title}</li>
              ))}
            </ul>
            <p className="text-xs leading-5 text-subtle">
              Open each card once so it renders, then export again.
            </p>
          </div>
        ) : null}

        <DialogFooter>
          {busy ? (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel export
            </Button>
          ) : null}
          {state.status === "done" && state.file ? (
            <Button type="button" onClick={() => saveBlobUrl(state.file!.url, state.file!.name)}>
              <Download className="h-4 w-4" aria-hidden />
              Save file
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
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
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-border/60 bg-elevated/30 px-3 py-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{label}</span>
      <span className={cn("truncate font-display text-lg font-semibold tabular-nums", tone === "danger" ? "text-danger" : "text-foreground")}>
        {value}
      </span>
      {hint ? <span className="truncate text-[11px] text-subtle">{hint}</span> : null}
    </div>
  );
}
