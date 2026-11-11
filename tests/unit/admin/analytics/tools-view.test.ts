import { describe, expect, it } from "vitest";
import {
  ALL_TOOLS,
  EMPTY_TOOL_TOTALS,
  accessWords,
  eventKindWords,
  eventWords,
  failureLabel,
  failureReasonWords,
  orderToolEvents,
  pageWindow,
  parseToolBreakdown,
  parseToolTotals,
  peopleText,
  propPairs,
  successRate,
  toolAnalyticsHref,
  toolListRows,
  toolNameOf,
  toolsAnalyticsHref,
  userToolLogHref,
  type ToolOverviewRow,
} from "@/lib/admin/analytics/tools-view";
import { parseAnalyticsParams } from "@/lib/admin/analytics/params";
import { TOOL_CATALOG, TOOL_USE_EVENTS, toolReasonOfCode } from "@/lib/tools/catalog";

// ---------------------------------------------------------------------------
// The Tools tab's shapes and words (lib/admin/analytics/tools-view.ts): what
// 0204's readers answer, read defensively, and how a tool, an event, a
// failure's reason and a person's path are said to the person reading.
//
// The tool log holds NO credits: what a tool cost is the credit ledger's,
// filled in by the loader (lib/admin/analytics/tools.ts). So everything
// read here says `credits: null` — "not known from this" — never a number.
// ---------------------------------------------------------------------------

const row = (slug: string, over: Partial<ToolOverviewRow> = {}): ToolOverviewRow => ({
  slug,
  users: 0,
  usingUsers: 0,
  opens: 0,
  uses: 0,
  failures: 0,
  credits: null,
  lastEventAt: null,
  ...over,
});

describe("parseToolBreakdown — the jsonb, read defensively", () => {
  const answer = {
    slug: "token-kit",
    totals: {
      users: 4,
      using_users: 3,
      opens: 9,
      uses: 12,
      failures: 2,
      visitor_events: 1,
      last_event_at: "2026-11-09T04:00:00+00:00",
    },
    daily: [
      { day: "2026-11-08", opens: 4, uses: 5, failures: 0, users: 2 },
      { day: "2026-11-09", opens: 5, uses: 7, failures: 2, users: 3 },
    ],
    events: [
      { tool_slug: "token-kit", event: "kit_built", count: 8, users: 3 },
      { tool_slug: "token-kit", event: "open", count: 9, users: 4 },
    ],
    reasons: [{ tool_slug: "token-kit", event: "ai_art_failed", reason: "insufficient_credits", count: 2 }],
  };

  it("maps every key the SQL writes", () => {
    expect(parseToolBreakdown(answer)).toEqual({
      totals: {
        users: 4,
        usingUsers: 3,
        opens: 9,
        uses: 12,
        failures: 2,
        // not the tool log's to say: the loader reads it from the ledger
        credits: null,
        visitorEvents: 1,
        lastEventAt: "2026-11-09T04:00:00+00:00",
      },
      daily: answer.daily,
      events: [
        { event: "kit_built", count: 8, users: 3 },
        { event: "open", count: 9, users: 4 },
      ],
      reasons: [{ event: "ai_art_failed", reason: "insufficient_credits", count: 2 }],
    });
  });

  it("never reads credits out of the tool log: a `credits` in an answer is a start's price, not a charge", () => {
    // 40 = the price of a run that was refused for lack of credits
    for (const credits of [40, "40", 0, null]) {
      expect(parseToolTotals({ uses: 3, credits }).credits, String(credits)).toBeNull();
      expect(parseToolBreakdown({ ...answer, totals: { ...answer.totals, credits } }).totals.credits, String(credits)).toBeNull();
    }
    expect(JSON.stringify(parseToolBreakdown({ ...answer, totals: { ...answer.totals, credits: 40 } }))).not.toContain("40");
    // nothing read at all: still "not known", never a 0 that reads as "nobody paid"
    expect(EMPTY_TOOL_TOTALS.credits).toBeNull();
  });

  it("an empty, null or odd answer is zeros and empty lists — never a throw", () => {
    const empty = { totals: EMPTY_TOOL_TOTALS, daily: [], events: [], reasons: [] };
    expect(parseToolBreakdown(null)).toEqual(empty);
    expect(parseToolBreakdown("nope")).toEqual(empty);
    expect(parseToolBreakdown({ totals: [], daily: {}, events: "x" })).toEqual(empty);
    expect(parseToolTotals({ users: "7", opens: "x", credits: Number.NaN })).toEqual({ ...EMPTY_TOOL_TOTALS, users: 7 });
  });

  it("drops a row with no name (a day, an event, a reason) rather than drawing a blank one", () => {
    const parsed = parseToolBreakdown({
      daily: [{ opens: 3 }, { day: "2026-11-09", uses: 1 }],
      events: [{ count: 3 }, { event: "open", count: 1 }],
      reasons: [{ event: "ai_art_failed", count: 3 }, { reason: "invalid", count: 1 }],
    });
    expect(parsed.daily).toEqual([{ day: "2026-11-09", opens: 0, uses: 1, failures: 0, users: 0 }]);
    expect(parsed.events).toEqual([{ event: "open", count: 1, users: 0 }]);
    expect(parsed.reasons).toEqual([]);
  });

  it("'*' is the slug for every tool together — never a slug a tool could have", () => {
    expect(ALL_TOOLS).toBe("*");
    expect(parseAnalyticsParams({ tool: ALL_TOOLS }).tool).toBeNull();
  });
});

describe("toolListRows — every tool the page lists", () => {
  it("lists every built tool, a quiet one with zeros, most uses first", () => {
    const rows = toolListRows([row("token-kit", { uses: 5, usingUsers: 2 }), row("rule0-sheet", { uses: 9, usingUsers: 4, credits: 3 })]);
    expect(rows).toHaveLength(TOOL_CATALOG.length);
    // a row keeps the credits its loader gave it: a number, or "not known"
    expect(rows.slice(0, 2).map((r) => r.credits)).toEqual([3, null]);
    expect(rows.slice(0, 2).map((r) => [r.slug, r.name, r.uses])).toEqual([
      ["rule0-sheet", "Rule 0 Table Sheet", 9],
      ["token-kit", "Token Kit", 5],
    ]);
    // the rest: zeros, in the catalog's own order
    const quiet = rows.slice(2);
    expect(quiet.every((r) => r.uses === 0 && r.opens === 0 && r.lastEventAt === null && r.inCatalog)).toBe(true);
    // a quiet tool's credits are not a 0 of the log's making: the view fills in the ledger's figure
    expect(quiet.every((r) => r.credits === null)).toBe(true);
    expect(quiet.map((r) => r.slug)).toEqual(TOOL_CATALOG.map((t) => t.slug).filter((slug) => slug !== "rule0-sheet" && slug !== "token-kit"));
  });

  it("keeps a slug the catalog no longer lists, under its slug, so the list adds up to the totals", () => {
    const rows = toolListRows([row("retired-tool", { uses: 3, opens: 4 })]);
    expect(rows).toHaveLength(TOOL_CATALOG.length + 1);
    expect(rows[0]).toMatchObject({ slug: "retired-tool", name: "retired-tool", inCatalog: false, uses: 3 });
    expect(toolNameOf("retired-tool")).toBe("retired-tool");
    expect(toolNameOf("pip-forge")).toBe("Pip Forge");
  });

  it("with no events at all, still lists the catalog", () => {
    expect(toolListRows([]).map((r) => r.slug)).toEqual(TOOL_CATALOG.map((t) => t.slug));
  });
});

describe("words", () => {
  it("the success rate is uses out of uses and failures", () => {
    expect(successRate(9, 1)).toBe("90%");
    expect(successRate(0, 4)).toBe("0%");
    expect(successRate(0, 0)).toBe("—");
  });

  it("people are counted in words", () => {
    expect(peopleText(1)).toBe("1 person");
    expect(peopleText(0)).toBe("0 people");
    expect(peopleText(1284)).toBe("1,284 people");
  });

  it("an event's kind is the catalog's reading of its name", () => {
    expect(eventKindWords("collection-builder", "open")).toBe("Visit");
    expect(eventKindWords("collection-builder", "ai_build")).toBe("Use");
    expect(eventKindWords("collection-builder", "ai_build_failed")).toBe("Failure");
    expect(eventKindWords("token-kit", "render_refused")).toBe("Failure");
    expect(eventKindWords("rule0-sheet", "ai_draft_lost")).toBe("Failure");
    expect(eventKindWords("collection-builder", "plan")).toBe("Step");
    // every listed use reads as a use
    for (const [slug, events] of Object.entries(TOOL_USE_EVENTS)) for (const event of events) expect(eventKindWords(slug, event), `${slug}/${event}`).toBe("Use");
    expect(eventWords("ai_build_failed")).toBe("ai build failed");
  });

  it("'What happened' lists uses first, then failures, then the rest — each as frequent as given", () => {
    const ordered = orderToolEvents("collection-builder", [
      { event: "open", count: 40, users: 9 },
      { event: "ai_build_failed", count: 12, users: 3 },
      { event: "import", count: 10, users: 5 },
      { event: "plan", count: 8, users: 4 },
      { event: "ai_build", count: 6, users: 2 },
      { event: "draft_refused", count: 1, users: 1 },
    ]);
    expect(ordered.map((r) => [r.event, r.kindWords])).toEqual([
      ["import", "Use"],
      ["ai_build", "Use"],
      ["ai_build_failed", "Failure"],
      ["draft_refused", "Failure"],
      ["open", "Visit"],
      ["plan", "Step"],
    ]);
  });

  it("a failure's reason is said in plain words where the tools share one, else as its code with spaces", () => {
    expect(failureReasonWords("insufficient_credits")).toBe("Out of credits");
    expect(failureReasonWords("rate_limited")).toBe("Too many at once");
    expect(failureReasonWords("capacity")).toBe("Card limit reached");
    expect(failureReasonWords("invalid")).toBe("Couldn't read the request");
    expect(failureReasonWords("ai_unavailable")).toBe("AI unavailable");
    expect(failureReasonWords("daily_limit")).toBe("Daily limit reached");
    // the vocabulary the tools write (toolReasonOfCode): the card limit is `capacity` in every tool
    expect(failureReasonWords(toolReasonOfCode("CARD_CAPACITY"))).toBe("Card limit reached");
    expect(failureReasonWords(toolReasonOfCode("INSUFFICIENT_CREDITS"))).toBe("Out of credits");
    // anything else: its code, underscores as spaces — never a guess, never a property of Object
    expect(failureReasonWords("scryfall_unavailable")).toBe("scryfall unavailable");
    expect(failureReasonWords("art_timeout")).toBe("art timeout");
    expect(failureReasonWords("toString")).toBe("toString");
    expect(failureLabel({ event: "ai_build_failed", reason: "insufficient_credits" })).toBe("ai build failed · Out of credits");
    expect(failureLabel({ event: "export_build_failed", reason: "render_error" })).toBe("export build failed · render error");
  });

  it("how someone got in is said in words", () => {
    expect(accessWords("admin")).toBe("As an admin");
    expect(accessWords("grant")).toBe("Tester access");
    expect(accessWords("release")).toBe("Their plan");
    expect(accessWords(null)).toBe("—");
    expect(accessWords("constructor")).toBe("constructor");
  });

  it("an event's props are `key: value` text: keys in words, booleans as yes / no, nothing interpreted", () => {
    expect(propPairs({ cards: 1200, refunded: true, refund_pending: false, reason: "rate_limited", credits_seen: 2.5, note: null })).toEqual([
      { key: "cards", value: "1,200" },
      { key: "refunded", value: "yes" },
      { key: "refund pending", value: "no" },
      { key: "reason", value: "rate_limited" },
      { key: "credits seen", value: "2.5" },
      { key: "note", value: "—" },
    ]);
    // markup stays text; a shape the tools never write is shown as its JSON
    expect(propPairs({ html: "<b>x</b>", odd: { a: 1 } })).toEqual([
      { key: "html", value: "<b>x</b>" },
      { key: "odd", value: '{"a":1}' },
    ]);
    expect(propPairs(null)).toEqual([]);
    expect(propPairs([1, 2])).toEqual([]);
    expect(propPairs("text")).toEqual([]);
  });
});

describe("paging and links", () => {
  it("says which rows a page shows and how many pages there are", () => {
    expect(pageWindow(1, 50, 120)).toEqual({ from: 1, to: 50, pages: 3 });
    expect(pageWindow(3, 50, 120)).toEqual({ from: 101, to: 120, pages: 3 });
    expect(pageWindow(1, 50, 50)).toEqual({ from: 1, to: 50, pages: 1 });
    expect(pageWindow(1, 50, 0)).toEqual({ from: 0, to: 0, pages: 1 });
    // a page past the end never claims rows that are not there
    expect(pageWindow(9, 50, 120)).toEqual({ from: 120, to: 120, pages: 3 });
  });

  it("links to the tab, to one tool for a period, and to one person's log", () => {
    expect(toolsAnalyticsHref()).toBe("/admin/analytics?tab=tools");
    expect(toolAnalyticsHref("token-kit")).toBe("/admin/analytics?tab=tools&tool=token-kit");
    expect(toolAnalyticsHref("token-kit", 90)).toBe("/admin/analytics?tab=tools&days=90&tool=token-kit");
    // from the Users page: 90 days and admins included, so the person is on the list whoever they are
    const id = "d0000000-0000-4000-a000-000000000002";
    expect(userToolLogHref("token-kit", id)).toBe(`/admin/analytics?tab=tools&days=90&admins=1&tool=token-kit&user=${id}#event-log`);
    // …and the page reads that address back
    const query = Object.fromEntries(new URL(userToolLogHref("token-kit", id), "https://x.test").searchParams);
    expect(parseAnalyticsParams(query)).toEqual({ tab: "tools", days: 90, admins: true, tool: "token-kit", user: id, page: 1 });
  });
});
