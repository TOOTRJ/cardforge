import { formatUtcDate } from "@/lib/format/dates";
import type { PlanEnding } from "@/lib/billing/plan-ending";

// /admin/users — how a user's pending cancellation reads in the detail
// panel. Dates are UTC and labelled so (an admin reads them from any zone). Pure (a page file can only export the page), so it is unit-tested.

/** The detail panel's four cancellation rows — one decision, unit-tested.
 *  "Cancelled" here means a PENDING cancellation (the plan is still active);
 *  a subscription that has already ended shows as status `canceled`. */
export function cancellationStats(
  ending: PlanEnding | null,
  status: string | null,
): { state: string; endsAt: string; canceledAt: string; billedFirst: string } {
  if (!ending) {
    return {
      state: status === "canceled" ? "ended (no live subscription)" : "none — the plan renews",
      endsAt: "—",
      canceledAt: "—",
      billedFirst: "—",
    };
  }
  return {
    state:
      ending.kind === "trial"
        ? "trial cancelled — still active until it ends, never charged"
        : "cancelled — still active until it ends",
    endsAt: formatUtcDate(ending.endsAt, "long"),
    canceledAt: ending.canceledAt ? formatUtcDate(ending.canceledAt, "long") : "not recorded (resync fills it)",
    billedFirst: ending.billedBeforeAt
      ? `yes — renews ${formatUtcDate(ending.billedBeforeAt, "long")}, then ends later`
      : ending.kind === "trial"
        ? "no — ends with the trial"
        : "no — ends with the paid period",
  };
}
