import type { ReactNode } from "react";
import Link from "next/link";
import {
  AnalyticsTable,
  ChartCard,
  DailyColumns,
  DailyTable,
  EmptyNote,
  KpiRow,
  KpiTile,
  RankedBars,
  RankedTable,
  TablePanel,
  type RankedRow,
} from "@/components/admin/analytics/charts";
import { periodLabel, previousPeriodLabel } from "@/lib/admin/analytics/params";
import { formatCount, formatMoney } from "@/lib/admin/analytics/series";
import { formatMoney as formatShortMoney } from "@/lib/format/money";
import { formatUtcDate } from "@/lib/format/dates";
import { isDisputed, type CurrencyRevenue, type RevenueEntry, type RevenueSummary } from "@/lib/admin/revenue-queries";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// /admin/analytics — the Revenue tab's content: money in, from
// billing_payments (every invoice.paid) and billing_pack_payments (every
// paid credit pack), for one period. A plain server component: the tab
// (components/admin/analytics/tabs/revenue-tab.tsx) reads the summary and
// hands it here, so this renders from fixed data in a test.
//
// The rules are lib/admin/revenue-queries.ts's: money taken only, a $0
// trial start listed and never counted, one total per currency, refunds
// beside the totals.
// ---------------------------------------------------------------------------

const REASON_LABEL: Record<string, string> = {
  subscription_create: "New plan",
  subscription_cycle: "Renewal",
  subscription_update: "Plan change",
  manual: "Manual",
};

const TIER_LABEL: Record<string, string> = { plus: "Plus", pro: "Pro" };

const plural = (n: number, word: string) => `${formatCount(n)} ${word}${n === 1 ? "" : "s"}`;

/** "· refunded $6.00" / "· disputed (needs response)" / "· dispute won". */
function moneyBackLabel(payment: RevenueEntry): string {
  const parts: string[] = [];
  if (payment.refundedCents > 0) {
    parts.push(
      `refunded ${formatMoney(payment.refundedCents, payment.currency)}${payment.refundedCents < payment.amountCents ? " (part)" : ""}`,
    );
  }
  if (payment.disputeStatus) {
    parts.push(
      isDisputed(payment)
        ? `disputed (${payment.disputeStatus.replace(/_/g, " ")})`
        : `dispute ${payment.disputeStatus.replace(/_/g, " ")}`,
    );
  }
  return parts.length ? ` · ${parts.join(" · ")}` : "";
}

function entryLabel(payment: RevenueEntry): string {
  if (payment.kind === "trial_start") {
    return `Trial start${payment.tier ? ` · ${TIER_LABEL[payment.tier] ?? payment.tier}` : ""} · not counted`;
  }
  if (payment.kind === "pack" || (payment.kind === "no_charge" && payment.credits != null)) {
    const credits = payment.credits != null ? `${payment.credits} credits` : "Credit pack";
    return `Credit pack · ${credits}${payment.kind === "no_charge" ? " · no charge, not counted" : ""}`;
  }
  const reason = REASON_LABEL[payment.billingReason ?? ""] ?? payment.billingReason ?? "Payment";
  const plan = `${payment.tier ? ` · ${TIER_LABEL[payment.tier] ?? payment.tier}` : ""}${payment.interval ? ` / ${payment.interval}` : ""}`;
  return `${reason}${plan}${payment.kind === "no_charge" ? " · no charge, not counted" : ""}`;
}

/** "$24.00 + €8.00": one amount per currency that has one — never a sum
 *  across currencies. "$0.00" when there is none. */
function moneyList(currencies: CurrencyRevenue[], pick: (c: CurrencyRevenue) => number): string {
  const parts = currencies.filter((c) => pick(c) > 0).map((c) => formatMoney(pick(c), c.currency));
  return parts.length ? parts.join(" + ") : formatMoney(0, currencies[0]?.currency ?? "usd");
}

/** A text cell of a table whose other columns are numbers: left, not mono. */
function Text({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("block text-left font-sans", className)}>{children}</span>;
}

const NO_REVENUE: CurrencyRevenue = {
  currency: "usd",
  cents: 0,
  count: 0,
  previousCents: 0,
  previousCount: 0,
  refundedCents: 0,
  refundedCount: 0,
  packCents: 0,
  packCount: 0,
  previousPackCents: 0,
  previousPackCount: 0,
  allTimeCents: 0,
  allTimeCount: 0,
  allTimeRefundedCents: 0,
  daily: [],
  products: [],
};

function PaymentsTable({ payments }: { payments: RevenueEntry[] }) {
  if (payments.length === 0) return <EmptyNote>No payments in this period.</EmptyNote>;
  return (
    <AnalyticsTable
      caption="Payments in this period, newest first"
      columns={["Paid", <Text key="who">Who</Text>, <Text key="what">What</Text>, "Amount", "Invoice"]}
      rows={payments.map((payment) => {
        const counted = payment.kind === "invoice" || payment.kind === "pack";
        const back = moneyBackLabel(payment);
        return {
          key: `${payment.kind}:${payment.id}`,
          cells: [
            <span key="paid" className="whitespace-nowrap text-muted">
              {formatUtcDate(payment.paidAt, "short")}
            </span>,
            <Text key="who">
              {payment.userId ? (
                <Link href={`/admin/users?u=${payment.userId}`} className="font-medium text-primary-bright hover:underline">
                  {payment.username ? `@${payment.username}` : payment.userId.slice(0, 8)}
                </Link>
              ) : (
                <span className="text-subtle">unlinked customer</span>
              )}
            </Text>,
            <Text key="what" className="min-w-[14rem]">
              {entryLabel(payment)}
              {back ? <span className="text-danger">{back}</span> : null}
            </Text>,
            <span key="amount" className={counted ? "font-semibold text-foreground" : "text-subtle"}>
              {formatMoney(payment.amountCents, payment.currency)}
            </span>,
            payment.hostedInvoiceUrl ? (
              <a
                key="invoice"
                href={payment.hostedInvoiceUrl}
                target="_blank"
                rel="noreferrer"
                className="whitespace-nowrap font-sans font-semibold text-primary-bright underline-offset-4 hover:underline"
              >
                {payment.invoiceNumber ?? "Invoice"}
              </a>
            ) : (
              <span key="invoice" className="whitespace-nowrap text-subtle">
                {payment.invoiceNumber ?? "—"}
              </span>
            ),
          ],
        };
      })}
    />
  );
}

export function RevenuePanel({ summary, days }: { summary: RevenueSummary; days: number }) {
  // A tile per currency that took money in this period or the one before
  // (usually one); a chart per currency that took money in this one.
  const active = summary.currencies.filter((c) => c.cents > 0 || c.previousCents > 0);
  const tiles = active.length ? active : [summary.currencies[0] ?? NO_REVENUE];
  const withRevenue = summary.currencies.filter((c) => c.cents > 0);
  const charts = withRevenue.length ? withRevenue : [tiles[0]];
  const several = charts.length > 1 || tiles.length > 1;
  const of = (c: CurrencyRevenue) => (several ? ` (${c.currency.toUpperCase()})` : "");
  const period = periodLabel(days);
  const previous = previousPeriodLabel(days);
  const refundedCount = summary.currencies.reduce((n, c) => n + c.refundedCount, 0);
  const packCount = summary.currencies.reduce((n, c) => n + c.packCount, 0);
  const previousPackCount = summary.currencies.reduce((n, c) => n + c.previousPackCount, 0);
  const one = tiles.length === 1 ? tiles[0] : null;
  const notListed = summary.entriesTotal - summary.entries.length;

  return (
    <div className="flex flex-col gap-6">
      <KpiRow className="xl:grid-cols-4">
        {tiles.map((c) => (
          <KpiTile
            key={c.currency}
            label={`Revenue${of(c)}`}
            value={formatMoney(c.cents, c.currency)}
            current={c.cents}
            previous={c.previousCents}
            previousLabel={previous}
            // The figures are cents: the period before is written as money too.
            formatPrevious={(cents) => formatMoney(cents, c.currency)}
            hint={
              <>
                {c.refundedCents > 0 ? (
                  <span className="block">{formatMoney(c.cents - c.refundedCents, c.currency)} after refunds.</span>
                ) : null}
                <span className="block">
                  All time: {formatMoney(c.allTimeCents, c.currency)} from {plural(c.allTimeCount, "payment")}
                  {c.allTimeRefundedCents > 0 ? `, ${formatMoney(c.allTimeRefundedCents, c.currency)} of it refunded` : ""}
                </span>
              </>
            }
          />
        ))}
        <KpiTile
          label="Payments"
          value={formatCount(summary.count)}
          current={summary.count}
          previous={summary.previousCount}
          previousLabel={previous}
          hint="Plans and credit packs that took money."
        />
        <KpiTile
          label="Refunded"
          value={moneyList(summary.currencies, (c) => c.refundedCents)}
          hint={
            refundedCount > 0
              ? `Given back on ${formatCount(refundedCount)} of this period's ${plural(summary.count, "payment")}.`
              : "Nothing given back on this period's payments."
          }
        />
        <KpiTile
          label="Pack sales"
          value={moneyList(summary.currencies, (c) => c.packCents)}
          // One currency: money against money. Several: the packs sold, which do add up.
          {...(one
            ? {
                current: one.packCents,
                previous: one.previousPackCents,
                formatPrevious: (cents: number) => formatMoney(cents, one.currency),
              }
            : { current: packCount, previous: previousPackCount })}
          previousLabel={previous}
          hint={`${plural(packCount, "credit pack")} sold.`}
        />
      </KpiRow>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {charts.map((c) => {
          const money = (cents: number) => formatMoney(cents, c.currency);
          return (
            <ChartCard
              key={`daily:${c.currency}`}
              title={`Revenue per day${of(c)}`}
              description={`Money taken on each UTC day of ${period}, before refunds and Stripe's fees.`}
              chart={
                <DailyColumns
                  points={c.daily}
                  unit={["revenue", "revenue"]}
                  // Whole amounts without ".00": the axis has room for "$1,000", not "$1,000.00".
                  formatValue={(cents) => formatShortMoney(cents, c.currency)}
                />
              }
              table={<DailyTable points={c.daily} caption={`Revenue per day${of(c)}`} column="Revenue" formatValue={money} />}
            />
          );
        })}
        {charts.map((c) => {
          const money = (cents: number) => formatMoney(cents, c.currency);
          const rows: RankedRow[] = c.products.map((product) => ({
            key: product.key,
            label: product.label,
            value: product.cents,
            note: plural(product.count, "payment"),
          }));
          return (
            <ChartCard
              key={`products:${c.currency}`}
              title={`What was bought${of(c)}`}
              description={`Each plan and credit pack by the money it took in ${period}, most first.`}
              chart={<RankedBars rows={rows} formatValue={money} empty="Nothing was bought in this period." />}
              table={
                <RankedTable
                  rows={rows}
                  caption={`What was bought${of(c)}`}
                  columns={["What", "Revenue", "Payments"]}
                  formatValue={money}
                />
              }
            />
          );
        })}
      </div>

      <TablePanel
        title="Payments in this period"
        description={
          notListed > 0
            ? `The newest ${formatCount(summary.entries.length)} of ${formatCount(summary.entriesTotal)} in ${period}. The other ${formatCount(notListed)} are older and not listed here; Stripe has every one.`
            : `Every payment and trial start of ${period}, newest first. Dates are UTC.`
        }
      >
        <PaymentsTable payments={summary.entries} />
      </TablePanel>

      <p className="max-w-[80ch] text-xs leading-5 text-muted">
        Revenue is money taken on plans (paid invoices) and credit packs, before Stripe&rsquo;s fees. Refunds are shown beside
        it, never taken off it, and belong to the payment they refund, whenever the refund was made. A $0 trial start is listed
        and never counted
        {summary.trialStarts > 0 ? ` (${formatCount(summary.trialStarts)} in this period)` : ""}.
        {summary.disputed > 0
          ? ` ${plural(summary.disputed, "payment")} of this period ${summary.disputed === 1 ? "is" : "are"} under dispute or lost.`
          : ""}
        {summary.currencies.length > 1 ? " Each currency is totalled on its own." : ""}
        {summary.unpricedPackSales
          ? ` ${plural(summary.unpricedPackSales, "earlier pack sale")} ${summary.unpricedPackSales === 1 ? "isn't" : "aren't"} priced here (sold before packs were logged); Stripe has them.`
          : ""}
      </p>
    </div>
  );
}
