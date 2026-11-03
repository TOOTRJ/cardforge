"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { History, Lock, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";
import { DECK_TOOL_EVENT, type DeckToolDetail } from "@/components/decks/deck-tool-event";
import { useDeckEditor, type VersionRestoreAnswer } from "@/components/decks/use-deck-editor";
import { listDeckHistoryAction, restoreDeckVersionAction, type DeckHistoryResult } from "@/lib/decks/history-actions";
import { DECK_HISTORY_PLUS_DAYS, type HistoryVersion } from "@/lib/decks/deck-history";
import { DECK_CARDS_HEADING_ID } from "@/lib/decks/deck-view";

// ---------------------------------------------------------------------------
// The deck's change history (TODO DK5.13) — the owner's dialog, opened by the
// toolbar's History or the phone bar's More menu (the "history" deck tool).
//
//   * A list of VERSIONS, newest first (lib/decks/deck-history.ts: a run of
//     changes made together), each with when, what in one line, and its
//     changes under "What changed". The newest is "Current version".
//   * "Restore this version" asks once (the same row turns into Restore /
//     Cancel — the focus moves onto the confirm), then goes through the
//     editor (restoreVersion): it waits behind every edit on its way, the
//     page redraws with the server's rows, and it is one Undo away — the
//     toast's Undo and the toolbar's.
//   * The plan is the server's word (listDeckHistoryAction reads it every
//     time): Pro reads everything, Plus the last 30 days with one line about
//     Pro, free a locked panel with the upgrade button — the session's undo
//     and redo stay everyone's.
//   * Closed, the focus goes back to the control that opened it, else to the
//     Cards heading — never <body>.
// ---------------------------------------------------------------------------

type Load =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; data: Extract<DeckHistoryResult, { ok: true }>; loadingMore?: boolean }
  | { state: "locked" }
  | { state: "error"; message: string };

const formatWhen = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

export function DeckHistoryDialog() {
  const editor = useDeckEditor();
  const upgrade = useUpgradeModal();
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ state: "idle" });
  const [confirming, setConfirming] = useState<number | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const deckId = editor?.deck.id ?? null;

  const read = useCallback(
    async (before?: number) => {
      if (!deckId) return;
      const result = await listDeckHistoryAction(before ? { deckId, before } : { deckId }).catch(() => null);
      setLoad((previous) => {
        if (!result) return { state: "error", message: "Couldn't load this deck's history. Try again in a moment." };
        if (!result.ok) {
          if (result.error === "locked") return { state: "locked" };
          return { state: "error", message: "Couldn't load this deck's history. Try again in a moment." };
        }
        if (before && previous.state === "ready") {
          return { state: "ready", data: { ...result, versions: [...previous.data.versions, ...result.versions], headId: previous.data.headId } };
        }
        return { state: "ready", data: result };
      });
    },
    [deckId],
  );

  useEffect(() => {
    const onTool = (event: Event) => {
      const detail = (event as CustomEvent<DeckToolDetail>).detail;
      if (detail?.tool !== "history") return;
      opener.current = detail.opener ?? null;
      setConfirming(null);
      setLoad({ state: "loading" });
      setOpen(true);
      void read();
    };
    window.addEventListener(DECK_TOOL_EVENT, onTool);
    return () => window.removeEventListener(DECK_TOOL_EVENT, onTool);
  }, [read]);

  if (!editor || !deckId) return null;

  const restore = async (version: HistoryVersion) => {
    const label = `the version of ${formatWhen(version.at)}`;
    setRestoring(version.headId);
    const answer = await editor.restoreVersion({
      changeId: version.headId,
      label,
      write: async (changeId): Promise<VersionRestoreAnswer> => {
        const result = await restoreDeckVersionAction({ deckId, changeId });
        if (!result.ok) return result;
        if (result.notes.length > 0) {
          toast.warning("Restored, with a note.", {
            description: result.notes.slice(0, 3).join(" ") + (result.notes.length > 3 ? ` …and ${result.notes.length - 3} more.` : ""),
          });
        }
        return { ok: true, headBefore: result.headBefore, said: restoredWords(label, result) };
      },
    });
    setRestoring(null);
    if (!answer.ok) return;
    setOpen(false);
    toast(answer.said, {
      duration: 8000,
      action: { label: "Undo", onClick: () => editor.undo() },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && setOpen(false)}>
      <DialogContent
        size="md"
        onCloseAutoFocus={(event) => {
          const from = opener.current;
          opener.current = null;
          event.preventDefault();
          if (from?.isConnected) from.focus();
          else document.getElementById(DECK_CARDS_HEADING_ID)?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-accent" aria-hidden />
            Deck history
          </DialogTitle>
          <DialogDescription>Every change to this deck&rsquo;s cards, newest first. Restore any version — it can be undone.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" aria-busy={load.state === "loading" || undefined}>
          {load.state === "loading" || load.state === "idle" ? (
            <p className="py-6 text-sm text-muted" role="status">
              Loading the history…
            </p>
          ) : load.state === "error" ? (
            <p role="alert" className="rounded-md border border-border bg-background/40 px-4 py-3 text-sm text-muted">
              {load.message}
            </p>
          ) : load.state === "locked" ? (
            <div className="flex flex-col items-center gap-3 rounded-card border border-border bg-elevated/60 px-5 py-6 text-center">
              <Lock aria-hidden className="h-5 w-5 text-gold-strong" />
              <p className="text-sm leading-6 text-foreground">
                See every change to this deck and put it back the way it was, in one click.
              </p>
              <p className="text-xs leading-5 text-muted">
                Deck history is part of Plus ({DECK_HISTORY_PLUS_DAYS} days) and Pro (everything). Undo and redo while you edit are free.
              </p>
              <Button size="sm" onClick={() => upgrade.open("deck_history", "deck_history")}>
                See plans
              </Button>
            </div>
          ) : (
            <>
              <p className="mb-3 text-xs text-subtle">
                {load.data.access.kind === "full"
                  ? "Pro keeps every version of this deck."
                  : `Plus keeps the last ${load.data.access.days} days of changes. Pro keeps every version.`}
              </p>
              {load.data.versions.length === 0 ? (
                <p className="py-6 text-sm text-muted">No changes yet — they&rsquo;ll appear here as you edit.</p>
              ) : (
                <ol className="flex flex-col gap-2" aria-label="Versions">
                  {load.data.versions.map((version) => {
                    const current = version.headId === load.data.headId;
                    const when = formatWhen(version.at);
                    return (
                      <li key={version.headId} className="rounded-card border border-border/70 bg-background/40 px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground">{version.summary}</p>
                            <p className="text-xs text-muted">
                              <time dateTime={version.at}>{when}</time>
                              {version.byOwner ? null : " · by PipGlyph"}
                              {current ? (
                                <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] text-primary-bright">Current version</span>
                              ) : null}
                            </p>
                          </div>
                          {current ? null : confirming === version.headId ? (
                            <span className="flex items-center gap-2">
                              <Button
                                size="sm"
                                autoFocus
                                disabled={restoring !== null}
                                aria-label={`Restore the version of ${when}`}
                                onClick={() => void restore(version)}
                              >
                                {restoring === version.headId ? "Restoring…" : "Restore"}
                              </Button>
                              <Button size="sm" variant="ghost" disabled={restoring !== null} onClick={() => setConfirming(null)}>
                                Cancel
                              </Button>
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={restoring !== null}
                              aria-label={`Restore this version — ${when}`}
                              onClick={() => setConfirming(version.headId)}
                            >
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                              Restore this version
                            </Button>
                          )}
                        </div>
                        {confirming === version.headId ? (
                          <p className="mt-2 text-xs text-muted">
                            The deck&rsquo;s cards go back to how they were right after this change. You can undo it.
                          </p>
                        ) : null}
                        {version.count > 1 ? (
                          <details className="mt-2 text-xs text-muted">
                            <summary className="cursor-pointer select-none hover:text-foreground">
                              What changed ({version.count})
                            </summary>
                            <ul className="mt-1 list-disc pl-5">
                              {version.changes.map((change) => (
                                <li key={change.id}>{change.text}</li>
                              ))}
                              {version.count > version.changes.length ? (
                                <li>…and {version.count - version.changes.length} more</li>
                              ) : null}
                            </ul>
                          </details>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              )}
              {load.data.nextBefore ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-3"
                  disabled={load.loadingMore}
                  onClick={() => {
                    setLoad({ ...load, loadingMore: true });
                    void read(load.data.nextBefore!);
                  }}
                >
                  {load.loadingMore ? "Loading…" : "Show older changes"}
                </Button>
              ) : null}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** "Restored the version of 3 Nov 2026, 14:02 — 2 cards back, 1 out." */
export function restoredWords(
  label: string,
  counts: { removed: number; changed: number; restored: number },
): string {
  const cards = (n: number) => `${n} card${n === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (counts.restored > 0) parts.push(`${cards(counts.restored)} back`);
  if (counts.removed > 0) parts.push(`${cards(counts.removed)} out`);
  if (counts.changed > 0) parts.push(`${cards(counts.changed)} changed`);
  const text = `Restored ${label}`;
  return parts.length > 0 ? `${text} — ${parts.join(", ")}.` : `${text}. It already read that way.`;
}
