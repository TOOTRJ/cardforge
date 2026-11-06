import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { groupCreditGrants, labelCreditGrants } from "@/lib/admin/credit-grant-stats";
import { CreditGrantsPanel } from "@/components/admin/credit-grants-panel";

describe("credits granted by reason (admin)", () => {
  it("groups positive ledger rows by the reason's head, largest first, with the ledger's labels", () => {
    const rows = groupCreditGrants([
      { delta: 60, reason: "plan_credits_once" },
      { delta: 120, reason: "plan_credits_once" },
      { delta: 10, reason: "free_period_bonus" },
      { delta: "30", reason: "pack_purchase" },
      { delta: 25, reason: "admin_grant: thanks for the report" },
      { delta: -1, reason: "generate_random_card" },
      { delta: 0, reason: "refund" },
    ]);
    expect(rows).toEqual([
      { reason: "plan_credits_once", label: "Plan credits", credits: 180, grants: 2 },
      { reason: "pack_purchase", label: "Credit pack", credits: 30, grants: 1 },
      { reason: "admin_grant", label: "Credits added by the PipGlyph team", credits: 25, grants: 1 },
      { reason: "free_period_bonus", label: "Free-period credits", credits: 10, grants: 1 },
    ]);
  });

  it("labels the SQL function's rows (0181: summed and sorted in the database) with the ledger's labels, skipping a bad row", () => {
    expect(
      labelCreditGrants([
        { reason: "plan_credits_once", credits: 180, grants: 2 },
        { reason: "admin_grant", credits: "25", grants: "1" },
        { reason: null, credits: 1, grants: 1 },
        { reason: "pack_purchase", credits: "many", grants: 1 },
      ]),
    ).toEqual([
      { reason: "plan_credits_once", label: "Plan credits", credits: 180, grants: 2 },
      { reason: "admin_grant", label: "Credits added by the PipGlyph team", credits: 25, grants: 1 },
    ]);
  });

  it("the panel prints each reason with its 30-day and all-time totals", () => {
    const html = renderToStaticMarkup(
      createElement(CreditGrantsPanel, {
        stats: {
          last30: [{ reason: "plan_credits_once", label: "Plan credits", credits: 180, grants: 2 }],
          allTime: [
            { reason: "plan_credits_once", label: "Plan credits", credits: 300, grants: 4 },
            { reason: "subscription_refill", label: "Monthly plan credits", credits: 900, grants: 30 },
          ],
        },
      }),
    );
    expect(html).toContain("Credits granted");
    expect(html).toContain("Plan credits");
    expect(html).toContain("180 (2)");
    expect(html).toContain("300 (4)");
    expect(html).toContain("Monthly plan credits");
    expect(html).toContain("900 (30)");
  });
});
