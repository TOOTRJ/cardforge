import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// /admin/analytics — the Content tab as the admin reads it: six numbers
// against the period before, a chart a day with its table twin, who can see
// the period's cards as ranked bars in ONE hue, and the most viewed public
// cards and decks linked to their pages and their makers.
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const reads = vi.hoisted(() => ({ stats: vi.fn() }));
vi.mock("@/lib/admin/analytics/content", async (original) => ({
  ...(await original<typeof import("@/lib/admin/analytics/content")>()),
  getContentStats: reads.stats,
}));

import { ContentTab, ContentTabView, visibilityRows } from "@/components/admin/analytics/tabs/content-tab";
import { parseContentStats } from "@/lib/admin/analytics/content";
import { analyticsPeriod, type AnalyticsParams } from "@/lib/admin/analytics/params";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const params: AnalyticsParams = { tab: "content", days: 7, admins: false, tool: null, user: null, page: 1 };
const period = analyticsPeriod(7, new Date("2026-11-10T15:00:00Z"));

const stats = parseContentStats(
  {
    current: { cardsCreated: 1200, cardsPublic: 300, cardsUnlisted: 780, cardsPrivate: 120, decksCreated: 29, cardLikes: 11, deckLikes: 8, cardViews: 1432, deckViews: 3 },
    previous: { cardsCreated: 600, cardsPublic: 300, cardsUnlisted: 250, cardsPrivate: 50, decksCreated: 0, cardLikes: 19, deckLikes: 0, cardViews: 1432, deckViews: 6 },
    perDay: [
      { day: "2026-11-04", cardsCreated: 400, decksCreated: 0, cardViews: 1 },
      { day: "2026-11-06", cardsCreated: 0, decksCreated: 24, cardViews: 1429 },
      { day: "2026-11-10", cardsCreated: 800, decksCreated: 5, cardViews: 2 },
    ],
    topCards: [
      { id: "c2", title: "Forgemaster's Decree", slug: "forgemasters-decree", ownerId: "22222222-2222-4222-8222-222222222222", username: "dev_artist", views: 1206 },
      { id: "c1", title: "Archivist of Lost Hours", slug: "archivist-of-lost-hours", ownerId: "11111111-1111-4111-8111-111111111111", username: "dev_pro", views: 3 },
    ],
    topDecks: [{ id: "d1", title: "Cinderwing Dragonstorm", slug: "cinderwing-dragonstorm", ownerId: "11111111-1111-4111-8111-111111111111", username: "dev_pro", views: 105 }],
  },
  period.dayKeys,
);
const empty = parseContentStats({}, period.dayKeys);

beforeEach(() => {
  reads.stats.mockReset().mockResolvedValue(stats);
});

describe("visibilityRows", () => {
  it("is three bars, most open first, each with its share of the cards made", () => {
    expect(visibilityRows(stats.current)).toEqual([
      { key: "public", label: "Public", value: 300, note: "25%" },
      { key: "unlisted", label: "Unlisted (link only)", value: 780, note: "65%" },
      { key: "private", label: "Private", value: 120, note: "10%" },
    ]);
  });

  it("is nothing when no card was made — an empty state, not three empty bars", () => {
    expect(visibilityRows(empty.current)).toEqual([]);
  });
});

describe("ContentTabView", () => {
  const out = html(<ContentTabView params={params} stats={stats} />);

  it("leads with six numbers, each against the period before", () => {
    const tiles = [...out.matchAll(/<dt[^>]*>([^<]*)<\/dt><dd[^>]*>([^<]*)<\/dd>/g)].map((m) => [m[1], m[2]]);
    expect(tiles).toEqual([
      ["Cards created", "1,200"],
      ["Public cards created", "300"],
      ["Decks created", "29"],
      ["Likes", "19"],
      ["Card views", "1,432"],
      ["Deck views", "3"],
    ]);
    expect(out.match(/vs the previous 7 days/g)).toHaveLength(6);
    expect(out).toContain("+100%"); // cards: 600 → 1,200
    expect(out).toContain("−50%"); // deck views: 6 → 3
    expect(out.match(/no change/g)).toHaveLength(3); // public cards, likes, card views
    expect(out).toMatch(/>new<\/span> vs the previous 7 days \(0\)/); // decks: from nothing
    expect(out).toContain("25% of the cards made");
    expect(out).toContain("11 on cards · 8 on decks");
  });

  it("says whether the team's own activity is in the numbers", () => {
    expect(out).toContain("The team&#x27;s own cards, decks and likes are left out.");
    const withAdmins = html(<ContentTabView params={{ ...params, admins: true }} stats={stats} />);
    expect(withAdmins).toContain("The team&#x27;s own cards, decks and likes are counted too.");
  });

  it("draws a chart a day for cards, card views and decks — each with a table twin holding the same numbers", () => {
    for (const title of ["Cards created per day", "Card views per day", "Decks created per day"]) {
      expect(out).toContain(`>${title}</h3>`);
      expect(out).toMatch(new RegExp(`<caption[^>]*>${title}</caption>`));
    }
    expect(out).toMatch(/800 cards<\/p><p[^>]*>Nov 10/);
    expect(out).toMatch(/1,429 views<\/p><p[^>]*>Nov 6/);
    expect(out).toMatch(/24 decks<\/p><p[^>]*>Nov 6/);
    // The twins: a quiet day is left out, a busy one is there with its number.
    expect(out).toMatch(/Nov 6, 2026<\/th><td[^>]*>1,429<\/td>/);
    expect(out).toMatch(/Nov 10, 2026<\/th><td[^>]*>800<\/td>/);
  });

  it("shows who can see the period's cards as ranked bars in the one chart hue, values printed, with a table twin", () => {
    expect(out).toContain("Who can see the cards made in this period");
    expect(out).toMatch(/Unlisted \(link only\)<\/span>[\s\S]*?780<span[^>]*> · 65%<\/span>/);
    expect(out).toMatch(/<caption[^>]*>Cards made in the period, by who can see them<\/caption>/);
    expect(out).toMatch(/Private<\/th><td[^>]*>120<\/td><td[^>]*>10%<\/td>/);
    expect(out).not.toMatch(/bg-chart-2|bg-mana|bg-gold|bg-danger/);
    // A full bar stands for every card made: Public is a quarter of the track.
    expect(out).toContain("width:max(2px, 25%)");
  });

  it("lists the most viewed public cards, linked to the card's page and to its maker", () => {
    expect(out).toContain("Most viewed cards");
    expect(out).toContain('href="/card/dev_artist/forgemasters-decree"');
    expect(out).toContain("Forgemaster&#x27;s Decree");
    expect(out).toContain('href="/admin/users?u=22222222-2222-4222-8222-222222222222"');
    expect(out).toContain("@dev_artist");
    expect(out).toMatch(/>1,206<\/td>/);
    expect(out.indexOf("forgemasters-decree")).toBeLessThan(out.indexOf("archivist-of-lost-hours"));
    expect(out).toContain("Private and unlisted cards are counted above but never named here.");
  });

  it("lists the most viewed public decks, linked to the deck's page", () => {
    expect(out).toContain("Most viewed decks");
    expect(out).toContain('href="/deck/cinderwing-dragonstorm"');
    expect(out).toContain("Cinderwing Dragonstorm");
    expect(out).toMatch(/>105<\/td>/);
  });

  it("a quiet period is sentences and zeros — no empty plots, no placeholders", () => {
    const quiet = html(<ContentTabView params={params} stats={empty} />);
    expect(quiet).toContain("No cards in this period.");
    expect(quiet).toContain("No views in this period.");
    expect(quiet).toContain("No decks in this period.");
    expect(quiet).toContain("No cards were made in this period.");
    expect(quiet).toContain("No public card was opened in this period.");
    expect(quiet).toContain("No public deck was opened in this period.");
    expect(quiet).not.toMatch(/N\/A|NaN|undefined/);
    expect(quiet).not.toContain("of the cards made</dd>");
  });

  it("a card whose maker is unknown still links to its page, with a dash for the maker", () => {
    const orphan = parseContentStats({ topCards: [{ id: "c9", title: "Lone Card", slug: "lone-card", ownerId: null, username: null, views: 2 }] }, period.dayKeys);
    const page = html(<ContentTabView params={params} stats={orphan} />);
    expect(page).toContain('href="/card/lone-card"');
    expect(page).toMatch(/Lone Card<\/a><\/th><td[^>]*>—<\/td>/);
  });

  it("a read that failed says so — never a page of zeros", () => {
    const failed = html(<ContentTabView params={params} stats={null} />);
    expect(failed).toContain('data-testid="admin-load-error"');
    expect(failed).toContain("what was made and viewed in the last 7 days");
    expect(failed).not.toContain("Cards created");
  });
});

describe("ContentTab", () => {
  it("reads the page's period with its Include admins switch", async () => {
    const out = html(await ContentTab({ params: { ...params, days: 90, admins: true } }));
    expect(reads.stats).toHaveBeenCalledTimes(1);
    const [periodArg, includeAdmins] = reads.stats.mock.calls[0];
    expect(periodArg).toMatchObject({ days: 90 });
    expect(periodArg.dayKeys).toHaveLength(90);
    expect(includeAdmins).toBe(true);
    expect(out).toContain("Made and viewed in the last 90 days");
  });

  it("is the load error when the read fails", async () => {
    reads.stats.mockResolvedValue(null);
    expect(html(await ContentTab({ params }))).toContain('data-testid="admin-load-error"');
  });
});
