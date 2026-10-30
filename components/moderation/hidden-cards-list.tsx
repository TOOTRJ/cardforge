"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { adminErrorToast } from "@/lib/admin/admin-toast";
import { Button } from "@/components/ui/button";
import { useRowFocus } from "@/components/creator/use-row-focus";
import { unhideCardAction } from "@/lib/moderation/actions";

// The admin's "Hidden cards" list (migration 0156) and its "Unhide": clears
// the lock and notifies the owner. The card stays PRIVATE — its owner
// decides whether to publish it again. The card's title is plain text: a
// private card's page is its owner's alone (a link would 404 here).
//
// An unhidden row leaves the list at once, and the focus goes to the Unhide
// button of the row that took its place, else the row before, else the
// section's heading (useRowFocus) — never <body>.

export type HiddenCardRow = {
  cardId: string;
  title: string;
  /** "@owner · Hidden from a report · 29 Oct 2026 UTC" */
  detail: string;
};

export function HiddenCardsList({ rows: fromServer, headingId }: { rows: HiddenCardRow[]; headingId: string }) {
  const router = useRouter();
  // Rows unhidden here leave at once; the server's list (after the refresh)
  // agrees, and rows keep their keys, so the focus moved below stays put.
  const [unhidden, setUnhidden] = useState<ReadonlySet<string>>(() => new Set());
  const rows = fromServer.filter((row) => !unhidden.has(row.cardId));
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const focusRow = useRowFocus(rootRef);

  const unhide = (row: HiddenCardRow, index: number) => {
    setBusy(row.cardId);
    startTransition(async () => {
      const result = await unhideCardAction({ cardId: row.cardId });
      setBusy(null);
      if (!result.ok) {
        adminErrorToast("card unhide", result.error);
        return;
      }
      toast.success("Card unhidden. It stays private until its owner publishes it; they've been notified.");
      setUnhidden((current) => new Set(current).add(row.cardId));
      focusRow(index);
      router.refresh();
    });
  };

  return (
    <div ref={rootRef} className="flex flex-col gap-4">
      {/* The fallback focus target once the last row is gone. */}
      <h2
        id={headingId}
        tabIndex={-1}
        data-row-add
        className="font-display text-sm font-semibold uppercase tracking-wider text-subtle focus-visible:outline-none"
      >
        Hidden cards
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No card is held private by moderation.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/40 rounded-md border border-border/60 bg-surface/60">
          {rows.map((row, index) => (
            <li key={row.cardId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium text-foreground">{row.title}</span>
                <span className="text-xs text-muted">{row.detail}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                data-row-remove
                disabled={busy !== null}
                aria-label={`Unhide ${row.title}`}
                onClick={() => unhide(row, index)}
              >
                {busy === row.cardId ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden />
                )}
                Unhide
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
