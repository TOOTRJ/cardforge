import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// /admin/analytics — the Tools tab (the owner's request, 2026-11-10: "which
// users have used each tool and how often"). With no tool open: six numbers
// across tools, the tools ranked by uses and a row per tool. With a tool
// open: its numbers, two day charts, every event, why failures failed,
// EVERYONE who used it (paged) and one person's event log. Each block's
// read stands alone, and an empty period says why it is usually empty.
//
// "Credits spent" is the credit LEDGER's figure (by the tool's own spend
// reasons), never an event's price: a dash where the ledger cannot tell —
// Token Kit's art spends under the card creator's reason — or was not read.
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({
  default: (props: { href: string; children: React.ReactNode; scroll?: boolean }) => {
    const rest: Record<string, unknown> = { ...props };
    delete rest.scroll;
    return <a {...rest} />;
  },
}));

const reads = vi.hoisted(() => ({
  getToolsOverview: vi.fn(),
  getToolNumbers: vi.fn(),
  getToolUsers: vi.fn(),
  getToolUserLog: vi.fn(),
}));
// The four reads are stubbed; what the views take from the module besides —
// ledgerCreditsOf, the one answer to "what did this tool cost" — is the real one.
vi.mock("@/lib/admin/users-queries", () => ({ requireAdminClient: async () => null }));
vi.mock("@/lib/admin/analytics/tools", async () => ({
  ...(await vi.importActual<typeof import("@/lib/admin/analytics/tools")>("@/lib/admin/analytics/tools")),
  ...reads,
}));

import { ToolsTab } from "@/components/admin/analytics/tabs/tools-tab";
import { ToolDetailView } from "@/components/admin/analytics/tools-detail";
import { ToolsOverviewView } from "@/components/admin/analytics/tools-overview";
import type { AnalyticsParams } from "@/lib/admin/analytics/params";
import type { ToolNumbers, ToolsOverview } from "@/lib/admin/analytics/tools";
import { EMPTY_TOOL_TOTALS, type ToolTotals, type ToolUserLog, type ToolUsersPage, type ToolUserRow } from "@/lib/admin/analytics/tools-view";
import { TOOL_CATALOG, toolBySlug } from "@/lib/tools/catalog";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const base: AnalyticsParams = { tab: "tools", days: 30, admins: false, tool: null, user: null, page: 1 };
const USER = "d0000000-0000-4000-a000-000000000002";
const tokenKit = toolBySlug("token-kit")!;

const totalsOf = (over: Partial<ToolTotals>): ToolTotals => ({ ...EMPTY_TOOL_TOTALS, ...over });

/** The period's spend per tool, as the loader reads it from the ledger: a
 *  figure for every tool with spend reasons of its own (0 when nobody
 *  spent), none for Token Kit. */
const spend: NonNullable<ToolsOverview["spend"]> = {
  bySlug: new Map([
    ["collection-builder", 4],
    ["bulk-customize", 0],
    ["re-art-deck", 0],
    ["pip-forge", 2],
    ["set-symbol-studio", 0],
    ["rule0-sheet", 3],
  ]),
  total: 9,
};

const overview: ToolsOverview = {
  rows: [
    // Token Kit: the ledger cannot tell its art from the creator's fills
    { slug: "token-kit", users: 5, usingUsers: 3, opens: 20, uses: 12, failures: 1, credits: null, lastEventAt: "2026-11-09T04:00:00+00:00" },
    { slug: "rule0-sheet", users: 2, usingUsers: 1, opens: 4, uses: 30, failures: 0, credits: 3, lastEventAt: "2026-11-08T04:00:00+00:00" },
  ],
  totals: totalsOf({ users: 6, usingUsers: 4, opens: 24, uses: 42, failures: 1, credits: 9, visitorEvents: 3 }),
  previous: totalsOf({ users: 3, usingUsers: 2, opens: 10, uses: 21, failures: 3, credits: 18 }),
  spend,
};

/** The same period with a ledger that could not be read. */
const unreadLedger: ToolsOverview = {
  rows: overview.rows.map((row) => ({ ...row, credits: null })),
  totals: { ...overview.totals, credits: null },
  previous: { ...overview.previous, credits: null },
  spend: null,
};

/** The text of an element: tags out, entities back. */
const textOf = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

/** One table's rows as arrays of cell text, by its caption. */
function tableRows(markup: string, caption: string): string[][] {
  const at = markup.indexOf(`<caption class="sr-only">${caption}`);
  expect(at, `a table captioned “${caption}”`).toBeGreaterThanOrEqual(0);
  const table = markup.slice(at, markup.indexOf("</table>", at));
  return [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((row) =>
    [...row[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((cell) => textOf(cell[1]).trim()),
  );
}

/** One headline tile as text, by its label: the value, how it compares
 *  with the period before (when it does) and its hint. */
function tile(markup: string, label: string): string {
  const at = markup.indexOf(`>${label}</dt>`);
  expect(at, `a tile labelled “${label}”`).toBeGreaterThanOrEqual(0);
  return textOf(markup.slice(at + 1, markup.indexOf("</div>", at))).trim();
}

beforeEach(() => {
  for (const read of Object.values(reads)) read.mockReset();
});

describe("every tool", () => {
  const out = html(<ToolsOverviewView params={base} data={overview} />);
  const text = textOf(out);

  it("leads with six numbers across tools, each against the period before", () => {
    expect(out).toMatch(/People who used a tool<\/dt><dd[^>]*>4<\/dd>/);
    expect(text).toContain("+100% vs the previous 30 days (2)");
    expect(text).toContain("6 people opened or used one");
    expect(out).toMatch(/Opens<\/dt><dd[^>]*>24<\/dd>/);
    expect(out).toMatch(/Uses<\/dt><dd[^>]*>42<\/dd>/);
    expect(out).toMatch(/Failures<\/dt><dd[^>]*>1<\/dd>/);
    // 42 of 43 tries worked; the period before, 21 of 24
    expect(out).toMatch(/Success rate<\/dt><dd[^>]*>98%<\/dd>/);
    expect(text).toContain("88% in the previous 30 days");
    expect(out).toMatch(/Credits spent<\/dt><dd[^>]*>9<\/dd>/);
    expect(text).toContain("−50% vs the previous 30 days (18)");
  });

  it("“Credits spent” is the credit ledger's figure, and says where it comes from and what is not in it", () => {
    expect(tile(out, "Credits spent")).toBe(
      "Credits spent 9 −50% vs the previous 30 days (18) On the tools' AI, from the credit ledger. Token Kit's art is not in it: it spends under the card creator's reason.",
    );
    // never the old name: nothing here is what an event said a run would cost
    expect(text).not.toContain("Credits charged");
    expect(out.split("Credits spent").length - 1).toBe(2); // the tile and the table's column
  });

  it("a ledger that could not be read is a dash and a reason — on the tile and in every tool's row — never a 0", () => {
    const unread = html(<ToolsOverviewView params={base} data={unreadLedger} />);
    // no figure, and nothing to compare
    expect(tile(unread, "Credits spent")).toBe("Credits spent — The credit ledger could not be read.");
    const rows = tableRows(unread, "Every tool in the last 30 days");
    expect(rows[0][7]).toBe("Credits spent");
    expect(rows.slice(1).map((row) => row[7])).toEqual(TOOL_CATALOG.map(() => "—"));
    // the tool log's own numbers still stand
    expect(unread).toMatch(/Uses<\/dt><dd[^>]*>42<\/dd>/);
    expect(rows[1].slice(0, 7)).toEqual(["Rule 0 Table Sheet", "2", "1", "4", "30", "0", "100%"]);
  });

  it("with only the period before unread, the figure stands and is compared with nothing", () => {
    const half = html(<ToolsOverviewView params={base} data={{ ...overview, previous: { ...overview.previous, credits: null } }} />);
    expect(tile(half, "Credits spent")).toBe(
      "Credits spent 9 On the tools' AI, from the credit ledger. Token Kit's art is not in it: it spends under the card creator's reason.",
    );
  });

  it("ranks every built tool by its uses — a quiet tool is listed with 0 — and says for how many people", () => {
    const rows = tableRows(out, "Uses by tool in the last 30 days");
    expect(rows[0]).toEqual(["Tool", "Uses", "People who used it"]);
    expect(rows.slice(1, 3)).toEqual([
      ["Rule 0 Table Sheet", "30", "1 person"],
      ["Token Kit", "12", "3 people"],
    ]);
    expect(rows).toHaveLength(1 + TOOL_CATALOG.length);
    expect(rows.slice(3).every((row) => row[1] === "0" && row[2] === "0 people")).toBe(true);
    for (const tool of TOOL_CATALOG) expect(rows.some((row) => row[0] === tool.name), tool.name).toBe(true);
  });

  it("draws the ranking in the one chart hue", () => {
    expect(out).toContain("bg-chart-1");
    expect(out).not.toMatch(/bg-chart-2|bg-mana|bg-gold|bg-danger/);
  });

  it("lists every tool with its numbers; a tool's name opens its own view, keeping the period and the switch", () => {
    const rows = tableRows(out, "Every tool in the last 30 days");
    expect(rows[0]).toEqual(["Tool", "People", "People who used it", "Opens", "Uses", "Failures", "Success rate", "Credits spent", "Last activity"]);
    expect(rows[1]).toEqual(["Rule 0 Table Sheet", "2", "1", "4", "30", "0", "100%", "3", "Nov 8, 2026 UTC"]);
    // Token Kit's credits are not known (its art spends under the creator's reason): a dash, never a 0
    expect(rows[2]).toEqual(["Token Kit", "5", "3", "20", "12", "1", "92%", "—", "Nov 9, 2026 UTC"]);
    // no events: zeros, and a dash where there is nothing to say — but the
    // ledger still knows what the tool's AI cost
    expect(rows[3]).toEqual(["Collection Deck Builder", "0", "0", "0", "0", "0", "—", "4", "—"]);
    expect(out).toContain('href="/admin/analytics?tab=tools&amp;tool=token-kit"');

    const wide = html(<ToolsOverviewView params={{ ...base, days: 90, admins: true }} data={overview} />);
    expect(wide).toContain('href="/admin/analytics?tab=tools&amp;days=90&amp;admins=1&amp;tool=token-kit"');
    expect(textOf(wide)).toContain("the last 90 days");
  });

  it("every tool's “Credits spent” is its ledger figure, with or without an event in the period: 0 where nobody spent or there is nothing to pay for", () => {
    const rows = tableRows(out, "Every tool in the last 30 days");
    const shown = Object.fromEntries(rows.slice(1).map((row) => [row[0], row[7]]));
    const bySlug: Record<string, string> = {
      "rule0-sheet": "3",
      // not known: its art spends under the card creator's reason
      "token-kit": "—",
      // no event in the period, and a figure all the same
      "collection-builder": "4",
      "pip-forge": "2",
      // reasons of their own that nobody spent under
      "bulk-customize": "0",
      "re-art-deck": "0",
      "set-symbol-studio": "0",
      // no AI to pay for
      "custom-symbols": "0",
      "play-exports": "0",
    };
    expect(Object.keys(bySlug).sort()).toEqual(TOOL_CATALOG.map((tool) => tool.slug as string).sort());
    expect(shown).toEqual(Object.fromEntries(Object.entries(bySlug).map(([slug, cell]) => [toolBySlug(slug)!.name, cell])));
    // the rows with a figure add up to the tile's total
    const sum = Object.values(shown).reduce((n, cell) => n + (cell === "—" ? 0 : Number(cell)), 0);
    expect(sum).toBe(overview.totals.credits);
  });

  it("a slug the catalog no longer lists keeps its row — as text, with no view to open", () => {
    const retired = html(
      <ToolsOverviewView
        params={base}
        data={{ ...overview, rows: [...overview.rows, { slug: "retired-tool", users: 1, usingUsers: 1, opens: 2, uses: 50, failures: 0, credits: null, lastEventAt: null }] }}
      />,
    );
    const rows = tableRows(retired, "Every tool in the last 30 days");
    expect(rows[1].slice(0, 5)).toEqual(["retired-tool", "1", "1", "2", "50"]);
    expect(retired).toContain('<span title="No longer in the tools catalog">retired-tool</span>');
    expect(rows).toHaveLength(1 + TOOL_CATALOG.length + 1);
    expect(retired).not.toContain("tool=retired-tool");
  });

  it("says what events with no account are (they are in no People column)", () => {
    expect(text).toContain("3 events have no account behind them (a shared sheet’s visitors, or an account since deleted)");
    const one = html(<ToolsOverviewView params={base} data={{ ...overview, totals: totalsOf({ uses: 1, visitorEvents: 1 }) }} />);
    expect(textOf(one)).toContain("1 event has no account behind it");
    const none = html(<ToolsOverviewView params={base} data={{ ...overview, totals: totalsOf({ uses: 1 }) }} />);
    expect(textOf(none)).not.toContain("no account behind");
  });

  it("with nothing counted and admins left out, says so and points at “Include admins”", () => {
    const empty = html(<ToolsOverviewView params={base} data={{ rows: [], totals: EMPTY_TOOL_TOTALS, previous: EMPTY_TOOL_TOTALS, spend }} />);
    expect(textOf(empty)).toContain("Nobody outside the team opened a tool in the last 30 days. The team’s own accounts are left out here");
    expect(empty).toContain('href="/admin/analytics?tab=tools&amp;admins=1"');
    expect(textOf(empty)).toContain("Include admins");
    // no chart, no table of zeros that reads as "nobody ever"
    expect(empty).not.toContain("<table");
  });

  it("with nothing counted and admins included, just says nobody did", () => {
    const empty = html(
      <ToolsOverviewView params={{ ...base, admins: true, days: 7 }} data={{ rows: [], totals: EMPTY_TOOL_TOTALS, previous: EMPTY_TOOL_TOTALS, spend: null }} />,
    );
    expect(textOf(empty)).toContain("Nobody opened a tool in the last 7 days.");
    expect(empty).not.toContain("admins=1");
  });
});

const numbers: ToolNumbers = {
  current: {
    // Token Kit: what its AI cost is not known from the ledger
    totals: totalsOf({ users: 5, usingUsers: 3, opens: 20, uses: 12, failures: 4, credits: null, visitorEvents: 2 }),
    daily: [
      { day: "2026-11-08", opens: 8, uses: 5, failures: 1, users: 3 },
      { day: "2026-11-09", opens: 12, uses: 7, failures: 3, users: 4 },
      { day: "2026-11-10", opens: 0, uses: 0, failures: 0, users: 0 },
    ],
    events: [
      { event: "open", count: 20, users: 5 },
      { event: "kit_built", count: 9, users: 3 },
      { event: "ai_art_failed", count: 3, users: 2 },
      { event: "kit_exported", count: 3, users: 2 },
      { event: "kit_export_done", count: 2, users: 2 },
      { event: "render_refused", count: 1, users: 1 },
    ],
    reasons: [
      { event: "ai_art_failed", reason: "insufficient_credits", count: 2 },
      { event: "ai_art_failed", reason: "art_timeout", count: 1 },
    ],
  },
  previous: totalsOf({ users: 2, usingUsers: 1, opens: 5, uses: 6, failures: 0, credits: null }),
};

const person = (n: number, over: Partial<ToolUserRow> = {}): ToolUserRow => ({
  userId: `d0000000-0000-4000-a000-00000000000${n}`,
  username: `user_${n}`,
  isAdmin: false,
  access: "grant",
  opens: 4,
  uses: 10 - n,
  failures: n,
  activeDays: 2,
  firstAt: "2026-10-20T10:00:00+00:00",
  lastAt: "2026-11-09T10:00:00+00:00",
  ...over,
});

const people: ToolUsersPage = {
  rows: [person(2), person(1, { isAdmin: true, access: "admin" }), person(3, { username: null, access: "release" }), person(4, { access: null })],
  total: 120,
  page: 2,
  pageSize: 50,
};

const userLog: ToolUserLog = {
  username: "dev_pro",
  events: [
    { at: "2026-11-09T04:10:00+00:00", event: "ai_art_failed", access: "grant", props: { reason: "insufficient_credits", refunded: true } },
    { at: "2026-11-09T04:05:00+00:00", event: "kit_built", access: "grant", props: { tokens: 14, note: "<b>bold</b>" } },
    { at: "2026-11-09T04:00:00+00:00", event: "open", access: "grant", props: {} },
  ],
};

describe("one tool", () => {
  const params: AnalyticsParams = { ...base, tool: "token-kit", page: 2 };
  const out = html(<ToolDetailView params={params} tool={tokenKit} numbers={numbers} people={people} log={undefined} />);
  const text = textOf(out);

  it("names the tool, links back to all tools and on to its release page", () => {
    expect(out).toMatch(/<h2[^>]*>Token Kit<\/h2>/);
    expect(out).toMatch(/<a href="\/admin\/analytics\?tab=tools"[^>]*>.*Back to all tools<\/a>/);
    expect(out).toMatch(/<a href="\/admin\/tools\/token-kit"[^>]*>Release and testers<\/a>/);
  });

  it("shows the tool's six numbers against the period before", () => {
    expect(out).toMatch(/People who used it<\/dt><dd[^>]*>3<\/dd>/);
    expect(text).toContain("5 people opened or used it");
    expect(out).toMatch(/Uses<\/dt><dd[^>]*>12<\/dd>/);
    expect(text).toContain("+100% vs the previous 30 days (6)");
    // 12 of 16 tries
    expect(out).toMatch(/Success rate<\/dt><dd[^>]*>75%<\/dd>/);
    // the period before had no failures and 6 uses
    expect(text).toContain("100% in the previous 30 days");
  });

  it("Token Kit's “Credits spent” is a dash that says why: its AI spends under the card creator's reason", () => {
    expect(tile(out, "Credits spent")).toBe(
      "Credits spent — Not known: this tool's AI spends under the card creator's reason in the credit ledger.",
    );
    expect(text).not.toContain("Credits charged");
  });

  it("a tool with spend reasons of its own shows the ledger's figure against the period before", () => {
    const forge = toolBySlug("pip-forge")!;
    const paid: ToolNumbers = {
      current: { ...numbers.current, totals: { ...numbers.current.totals, credits: 5 } },
      previous: { ...numbers.previous, credits: 2 },
    };
    const view = html(<ToolDetailView params={{ ...params, tool: "pip-forge" }} tool={forge} numbers={paid} people={people} log={undefined} />);
    expect(tile(view, "Credits spent")).toBe("Credits spent 5 +150% vs the previous 30 days (2) On this tool's AI, from the credit ledger.");

    // nobody spent: a 0 that IS the ledger's answer, compared like any other
    const free: ToolNumbers = { current: { ...numbers.current, totals: { ...numbers.current.totals, credits: 0 } }, previous: { ...numbers.previous, credits: 4 } };
    const none = html(<ToolDetailView params={{ ...params, tool: "pip-forge" }} tool={forge} numbers={free} people={people} log={undefined} />);
    expect(tile(none, "Credits spent")).toBe("Credits spent 0 −100% vs the previous 30 days (4) On this tool's AI, from the credit ledger.");
  });

  it("a tool the ledger CAN tell apart, with a ledger that was not read, says the ledger could not be read — never Token Kit's reason", () => {
    const forge = toolBySlug("pip-forge")!;
    const unread: ToolNumbers = {
      current: { ...numbers.current, totals: { ...numbers.current.totals, credits: null } },
      previous: { ...numbers.previous, credits: null },
    };
    const view = html(<ToolDetailView params={{ ...params, tool: "pip-forge" }} tool={forge} numbers={unread} people={people} log={undefined} />);
    expect(tile(view, "Credits spent")).toBe("Credits spent — The credit ledger could not be read.");
    expect(textOf(view)).not.toContain("card creator's reason");
  });

  it("draws uses and opens as TWO charts — one measure each — with every day's number in its table", () => {
    expect(out).toMatch(/<h3[^>]*>Uses per day<\/h3>/);
    expect(out).toMatch(/<h3[^>]*>Opens per day<\/h3>/);
    // newest day first; a quiet day is left out of the table
    expect(tableRows(out, "Token Kit: uses per day in the last 30 days")).toEqual([
      ["Day (UTC)", "Uses"],
      ["Nov 9, 2026", "7"],
      ["Nov 8, 2026", "5"],
    ]);
    expect(tableRows(out, "Token Kit: opens per day in the last 30 days")).toEqual([
      ["Day (UTC)", "Opens"],
      ["Nov 9, 2026", "12"],
      ["Nov 8, 2026", "8"],
    ]);
    expect(out).not.toMatch(/bg-chart-2/);
  });

  it("lists what happened: uses first, then failures, then the rest, each with its kind in words", () => {
    expect(tableRows(out, "Token Kit: every event in the last 30 days")).toEqual([
      ["What", "Kind", "Times", "People"],
      ["kit built", "Use", "9", "3"],
      ["kit exported", "Use", "3", "2"],
      ["ai art failed", "Failure", "3", "2"],
      ["render refused", "Failure", "1", "1"],
      ["open", "Visit", "20", "5"],
      ["kit export done", "Step", "2", "2"],
    ]);
    expect(text).toContain("2 of these have no account behind them (a shared sheet’s visitors, or an account since deleted), so they are in nobody’s “People” count.");
    const one = html(
      <ToolDetailView
        params={params}
        tool={tokenKit}
        numbers={{ ...numbers, current: { ...numbers.current, totals: { ...numbers.current.totals, visitorEvents: 1 } } }}
        people={people}
        log={undefined}
      />,
    );
    expect(textOf(one)).toContain("1 of these has no account behind it");
  });

  it("says why things failed in plain words, and how many failures gave no reason", () => {
    expect(tableRows(out, "Token Kit: why things failed in the last 30 days")).toEqual([
      ["What failed and why", "Times"],
      ["ai art failed · Out of credits", "2"],
      ["ai art failed · art timeout", "1"],
    ]);
    // 4 failures, 3 with a reason
    expect(text).toContain("1 more failure gave no reason.");
  });

  it("lists EVERYONE who used it: the person, how they got in, their numbers, and a link to their event log", () => {
    const rows = tableRows(out, "Everyone who used Token Kit in the last 30 days");
    expect(rows[0]).toEqual(["Person", "How they got in", "Opens", "Uses", "Failures", "Days active", "First seen", "Last seen", "Event log"]);
    expect(rows[1]).toEqual(["@user_2", "Tester access", "4", "8", "2", "2", "Oct 20, 2026 UTC", "Nov 9, 2026 UTC", "Event log"]);
    expect(rows[2][0]).toBe("@user_1 Admin");
    expect(rows[2][1]).toBe("As an admin");
    expect(rows[3].slice(0, 2)).toEqual(["(no username)", "Their plan"]);
    expect(rows[4][1]).toBe("—");
    expect(rows).toHaveLength(5);
    // a person is a link to their admin page
    expect(out).toContain('href="/admin/users?u=d0000000-0000-4000-a000-000000000002"');
    // their log keeps the tool, the period and the page, and lands on the log
    expect(out).toContain(`href="/admin/analytics?tab=tools&amp;tool=token-kit&amp;user=${USER}&amp;page=2#event-log"`);
    expect(out).toContain('aria-label="Event log of @user_2"');
  });

  it("pages 50 at a time: which rows these are, and Previous / Next that stay on the list", () => {
    expect(text).toContain("Showing 51–100 of 120");
    expect(text).toContain("Page 2 of 3");
    expect(out).toMatch(/<a href="\/admin\/analytics\?tab=tools&amp;tool=token-kit#people"[^>]*>.*Previous<\/a>/);
    expect(out).toMatch(/<a href="\/admin\/analytics\?tab=tools&amp;tool=token-kit&amp;page=3#people"[^>]*>Next.*<\/a>/);

    const last = html(<ToolDetailView params={{ ...params, page: 3 }} tool={tokenKit} numbers={numbers} people={{ ...people, page: 3, rows: [person(5)] }} log={undefined} />);
    expect(textOf(last)).toContain("Showing 101–120 of 120");
    // the end of the list: Next is words, not a link
    expect(last).toMatch(/<span aria-disabled="true"[^>]*>Next/);
    expect(last).not.toContain("page=4");

    const few = html(<ToolDetailView params={{ ...params, page: 1 }} tool={tokenKit} numbers={numbers} people={{ ...people, page: 1, total: 4 }} log={undefined} />);
    expect(textOf(few)).toContain("Showing 1–4 of 4");
    expect(few).not.toContain("Previous");
  });

  it("a page past the end says where the list ends, with the way back", () => {
    const past = html(<ToolDetailView params={{ ...params, page: 9 }} tool={tokenKit} numbers={numbers} people={{ rows: [], total: 120, page: 9, pageSize: 50 }} log={undefined} />);
    expect(textOf(past)).toContain("No more people: the list ends on page 3.");
    expect(past).toContain('href="/admin/analytics?tab=tools&amp;tool=token-kit&amp;page=3#people"');
  });

  it("opens no event log until the address names a person", () => {
    expect(out).not.toContain('id="event-log"');
  });
});

describe("one person's event log", () => {
  const params: AnalyticsParams = { ...base, tool: "token-kit", user: USER, page: 2 };
  const out = html(<ToolDetailView params={params} tool={tokenKit} numbers={numbers} people={people} log={userLog} />);

  it("sits above the people list, named for the person and the tool, with a way to close it", () => {
    expect(out).toMatch(/<h3[^>]*>@dev_pro’s events in Token Kit<\/h3>/);
    expect(out.indexOf('id="event-log"')).toBeGreaterThan(0);
    expect(out.indexOf('id="event-log"')).toBeLessThan(out.indexOf('id="people"'));
    // Close drops the person and keeps the tool and the page
    expect(out).toMatch(/<a href="\/admin\/analytics\?tab=tools&amp;tool=token-kit&amp;page=2#people"[^>]*>Close<\/a>/);
    expect(out).toMatch(new RegExp(`<a href="/admin/users\\?u=${USER}"[^>]*>Open their account</a>`));
    // the row whose log is open says so
    expect(out).toMatch(new RegExp(`user=${USER}&amp;page=2#event-log" aria-current="true"`));
  });

  it("lists when, what, its kind and its props as plain key: value text", () => {
    expect(tableRows(out, "@dev_pro’s events in Token Kit, newest first")).toEqual([
      ["When", "What", "Kind", "Details"],
      ["Nov 9, 2026, 4:10 AM UTC", "ai art failed", "Failure", "reason: insufficient_credits · refunded: yes"],
      ["Nov 9, 2026, 4:05 AM UTC", "kit built", "Use", "tokens: 14 · note: <b>bold</b>"],
      ["Nov 9, 2026, 4:00 AM UTC", "open", "Visit", "—"],
    ]);
  });

  it("prints a prop's value as text, never as markup", () => {
    expect(out).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(out).not.toContain("<b>bold</b>");
    expect(out).not.toContain("dangerouslySetInnerHTML");
  });

  it("says so when the person has nothing in this tool, and when their log could not be read", () => {
    const none = html(<ToolDetailView params={params} tool={tokenKit} numbers={numbers} people={people} log={{ username: null, events: [] }} />);
    expect(none).toMatch(/<h3[^>]*>This person’s events in Token Kit<\/h3>/);
    expect(textOf(none)).toContain("Nothing is recorded for this person in Token Kit.");
    const failed = html(<ToolDetailView params={params} tool={tokenKit} numbers={numbers} people={people} log={null} />);
    expect(textOf(failed)).toContain("Couldn’t load this person’s events.");
  });
});

describe("a block that could not be read says so in its own place", () => {
  const params: AnalyticsParams = { ...base, tool: "token-kit" };

  it("the numbers failed: the people are still listed", () => {
    const out = html(<ToolDetailView params={params} tool={tokenKit} numbers={null} people={people} log={undefined} />);
    expect(textOf(out)).toContain("Couldn’t load Token Kit’s numbers.");
    expect(out).not.toContain("Uses per day");
    expect(textOf(out)).toContain("@user_2");
  });

  it("the people failed: the numbers are still shown", () => {
    const out = html(<ToolDetailView params={params} tool={tokenKit} numbers={numbers} people={null} log={undefined} />);
    expect(textOf(out)).toContain("Couldn’t load the people who used Token Kit.");
    expect(out).toContain("Uses per day");
  });
});

describe("a tool nobody touched in the period", () => {
  const quiet: ToolNumbers = { current: { totals: EMPTY_TOOL_TOTALS, daily: [], events: [], reasons: [] }, previous: EMPTY_TOOL_TOTALS };
  const nobody: ToolUsersPage = { rows: [], total: 0, page: 1, pageSize: 50 };

  it("says so once, points at “Include admins”, and draws no empty charts or lists", () => {
    const params: AnalyticsParams = { ...base, tool: "token-kit" };
    const out = html(<ToolDetailView params={params} tool={tokenKit} numbers={quiet} people={nobody} log={undefined} />);
    expect(textOf(out)).toContain("Nobody outside the team opened Token Kit in the last 30 days.");
    expect(out).toContain('href="/admin/analytics?tab=tools&amp;admins=1&amp;tool=token-kit"');
    expect(out).not.toContain("Uses per day");
    expect(out).not.toContain('id="people"');
    expect(out).toMatch(/Back to all tools/);
  });

  it("still opens a person's log (it is not held to the period)", () => {
    const params: AnalyticsParams = { ...base, admins: true, tool: "token-kit", user: USER };
    const out = html(<ToolDetailView params={params} tool={tokenKit} numbers={quiet} people={nobody} log={userLog} />);
    expect(textOf(out)).toContain("Nobody opened Token Kit in the last 30 days.");
    expect(out).toMatch(/@dev_pro’s events in Token Kit/);
  });
});

describe("ToolsTab — the address picks the view, and only that view's reads run", () => {
  it("no tool: reads the overview for the period and the switch", async () => {
    reads.getToolsOverview.mockResolvedValue(overview);
    const out = html(await ToolsTab({ params: { ...base, days: 7, admins: true } }));
    expect(out).toContain("Every tool");
    // the ledger's figures, as the loader handed them over
    expect(out).toMatch(/Credits spent<\/dt><dd[^>]*>9<\/dd>/);
    expect(tableRows(out, "Every tool in the last 7 days")[2].slice(0, 8)).toEqual(["Token Kit", "5", "3", "20", "12", "1", "92%", "—"]);
    expect(out).not.toContain("Credits charged");
    expect(reads.getToolsOverview).toHaveBeenCalledTimes(1);
    const [period, admins] = reads.getToolsOverview.mock.calls[0];
    expect(period.days).toBe(7);
    expect(period.dayKeys).toHaveLength(7);
    expect(admins).toBe(true);
    expect(reads.getToolNumbers).not.toHaveBeenCalled();
    expect(reads.getToolUsers).not.toHaveBeenCalled();
    expect(reads.getToolUserLog).not.toHaveBeenCalled();
  });

  it("no tool, and the read failed: says so — never a page of zeros", async () => {
    reads.getToolsOverview.mockResolvedValue(null);
    const out = html(await ToolsTab({ params: base }));
    expect(textOf(out)).toContain("Couldn’t load the tools’ numbers.");
    expect(out).not.toContain("<table");
  });

  it("a tool: reads its numbers and its people's page — and no log", async () => {
    reads.getToolNumbers.mockResolvedValue(numbers);
    reads.getToolUsers.mockResolvedValue(people);
    const out = html(await ToolsTab({ params: { ...base, tool: "token-kit", page: 2 } }));
    expect(out).toContain("Everyone who used it");
    expect(reads.getToolNumbers).toHaveBeenCalledWith("token-kit", expect.objectContaining({ days: 30 }), false);
    expect(reads.getToolUsers).toHaveBeenCalledWith("token-kit", expect.objectContaining({ days: 30 }), false, 2);
    expect(reads.getToolUserLog).not.toHaveBeenCalled();
    expect(reads.getToolsOverview).not.toHaveBeenCalled();
    expect(out).not.toContain('id="event-log"');
  });

  it("a tool and a person: reads that person's log too", async () => {
    reads.getToolNumbers.mockResolvedValue(numbers);
    reads.getToolUsers.mockResolvedValue(people);
    reads.getToolUserLog.mockResolvedValue(userLog);
    const out = html(await ToolsTab({ params: { ...base, admins: true, days: 90, tool: "token-kit", user: USER } }));
    expect(reads.getToolUserLog).toHaveBeenCalledWith("token-kit", USER);
    expect(reads.getToolNumbers).toHaveBeenCalledWith("token-kit", expect.objectContaining({ days: 90 }), true);
    expect(out).toMatch(/@dev_pro’s events in Token Kit/);
  });

  it("a slug the catalog doesn't have: a short note and the way back — no read at all", async () => {
    const out = html(await ToolsTab({ params: { ...base, tool: "no-such-tool" } }));
    expect(textOf(out)).toContain("There is no tool called “no-such-tool”.");
    expect(out).toMatch(/<a href="\/admin\/analytics\?tab=tools"[^>]*>Back to all tools<\/a>/);
    for (const read of Object.values(reads)) expect(read).not.toHaveBeenCalled();
  });
});
