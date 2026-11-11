import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { KpiRow, KpiTile } from "@/components/admin/analytics/charts";
import { formatCount } from "@/lib/admin/analytics/series";
import { analyticsHref, periodLabel, previousPeriodLabel, type AnalyticsParams } from "@/lib/admin/analytics/params";
import { LEDGER_BLIND_TOOLS, peopleText, successRate, type ToolTotals } from "@/lib/admin/analytics/tools-view";

// ---------------------------------------------------------------------------
// Small pieces the Tools tab's views share: a words cell, a person, the six
// headline numbers and the "nothing counted" note.
// ---------------------------------------------------------------------------

/** The three words every number on the tab is made of. */
export const TOOL_WORDS =
  "An open is a visit to a tool's page. A use is the tool doing one of its jobs for someone. A failure is a refusal or an error.";

export const toolsLinkClass =
  "rounded-sm font-medium text-primary-bright hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60";

/**
 * A cell or a heading of WORDS in an AnalyticsTable. The table sets every
 * column after the first right, in the number face (a chart's twin is a
 * name and then numbers); a kind, a path or a date reads from the left in
 * the text face.
 */
export function Words({ children, wrap = false }: { children: ReactNode; wrap?: boolean }) {
  return <span className={wrap ? "block min-w-[14rem] whitespace-normal text-left font-sans" : "block text-left font-sans"}>{children}</span>;
}

/** A person: a link to their admin page, with a badge when they are staff. */
export function ToolPerson({ userId, username, isAdmin = false }: { userId: string; username: string | null; isAdmin?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Link href={`/admin/users?u=${userId}`} className={toolsLinkClass}>
        {username ? `@${username}` : "(no username)"}
      </Link>
      {isAdmin ? <Badge variant="gold">Admin</Badge> : null}
    </span>
  );
}

/**
 * The six numbers of the Tools tab, for every tool or for one: people who
 * used it, opens, uses, failures, the success rate and credits spent (the
 * credit ledger's) —
 * each against the period before.
 */
export function ToolKpis({
  days,
  totals,
  previous,
  one,
  slug,
}: {
  days: number;
  totals: ToolTotals;
  previous: ToolTotals;
  one: boolean;
  /** The one tool these are for (so "not known" is said only of a tool the
   *  ledger cannot tell apart, never of a ledger that was not read). */
  slug?: string;
}) {
  const ledgerBlind = one && slug !== undefined && LEDGER_BLIND_TOOLS.includes(slug);
  const previousLabel = previousPeriodLabel(days);
  return (
    <KpiRow>
      <KpiTile
        label={one ? "People who used it" : "People who used a tool"}
        value={formatCount(totals.usingUsers)}
        current={totals.usingUsers}
        previous={previous.usingUsers}
        previousLabel={previousLabel}
        hint={`${peopleText(totals.users)} opened or used ${one ? "it" : "one"}`}
      />
      <KpiTile label="Opens" value={formatCount(totals.opens)} current={totals.opens} previous={previous.opens} previousLabel={previousLabel} />
      <KpiTile label="Uses" value={formatCount(totals.uses)} current={totals.uses} previous={previous.uses} previousLabel={previousLabel} />
      <KpiTile
        label="Failures"
        value={formatCount(totals.failures)}
        current={totals.failures}
        previous={previous.failures}
        previousLabel={previousLabel}
        upIsGood={false}
      />
      <KpiTile
        label="Success rate"
        value={successRate(totals.uses, totals.failures)}
        hint={
          previous.uses + previous.failures > 0
            ? `${successRate(previous.uses, previous.failures)} in ${previousLabel}`
            : "Uses out of uses and failures"
        }
      />
      {/* The credit LEDGER's figure (never an event's price). Null: the
          ledger cannot tell this tool's spending apart, or was not read. */}
      <KpiTile
        label="Credits spent"
        value={totals.credits === null ? "—" : formatCount(totals.credits)}
        current={totals.credits ?? undefined}
        previous={totals.credits === null ? undefined : (previous.credits ?? undefined)}
        previousLabel={previousLabel}
        hint={
          totals.credits === null
            ? ledgerBlind
              ? "Not known: this tool's AI spends under the card creator's reason in the credit ledger."
              : "The credit ledger could not be read."
            : one
              ? "On this tool's AI, from the credit ledger."
              : "On the tools' AI, from the credit ledger. Token Kit's art is not in it: it spends under the card creator's reason."
        }
      />
    </KpiRow>
  );
}

/**
 * "Nothing was counted" — and why that is usually so: the team's own
 * accounts are left out until "Include admins" is on (in beta, most of the
 * activity is the team's).
 */
export function NothingCounted({ params, what }: { params: AnalyticsParams; what: string }) {
  return (
    <p className="rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-sm leading-6 text-muted">
      {params.admins ? (
        <>
          Nobody opened {what} in {periodLabel(params.days)}.
        </>
      ) : (
        <>
          Nobody outside the team opened {what} in {periodLabel(params.days)}. The team&rsquo;s own accounts are left out here:{" "}
          <Link href={analyticsHref(params, { admins: true, page: params.page })} className={toolsLinkClass}>
            turn on &ldquo;Include admins&rdquo;
          </Link>{" "}
          to count them.
        </>
      )}
    </p>
  );
}
