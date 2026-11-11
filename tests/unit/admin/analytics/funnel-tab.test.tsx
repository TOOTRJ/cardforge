import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The Funnel tab of /admin/analytics, drawn from plain data: the headline
// numbers against the previous period, the cohort chart (the one place a
// share of signups is shown), signups per day and by method, the step tables
// with NO rate column, the row lists scoped to the period, and each trial
// over its own length. A block whose read failed says so.
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: (props: { href: string; children: React.ReactNode; scroll?: boolean }) => {
    const rest: Record<string, unknown> = { ...props };
    delete rest.scroll;
    return <a {...rest} />;
  },
}));

const loader = vi.hoisted(() => ({ getFunnelSummary: vi.fn() }));
vi.mock("@/lib/admin/funnel-queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/funnel-queries")>()),
  getFunnelSummary: loader.getFunnelSummary,
}));

import { FunnelPanel } from "@/components/admin/funnel-panel";
import { FunnelTab } from "@/components/admin/analytics/tabs/funnel-tab";
import { buildCohort, buildScreenWidths, buildSignupsDaily, type FunnelSummary } from "@/lib/admin/funnel-queries";
import type { AnalyticsParams } from "@/lib/admin/analytics/params";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
/** The text of the markup: tags out, entities read. */
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/\s+/g, " ");
/** One titled block of the tab: from its heading to the end of its box. */
const block = (markup: string, title: string) => {
  const start = markup.indexOf(`>${title}</h3>`);
  expect(start).toBeGreaterThan(-1);
  return markup.slice(start, markup.indexOf("</section>", start));
};

const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const summary = (patch: Partial<FunnelSummary> = {}): FunnelSummary => ({
  counts: {
    current: {
      signup: { n: 174, users: 170 },
      first_card_saved: { n: 109, users: 109 },
      trial_started: { n: 12, users: 12 },
      trial_converted: { n: 3, users: 3 },
      pricing_view: { n: 1200, users: 0 },
      checkout_started: { n: 20, users: 18 },
    },
    previous: {
      signup: { n: 120, users: 118 },
      first_card_saved: { n: 109, users: 109 },
      trial_started: { n: 24, users: 24 },
      pricing_view: { n: 800, users: 0 },
    },
  },
  cohort: buildCohort([
    { step: "signup", users: 170 },
    { step: "first_card_saved", users: 107 },
    { step: "first_ai_generation", users: 61 },
    { step: "first_download", users: 40 },
    { step: "trial_started", users: 12 },
    { step: "trial_converted", users: 3 },
  ]),
  signups: buildSignupsDaily(
    ["2026-11-08", "2026-11-09", "2026-11-10"],
    [
      { day: "2026-11-08", method: "google", n: 100 },
      { day: "2026-11-10", method: "email", n: 60 },
      { day: "2026-11-10", method: "not recorded", n: 14 },
    ],
  ),
  signupSources: [
    { source: "reddit.com", n: 90 },
    { source: "not recorded", n: 14 },
  ],
  signupSurfaces: [
    { surface: "home_hero", n: 70 },
    { surface: "none", n: 30 },
  ],
  cancelReasons: [{ reason: "too_expensive", label: "Too expensive", n: 2 }],
  guestCard: { signups: 9, firstCardsSaved: 4 },
  failed: { signups: false, cancellations: false },
  trials: [
    {
      userId: USER,
      username: "tester",
      startedAt: "2026-10-20T12:00:00.000Z",
      endedAt: "2026-11-03T12:00:05.000Z",
      windowDays: 14,
      outcome: "trial_converted",
      activeDays: 6,
      saves: 21,
      generations: 8,
      downloads: 3,
    },
    {
      userId: OTHER,
      username: null,
      startedAt: "2026-11-08T09:00:00.000Z",
      endedAt: null,
      windowDays: 2,
      outcome: "ongoing",
      activeDays: 1,
      saves: 1,
      generations: 0,
      downloads: 0,
    },
  ],
  screenWidths: buildScreenWidths({ "0-639": 30, "1366-1535": 70 }),
  ...patch,
});

describe("FunnelPanel", () => {
  const out = html(<FunnelPanel summary={summary()} days={30} />);
  const words = text(out);

  it("leads with four numbers, each against the previous period of the same length", () => {
    const tiles = out.slice(out.indexOf("<dl"), out.indexOf("</dl>"));
    expect([...tiles.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((m) => m[1])).toEqual(["Signups", "Activated", "Trials started", "Trials converted"]);
    const tile = text(tiles);
    expect(tile).toContain("Signups 174 +45% vs the previous 30 days (120)");
    expect(tile).toContain("Activated 109 no change vs the previous 30 days (109) Saved a first card.");
    expect(tile).toContain("Trials started 12 −50% vs the previous 30 days (24)");
    // From nothing: "new", never a division by zero.
    expect(tile).toContain("Trials converted 3 new vs the previous 30 days (0)");
  });

  it("the cohort follows the people who signed up in the period: each step a share of THEM, in funnel order", () => {
    const cohort = block(out, "From signup to paying — people who signed up in the last 30 days");
    expect(text(cohort)).toContain("This follows the same people");
    expect(text(cohort)).toContain("the later steps can keep growing");
    const order = ["Signed up", "Saved a first card", "Made a first AI generation", "Downloaded a card", "Started a trial", "Trial became a paid plan"];
    for (let i = 1; i < order.length; i += 1) expect(cohort.indexOf(order[i - 1])).toBeLessThan(cohort.indexOf(order[i]));
    expect(cohort).toContain("100% of signups");
    expect(cohort).toContain("63% of signups");
    expect(cohort).toContain("1.8% of signups");
    // The bars share one scale: the cohort itself is the full width.
    expect(cohort).toContain("width:max(2px, 100%)");
    // Its table twin holds every number.
    expect(cohort).toMatch(/<th[^>]*>Step<\/th><th[^>]*>People<\/th><th[^>]*>Share of signups<\/th>/);
    expect(cohort).toMatch(/Saved a first card<\/th><td[^>]*>107<\/td><td[^>]*>63%<\/td>/);
  });

  it("there is no rate column anywhere: a step's events are never divided by the step before's", () => {
    expect(out).not.toMatch(/>Rate\b/);
    expect(words).not.toMatch(/Rate 30d|step-to-step rate/i);
    // 109 first cards beside 174 signups are two counts, side by side — no percentage between them.
    const activation = block(out, "Activation");
    expect(activation).not.toContain("%</td><td");
    expect(activation).toMatch(/<th[^>]*>Step<\/th><th[^>]*>This period<\/th><th[^>]*>People<\/th><th[^>]*>Previous period<\/th><th[^>]*>Change<\/th>/);
    expect(activation).toMatch(/Signups<\/th><td[^>]*>174<\/td><td[^>]*>170<\/td><td[^>]*>120<\/td><td[^>]*>\+45%<\/td>/);
    expect(activation).toMatch(/First card saved<\/th><td[^>]*>109<\/td><td[^>]*>109<\/td><td[^>]*>109<\/td><td[^>]*>no change<\/td>/);
  });

  it("keeps every section of steps, and a step visitors take before they have an account has no people", () => {
    for (const title of ["Activation", "Storefront", "Trials", "Out of credits", "Money", "Leaks", "Decks", "Home create buttons", "Guest creator"]) {
      expect(out).toContain(`>${title}</h3>`);
    }
    expect(block(out, "Storefront")).toMatch(/Pricing views<\/th><td[^>]*>1,200<\/td><td[^>]*>—<\/td><td[^>]*>800<\/td><td[^>]*>\+50%<\/td>/);
  });

  it("charts signups per day and how people signed up — one hue, each with a table twin", () => {
    const daily = block(out, "Signups per day");
    expect(text(daily)).toContain("174 new accounts in the last 30 days.");
    expect(daily).toMatch(/<caption[^>]*>Signups per day, the last 30 days<\/caption>/);
    const methods = block(out, "How people signed up");
    expect(methods.indexOf("Google")).toBeLessThan(methods.indexOf("Email"));
    expect(methods).toContain("57% of signups");
    expect(methods).toMatch(/<th[^>]*>How<\/th><th[^>]*>Signups<\/th><th[^>]*>Share<\/th>/);
    expect(out).not.toMatch(/bg-chart-[2-9]|bg-mana|bg-gold/);
  });

  it("lists where signups came from, the create buttons, guest cards and cancellation reasons for the period", () => {
    expect(block(out, "Signups by source")).toMatch(/reddit\.com<\/th><td[^>]*>90<\/td>/);
    expect(block(out, "Signups by source")).toMatch(/not recorded<\/th><td[^>]*>14<\/td>/);
    expect(block(out, "Signups by last create button pressed")).toMatch(/No tracked button<\/th><td[^>]*>30<\/td>/);
    const guest = block(out, "Guest creator cards");
    expect(guest).toMatch(/Signups with a guest card waiting<\/th><td[^>]*>9<\/td>/);
    expect(guest).toMatch(/First cards saved from a guest card<\/th><td[^>]*>4<\/td>/);
    expect(block(out, "Cancellations by reason")).toMatch(/Too expensive<\/th><td[^>]*>2<\/td>/);
    expect(words).toContain("Plans that ended in the last 30 days");
    expect(words).not.toMatch(/· 30d|last 30d/);
  });

  it("measures each trial over its own length, and links each person to their admin page", () => {
    const trials = block(out, "Trial engagement");
    expect(text(trials)).toContain("Each one is measured over its own length");
    expect(trials).toMatch(
      /<th[^>]*>User<\/th><th[^>]*>Started<\/th><th[^>]*>Ended<\/th><th[^>]*>Days measured<\/th><th[^>]*>Outcome<\/th><th[^>]*>Active days<\/th><th[^>]*>Saves<\/th><th[^>]*>AI generations<\/th><th[^>]*>Downloads<\/th>/,
    );
    expect(trials).toContain(`href="/admin/users?u=${USER}"`);
    expect(trials).toContain(">@tester</a>");
    // No handle: the start of the id, still a link.
    expect(trials).toMatch(new RegExp(`href="/admin/users\\?u=${OTHER}"[^>]*>cccccccc</a>`));
    const rows = [...trials.matchAll(/<tr class="border-b border-border\/50[^"]*">(.*?)<\/tr>/g)].map((m) => text(m[1]).trim());
    expect(rows).toEqual([
      "@tester Oct 20, 2026 UTC Nov 3, 2026 UTC 14 Converted to paid 6 21 8 3",
      "cccccccc Nov 8, 2026 UTC still running 2 Still running 1 1 0 0",
    ]);
  });

  it("a trial whose end was never recorded says so — never a made-up date", () => {
    const stale = summary({ trials: [{ ...summary().trials![1], outcome: "unknown", windowDays: 60 }] });
    const trials = text(block(html(<FunnelPanel summary={stale} days={90} />), "Trial engagement"));
    expect(trials).toContain("not recorded 60 End not recorded");
    expect(trials).toContain("Trials that started in the last 90 days");
  });

  it("an empty period reads as sentences, not empty tables or a chart of zero bars", () => {
    const empty = html(
      <FunnelPanel
        summary={summary({
          counts: { current: {}, previous: {} },
          cohort: buildCohort([]),
          signups: buildSignupsDaily(["2026-11-10"], []),
          signupSources: [],
          signupSurfaces: [],
          cancelReasons: [],
          guestCard: { signups: 0, firstCardsSaved: 0 },
          trials: [],
          screenWidths: buildScreenWidths({}),
        })}
        days={7}
      />,
    );
    const said = text(empty);
    expect(said).toContain("Nobody signed up in this period.");
    expect(said).toContain("No signups in this period.");
    expect(said).toContain("No trial started in this period.");
    expect(said).toContain("No plan ended in this period.");
    expect(said).toContain("No screen widths recorded in this period.");
    expect(said).toContain("Signups 0 no change vs the previous 7 days (0)");
    expect(empty).not.toContain("NaN");
    expect(empty).not.toContain('role="alert"');
  });

  it("a read that failed says so in its own block — never zeros, never an empty list — and the rest still shows", () => {
    const broken = html(
      <FunnelPanel
        summary={summary({
          counts: null,
          cohort: null,
          signups: null,
          trials: null,
          screenWidths: null,
          signupSources: [],
          signupSurfaces: [],
          cancelReasons: [],
          guestCard: { signups: 0, firstCardsSaved: null },
          failed: { signups: true, cancellations: true },
        })}
        days={30}
      />,
    );
    const said = text(broken);
    for (const what of [
      "the headline numbers",
      "how far new accounts have come",
      "the signups per day",
      "the step counts",
      "the signups by source",
      "the signups by create button",
      "the guest creator cards",
      "the trials",
      "the cancellations by reason",
      "the screen widths",
    ]) {
      expect(said).toContain(`Couldn’t load ${what}.`);
    }
    expect(said).not.toContain("No signups in this period.");
    expect(said).not.toContain("No plan ended in this period.");
    expect(broken).not.toContain("<table");

    // One failed block leaves the others whole.
    const partial = html(<FunnelPanel summary={summary({ cohort: null, guestCard: { signups: 9, firstCardsSaved: null } })} days={30} />);
    expect(text(partial)).toContain("Couldn’t load how far new accounts have come.");
    expect(text(partial)).toContain("Signups 174 +45%");
    const guest = block(partial, "Guest creator cards");
    expect(guest).toMatch(/First cards saved from a guest card<\/th><td[^>]*>—<\/td>/);
    expect(text(guest)).toContain("Couldn’t load the first cards saved from a guest card.");
  });

  it("says when the trial list is the newest 200 of more", () => {
    const many = summary({ trials: Array.from({ length: 200 }, (_, i) => ({ ...summary().trials![0], startedAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() })) });
    expect(text(html(<FunnelPanel summary={many} days={90} />))).toContain("The newest 200 trials of the period are listed.");
    expect(words).not.toContain("The newest 200 trials");
  });
});

describe("FunnelTab", () => {
  const params: AnalyticsParams = { tab: "funnel", days: 90, admins: true, tool: null, user: null, page: 1 };
  beforeEach(() => loader.getFunnelSummary.mockReset());

  it("reads the page's period with the page's switch, and draws the panel for it", async () => {
    loader.getFunnelSummary.mockResolvedValue(summary());
    const out = html(await FunnelTab({ params }));
    expect(loader.getFunnelSummary).toHaveBeenCalledTimes(1);
    const [period, includeAdmins] = loader.getFunnelSummary.mock.calls[0];
    expect(period.days).toBe(90);
    expect(period.dayKeys).toHaveLength(90);
    // The previous period is the same stretch 90 days earlier, cut at the
    // same time of day: exactly as long, and ending short of this one's start.
    expect(period.since.getTime() - period.previousSince.getTime()).toBe(90 * 86_400_000);
    expect(period.until.getTime() - period.previousUntil.getTime()).toBe(90 * 86_400_000);
    expect(period.previousUntil.getTime() - period.previousSince.getTime()).toBe(period.until.getTime() - period.since.getTime());
    expect(period.previousUntil.getTime()).toBeLessThan(period.since.getTime());
    expect(includeAdmins).toBe(true);
    expect(out).toContain("people who signed up in the last 90 days");
    expect(text(out)).toContain("vs the previous 90 days");
  });

  it("admins are left out unless the address says otherwise", async () => {
    loader.getFunnelSummary.mockResolvedValue(summary());
    await FunnelTab({ params: { ...params, days: 7, admins: false } });
    expect(loader.getFunnelSummary.mock.calls[0][0].days).toBe(7);
    expect(loader.getFunnelSummary.mock.calls[0][1]).toBe(false);
  });

  it("no summary at all is one load error, never a blank tab", async () => {
    loader.getFunnelSummary.mockResolvedValue(null);
    const out = html(await FunnelTab({ params }));
    expect(out).toContain('role="alert"');
    expect(text(out)).toContain("Couldn’t load the funnel.");
  });
});
