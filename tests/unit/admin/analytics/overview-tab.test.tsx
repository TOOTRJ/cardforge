import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The Overview tab of /admin/analytics — the page's front door: the headline
// numbers against the previous period, revenue per currency, signups per
// day, and a line on each of the other tabs.
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: (props: { href: string; children: React.ReactNode; scroll?: boolean }) => {
    const rest: Record<string, unknown> = { ...props };
    delete rest.scroll;
    return <a {...rest} />;
  },
}));

const loader = vi.hoisted(() => ({ getOverviewSummary: vi.fn() }));
vi.mock("@/lib/admin/analytics/overview", () => ({ getOverviewSummary: loader.getOverviewSummary }));
vi.mock("@/lib/admin/users-queries", () => ({ requireAdminClient: async () => null }));

import { OverviewPanel, OverviewTab } from "@/components/admin/analytics/tabs/overview-tab";
import type { OverviewSummary } from "@/lib/admin/analytics/overview";
import { buildSignupsDaily } from "@/lib/admin/funnel-queries";
import { ANALYTICS_TABS, type AnalyticsParams } from "@/lib/admin/analytics/params";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const params: AnalyticsParams = { tab: "overview", days: 30, admins: false, tool: null, user: null, page: 1 };

const summary = (patch: Partial<OverviewSummary> = {}): OverviewSummary => ({
  counts: {
    current: {
      signup: { n: 174, users: 170 },
      first_card_saved: { n: 109, users: 109 },
      trial_started: { n: 12, users: 12 },
      trial_converted: { n: 3, users: 3 },
      card_saved: { n: 1284, users: 96 },
      ai_generation: { n: 310, users: 41 },
      download: { n: 75, users: 30 },
    },
    previous: {
      signup: { n: 120, users: 118 },
      card_saved: { n: 1605, users: 90 },
      ai_generation: { n: 310, users: 50 },
    },
  },
  signups: buildSignupsDaily(
    ["2026-11-08", "2026-11-09", "2026-11-10"],
    [
      { day: "2026-11-08", method: "google", n: 100 },
      { day: "2026-11-10", method: "email", n: 74 },
    ],
  ),
  revenue: [{ currency: "usd", currentCents: 42_000, previousCents: 33_600 }],
  ...patch,
});

describe("OverviewPanel", () => {
  const out = html(<OverviewPanel summary={summary()} params={params} />);
  const words = text(out);

  it("leads with the period's numbers, each against the period before", () => {
    const tiles = out.slice(out.indexOf("<dl"), out.indexOf("</dl>"));
    expect([...tiles.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((m) => m[1])).toEqual([
      "Signups",
      "Activated",
      "Trials started",
      "Trials converted",
      "Cards saved",
      "AI generations",
      "Downloads",
      "Revenue",
    ]);
    const tile = text(tiles);
    expect(tile).toContain("Signups 174 +45% vs the previous 30 days (120)");
    expect(tile).toContain("Cards saved 1,284 −20% vs the previous 30 days (1,605)");
    expect(tile).toContain("AI generations 310 no change vs the previous 30 days (310)");
    expect(tile).toContain("Downloads 75 new vs the previous 30 days (0)");
  });

  it("revenue is money, written as money on both sides, and says what it is and that the admin switch does not move it", () => {
    expect(words).toContain("Revenue $420.00 +25% vs the previous 30 days ($336.00)");
    expect(words).toContain("Money taken, before refunds");
    expect(words).toContain("Counts everyone: the Include admins switch does not change it.");
    // Never the previous figure as a bare count of cents or dollars.
    expect(words).not.toMatch(/\((33,600|33600|336)\)/);
  });

  it("one tile per currency — never two currencies added — each named once there is more than one", () => {
    const two = text(
      html(
        <OverviewPanel
          summary={summary({
            revenue: [
              { currency: "usd", currentCents: 42_000, previousCents: 0 },
              { currency: "eur", currentCents: 900, previousCents: 1800 },
            ],
          })}
          params={params}
        />,
      ),
    );
    expect(two).toContain("Revenue (USD) $420.00 new vs the previous 30 days ($0.00)");
    expect(two).toContain("Revenue (EUR) €9.00 −50% vs the previous 30 days (€18.00)");
    expect(two).not.toContain("$429.00");
  });

  it("charts signups per day, with its table twin", () => {
    expect(out).toContain(">Signups per day</h3>");
    expect(words).toContain("174 new accounts in the last 30 days.");
    expect(out).toMatch(/<caption[^>]*>Signups per day, the last 30 days<\/caption>/);
    expect(out.match(/bg-chart-1/g)).toHaveLength(3);
    expect(out).not.toMatch(/bg-chart-[2-9]/);
  });

  it("links every other tab with a line on what is there, carrying the period and the switch along", () => {
    const wide = html(<OverviewPanel summary={summary()} params={{ ...params, days: 90, admins: true }} />);
    for (const tab of ANALYTICS_TABS.filter((t) => t.id !== "overview")) {
      expect(wide).toContain(`href="/admin/analytics?tab=${tab.id}&amp;days=90&amp;admins=1"`);
      expect(wide).toMatch(new RegExp(`>${tab.label}<svg`));
    }
    expect(wide).not.toContain('href="/admin/analytics?days=90&amp;admins=1"');
    expect(out).toContain('href="/admin/analytics?tab=funnel"');
    expect(words).toContain("How far new accounts get");
    // A line each: six links, six descriptions.
    expect(out.match(/<li class="min-w-0">/g)).toHaveLength(6);
  });

  it("a block whose read failed says so; the others still show", () => {
    const noCounts = html(<OverviewPanel summary={summary({ counts: null })} params={params} />);
    expect(text(noCounts)).toContain("Couldn’t load the headline numbers.");
    expect(text(noCounts)).toContain("Revenue $420.00");
    expect(noCounts).not.toContain(">Signups</dt>");

    const noMoney = html(<OverviewPanel summary={summary({ revenue: null })} params={params} />);
    expect(text(noMoney)).toContain("Couldn’t load the revenue.");
    expect(noMoney).not.toContain(">Revenue</dt>");
    expect(text(noMoney)).toContain("Signups 174");

    const noDaily = html(<OverviewPanel summary={summary({ signups: null })} params={params} />);
    expect(text(noDaily)).toContain("Couldn’t load the signups per day.");

    const nothing = html(<OverviewPanel summary={{ counts: null, signups: null, revenue: null }} params={params} />);
    expect(nothing).not.toContain("<dl");
    expect(nothing.match(/role="alert"/g)).toHaveLength(3);
    // The way on to the other tabs is always there.
    expect(nothing).toContain('href="/admin/analytics?tab=revenue"');
  });
});

describe("OverviewTab", () => {
  beforeEach(() => loader.getOverviewSummary.mockReset());

  it("reads the page's period with the page's switch", async () => {
    loader.getOverviewSummary.mockResolvedValue(summary());
    const out = html(await OverviewTab({ params: { ...params, days: 7, admins: true } }));
    expect(loader.getOverviewSummary).toHaveBeenCalledTimes(1);
    const [period, includeAdmins] = loader.getOverviewSummary.mock.calls[0];
    expect(period.days).toBe(7);
    expect(period.dayKeys).toHaveLength(7);
    expect(includeAdmins).toBe(true);
    expect(text(out)).toContain("vs the previous 7 days");
  });

  it("no summary at all is one load error, never a blank tab", async () => {
    loader.getOverviewSummary.mockResolvedValue(null);
    const out = html(await OverviewTab({ params }));
    expect(out).toContain('role="alert"');
    expect(text(out)).toContain("Couldn’t load the overview.");
  });
});
