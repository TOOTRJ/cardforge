import Link from "next/link";
import { ExternalLink, ListOrdered } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatRelativeTime, formatShortDate } from "@/lib/format/dates";
import { cn } from "@/lib/utils";
import {
  FRAME_REQUEST_WINDOWS,
  FRAME_REQUEST_WINDOW_LABELS,
  type FrameRequestRow,
  type FrameRequestSummary,
} from "@/lib/frames/frame-request-queries";
import type { FrameRequestArtFlag } from "@/lib/frames/frame-requests";

// ---------------------------------------------------------------------------
// /admin/frame-requests (TODO 1.6): every import PipGlyph couldn't reproduce
// exactly, per frame signature + set, most requested first — the order the
// missing frames get built in (frames plan 4.7 / 4.11). Families PipGlyph
// will never build (posters, The Zeta Set, substitute cards) sit collapsed
// at the bottom: no count changes their answer. Server component.
// ---------------------------------------------------------------------------

const ART_FLAG_LABEL: Record<FrameRequestArtFlag, string> = {
  "window-cropped": "window-cropped",
  "frame-in-crop": "frame in crop",
};

const ART_FLAG_TITLE: Record<FrameRequestArtFlag, string> = {
  "window-cropped":
    "Scryfall's art is cut to the classic window — too small for an edge-to-edge frame (TODO 1.18)",
  "frame-in-crop":
    "Scryfall's art includes parts of the printed frame (TODO 1.18)",
};

export function FrameRequestsPanel({
  summary,
  now,
}: {
  summary: FrameRequestSummary;
  /** Fixed clock for tests; the page leaves it to Date.now(). */
  now?: number;
}) {
  const open = summary.rows.filter((row) => !row.forGood);
  const forGood = summary.rows.filter((row) => row.forGood);
  const signatures = new Set(open.map((row) => row.signature)).size;
  const openRequests = open.reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Window" className="flex flex-wrap gap-2">
          {FRAME_REQUEST_WINDOWS.map((range) => {
            const active = range === summary.window;
            return (
              <Link
                key={range}
                href={range === "30" ? "/admin/frame-requests" : `/admin/frame-requests?window=${range}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-primary/40 bg-primary/15 text-primary-bright"
                    : "border-border/70 text-muted hover:text-foreground",
                )}
              >
                {FRAME_REQUEST_WINDOW_LABELS[range]}
              </Link>
            );
          })}
        </nav>
        <span className="text-xs text-muted">
          {openRequests} request{openRequests === 1 ? "" : "s"} for {signatures} missing frame
          {signatures === 1 ? "" : "s"}
        </span>
      </div>

      {summary.error ? (
        <p role="status" className="rounded-lg border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-gold-strong">
          {summary.error}
        </p>
      ) : null}

      {open.length === 0 ? (
        <SurfaceCard className="p-4">
          <EmptyState
            icon={ListOrdered}
            title="No requests in this window"
            description="An import whose printing PipGlyph can't reproduce exactly shows up here."
          />
        </SurfaceCard>
      ) : (
        <SurfaceCard className="p-0">
          <RequestTable rows={open} now={now} caption="Most-requested missing frames" />
        </SurfaceCard>
      )}

      {forGood.length > 0 ? (
        <details className="group rounded-lg border border-border/60 bg-background/40">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-muted hover:text-foreground">
            Unsupported for good ({forGood.reduce((sum, row) => sum + row.count, 0)} requests,{" "}
            {forGood.length} row{forGood.length === 1 ? "" : "s"}) — posters, The Zeta Set, substitute cards
          </summary>
          <RequestTable rows={forGood} now={now} caption="Families PipGlyph won't build" />
        </details>
      ) : null}
    </div>
  );
}

function RequestTable({
  rows,
  now,
  caption,
}: {
  rows: FrameRequestRow[];
  now?: number;
  caption: string;
}) {
  return (
    // `relative`: the sr-only spans are absolutely positioned and would
    // otherwise escape the scroller and widen the page on a phone.
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[56rem] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-subtle">
            <th scope="col" className="px-4 py-2 font-medium">Printing is</th>
            <th scope="col" className="px-2 py-2 font-medium">Set</th>
            <th scope="col" className="px-2 py-2 font-medium">Status</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Requests</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Users</th>
            <th scope="col" className="px-2 py-2 font-medium">Last seen</th>
            <th scope="col" className="px-2 py-2 font-medium">Landed on</th>
            <th scope="col" className="px-2 py-2 font-medium">Art</th>
            <th scope="col" className="px-4 py-2 font-medium">Sample</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.signature}|${row.setCode ?? ""}`}
              data-signature={row.signature}
              className="border-t border-border/40 align-top"
            >
              <td className="px-4 py-2">
                <div className="font-medium text-foreground">{row.label}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-subtle">
                  <code>{row.signature}</code>
                  {row.blockedBy ? <span>· TODO {row.blockedBy}</span> : null}
                </div>
              </td>
              <td className="px-2 py-2 font-mono text-xs uppercase text-muted">
                {row.setCode ?? "—"}
              </td>
              <td className="px-2 py-2">
                <Badge variant={row.status === "unsupported" ? "danger" : "gold"}>
                  {row.status}
                </Badge>
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-foreground">{row.count}</td>
              <td className="px-2 py-2 text-right tabular-nums text-muted">{row.users}</td>
              <td className="whitespace-nowrap px-2 py-2 text-muted">
                <time dateTime={row.lastSeen} title={formatShortDate(row.lastSeen)}>
                  {formatRelativeTime(row.lastSeen, now)}
                </time>
              </td>
              <td className="px-2 py-2 text-muted">{row.templateLabel ?? "—"}</td>
              <td className="px-2 py-2">
                {row.artFlags.length === 0 ? (
                  <span className="text-subtle">—</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {row.artFlags.map((flag) => (
                      <Badge
                        key={flag}
                        variant="outline"
                        title={ART_FLAG_TITLE[flag]}
                        className="whitespace-nowrap"
                      >
                        {ART_FLAG_LABEL[flag]}
                      </Badge>
                    ))}
                  </span>
                )}
              </td>
              <td className="px-4 py-2">
                {row.sampleUrl ? (
                  <a
                    href={row.sampleUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 whitespace-nowrap text-primary-bright underline-offset-2 hover:underline"
                  >
                    {(row.setCode ?? "").toUpperCase()} #{row.sampleCollector}
                    <ExternalLink className="h-3 w-3" aria-hidden />
                    <span className="sr-only">(opens Scryfall)</span>
                  </a>
                ) : (
                  <span className="text-subtle">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
