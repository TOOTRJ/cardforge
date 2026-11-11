import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// /admin/analytics — the "Credits and AI" tab: what it shows from the
// ledger's flow, and what it asks for (the period, the period before, the
// admin switch). Each read fails on its own: its block says so, the others
// still show.
// ---------------------------------------------------------------------------

const loaders = vi.hoisted(() => ({
  flow: vi.fn(),
  generations: vi.fn(),
  grants: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: (props: { href: string; children: React.ReactNode }) => <a {...props} />,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("no database in this test");
  },
}));
vi.mock("@/lib/admin/users-queries", () => ({ requireAdminClient: async () => null }));
vi.mock("@/lib/admin/analytics/credits", async (original) => ({
  ...(await original<typeof import("@/lib/admin/analytics/credits")>()),
  getCreditFlow: loaders.flow,
  getAiGenerationCounts: loaders.generations,
}));
vi.mock("@/lib/admin/credit-grant-stats", async (original) => ({
  ...(await original<typeof import("@/lib/admin/credit-grant-stats")>()),
  getCreditGrantStats: loaders.grants,
}));

import { CreditsTab, CreditsView, type CreditsViewProps } from "@/components/admin/analytics/tabs/credits-tab";
import { analyticsPeriod, type AnalyticsParams } from "@/lib/admin/analytics/params";
import type { CreditFlow } from "@/lib/admin/analytics/credits";
import type { CreditGrantStats } from "@/lib/admin/credit-grant-stats";

const params: AnalyticsParams = { tab: "credits", days: 30, admins: false, tool: null, user: null, page: 1 };
const NOW = new Date("2026-11-10T15:00:00Z");
const period = analyticsPeriod(30, NOW);

const flow: CreditFlow = {
  totals: { spent: 120, spends: 105, refunded: 9, refunds: 9, granted: 400, grants: 12, takenBack: 0, takeBacks: 0 },
  spentByReason: [
    { reason: "fill_card", spent: 60, spends: 60, refunded: 4, refunds: 4 },
    { reason: "generate_random_card", spent: 20, spends: 10, refunded: 2, refunds: 1 },
    { reason: "build_collection_deck", spent: 12, spends: 12, refunded: 1, refunds: 1 },
    { reason: "generate_from_concept", spent: 10, spends: 5, refunded: 0, refunds: 0 },
    { reason: "forge_pip", spent: 10, spends: 10, refunded: 1, refunds: 1 },
    { reason: "deck_reart_art", spent: 5, spends: 5, refunded: 0, refunds: 0 },
    { reason: "suggest_collection_commander", spent: 3, spends: 3, refunded: 0, refunds: 0 },
    // Charged just before the period, refunded in it.
    { reason: "remix_card", spent: 0, spends: 0, refunded: 0, refunds: 0 },
  ],
  refundedUnattributed: { credits: 1, refunds: 1 },
  grantedByReason: [{ reason: "plan_credits_once", credits: 400, grants: 12 }],
  days: [
    { day: "2026-10-20", spent: 30, granted: 0, refunded: 2 },
    { day: "2026-11-09", spent: 89, granted: 400, refunded: 7 },
    { day: "2026-11-10", spent: 1, granted: 0, refunded: 0 },
  ],
};
const previous = { ...flow.totals, spent: 80, granted: 500, refunded: 9 };
const grants: CreditGrantStats = {
  period: [{ reason: "plan_credits_once", label: "Plan credits", credits: 400, grants: 12 }],
  allTime: [
    { reason: "plan_credits_once", label: "Plan credits", credits: 2400, grants: 40 },
    { reason: "signup_grant", label: "Welcome credits", credits: 500, grants: 100 },
  ],
};
const full: CreditsViewProps = {
  params,
  dayKeys: period.dayKeys,
  flow,
  previous,
  generations: { current: 41, previous: 30 },
  grants,
};

const render = (props: Partial<CreditsViewProps> = {}) =>
  renderToStaticMarkup(<CreditsView {...full} {...props} />)
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'");
const text = (out: string) => out.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");
/** The text of the tile whose label is `label`. */
const tile = (out: string, label: string) => {
  const start = out.indexOf(`>${label}</dt>`);
  expect(start, `a tile labelled ${label}`).toBeGreaterThan(-1);
  return out.slice(start, out.indexOf("</div>", start)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
};

beforeEach(() => {
  loaders.flow.mockReset();
  loaders.generations.mockReset();
  loaders.grants.mockReset();
});

describe("CreditsView", () => {
  const out = render();

  it("heads with four numbers, each against the period before", () => {
    const spent = tile(out, "Credits spent");
    expect(spent).toContain(" 120 ");
    expect(spent).toContain("+50% vs the previous 30 days (80)");
    expect(spent).toContain("105 charges. 111 kept after refunds.");
    const granted = tile(out, "Credits granted");
    expect(granted).toContain(" 400 ");
    expect(granted).toContain("−20% vs the previous 30 days (500)");
    expect(granted).toContain("12 grants");
    const refunded = tile(out, "Credits refunded");
    expect(refunded).toContain(" 9 ");
    expect(refunded).toContain("no change vs the previous 30 days (9)");
    expect(refunded).toContain("7.5% of what was spent.");
    const generations = tile(out, "AI generations");
    expect(generations).toContain(" 41 ");
    expect(generations).toContain("+37% vs the previous 30 days (30)");
    expect(generations).toContain("AI jobs started");
  });

  it("draws credits spent per day in the one chart hue, with a twin that also has what was refunded and granted", () => {
    expect(out).toContain("Credits spent per day");
    expect(out).toContain("89 credits spent</p>");
    expect(out).toContain("1 credit spent</p>");
    // One column a day of the period.
    expect(out.match(/rounded-t-\[4px\] bg-chart-1/g)).toHaveLength(30);
    expect(out).not.toMatch(/bg-chart-2|bg-mana|bg-gold/);
    const twin = text(out);
    expect(twin).toContain("|Day (UTC)|Spent|Refunded|Granted|");
    // Newest first; a quiet day is left out.
    expect(twin).toContain("|Nov 10, 2026 UTC|1|0|0|Nov 9, 2026 UTC|89|7|400|Oct 20, 2026 UTC|30|2|0|");
  });

  it("ranks where credits went by the ledger's own labels — two reasons with one label are one row", () => {
    expect(out).toContain("Where credits went");
    const twin = text(out);
    expect(twin).toContain("|Spent on|Credits spent|Charges|Refunded|Kept|");
    expect(twin).toContain("|AI card fill|60|60|4|56|");
    // generate_random_card + generate_from_concept.
    expect(twin).toContain("|AI card generation|30|15|2|28|");
    expect(out.match(/>AI card generation</g)).toHaveLength(2); // the bar and the table row
    expect(twin).toContain("|Collection deck build|12|12|1|11|");
    // The bars print the value and the number of charges.
    expect(out).toMatch(/AI card fill<\/span>[\s\S]*?>60<span[^>]*> · 60 charges<\/span>/);
    // A reason with nothing spent in the period has a table row and no bar.
    expect(twin).toContain("|AI restyle|0|0|0|0|");
    expect(out.match(/>AI restyle</g)).toHaveLength(1);
    expect(out).toContain("1 refunded credit could not be matched to a charge");
  });

  it("says what each beta tool cost, from the ledger, with everything else in one last row", () => {
    const twin = text(out);
    expect(twin).toContain("|Tool|Credits spent|Charges|Refunded|Kept|");
    // build_collection_deck + suggest_collection_commander.
    expect(twin).toContain("|Collection Deck Builder|15|15|1|14|");
    expect(twin).toContain("|Pip Forge|10|10|1|9|");
    expect(twin).toContain("|Re-art deck|5|5|0|5|");
    expect(twin).toContain("|Bulk Customize|0|0|0|0|");
    expect(twin).toContain("|The card creator and everything else|90|75|6|84|");
    expect(out).toContain('href="/admin/analytics?tab=tools&amp;tool=collection-builder"');
    // The six tool rows and the rest add up to the total spent.
    expect(15 + 10 + 5 + 0 + 0 + 0 + 90).toBe(flow.totals.spent);
    expect(out).toContain("Token Kit’s AI art is charged as an “AI card fill”");
    expect(twin).not.toContain("|Token Kit|");
  });

  it("lists what was granted, by reason, for the period and all time", () => {
    const twin = text(out);
    expect(twin).toContain("|Plan credits|400|12|2,400|40|");
    expect(twin).toContain("|Welcome credits|—|—|500|100|");
    expect(twin).toContain("|Total|400|12|2,900|140|");
  });

  it("says what “Include admins” changes here — grants — whichever way the switch is", () => {
    expect(out).toContain("Admin accounts are left out. An admin's AI use is free and writes nothing to the ledger");
    const withAdmins = render({ params: { ...params, admins: true } });
    expect(withAdmins).toContain("Admin accounts are included.");
    expect(withAdmins).toContain("what this adds is the credits granted to them");
    // The link to a tool keeps the switch.
    expect(withAdmins).toContain('href="/admin/analytics?tab=tools&amp;admins=1&amp;tool=pip-forge"');
  });

  it("credits taken back with a refunded pack are named, and are not spending", () => {
    expect(out).not.toContain("taken back");
    const taken = render({ flow: { ...flow, totals: { ...flow.totals, takenBack: 12, takeBacks: 1 } } });
    expect(taken).toContain("12 credits were taken back with refunded credit packs; that is not spending");
    expect(tile(taken, "Credits spent")).toContain(" 120 ");
  });

  it("without the period before, the tiles show no comparison rather than a wrong one", () => {
    const alone = render({ previous: null });
    expect(tile(alone, "Credits spent")).toContain(" 120 ");
    expect(tile(alone, "Credits spent")).not.toContain("vs the previous");
    expect(tile(alone, "AI generations")).toContain("vs the previous 30 days (30)");
  });

  it("a period with nothing in it reads as sentences, not empty plots", () => {
    const empty = render({
      flow: {
        totals: { spent: 0, spends: 0, refunded: 0, refunds: 0, granted: 0, grants: 0, takenBack: 0, takeBacks: 0 },
        spentByReason: [],
        refundedUnattributed: { credits: 0, refunds: 0 },
        grantedByReason: [],
        days: [],
      },
      previous: { ...flow.totals, spent: 0, granted: 0, refunded: 0 },
      generations: { current: 0, previous: 0 },
      grants: { period: [], allTime: [] },
    });
    expect(tile(empty, "Credits spent")).toContain(" 0 ");
    expect(tile(empty, "Credits spent")).toContain("no change");
    expect(empty).toContain("No credits spent in this period.");
    expect(empty).toContain("No credits were spent in this period.");
    expect(empty).toContain("No credits granted yet.");
    expect(empty).not.toContain("bg-chart-1");
    // The tools are still listed, at zero.
    expect(text(empty)).toContain("|Pip Forge|0|0|0|0|");
  });

  it("a ledger read that failed says so; the generations and the grants still show", () => {
    const failed = render({ flow: null, previous: null });
    expect(failed).toContain("Couldn’t load the credits spent, refunded and granted.");
    expect(failed).not.toContain("Credits spent per day");
    expect(failed).not.toContain("Credits spent by tool");
    expect(tile(failed, "AI generations")).toContain(" 41 ");
    expect(text(failed)).toContain("|Plan credits|400|12|2,400|40|");
  });

  it("the grants and the generations each fail on their own", () => {
    const noGrants = render({ grants: null });
    expect(noGrants).toContain("Couldn’t load the credits granted by reason.");
    expect(tile(noGrants, "Credits spent")).toContain(" 120 ");
    const noGenerations = render({ generations: null });
    const generations = tile(noGenerations, "AI generations");
    expect(generations).toContain(" — ");
    expect(generations).toContain("Couldn't be counted this time.");
    expect(generations).not.toContain("vs the previous");
    expect(noGenerations.match(/data-testid="admin-load-error"/g)).toBeNull();
  });
});

describe("CreditsTab", () => {
  it("reads the period, the period before it, the generations and the grants — all with the admin switch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      loaders.flow.mockImplementation(async (window: { since: Date }) =>
        window.since.getTime() === period.since.getTime() ? flow : { ...flow, totals: previous },
      );
      loaders.generations.mockResolvedValue({ current: 41, previous: 30 });
      loaders.grants.mockResolvedValue(grants);
      const out = renderToStaticMarkup(await CreditsTab({ params: { ...params, admins: true } })).replace(/<!-- -->/g, "");
      expect(loaders.flow.mock.calls).toEqual([
        [{ since: period.since, until: period.until }, true],
        // The period before is the same stretch 30 days earlier, cut at the
        // same time of day — it does NOT run up to this period's start.
        [{ since: period.previousSince, until: period.previousUntil }, true],
      ]);
      expect(period.previousSince.toISOString()).toBe("2026-09-12T00:00:00.000Z");
      expect(period.previousUntil.toISOString()).toBe("2026-10-11T15:00:00.000Z");
      // The generations are counted over the same two stretches.
      expect(loaders.generations).toHaveBeenCalledWith(
        expect.objectContaining({
          since: period.since,
          until: period.until,
          previousSince: period.previousSince,
          previousUntil: period.previousUntil,
        }),
        true,
      );
      expect(loaders.grants).toHaveBeenCalledWith({ since: period.since, includeAdmins: true });
      expect(tile(out, "Credits spent")).toContain("+50% vs the previous 30 days (80)");
      expect(out.match(/rounded-t-\[4px\] bg-chart-1/g)).toHaveLength(30);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves admins out by default, follows the period picked, and survives every read failing", async () => {
    loaders.flow.mockResolvedValue(null);
    loaders.generations.mockResolvedValue(null);
    loaders.grants.mockResolvedValue(null);
    const out = renderToStaticMarkup(await CreditsTab({ params: { ...params, days: 7 } }));
    expect(loaders.flow.mock.calls.map(([, admins]) => admins)).toEqual([false, false]);
    const [[current], [before]] = loaders.flow.mock.calls as Array<[{ since: Date; until: Date }]>;
    // The period before is the same stretch 7 days earlier: both ends moved
    // back 7 days, so the two are exactly as long as each other…
    expect(current.since.getTime() - before.since.getTime()).toBe(7 * 86_400_000);
    expect(current.until.getTime() - before.until.getTime()).toBe(7 * 86_400_000);
    expect(before.until.getTime() - before.since.getTime()).toBe(current.until.getTime() - current.since.getTime());
    // …and it stops short of this period's start: the rest of that earlier
    // day is in neither.
    expect(before.until.getTime()).toBeLessThan(current.since.getTime());
    const [[asked]] = loaders.generations.mock.calls as Array<[{ since: Date; until: Date; previousSince: Date; previousUntil: Date }, boolean]>;
    expect([asked.since, asked.until, asked.previousSince, asked.previousUntil]).toEqual([current.since, current.until, before.since, before.until]);
    expect(loaders.generations.mock.calls[0][1]).toBe(false);
    expect(loaders.grants).toHaveBeenCalledWith({ since: current.since, includeAdmins: false });
    expect(out.match(/data-testid="admin-load-error"/g)).toHaveLength(2);
    expect(out).toContain("AI generations");
  });
});
