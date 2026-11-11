import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The analytics page's chart pieces and its nav (the 2026-11 analytics
// audit). What they hold so no tab has to: one hue, thin marks, solid
// hairlines, a value at every bar, a table twin with every number, and a
// change that is words and a sign — never colour alone.
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: (props: { href: string; children: React.ReactNode; scroll?: boolean }) => {
    const rest: Record<string, unknown> = { ...props };
    delete rest.scroll;
    return <a {...rest} />;
  },
}));

import { DailyColumns, DailyTable, KpiTile, RankedBars, RankedTable } from "@/components/admin/analytics/charts";
import { AnalyticsNav } from "@/components/admin/analytics/analytics-nav";
import { ANALYTICS_TABS, type AnalyticsParams } from "@/lib/admin/analytics/params";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const points = [
  { day: "2026-11-09", value: 0 },
  { day: "2026-11-10", value: 12 },
  { day: "2026-11-11", value: 3 },
];
const base: AnalyticsParams = { tab: "overview", days: 30, admins: false, tool: null, user: null, page: 1 };

describe("DailyColumns", () => {
  const out = html(<DailyColumns points={points} unit={["signup", "signups"]} />);

  it("draws one column a day in the one chart hue, a quiet day as no bar", () => {
    expect(out.match(/bg-chart-1/g)).toHaveLength(3);
    expect(out).toContain("height:0");
    expect(out).not.toMatch(/bg-chart-2|bg-mana|bg-gold|bg-danger/);
  });

  it("keeps marks thin and the grid a solid hairline (never dashed)", () => {
    expect(out).toContain("max-w-6");
    expect(out).toContain("rounded-t-[4px]");
    expect(out).not.toContain("border-dashed");
  });

  it("says the value first in its tooltip, with the right word for one and for many", () => {
    expect(out).toMatch(/12 signups<\/p><p[^>]*>Nov 10/);
    expect(html(<DailyColumns points={[{ day: "2026-11-11", value: 1 }]} unit={["signup", "signups"]} />)).toContain("1 signup<");
  });

  it("an empty period is a sentence, not an empty plot", () => {
    expect(html(<DailyColumns points={points.map((p) => ({ ...p, value: 0 }))} unit={["signup", "signups"]} />)).toContain("No signups in this period.");
    expect(html(<DailyColumns points={[]} unit={["signup", "signups"]} />)).toContain("No signups in this period.");
  });

  it("its table twin holds every day that has a number, newest first", () => {
    const table = html(<DailyTable points={points} caption="Signups per day" column="Signups" />);
    expect(table).toMatch(/<caption[^>]*>Signups per day<\/caption>/);
    expect(table.indexOf("Nov 11")).toBeLessThan(table.indexOf("Nov 10"));
    expect(table).not.toContain("Nov 9");
    expect(table).toMatch(/>12</);
  });
});

describe("RankedBars", () => {
  const rows = [
    { key: "signup", label: "Signed up", value: 174, note: "100% of signups" },
    { key: "first", label: "Saved a first card", value: 109, note: "63% of signups" },
    { key: "paid", label: "Started paying", value: 0, note: "0% of signups" },
  ];
  const out = html(<RankedBars rows={rows} />);

  it("prints the value and its note at every bar — nothing is read from hovering", () => {
    expect(out).toContain("174");
    expect(out).toContain("63% of signups");
    expect(out).toContain("Saved a first card");
  });

  it("keeps the order it is given (a funnel's own), in one hue, the largest bar full width and a zero as no bar", () => {
    expect(out.indexOf("Signed up")).toBeLessThan(out.indexOf("Saved a first card"));
    expect(out.match(/bg-chart-1/g)).toHaveLength(3);
    expect(out).toContain("width:max(2px, 100%)");
    expect(out).toContain("width:0");
  });

  it("has a table twin, and a sentence when there is nothing", () => {
    expect(html(<RankedTable rows={rows} caption="From signup to paying" columns={["Step", "People", "Share"]} />)).toMatch(/<th[^>]*>Share<\/th>/);
    expect(html(<RankedBars rows={[]} empty="No failures in this period." />)).toContain("No failures in this period.");
  });
});

describe("KpiTile", () => {
  it("shows the value and how it compares, in words and a sign", () => {
    const out = html(<KpiTile label="Signups" value="174" current={174} previous={120} previousLabel="the previous 30 days" />);
    expect(out).toContain("Signups");
    expect(out).toContain("174");
    expect(out).toContain("+45%");
    expect(out).toContain("vs the previous 30 days");
    expect(out).toContain("(120)");
  });

  it("a fall where falling is bad is marked — and still says so in text", () => {
    const out = html(<KpiTile label="Signups" value="60" current={60} previous={120} previousLabel="the previous 30 days" />);
    expect(out).toContain("−50%");
    expect(out).toContain("text-danger");
    const refunds = html(<KpiTile label="Refunded" value="$0.00" current={0} previous={500} upIsGood={false} />);
    expect(refunds).not.toContain("text-danger");
  });

  it("with nothing to compare it is just the number", () => {
    const out = html(<KpiTile label="All time" value="$4,200.00" />);
    expect(out).not.toContain("vs");
  });

  it("the big number is not set in tabular figures or the display face", () => {
    const out = html(<KpiTile label="Signups" value="121" />);
    expect(out).not.toMatch(/<dd class="[^"]*(tabular-nums|font-display)[^"]*">121/);
  });
});

describe("AnalyticsNav", () => {
  it("links every tab, marks the open one, and carries the period and the switch along", () => {
    const out = html(<AnalyticsNav params={{ ...base, tab: "funnel", days: 90, admins: true }} />);
    for (const tab of ANALYTICS_TABS) expect(out).toContain(`>${tab.label}</a>`);
    expect(out).toMatch(/href="\/admin\/analytics\?tab=funnel&amp;days=90&amp;admins=1"[^>]*aria-current="page"/);
    expect(out).toContain('href="/admin/analytics?tab=tools&amp;days=90&amp;admins=1"');
  });

  it("offers 7, 30 and 90 days in one row above everything it scopes", () => {
    const out = html(<AnalyticsNav params={base} />);
    expect(out).toContain('aria-label="Period"');
    expect(out).toContain('href="/admin/analytics?days=7"');
    expect(out).toContain('href="/admin/analytics?days=90"');
    expect(out).toMatch(/href="\/admin\/analytics"[^>]*aria-current="page"[^>]*>30 days/);
  });

  it("the admin filter is a link that says its state and what pressing it does, only on the tabs it changes", () => {
    // A link, not role=switch: it navigates, and a switch that does not answer Space is a lie.
    const off = html(<AnalyticsNav params={base} />);
    expect(off).not.toContain('role="switch"');
    expect(off).toMatch(/href="\/admin\/analytics\?admins=1" aria-label="Include admins: off\. Count the team&#x27;s own accounts too"/);
    expect(off).toContain("The team&#x27;s own accounts are left out.");
    const on = html(<AnalyticsNav params={{ ...base, admins: true }} />);
    expect(on).toMatch(/href="\/admin\/analytics" aria-label="Include admins: on\. Leave the team&#x27;s own accounts out"/);
    const revenue = html(<AnalyticsNav params={{ ...base, tab: "revenue" }} />);
    expect(revenue).not.toContain("Include admins");
    expect(revenue).toContain("This tab counts everyone.");
  });
});

describe("the page", () => {
  const page = readFileSync("app/(app)/admin/analytics/page.tsx", "utf8");

  it("is an admin's only, never indexed, and renders exactly one tab — so only the open tab's queries run", () => {
    expect(page).toMatch(/if \(!profile\?\.is_admin\) notFound\(\);\s+if \(!isAdminConfigured\(\)\) notFound\(\);/);
    expect(page).toContain("robots: { index: false, follow: false }");
    expect(page).toContain("const Tab = TABS[params.tab];");
    expect(page.match(/<Tab params=\{params\} \/>/g)).toHaveLength(1);
    // No tab's data is read by the page itself.
    expect(page).not.toMatch(/createAdminClient|\.rpc\(|await get(?!CurrentProfile)[A-Z]/);
  });

  it("has a tab component for every tab in the list", () => {
    const files = readdirSync(join("components", "admin", "analytics", "tabs"));
    for (const tab of ANALYTICS_TABS) expect(files).toContain(`${tab.id}-tab.tsx`);
  });

  it("is in the admin menu, after Users (the drawer's Admin link stays the Users page)", () => {
    const config = readFileSync("lib/site-config.ts", "utf8");
    expect(config).toMatch(/\{ label: "Users", href: "\/admin\/users" \},\s+\{ label: "Analytics", href: "\/admin\/analytics" \},/);
  });
});
