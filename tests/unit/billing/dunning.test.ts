import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DUNNING_GRACE_DAYS, dunningGraceUntil, inDunningGrace } from "@/lib/billing/dunning";

// ---------------------------------------------------------------------------
// The dunning grace (billing audit 2026-11-05, P1-3): a past_due subscription
// keeps its paid perks for DUNNING_GRACE_DAYS from the moment the sync first
// saw the failure. ONE rule in two forms — this module and the SQL helper
// subscription_perks_on() (0174) — held together below.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-11-05T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe("dunningGraceUntil / inDunningGrace", () => {
  it("is 14 days", () => {
    expect(DUNNING_GRACE_DAYS).toBe(14);
  });

  it("a past_due subscription is in grace until 14 days after the failure was first seen", () => {
    const failedAt = hoursAgo(24);
    expect(dunningGraceUntil({ subscription_status: "past_due", payment_failed_at: failedAt }, NOW)).toBe(
      new Date(new Date(failedAt).getTime() + 14 * 86_400_000).toISOString(),
    );
    expect(inDunningGrace({ subscription_status: "past_due", payment_failed_at: hoursAgo(13 * 24 + 23) }, NOW)).toBe(true);
    expect(inDunningGrace({ subscription_status: "past_due", payment_failed_at: hoursAgo(14 * 24 + 1) }, NOW)).toBe(false);
  });

  it("no stamp, no grace — a reader that leaves the column out fails toward free", () => {
    expect(inDunningGrace({ subscription_status: "past_due" }, NOW)).toBe(false);
    expect(inDunningGrace({ subscription_status: "past_due", payment_failed_at: null }, NOW)).toBe(false);
    expect(inDunningGrace({ subscription_status: "past_due", payment_failed_at: "not a date" }, NOW)).toBe(false);
  });

  it("only past_due: unpaid (retries exhausted), incomplete, canceled and active get none", () => {
    for (const status of ["unpaid", "incomplete", "incomplete_expired", "canceled", "active", "trialing", null]) {
      expect(inDunningGrace({ subscription_status: status, payment_failed_at: hoursAgo(1) }, NOW), String(status)).toBe(false);
    }
  });
});

describe("the SQL twin (0174 subscription_perks_on)", () => {
  const dir = join(process.cwd(), "supabase/migrations");
  const file = readdirSync(dir).find((f) => /^\d{4}_dunning_grace_refunds_disputes\.sql$/.test(f));
  const sql = (file ? readFileSync(join(dir, file), "utf8") : "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ");

  it("keeps the same statuses and the same number of days as the module", () => {
    expect(file).toBeDefined();
    expect(sql).toContain("p_status in ('active', 'trialing')");
    expect(sql).toContain(
      `or (p_status = 'past_due' and p_failed_at is not null and p_failed_at > now() - interval '${DUNNING_GRACE_DAYS} days')`,
    );
  });

  it("is what the three SQL perk readers call", () => {
    for (const fn of ["card_capacity_for", "owner_export_stamp", "viewer_is_pro"]) {
      const body = new RegExp(`create or replace function public\\.${fn}\\([\\s\\S]*?\\$\\$;`).exec(sql)?.[0] ?? "";
      expect(body, fn).toContain("public.subscription_perks_on(");
      expect(body, fn).not.toMatch(/subscription_status in \('active', 'trialing'\)/);
    }
  });
});
