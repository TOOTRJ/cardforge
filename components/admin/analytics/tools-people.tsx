import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AdminLoadError } from "@/components/admin/admin-load-error";
import { AnalyticsTable, EmptyNote, TablePanel } from "@/components/admin/analytics/charts";
import { ToolPerson, Words, toolsLinkClass } from "@/components/admin/analytics/tools-parts";
import { analyticsHref, periodLabel, type AnalyticsParams } from "@/lib/admin/analytics/params";
import { formatCount } from "@/lib/admin/analytics/series";
import {
  EVENT_LOG_ANCHOR,
  PEOPLE_ANCHOR,
  TOOL_EVENT_LOG_LIMIT,
  accessWords,
  eventKindWords,
  eventWords,
  pageWindow,
  propPairs,
  type ToolUserLog,
  type ToolUsersPage,
} from "@/lib/admin/analytics/tools-view";
import type { ToolDefinition } from "@/lib/tools/catalog";
import { formatUtcDate, formatUtcDateTime } from "@/lib/format/dates";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// "Which users, how often" — everyone signed in who touched a tool in the
// period (50 a page, most uses first), and ONE person's event log: what
// they did, newest first, with each event's props as plain `key: value`
// text. Props are counts, codes and booleans; they are printed as text and
// never interpreted.
// ---------------------------------------------------------------------------

export function ToolPeople({ params, tool, people }: { params: AnalyticsParams; tool: ToolDefinition; people: ToolUsersPage | null }) {
  return (
    <div id={PEOPLE_ANCHOR} className="scroll-mt-24">
      <TablePanel
        title="Everyone who used it"
        description={`Every signed-in person with anything recorded in ${tool.name} in ${periodLabel(params.days)}: most uses first. Dates are UTC.`}
      >
        {people === null ? (
          <AdminLoadError what={`the people who used ${tool.name}`} />
        ) : people.rows.length === 0 ? (
          <PeopleEmpty params={params} people={people} />
        ) : (
          <>
            <AnalyticsTable
              className="whitespace-nowrap"
              caption={`Everyone who used ${tool.name} in ${periodLabel(params.days)}`}
              columns={[
                "Person",
                <Words key="via">How they got in</Words>,
                "Opens",
                "Uses",
                "Failures",
                "Days active",
                <Words key="first">First seen</Words>,
                <Words key="last">Last seen</Words>,
                <span key="log" className="sr-only">
                  Event log
                </span>,
              ]}
              rows={people.rows.map((row) => ({
                key: row.userId,
                cells: [
                  <ToolPerson key="person" userId={row.userId} username={row.username} isAdmin={row.isAdmin} />,
                  <Words key="via">{accessWords(row.access)}</Words>,
                  formatCount(row.opens),
                  formatCount(row.uses),
                  formatCount(row.failures),
                  formatCount(row.activeDays),
                  <Words key="first">{formatUtcDate(row.firstAt)}</Words>,
                  <Words key="last">{formatUtcDate(row.lastAt)}</Words>,
                  <Link
                    key="log"
                    href={`${analyticsHref(params, { user: row.userId, page: params.page })}#${EVENT_LOG_ANCHOR}`}
                    aria-current={params.user === row.userId ? "true" : undefined}
                    aria-label={`Event log of ${row.username ? `@${row.username}` : "this person"}`}
                    className={cn("font-sans", toolsLinkClass)}
                  >
                    Event log
                  </Link>,
                ],
              }))}
            />
            <Pager params={params} people={people} />
          </>
        )}
      </TablePanel>
    </div>
  );
}

function PeopleEmpty({ params, people }: { params: AnalyticsParams; people: ToolUsersPage }) {
  if (people.total > 0) {
    const { pages } = pageWindow(people.page, people.pageSize, people.total);
    return (
      <EmptyNote>
        No more people: the list ends on page {pages}.{" "}
        <Link href={`${analyticsHref(params, { page: pages })}#${PEOPLE_ANCHOR}`} className={toolsLinkClass}>
          Back to page {pages}
        </Link>
      </EmptyNote>
    );
  }
  return (
    <EmptyNote>
      {params.admins
        ? "Nobody signed in touched it in this period."
        : "Nobody outside the team touched it in this period. Turn on “Include admins” above to count the team's own accounts."}
    </EmptyNote>
  );
}

function Pager({ params, people }: { params: AnalyticsParams; people: ToolUsersPage }) {
  const { from, to, pages } = pageWindow(people.page, people.pageSize, people.total);
  const step = "inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-medium";
  const live = "text-foreground hover:border-border-strong hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60";
  const hrefOf = (page: number) => `${analyticsHref(params, { page })}#${PEOPLE_ANCHOR}`;
  return (
    <nav aria-label="People, by page" className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <span className="text-xs text-muted">
        Showing {formatCount(from)}–{formatCount(to)} of {formatCount(people.total)}
      </span>
      {pages > 1 ? (
        <div className="flex items-center gap-2">
          {people.page > 1 ? (
            <Link href={hrefOf(people.page - 1)} className={cn(step, live)}>
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Previous
            </Link>
          ) : (
            <span aria-disabled="true" className={cn(step, "text-subtle opacity-60")}>
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Previous
            </span>
          )}
          <span className="text-xs tabular-nums text-muted">
            Page {people.page} of {pages}
          </span>
          {people.page < pages ? (
            <Link href={hrefOf(people.page + 1)} className={cn(step, live)}>
              Next <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          ) : (
            <span aria-disabled="true" className={cn(step, "text-subtle opacity-60")}>
              Next <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </span>
          )}
        </div>
      ) : null}
    </nav>
  );
}

/** One person's newest events of the tool, above the people list. */
export function ToolEventLog({
  params,
  tool,
  userId,
  log,
}: {
  params: AnalyticsParams;
  tool: ToolDefinition;
  userId: string;
  /** null = the read failed. */
  log: ToolUserLog | null;
}) {
  const name = log?.username ? `@${log.username}` : "This person";
  const close = `${analyticsHref(params, { user: null, page: params.page })}#${PEOPLE_ANCHOR}`;
  return (
    <div id={EVENT_LOG_ANCHOR} className="scroll-mt-24">
      <TablePanel
        title={`${name}’s events in ${tool.name}`}
        description={
          <>
            Their newest {TOOL_EVENT_LOG_LIMIT}, newest first, whenever they happened. Times are UTC.{" "}
            <Link href={`/admin/users?u=${userId}`} className={toolsLinkClass}>
              Open their account
            </Link>
            {" · "}
            <Link href={close} className={toolsLinkClass}>
              Close
            </Link>
          </>
        }
      >
        {log === null ? (
          <AdminLoadError what="this person’s events" />
        ) : log.events.length === 0 ? (
          <EmptyNote>Nothing is recorded for this person in {tool.name}.</EmptyNote>
        ) : (
          <AnalyticsTable
            className="whitespace-nowrap"
            caption={`${name}’s events in ${tool.name}, newest first`}
            columns={["When", <Words key="what">What</Words>, <Words key="kind">Kind</Words>, <Words key="details">Details</Words>]}
            rows={log.events.map((event, index) => {
              const pairs = propPairs(event.props);
              return {
                key: `${event.at}/${index}`,
                cells: [
                  formatUtcDateTime(event.at),
                  <Words key="what">
                    <span title={event.event}>{eventWords(event.event)}</span>
                  </Words>,
                  <Words key="kind">{eventKindWords(tool.slug, event.event)}</Words>,
                  <Words key="details" wrap>
                    {pairs.length === 0
                      ? "—"
                      : pairs.map((pair, i) => (
                          <span key={pair.key}>
                            {i > 0 ? " · " : null}
                            <span className="text-subtle">{pair.key}:</span> {pair.value}
                          </span>
                        ))}
                  </Words>,
                ],
              };
            })}
          />
        )}
      </TablePanel>
    </div>
  );
}
