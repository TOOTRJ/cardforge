import Link from "next/link";
import { Receipt } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { formatMoney } from "@/lib/format/money";
import { formatCalendarDate } from "@/lib/format/dates";
import type { RevenueSummary } from "@/lib/admin/revenue-queries";

const REASON_LABEL: Record<string, string> = {
  subscription_create: "New plan",
  subscription_cycle: "Renewal",
  subscription_update: "Plan change",
  manual: "Manual",
};

const TIER_LABEL: Record<string, string> = { plus: "Plus", pro: "Pro" };

// Money in, from billing_payments (every invoice.paid). Server component:
// the page already runs as an admin.
export function RevenuePanel({ summary }: { summary: RevenueSummary }) {
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
              {formatMoney(summary.last30DaysCents)}
              <span className="ml-1 text-xs font-normal text-muted">
                · {summary.last30DaysCount} payment{summary.last30DaysCount === 1 ? "" : "s"}
              </span>
            </dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-xs uppercase tracking-wider text-subtle">All time</dt>
            <dd className="font-semibold text-foreground">
              {formatMoney(summary.allTimeCents)}
              <span className="ml-1 text-xs font-normal text-muted">
                · {summary.allTimeCount} payment{summary.allTimeCount === 1 ? "" : "s"}
              </span>
            </dd>
          </div>
        </dl>
      </div>
      {summary.recent.length === 0 ? (
        <p className="text-sm text-muted">
          No payments recorded yet. Rows land here on every paid Stripe invoice.
        </p>
      ) : (
        <ul className="divide-y divide-border/40 rounded-lg border border-border/60">
          {summary.recent.map((payment) => (
            <li
              key={payment.invoiceId}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm"
            >
              <span className="text-muted">{formatCalendarDate(payment.paidAt)}</span>
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
              <span className="font-semibold text-foreground">
                {formatMoney(payment.amountCents, payment.currency)}
              </span>
              <span className="text-xs text-muted">
                {REASON_LABEL[payment.billingReason ?? ""] ?? payment.billingReason ?? "Payment"}
                {payment.tier ? ` · ${TIER_LABEL[payment.tier] ?? payment.tier}` : ""}
                {payment.interval ? ` / ${payment.interval}` : ""}
              </span>
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
          ))}
        </ul>
      )}
    </SurfaceCard>
  );
}
