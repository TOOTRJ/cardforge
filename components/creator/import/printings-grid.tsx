"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChipGroup } from "@/components/ui/chip-group";
import {
  PRINTING_VIEW_LABELS,
  PRINTING_VIEW_VALUES,
  printingTreatmentBadge,
  type PrintingMatch,
  type PrintingSummary,
  type PrintingView,
} from "@/lib/scryfall/printing-views";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The printings grid (TODO 1.5): every printing of a card as a tile —
// thumbnail, SET · year · #number, artist, whether PipGlyph has its exact
// frame (✓ Exact · ≈ Nearest · ✕ Not available) and its treatment — with the
// treatment filter chips above and "Load more" below. The import dialog uses
// it; the Art panel's "Use art from a real card" (1.15) reuses it with
// `showStatus={false}`. The grid scrolls in its own box, so picking a
// printing never loses the user's place.
// ---------------------------------------------------------------------------

const STATUS_COPY: Record<PrintingMatch["status"], { glyph: string; label: string; className: string }> = {
  exact: {
    glyph: "✓",
    label: "Exact",
    className: "border-primary/40 bg-primary/15 text-primary-bright",
  },
  nearest: {
    glyph: "≈",
    label: "Nearest",
    className: "border-gold/45 bg-gold/10 text-gold-strong",
  },
  unsupported: {
    glyph: "✕",
    label: "Not available",
    className: "border-danger/40 bg-danger/10 text-danger",
  },
};

/** The tooltip under a status badge: what the printing is, and why it
 *  isn't exact. */
export function printingStatusTitle(match: PrintingMatch): string {
  return match.reason ? `${match.exactLabel} — ${match.reason}` : match.exactLabel;
}

/** ✓ Exact · ≈ Nearest · ✕ Not available. A substitute card (reject) is
 *  "Not available" whatever its status. */
export function PrintingStatusBadge({
  match,
  className,
}: {
  match: PrintingMatch;
  className?: string;
}) {
  const copy = STATUS_COPY[match.reject ? "unsupported" : match.status];
  return (
    <span
      title={printingStatusTitle(match)}
      data-status={match.reject ? "unsupported" : match.status}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border px-1.5 text-[10px] font-semibold leading-4",
        copy.className,
        className,
      )}
    >
      <span aria-hidden>{copy.glyph}</span> {copy.label}
    </span>
  );
}

export function PrintingFilterChips({
  value,
  onChange,
  disabled = false,
}: {
  value: PrintingView;
  onChange: (next: PrintingView) => void;
  disabled?: boolean;
}) {
  return (
    <ChipGroup
      ariaLabel="Printing filter"
      layout="wrap"
      size="sm"
      value={value}
      onChange={onChange}
      options={PRINTING_VIEW_VALUES.map((view) => ({
        value: view,
        label: PRINTING_VIEW_LABELS[view],
        disabled,
      }))}
    />
  );
}

export type PrintingsGridProps = {
  printings: readonly PrintingSummary[];
  /** The printing shown in the detail pane. */
  activeId: string | null;
  onSelect: (printing: PrintingSummary) => void;
  loading: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  /** Scryfall's count for the view ("30 of 916"). */
  total?: number;
  error?: string | null;
  /** The Exact / Nearest / Not available badge (off for art-only pickers). */
  showStatus?: boolean;
  /** Say so while a clicked printing loads. */
  pendingId?: string | null;
};

export function PrintingsGrid({
  printings,
  activeId,
  onSelect,
  loading,
  loadingMore = false,
  hasMore = false,
  onLoadMore,
  total,
  error = null,
  showStatus = true,
  pendingId = null,
}: PrintingsGridProps) {
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-[11px] text-subtle" role="status">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading printings…
      </p>
    );
  }
  if (printings.length === 0) {
    return (
      <p className="text-[11px] text-subtle" role="status">
        {error ?? "No printings match this filter."}
        {error && onLoadMore ? (
          <>
            {" "}
            <button type="button" onClick={onLoadMore} className="text-primary-bright underline-offset-2 hover:underline">
              Try again
            </button>
          </>
        ) : null}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <ul
        aria-label="Printings"
        className="grid max-h-80 grid-cols-3 gap-1.5 overflow-y-auto rounded-md pr-1 sm:grid-cols-5"
        data-testid="printings-grid"
      >
        {printings.map((p) => {
          const active = p.id === activeId;
          const year = p.released_at?.slice(0, 4) ?? "—";
          const treatment = printingTreatmentBadge(p);
          const where = [
            (p.set ?? "?").toUpperCase(),
            year,
            p.collector_number ? `#${p.collector_number}` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  if (!active) onSelect(p);
                }}
                aria-pressed={active}
                aria-label={`${p.set_name ?? p.set ?? "Unknown set"} ${where}${
                  showStatus && p.match ? `, ${STATUS_COPY[p.match.reject ? "unsupported" : p.match.status].label}` : ""
                }`}
                className={cn(
                  "flex w-full flex-col items-start gap-1 rounded-md border p-1.5 text-left transition-colors",
                  active
                    ? "border-primary bg-primary/15"
                    : "border-border bg-elevated/40 hover:border-border-strong",
                )}
              >
                <span className="relative block w-full">
                  {p.thumb_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.thumb_url}
                      alt=""
                      loading="lazy"
                      className="aspect-[4/3] w-full rounded-sm border border-border/50 object-cover"
                    />
                  ) : (
                    <span className="block aspect-[4/3] w-full rounded-sm bg-elevated" />
                  )}
                  {pendingId === p.id ? (
                    <span className="absolute inset-0 flex items-center justify-center rounded-sm bg-surface/60">
                      <Loader2 className="h-4 w-4 animate-spin text-foreground" aria-hidden />
                    </span>
                  ) : null}
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground">
                  {where}
                </span>
                {p.artist ? (
                  <span className="w-full truncate text-[10px] text-subtle" title={p.artist}>
                    {p.artist}
                  </span>
                ) : null}
                <span className="flex flex-wrap gap-1">
                  {showStatus && p.match ? <PrintingStatusBadge match={p.match} /> : null}
                  {treatment ? (
                    <span className="inline-flex rounded-full border border-border/70 px-1.5 text-[10px] leading-4 text-muted">
                      {treatment}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-subtle">
          {total && total > printings.length
            ? `${printings.length} of ${total} printings`
            : `${printings.length} ${printings.length === 1 ? "printing" : "printings"}`}
        </span>
        {hasMore && onLoadMore ? (
          <Button type="button" variant="ghost" size="sm" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            Load more
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-[11px] text-danger">{error}</p> : null}
    </div>
  );
}
