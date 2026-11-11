import Link from "next/link";
import { EmptyNote } from "@/components/admin/analytics/charts";
import { ListTable, PersonLink } from "@/components/admin/analytics/list-table";
import { analyticsHref, type AnalyticsParams } from "@/lib/admin/analytics/params";
import {
  pageRangeText,
  referralStandingText,
  rewardedOn,
  tierName,
  type ReferredFriend,
  type ReferredFriendsPage,
} from "@/lib/admin/analytics/referrals";
import { formatCount } from "@/lib/admin/analytics/series";
import { formatUtcDate } from "@/lib/format/dates";

// ---------------------------------------------------------------------------
// WHO WAS REFERRED (owner 2026-11-10: "…also display who was referred along
// with their data"): one row per referral, newest first — the friend, who
// brought them, where the referral stands in plain words, and what the
// friend has done since (cards, plan, the days this referral banked them).
// A page of 50; the pager is two links, so a page can be bookmarked.
// ---------------------------------------------------------------------------

const DASH = "—";
const day = (at: string | null) => (at ? formatUtcDate(at) : DASH);

function cardsCell(row: ReferredFriend): string {
  if (!row.refereeId) return DASH;
  return `${formatCount(row.cards)} · ${formatCount(row.publicCards)} public`;
}

const pagerLink =
  "rounded-md border border-border px-2.5 py-1 font-medium text-foreground hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60";

export function ReferredFriendsTable({
  page,
  params,
  cardsRequired,
}: {
  page: ReferredFriendsPage;
  params: AnalyticsParams;
  /** The program's setting, for "Saved 5 cards". */
  cardsRequired?: number;
}) {
  if (page.rows.length === 0) {
    return page.page > 1 ? (
      <div className="flex flex-col items-center gap-3">
        <EmptyNote>There are no referrals on this page.</EmptyNote>
        <Link href={analyticsHref(params, { page: 1 })} className={`${pagerLink} text-xs`}>
          Back to the first page
        </Link>
      </div>
    ) : (
      <EmptyNote>Nobody has joined through a referral link yet.</EmptyNote>
    );
  }
  const hasPrevious = page.page > 1;
  const hasNext = page.page * page.pageSize < page.total;
  return (
    <div className="flex flex-col gap-3">
      <ListTable
        caption="Referred friends, newest referral first"
        columns={[
          { label: "Friend" },
          { label: "Referred by" },
          { label: "Joined" },
          { label: "Where they are" },
          { label: "Cards" },
          { label: "Last card" },
          { label: "Plan" },
          { label: "Card on file" },
          { label: "Rewarded" },
          { label: "Days banked", kind: "number" },
        ]}
        rows={page.rows.map((row) => ({
          key: row.referralId,
          cells: [
            row.refereeId ? (
              <PersonLink userId={row.refereeId} username={row.refereeUsername} />
            ) : (
              <span className="text-muted">Account deleted</span>
            ),
            <PersonLink key="by" userId={row.referrerId} username={row.referrerUsername} />,
            day(row.refereeJoinedAt ?? row.signedUpAt),
            <span key="where" className="text-foreground">
              {referralStandingText(row.status, row.blockReason, cardsRequired)}
            </span>,
            cardsCell(row),
            day(row.lastCardAt),
            tierName(row.tier) ?? DASH,
            day(row.cardOnFileAt),
            day(rewardedOn(row)),
            formatCount(row.bankedDays),
          ],
        }))}
      />
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <p>{pageRangeText(page)}</p>
        {hasPrevious || hasNext ? (
          <nav aria-label="Referred friends pages" className="flex items-center gap-2">
            {hasPrevious ? (
              <Link href={analyticsHref(params, { page: page.page - 1 })} scroll={false} className={pagerLink}>
                Previous
              </Link>
            ) : null}
            {hasNext ? (
              <Link href={analyticsHref(params, { page: page.page + 1 })} scroll={false} className={pagerLink}>
                Next
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </div>
  );
}
