import Link from "next/link";
import { ArrowDown, BadgeCheck, ExternalLink, Hammer, ListOrdered, type LucideIcon } from "lucide-react";
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
import {
  FRAME_REQUEST_CAUSE_LABELS,
  type FrameRequestArtFlag,
} from "@/lib/frames/frame-requests";

// ---------------------------------------------------------------------------
// /admin/frame-requests (TODO 1.6): every import PipGlyph couldn't reproduce
// exactly, per frame signature + set, in two groups (owner decision D1,
// 2026-09-29): "Missing frames" — the registry has no exact frame, so build
// it (frames plan 4.7 / 4.11) — and "Not yet verified" — the exact frame
// exists but isn't verified in the card's colour, so verify it. Each is
// sorted by distinct users, then requests (D4). A row whose signature isn't
// a registry key is flagged (D6). Families PipGlyph will never build
// (posters, The Zeta Set, substitute and art cards) sit collapsed at the
// bottom: no count changes their answer. Server component.
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

const NOT_IN_REGISTRY_TITLE =
  "No rule in lib/scryfall/frame-signatures.ts has this key: a renamed or removed rule, or a row written straight through the RPC with an invented key. It no longer groups with new imports.";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function FrameRequestsPanel({
  summary,
  now,
}: {
  summary: FrameRequestSummary;
  /** Fixed clock for tests; the page leaves it to Date.now(). */
  now?: number;
}) {
  // A row whose missing piece its frame draws now (a crown or two-colour
  // frame logged before 4.6a / 4.6b) is answered: the same printing imports
  // exact today. It is listed apart, never as open.
  const open = summary.rows.filter((row) => !row.forGood && !row.drawnNow);
  const drawnNow = summary.rows.filter((row) => !row.forGood && row.drawnNow);
  const forGood = summary.rows.filter((row) => row.forGood);
  const missing = open.filter((row) => row.cause === "missing");
  const unverified = open.filter((row) => row.cause === "unverified");
  const unknown = summary.rows.filter((row) => !row.inRegistry).length;

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
        <span className="text-xs text-muted">Most distinct users first, then most requests</span>
      </div>

      {summary.error ? (
        <p role="status" className="rounded-lg border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-gold-strong">
          {summary.error}
        </p>
      ) : null}

      {unknown > 0 ? (
        <p className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {`${plural(unknown, "row")} ${unknown === 1 ? "carries a signature" : "carry signatures"} the registry doesn’t know — flagged “not in registry” below.`}
        </p>
      ) : null}

      {summary.rows.length === 0 ? (
        <SurfaceCard className="p-4">
          <EmptyState
            icon={ListOrdered}
            title="No requests in this window"
            description="An import whose printing PipGlyph can't reproduce exactly shows up here."
          />
        </SurfaceCard>
      ) : (
        <>
          <RequestGroup
            id="missing-frames"
            icon={Hammer}
            title={FRAME_REQUEST_CAUSE_LABELS.missing}
            noun="missing frame"
            description={
              <>
                The registry&rsquo;s nearest or unsupported answer: PipGlyph has no frame for these
                printings yet. Build from the top.
              </>
            }
            rows={missing}
            now={now}
          />
          <RequestGroup
            id="not-yet-verified"
            icon={BadgeCheck}
            title={FRAME_REQUEST_CAUSE_LABELS.unverified}
            noun="unverified frame"
            description={
              <>
                The registry names an exact frame, but it isn&rsquo;t verified in the card&rsquo;s
                colour yet, so these imports landed on the nearest one. Verify it in{" "}
                <Link
                  href="/admin/frame-compare"
                  className="text-primary-bright underline-offset-2 hover:underline"
                >
                  Frame compare
                </Link>{" "}
                and the next import is exact.
              </>
            }
            rows={unverified}
            now={now}
          />
        </>
      )}

      {drawnNow.length > 0 ? (
        <details className="group rounded-lg border border-border/60 bg-background/40" data-testid="drawn-now">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-muted hover:text-foreground">
            Drawn since they were logged ({drawnNow.reduce((sum, row) => sum + row.count, 0)} requests,{" "}
            {drawnNow.length} row{drawnNow.length === 1 ? "" : "s"}) — the frame they landed on draws the
            missing piece now, so these printings import exact
          </summary>
          <RequestTable rows={drawnNow} now={now} caption="Requests PipGlyph has answered since" />
        </details>
      ) : null}

      {forGood.length > 0 ? (
        <details className="group rounded-lg border border-border/60 bg-background/40">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-muted hover:text-foreground">
            Unsupported for good ({forGood.reduce((sum, row) => sum + row.count, 0)} requests,{" "}
            {forGood.length} row{forGood.length === 1 ? "" : "s"}) — posters, The Zeta Set, substitute
            and art cards
          </summary>
          <RequestTable rows={forGood} now={now} caption="Families PipGlyph won't build" />
        </details>
      ) : null}
    </div>
  );
}

function RequestGroup({
  id,
  icon: Icon,
  title,
  noun,
  description,
  rows,
  now,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  /** "missing frame" → "4 requests for 2 missing frames". */
  noun: string;
  description: React.ReactNode;
  rows: FrameRequestRow[];
  now?: number;
}) {
  const requests = rows.reduce((sum, row) => sum + row.count, 0);
  const signatures = new Set(rows.map((row) => row.signature)).size;
  const headingId = `${id}-heading`;
  return (
    <SurfaceCard as="section" aria-labelledby={headingId} className="p-0">
      <div className="flex flex-col gap-1 px-4 pt-4 pb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-gold-strong" aria-hidden />
            <h2 id={headingId} className="font-display text-base font-semibold text-foreground">
              {title}
            </h2>
          </div>
          <span className="text-xs text-muted">
            {plural(requests, "request")} for {plural(signatures, noun)}
          </span>
        </div>
        <p className="text-sm text-muted">{description}</p>
      </div>
      {rows.length === 0 ? (
        <p className="border-t border-border/40 px-4 py-4 text-sm text-subtle">
          None in this window.
        </p>
      ) : (
        <RequestTable rows={rows} now={now} caption={title} />
      )}
    </SurfaceCard>
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
            <th scope="col" aria-sort="descending" className="px-2 py-2 text-right font-medium">
              <span className="inline-flex items-center gap-0.5">
                <ArrowDown className="h-3 w-3" aria-hidden />
                Users
              </span>
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Requests</th>
            <th scope="col" className="px-2 py-2 font-medium">Last seen</th>
            <th scope="col" className="px-2 py-2 font-medium">Landed on</th>
            <th scope="col" className="px-2 py-2 font-medium">Art</th>
            <th scope="col" className="px-4 py-2 font-medium">Sample</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.signature}|${row.setCode ?? ""}|${row.cause}`}
              data-signature={row.signature}
              data-cause={row.cause}
              className="border-t border-border/40 align-top"
            >
              <td className="px-4 py-2">
                <div className="font-medium text-foreground">{row.label}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-subtle">
                  <code>{row.signature}</code>
                  {row.inRegistry ? null : (
                    <Badge variant="danger" title={NOT_IN_REGISTRY_TITLE} className="whitespace-nowrap">
                      not in registry
                    </Badge>
                  )}
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
              <td className="px-2 py-2 text-right tabular-nums text-foreground">{row.users}</td>
              <td className="px-2 py-2 text-right tabular-nums text-muted">{row.count}</td>
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
