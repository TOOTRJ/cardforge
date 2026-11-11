import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const db = vi.hoisted(() => ({
  calls: [] as Array<[string, Record<string, unknown>]>,
  answer: (() => ({ data: [], error: null })) as (args: Record<string, unknown>) => { data: unknown; error: { message: string } | null },
  admin: true,
}));

vi.mock("@/lib/admin/users-queries", () => ({
  requireAdminClient: async () =>
    db.admin
      ? {
          rpc: async (name: string, args: Record<string, unknown>) => {
            db.calls.push([name, args]);
            return db.answer(args);
          },
        }
      : null,
}));

import { getCreditGrantStats, labelCreditGrants } from "@/lib/admin/credit-grant-stats";
import { CreditGrantsPanel } from "@/components/admin/credit-grants-panel";

beforeEach(() => {
  db.calls = [];
  db.answer = () => ({ data: [], error: null });
  db.admin = true;
});

describe("credits granted by reason (admin)", () => {
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

  it("a refund is a charge given back, not a grant: it is left out (the tab counts refunds on their own)", () => {
    expect(
      labelCreditGrants([
        { reason: "refund", credits: 40, grants: 40 },
        { reason: "pack_purchase", credits: 30, grants: 1 },
        // A pack's credits handed back after a dispute was won ARE a grant.
        { reason: "pack_refund_reversed", credits: 10, grants: 1 },
      ]).map((row) => row.reason),
    ).toEqual(["pack_purchase", "pack_refund_reversed"]);
  });

  it("asks for the period (since its start) and all time, with the admin switch on both", async () => {
    db.answer = (args) => ({
      data: args.p_since
        ? [{ reason: "plan_credits_once", credits: 60, grants: 1 }]
        : [
            { reason: "plan_credits_once", credits: 300, grants: 4 },
            { reason: "refund", credits: 9, grants: 9 },
          ],
      error: null,
    });
    const since = new Date("2026-10-12T00:00:00Z");
    const stats = await getCreditGrantStats({ since, includeAdmins: true });
    expect(db.calls).toEqual([
      ["admin_credit_grant_stats", { p_since: "2026-10-12T00:00:00.000Z", p_include_admins: true }],
      ["admin_credit_grant_stats", { p_since: null, p_include_admins: true }],
    ]);
    expect(stats).toEqual({
      period: [{ reason: "plan_credits_once", label: "Plan credits", credits: 60, grants: 1 }],
      allTime: [{ reason: "plan_credits_once", label: "Plan credits", credits: 300, grants: 4 }],
    });
  });

  it("leaves admins out unless asked, and reads the last 30 days when no period is named", async () => {
    const before = Date.now();
    await getCreditGrantStats();
    const [[, period], [, all]] = db.calls;
    expect(period.p_include_admins).toBe(false);
    expect(all).toEqual({ p_since: null, p_include_admins: false });
    const since = Date.parse(String(period.p_since));
    expect(before - since).toBeGreaterThanOrEqual(30 * 86_400_000 - 1000);
    expect(before - since).toBeLessThanOrEqual(30 * 86_400_000 + 1000);
  });

  it("a read that fails is no stats at all (the tab says it could not load) — and a non-admin gets none", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    db.answer = (args) => (args.p_since ? { data: [], error: null } : { data: null, error: { message: "statement timeout" } });
    expect(await getCreditGrantStats({ since: new Date() })).toBeNull();
    expect(logged).toHaveBeenCalled();
    db.admin = false;
    db.answer = () => ({ data: [], error: null });
    expect(await getCreditGrantStats()).toBeNull();
    logged.mockRestore();
  });

  it("the panel prints each reason with its period and all-time credits and grants, the period's largest first, and a total", () => {
    const html = renderToStaticMarkup(
      createElement(CreditGrantsPanel, {
        days: 7,
        stats: {
          period: [
            { reason: "plan_credits_once", label: "Plan credits", credits: 180, grants: 2 },
            { reason: "signup_grant", label: "Welcome credits", credits: 1250, grants: 250 },
          ],
          allTime: [
            { reason: "subscription_refill", label: "Monthly plan credits", credits: 900, grants: 30 },
            { reason: "plan_credits_once", label: "Plan credits", credits: 300, grants: 4 },
            { reason: "signup_grant", label: "Welcome credits", credits: 5000, grants: 1000 },
          ],
        },
      }),
    );
    const text = html.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");
    expect(html).toContain("Credits granted");
    expect(html).toContain("in the last 7 days and all time");
    expect(text).toContain("|Reason|This period|Grants|All time|Grants, all time|");
    // Thousands are written in full; a reason with nothing in the period shows a dash.
    expect(text).toContain("|Welcome credits|1,250|250|5,000|1,000|");
    expect(text).toContain("|Plan credits|180|2|300|4|");
    expect(text).toContain("|Monthly plan credits|—|—|900|30|");
    expect(text).toContain("|Total|1,430|252|6,200|1,034|");
    expect(text.indexOf("Welcome credits")).toBeLessThan(text.indexOf("|Plan credits|"));
    expect(text.indexOf("|Plan credits|")).toBeLessThan(text.indexOf("Monthly plan credits"));
  });

  it("the panel says so when nothing was ever granted", () => {
    const html = renderToStaticMarkup(createElement(CreditGrantsPanel, { stats: { period: [], allTime: [] } }));
    expect(html).toContain("No credits granted yet.");
    expect(html).toContain("in the last 30 days and all time");
    expect(html).not.toContain("<table");
  });
});
