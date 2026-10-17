import Link from "next/link";
import { Receipt } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { formatMoney } from "@/lib/format/money";
import { formatUtcDate } from "@/lib/format/dates";
import {
  REVENUE_ROW_CAP,
  type CurrencyTotal,
  type RevenueEntry,
  type RevenueSummary,
} from "@/lib/admin/revenue-queries";

const REASON_LABEL: Record<string, string> = {
  subscription_create: "New plan",
  subscription_cycle: "Renewal",
  subscription_update: "Plan change",
  manual: "Manual",
};

const TIER_LABEL: Record<string, string> = { plus: "Plus", pro: "Pro" };

/** "$24 + €8.00", one amount per currency — never added across currencies. */
function totalsText(totals: CurrencyTotal[]): string {
  if (totals.length === 0) return formatMoney(0);
  return totals.map((t) => formatMoney(t.cents, t.currency)).join(" + ");
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

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

// Money in, from billing_payments (every invoice.paid) and
// billing_pack_payments (every paid credit pack). Server component: the page
// already runs as an admin.
export function RevenuePanel({ summary }: { summary: RevenueSummary }) {
  const multiCurrency = summary.allTime.length > 1;
  return (
    <SurfaceCard className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-gold-strong" aria-hidden />
          <h2 className="font-display text-base font-semibold text-foreground">Revenue</h2>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div className="flex items-baseline gap-1.5">
            <dt className="text-xs uppercase tracking-wider text-subtle">Last 30 days</dt>
            <dd className="font-semibold text-foreground">
              {totalsText(summary.last30Days)}
              <span className="ml-1 text-xs font-normal text-muted">
                · {plural(summary.last30DaysCount, "payment")}
              </span>
            </dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-xs uppercase tracking-wider text-subtle">
              {summary.allTimeCapped ? `All time (newest ${REVENUE_ROW_CAP.toLocaleString("en-US")} rows)` : "All time"}
            </dt>
            <dd className="font-semibold text-foreground">
              {totalsText(summary.allTime)}
              <span className="ml-1 text-xs font-normal text-muted">
                · {plural(summary.allTimeCount, "payment")}
              </span>
            </dd>
          </div>
        </dl>
      </div>
      <p className="text-xs text-muted">
        Plans (paid invoices) and credit packs, before Stripe fees and refunds.
        {" "}$0 trial starts are listed but not counted
        {summary.trialStarts > 0 ? ` (${summary.trialStarts} so far)` : ""}.
        {multiCurrency ? " Each currency is totalled on its own." : ""}
        {summary.allTimeCapped
          ? ` All time covers the newest ${REVENUE_ROW_CAP.toLocaleString("en-US")} rows of each log only — Stripe has the full history.`
          : ""}
        {summary.unpricedPackSales
          ? ` ${plural(summary.unpricedPackSales, "earlier pack sale")} ${summary.unpricedPackSales === 1 ? "isn't" : "aren't"} priced here (sold before packs were logged) — see Stripe.`
          : ""}
      </p>
      {summary.recent.length === 0 ? (
        <p className="text-sm text-muted">
          No payments recorded yet. Rows land here on every paid Stripe invoice and credit pack.
        </p>
      ) : (
        <ul className="divide-y divide-border/40 rounded-lg border border-border/60">
          {summary.recent.map((payment) => {
            const counted = payment.kind === "invoice" || payment.kind === "pack";
            return (
              <li
                key={`${payment.kind}:${payment.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm"
              >
                <span className="text-muted">{formatUtcDate(payment.paidAt, "long")}</span>
                {payment.userId ? (
                  <Link
                    href={`/admin/users?u=${payment.userId}`}
                    className="font-medium text-primary-bright hover:underline"
                  >
                    {payment.username ? `@${payment.username}` : payment.userId.slice(0, 8)}
                  </Link>
                ) : (
                  <span className="text-subtle">unlinked customer</span>
                )}
                <span className={counted ? "font-semibold text-foreground" : "text-subtle"}>
                  {formatMoney(payment.amountCents, payment.currency)}
                </span>
                <span className="text-xs text-muted">{entryLabel(payment)}</span>
                {payment.hostedInvoiceUrl ? (
                  <a
                    href={payment.hostedInvoiceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto text-xs font-semibold text-primary-bright underline-offset-4 hover:underline"
                  >
                    {payment.invoiceNumber ?? "Invoice"}
                  </a>
                ) : payment.invoiceNumber ? (
                  <span className="ml-auto font-mono text-xs text-subtle">{payment.invoiceNumber}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </SurfaceCard>
  );
}
