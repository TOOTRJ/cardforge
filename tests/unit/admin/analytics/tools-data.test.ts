import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreditFlow, CreditSpendRow } from "@/lib/admin/analytics/credits";

// ---------------------------------------------------------------------------
// The Tools tab's reads (lib/admin/analytics/tools.ts): every one is a
// function of migration 0204, asked for the page's period with the app's
// own list of what a USE is (`p_uses` = TOOL_USE_EVENTS — exactly as
// /admin/tools asks) and the "Include admins" switch. A read that fails is
// logged and null — never zeros that read as "nobody used it".
//
// Each reader checks the viewer is an admin ITSELF (requireAdminClient):
// anyone else gets null and nothing is read. And what a tool COST is the
// credit ledger's (getCreditFlow, by the tool's own spend reasons) — never
// an event's `credits` prop, which is a start's price.
// ---------------------------------------------------------------------------

type Answer = { data: unknown; error: { message: string; code?: string } | null };

const db = vi.hoisted(() => ({
  /** Whether the viewer is an admin: what requireAdminClient answers. */
  admin: true,
  /** How often a reader asked who the viewer is. */
  gate: 0,
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  answer: (() => ({ data: null, error: null })) as (name: string, args: Record<string, unknown>) => { data: unknown; error: { message: string; code?: string } | null },
  profile: { data: { username: "dev_pro" } as unknown, error: null as { message: string } | null },
  profileReads: [] as Array<[string, unknown]>,
  /** The credit ledger: what getCreditFlow answers for a window that starts
   *  at `since` (null = the ledger could not be read). */
  flow: (() => null) as (since: string) => CreditFlow | null,
  flowCalls: [] as Array<[since: string, until: string, includeAdmins: boolean]>,
}));

function fakeAdmin() {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      db.calls.push({ name, args });
      return db.answer(name, args);
    },
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: unknown) => ({
          maybeSingle: async () => {
            db.profileReads.push([`${table}.${columns}.${column}`, value]);
            return db.profile;
          },
        }),
      }),
    }),
  };
}

vi.mock("server-only", () => ({}));
// The client the Users page hands getUserToolUsage (it has checked the viewer).
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeAdmin() }));
// The readers' own gate: the service client for an admin, null for anyone else.
vi.mock("@/lib/admin/users-queries", () => ({
  requireAdminClient: async () => {
    db.gate += 1;
    return db.admin ? fakeAdmin() : null;
  },
}));
// The ledger's read is the Credits tab's (its own tests hold it); which tool
// a reason belongs to — spendingByTool — stays the real one.
vi.mock("@/lib/admin/analytics/credits", async () => ({
  ...(await vi.importActual<typeof import("@/lib/admin/analytics/credits")>("@/lib/admin/analytics/credits")),
  getCreditFlow: async (window: { since: Date; until: Date }, includeAdmins: boolean) => {
    db.flowCalls.push([window.since.toISOString(), window.until.toISOString(), includeAdmins]);
    return db.flow(window.since.toISOString());
  },
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { CREDIT_REASON_TOOLS } from "@/lib/admin/analytics/credits";
import { analyticsPeriod } from "@/lib/admin/analytics/params";
import {
  LEDGER_BLIND_TOOLS,
  getToolNumbers,
  getToolUserLog,
  getToolUsers,
  getToolsOverview,
  getUserToolUsage,
  ledgerCreditsOf,
} from "@/lib/admin/analytics/tools";
import { TOOL_CATALOG, TOOL_USE_EVENTS } from "@/lib/tools/catalog";

const NOW = new Date("2026-11-10T15:30:00.000Z");
const period = analyticsPeriod(30, NOW);
const SINCE = "2026-10-12T00:00:00.000Z";
const UNTIL = NOW.toISOString();
// The period before is the same stretch 30 days earlier, cut at the same
// time of day — it does NOT run up to this period's start.
const PREVIOUS_SINCE = "2026-09-12T00:00:00.000Z";
const PREVIOUS_UNTIL = "2026-10-11T15:30:00.000Z";
const USER = "d0000000-0000-4000-a000-000000000002";
const FAIL: Answer = { data: null, error: { message: "boom" } };

/** A breakdown's totals as 0204 writes them: no credits among them. */
const totals = (uses: number, users: number) => ({
  totals: { users, using_users: users, opens: 3, uses, failures: 1, visitor_events: 0, last_event_at: null },
});

const spent = (reason: string, credits: number, refunded = 0): CreditSpendRow => ({
  reason,
  spent: credits,
  spends: credits,
  refunded,
  refunds: refunded,
});

/** The ledger's flow for a window, as getCreditFlow answers it. */
function flowOf(rows: CreditSpendRow[]): CreditFlow {
  const sum = (key: "spent" | "spends" | "refunded" | "refunds") => rows.reduce((n, row) => n + row[key], 0);
  return {
    totals: { spent: sum("spent"), spends: sum("spends"), refunded: sum("refunded"), refunds: sum("refunds"), granted: 0, grants: 0, takenBack: 0, takeBacks: 0 },
    spentByReason: rows,
    refundedUnattributed: { credits: 0, refunds: 0 },
    grantedByReason: [],
    days: [],
  };
}

/** A ledger nobody spent from, in either period. */
const QUIET_LEDGER = () => flowOf([]);

let log: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  db.admin = true;
  db.gate = 0;
  db.calls.length = 0;
  db.profileReads.length = 0;
  db.flowCalls.length = 0;
  db.answer = () => ({ data: null, error: null });
  db.profile = { data: { username: "dev_pro" }, error: null };
  db.flow = QUIET_LEDGER;
  log = vi.spyOn(console, "error").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  log.mockRestore();
  warn.mockRestore();
});

describe("every read says what a use is and whether the team counts", () => {
  it("hands TOOL_USE_EVENTS as p_uses and the switch as p_include_admins — on every call", async () => {
    db.answer = (name) => (name === "admin_tool_breakdown" ? { data: totals(1, 1), error: null } : { data: [], error: null });
    await getToolsOverview(period, false);
    await getToolNumbers("token-kit", period, true);
    await getToolUsers("token-kit", period, true, 1);
    await getUserToolUsage(createAdminClient(), USER);
    expect(db.calls).toHaveLength(7);
    for (const call of db.calls) expect(call.args.p_uses, call.name).toEqual(TOOL_USE_EVENTS);
    expect(db.calls.slice(0, 3).map((c) => c.args.p_include_admins)).toEqual([false, false, false]);
    expect(db.calls.slice(3, 6).map((c) => c.args.p_include_admins)).toEqual([true, true, true]);
    // one account's tools are that account's, admin or not: no switch
    expect(db.calls[6].args).toEqual({ p_user_id: USER, p_uses: TOOL_USE_EVENTS });
  });

  it("hands the ledger the same switch, for the period and for the one before", async () => {
    db.answer = (name) => (name === "admin_tool_breakdown" ? { data: totals(1, 1), error: null } : { data: [], error: null });
    await getToolsOverview(period, false);
    await getToolNumbers("pip-forge", period, true);
    expect(db.flowCalls).toEqual([
      [SINCE, UNTIL, false],
      [PREVIOUS_SINCE, PREVIOUS_UNTIL, false],
      [SINCE, UNTIL, true],
      [PREVIOUS_SINCE, PREVIOUS_UNTIL, true],
    ]);
  });
});

describe("a viewer who is not an admin gets nothing — each reader asks for itself", () => {
  it("every reader of the tab is null, and no function, table or ledger is read", async () => {
    db.admin = false;
    // A database that WOULD answer: nothing below may reach it.
    db.answer = (name) => (name === "admin_tool_breakdown" ? { data: totals(9, 9), error: null } : { data: [{ tool_slug: "token-kit", uses: 9 }], error: null });
    db.flow = () => flowOf([spent("forge_pip", 9)]);

    expect(await getToolsOverview(period, false)).toBeNull();
    expect(await getToolsOverview(period, true)).toBeNull();
    expect(await getToolNumbers("token-kit", period, true)).toBeNull();
    expect(await getToolUsers("token-kit", period, true, 1)).toBeNull();
    expect(await getToolUserLog("token-kit", USER)).toBeNull();

    // each asked who the viewer is…
    expect(db.gate).toBe(5);
    // …and stopped there
    expect(db.calls).toEqual([]);
    expect(db.profileReads).toEqual([]);
    expect(db.flowCalls).toEqual([]);
    // not a failed read: nothing to log
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("getUserToolUsage reads with the client its caller hands it — the Users page has checked the viewer", async () => {
    db.admin = false;
    db.answer = () => ({ data: [{ tool_slug: "rule0-sheet", opens: 1, uses: 2, failures: 0, last_at: null }], error: null });
    expect(await getUserToolUsage(createAdminClient(), USER)).toEqual([{ slug: "rule0-sheet", opens: 1, uses: 2, failures: 0, lastAt: null }]);
    expect(db.gate).toBe(0);
    expect(db.calls.map((c) => c.name)).toEqual(["admin_user_tool_usage"]);
  });
});

describe("ledgerCreditsOf — what one tool's AI cost, from the credit ledger", () => {
  const spend = { bySlug: new Map([["collection-builder", 9], ["pip-forge", 0]]), total: 9 };

  it("a tool with spend reasons of its own reads the ledger's figure — 0 when nobody spent", () => {
    expect(ledgerCreditsOf(spend, "collection-builder")).toBe(9);
    expect(ledgerCreditsOf(spend, "pip-forge")).toBe(0);
  });

  it("Token Kit is not known: its art spends under the card creator's reason", () => {
    expect(LEDGER_BLIND_TOOLS).toEqual(["token-kit"]);
    expect(ledgerCreditsOf(spend, "token-kit")).toBeNull();
    // never 0 — that would read as "nobody paid for Token Kit's art"
    expect(ledgerCreditsOf({ bySlug: new Map(), total: 0 }, "token-kit")).toBeNull();
  });

  it("a tool with nothing to pay for is 0", () => {
    expect(ledgerCreditsOf(spend, "play-exports")).toBe(0);
    expect(ledgerCreditsOf(spend, "custom-symbols")).toBe(0);
  });

  it("a ledger that could not be read is not known for any tool — never 0", () => {
    for (const tool of TOOL_CATALOG) expect(ledgerCreditsOf(null, tool.slug), tool.slug).toBeNull();
  });

  it("a slug the catalog no longer lists is not known — its reasons, if it had any, are mapped to nothing now", () => {
    expect(ledgerCreditsOf(spend, "retired-tool")).toBeNull();
    expect(ledgerCreditsOf({ bySlug: new Map(), total: 0 }, "retired-tool")).toBeNull();
  });

  it("a ledger-blind tool is a catalog tool with no reason of its own (one with a reason reads the ledger)", () => {
    const slugs = TOOL_CATALOG.map((tool) => tool.slug as string);
    const mapped = new Set<string>(Object.values(CREDIT_REASON_TOOLS));
    for (const slug of LEDGER_BLIND_TOOLS) {
      expect(slugs, slug).toContain(slug);
      expect(mapped.has(slug), slug).toBe(false);
    }
  });
});

describe("getToolsOverview — every tool", () => {
  const rows = [
    { tool_slug: "token-kit", users: 3, using_users: 2, opens: 7, uses: 9, failures: 1, last_event_at: "2026-11-09T04:00:00+00:00" },
    { tool_slug: "rule0-sheet", users: "2", using_users: "1", opens: "2", uses: "3", failures: "0", last_event_at: null },
  ];
  const answer = (name: string, args: Record<string, unknown>): Answer => {
    if (name === "admin_tools_overview") return { data: rows, error: null };
    return { data: args.p_since === SINCE ? totals(12, 4) : totals(5, 2), error: null };
  };

  it("reads the per-tool rows of the period, and the totals across tools for it and the period before", async () => {
    db.answer = answer;
    const overview = await getToolsOverview(period, false);

    expect(db.calls.map((c) => [c.name, c.args.p_slug, c.args.p_since, c.args.p_until])).toEqual([
      ["admin_tools_overview", undefined, SINCE, UNTIL],
      // '*' = every tool together: a person who used three tools is one person
      ["admin_tool_breakdown", "*", SINCE, UNTIL],
      // the period before: the same stretch 30 days earlier, to the same time of day
      ["admin_tool_breakdown", "*", PREVIOUS_SINCE, PREVIOUS_UNTIL],
    ]);
    // (credits: the ledger's — here one nobody spent from; Token Kit's is never known)
    expect(overview?.rows).toEqual([
      { slug: "token-kit", users: 3, usingUsers: 2, opens: 7, uses: 9, failures: 1, credits: null, lastEventAt: "2026-11-09T04:00:00+00:00" },
      { slug: "rule0-sheet", users: 2, usingUsers: 1, opens: 2, uses: 3, failures: 0, credits: 0, lastEventAt: null },
    ]);
    expect(overview?.totals).toMatchObject({ uses: 12, users: 4, usingUsers: 4 });
    expect(overview?.previous).toMatchObject({ uses: 5, users: 2 });
  });

  it("takes every credit figure from the ledger: each tool's row, the total across tools, and the period before", async () => {
    db.answer = answer;
    db.flow = (since) =>
      since === SINCE
        ? flowOf([
            spent("draft_table_sheet", 3),
            spent("build_collection_deck", 6, 1),
            spent("suggest_collection_commander", 2),
            // Token Kit's art and every creator fill: no tool's
            spent("fill_card", 40),
            spent("generate_random_card", 10),
          ])
        : flowOf([spent("forge_pip", 2), spent("fill_card", 7)]);
    const overview = await getToolsOverview(period, false);

    // asked once for each period, and for nothing else
    expect(db.flowCalls).toEqual([
      [SINCE, UNTIL, false],
      [PREVIOUS_SINCE, PREVIOUS_UNTIL, false],
    ]);
    expect(overview?.rows.map((row) => [row.slug, row.credits])).toEqual([
      // the ledger cannot tell Token Kit's art from the creator's fills
      ["token-kit", null],
      ["rule0-sheet", 3],
    ]);
    // across tools: what the tools with reasons of their own cost — GROSS (a
    // charge later given back is still spent), and without the 50 that are
    // the creator's and Token Kit's
    expect(overview?.totals.credits).toBe(11);
    expect(overview?.previous.credits).toBe(2);
    // the period's spend per tool, for a tool with no event row of its own
    expect(overview?.spend?.total).toBe(11);
    expect(ledgerCreditsOf(overview!.spend, "collection-builder")).toBe(8);
    expect(ledgerCreditsOf(overview!.spend, "rule0-sheet")).toBe(3);
    expect(ledgerCreditsOf(overview!.spend, "re-art-deck")).toBe(0);
    expect(ledgerCreditsOf(overview!.spend, "token-kit")).toBeNull();
    expect(ledgerCreditsOf(overview!.spend, "play-exports")).toBe(0);
    // every tool with a reason of its own has a figure, spent on or not
    expect([...overview!.spend!.bySlug.keys()].sort()).toEqual([...new Set(Object.values(CREDIT_REASON_TOOLS))].sort());
  });

  it("a ledger that could not be read leaves the credits not known — the tool log's numbers still stand", async () => {
    db.answer = answer;
    db.flow = () => null;
    const overview = await getToolsOverview(period, false);
    expect(overview).not.toBeNull();
    expect(overview?.rows.map((row) => row.credits)).toEqual([null, null]);
    expect(overview?.totals).toMatchObject({ uses: 12, users: 4, credits: null });
    expect(overview?.previous).toMatchObject({ uses: 5, credits: null });
    expect(overview?.spend).toBeNull();
    // not the tools' read failing: nothing of theirs to log
    expect(log).not.toHaveBeenCalled();
  });

  it("only the period before unread: this period's figures stand, the comparison is not known", async () => {
    db.answer = answer;
    db.flow = (since) => (since === SINCE ? flowOf([spent("draft_table_sheet", 3)]) : null);
    const overview = await getToolsOverview(period, false);
    expect(overview?.totals.credits).toBe(3);
    expect(overview?.previous.credits).toBeNull();
    expect(overview?.rows.map((row) => row.credits)).toEqual([null, 3]);
  });

  it("an event's `credits` — a start's price, a refused run's price — reaches no figure", async () => {
    // A database that still answers a credits column and key (the price of a
    // 40-credit run that was refused for lack of credits): not read.
    db.answer = (name, args) => {
      if (name === "admin_tools_overview") {
        return { data: [{ tool_slug: "re-art-deck", users: 1, using_users: 0, opens: 1, uses: 0, failures: 1, credits: 40, last_event_at: null }], error: null };
      }
      return { data: { totals: { ...totals(0, 1).totals, credits: args.p_since === SINCE ? 40 : 25 } }, error: null };
    };
    // the ledger: nobody was charged
    const none = await getToolsOverview(period, false);
    expect(none?.rows).toEqual([{ slug: "re-art-deck", users: 1, usingUsers: 0, opens: 1, uses: 0, failures: 1, credits: 0, lastEventAt: null }]);
    expect(none?.totals.credits).toBe(0);
    expect(none?.previous.credits).toBe(0);
    // the ledger unread: not known — never the event's 40
    db.flow = () => null;
    const unread = await getToolsOverview(period, false);
    expect(unread?.rows[0].credits).toBeNull();
    expect(unread?.totals.credits).toBeNull();
    expect(unread?.previous.credits).toBeNull();
    expect(JSON.stringify([none, unread])).not.toMatch(/\b(40|25)\b/);
  });

  it.each(["admin_tools_overview", "admin_tool_breakdown"])("is null — and logged — when %s fails", async (failing) => {
    db.answer = (name) => (name === failing ? FAIL : { data: name === "admin_tools_overview" ? [] : totals(1, 1), error: null });
    expect(await getToolsOverview(period, false)).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("tools overview read failed"), "boom");
  });

  it("no events at all is an answer (empty rows, zero totals), not a failure", async () => {
    db.answer = (name) => ({ data: name === "admin_tools_overview" ? [] : null, error: null });
    const overview = await getToolsOverview(period, false);
    expect(overview?.rows).toEqual([]);
    // nobody used a tool, and the ledger says nobody paid for one
    expect(overview?.totals).toMatchObject({ users: 0, uses: 0, opens: 0, failures: 0, credits: 0 });
    expect(overview?.previous.credits).toBe(0);
  });
});

describe("getToolNumbers — one tool", () => {
  const answer = (_name: string, args: Record<string, unknown>): Answer => ({
    data:
      args.p_since === SINCE
        ? { ...totals(8, 3), daily: [{ day: "2026-11-10", opens: 2, uses: 8, failures: 1, users: 3 }], events: [{ event: "kit_built", count: 8, users: 3 }], reasons: [] }
        : totals(2, 1),
    error: null,
  });

  it("reads the tool's breakdown for the period and the one before", async () => {
    db.answer = answer;
    const numbers = await getToolNumbers("token-kit", period, false);
    expect(db.calls.map((c) => [c.name, c.args.p_slug, c.args.p_since, c.args.p_until])).toEqual([
      ["admin_tool_breakdown", "token-kit", SINCE, UNTIL],
      ["admin_tool_breakdown", "token-kit", PREVIOUS_SINCE, PREVIOUS_UNTIL],
    ]);
    expect(numbers?.current.totals.uses).toBe(8);
    expect(numbers?.current.daily).toHaveLength(1);
    expect(numbers?.current.events).toEqual([{ event: "kit_built", count: 8, users: 3 }]);
    expect(numbers?.previous.uses).toBe(2);
  });

  it("the tool's credits are the ledger's for its own reasons, in both periods", async () => {
    db.answer = answer;
    db.flow = (since) =>
      since === SINCE
        ? flowOf([spent("build_collection_deck", 6), spent("suggest_collection_commander", 3), spent("forge_pip", 5), spent("fill_card", 40)])
        : flowOf([spent("build_collection_deck", 4), spent("forge_pip", 1)]);

    const builder = await getToolNumbers("collection-builder", period, false);
    expect(db.flowCalls).toEqual([
      [SINCE, UNTIL, false],
      [PREVIOUS_SINCE, PREVIOUS_UNTIL, false],
    ]);
    // both of the tool's reasons, and no other tool's
    expect(builder?.current.totals.credits).toBe(9);
    expect(builder?.previous.credits).toBe(4);

    const forge = await getToolNumbers("pip-forge", period, false);
    expect([forge?.current.totals.credits, forge?.previous.credits]).toEqual([5, 1]);

    // a tool with reasons of its own that nobody spent on: 0
    const studio = await getToolNumbers("set-symbol-studio", period, false);
    expect([studio?.current.totals.credits, studio?.previous.credits]).toEqual([0, 0]);

    // a tool with nothing to pay for: 0
    const exportsTool = await getToolNumbers("play-exports", period, false);
    expect([exportsTool?.current.totals.credits, exportsTool?.previous.credits]).toEqual([0, 0]);

    // Token Kit: not known — never the 40 its art shares a reason with
    const kit = await getToolNumbers("token-kit", period, false);
    expect([kit?.current.totals.credits, kit?.previous.credits]).toEqual([null, null]);
  });

  it("a ledger that could not be read leaves the credits not known — the rest of the numbers stand", async () => {
    db.answer = answer;
    db.flow = () => null;
    const numbers = await getToolNumbers("pip-forge", period, false);
    expect(numbers?.current.totals).toMatchObject({ uses: 8, credits: null });
    expect(numbers?.previous).toMatchObject({ uses: 2, credits: null });
    expect(log).not.toHaveBeenCalled();
  });

  it("an event's `credits` — a start's price, a refused run's price — reaches no figure", async () => {
    db.answer = (_name, args) => ({ data: { totals: { ...totals(0, 1).totals, credits: args.p_since === SINCE ? 40 : 25 } }, error: null });
    const none = await getToolNumbers("re-art-deck", period, false);
    expect([none?.current.totals.credits, none?.previous.credits]).toEqual([0, 0]);
    db.flow = () => null;
    const unread = await getToolNumbers("re-art-deck", period, false);
    expect([unread?.current.totals.credits, unread?.previous.credits]).toEqual([null, null]);
  });

  it("is null — and logged — when a read fails", async () => {
    db.answer = (_name, args) => (args.p_since === PREVIOUS_SINCE ? FAIL : { data: totals(1, 1), error: null });
    expect(await getToolNumbers("token-kit", period, false)).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("token-kit numbers read failed"), "boom");
  });
});

describe("getToolUsers — everyone, a page at a time", () => {
  const person = (n: number, total: number) => ({
    user_id: `d0000000-0000-4000-a000-00000000000${n}`,
    username: n === 1 ? null : `user_${n}`,
    is_admin: n === 3,
    access: n === 3 ? "admin" : "grant",
    opens: 2,
    uses: 10 - n,
    failures: 1,
    active_days: 2,
    first_at: "2026-10-20T10:00:00+00:00",
    last_at: "2026-11-09T10:00:00+00:00",
    total_count: total,
  });

  it("asks for 50 from the page's offset, and says how many there are in all", async () => {
    db.answer = () => ({ data: [person(1, 120), person(3, 120)], error: null });
    const page = await getToolUsers("token-kit", period, false, 3);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].args).toMatchObject({ p_slug: "token-kit", p_since: SINCE, p_until: UNTIL, p_limit: 50, p_offset: 100 });
    expect(page).toMatchObject({ total: 120, page: 3, pageSize: 50 });
    expect(page?.rows[0]).toEqual({
      userId: "d0000000-0000-4000-a000-000000000001",
      username: null,
      isAdmin: false,
      access: "grant",
      opens: 2,
      uses: 9,
      failures: 1,
      activeDays: 2,
      firstAt: "2026-10-20T10:00:00+00:00",
      lastAt: "2026-11-09T10:00:00+00:00",
    });
    expect(page?.rows[1]).toMatchObject({ isAdmin: true, access: "admin" });
    // who used a tool is the tool log's: the ledger is not read for it
    expect(db.flowCalls).toEqual([]);
  });

  it("a page past the end asks once more for the count, so the tab can say where the list ends", async () => {
    db.answer = (_name, args) => ({ data: args.p_offset === 0 ? [person(2, 60)] : [], error: null });
    const page = await getToolUsers("token-kit", period, false, 9);
    expect(db.calls.map((c) => [c.args.p_limit, c.args.p_offset])).toEqual([
      [50, 400],
      [1, 0],
    ]);
    expect(page).toEqual({ rows: [], total: 60, page: 9, pageSize: 50 });
  });

  it("nobody on page 1 is nobody: one read, total 0", async () => {
    db.answer = () => ({ data: [], error: null });
    expect(await getToolUsers("token-kit", period, false, 1)).toEqual({ rows: [], total: 0, page: 1, pageSize: 50 });
    expect(db.calls).toHaveLength(1);
  });

  it("is null — and logged — when the read fails (also the count's)", async () => {
    db.answer = () => FAIL;
    expect(await getToolUsers("token-kit", period, false, 1)).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("token-kit users read failed"), "boom");
    db.answer = (_name, args) => (args.p_offset === 0 ? FAIL : { data: [], error: null });
    expect(await getToolUsers("token-kit", period, false, 4)).toBeNull();
  });
});

describe("getToolUserLog — one person's events", () => {
  const events = [
    { created_at: "2026-11-09T04:10:00+00:00", event: "ai_art_failed", access: "grant", props: { reason: "insufficient_credits" } },
    { created_at: "2026-11-09T04:00:00+00:00", event: "open", access: null, props: null },
  ];

  it("reads their newest 100 of the tool, and their handle for the heading", async () => {
    db.answer = () => ({ data: events, error: null });
    const result = await getToolUserLog("token-kit", USER);
    expect(db.calls).toEqual([{ name: "admin_tool_user_events", args: { p_slug: "token-kit", p_user_id: USER, p_limit: 100 } }]);
    expect(db.profileReads).toEqual([["profiles.username.id", USER]]);
    expect(result).toEqual({
      username: "dev_pro",
      events: [
        { at: "2026-11-09T04:10:00+00:00", event: "ai_art_failed", access: "grant", props: { reason: "insufficient_credits" } },
        { at: "2026-11-09T04:00:00+00:00", event: "open", access: null, props: {} },
      ],
    });
  });

  it("still reads without the handle (it only names the heading)", async () => {
    db.answer = () => ({ data: events, error: null });
    db.profile = { data: null, error: { message: "profiles down" } };
    const result = await getToolUserLog("token-kit", USER);
    expect(result?.username).toBeNull();
    expect(result?.events).toHaveLength(2);
    expect(warn).toHaveBeenCalled();
  });

  it("is null — and logged — when the events can't be read", async () => {
    db.answer = () => FAIL;
    expect(await getToolUserLog("token-kit", USER)).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("token-kit event log read failed"), "boom");
  });
});

describe("getUserToolUsage — the Users page's “Tools used”", () => {
  it("maps one row per tool", async () => {
    db.answer = () => ({
      data: [
        { tool_slug: "rule0-sheet", opens: 1, uses: 2, failures: 1, last_at: "2026-11-09T08:13:00+00:00" },
        { tool_slug: "collection-builder", opens: "1", uses: "0", failures: "0", last_at: null },
      ],
      error: null,
    });
    expect(await getUserToolUsage(createAdminClient(), USER)).toEqual([
      { slug: "rule0-sheet", opens: 1, uses: 2, failures: 1, lastAt: "2026-11-09T08:13:00+00:00" },
      { slug: "collection-builder", opens: 1, uses: 0, failures: 0, lastAt: null },
    ]);
  });

  it("an account with no tool event is an empty list — the one answer that says “hasn't opened a tool”", async () => {
    db.answer = () => ({ data: [], error: null });
    expect(await getUserToolUsage(createAdminClient(), USER)).toEqual([]);
    db.answer = () => ({ data: null, error: null });
    expect(await getUserToolUsage(createAdminClient(), USER)).toEqual([]);
  });

  it("a database 0204 has not reached (PGRST202) was NOT read: null — never an empty list — and nothing logged", async () => {
    db.answer = () => ({ data: null, error: { message: "Could not find the function public.admin_user_tool_usage", code: "PGRST202" } });
    const usage = await getUserToolUsage(createAdminClient(), USER);
    // null = "couldn't load"; [] would say "Hasn't opened a tool yet." about
    // an account nothing was read for
    expect(usage).toBeNull();
    // the app may deploy before the migration: expected, so quiet
    expect(log).not.toHaveBeenCalled();
  });

  it("any other failure is null — and logged", async () => {
    db.answer = () => ({ data: null, error: { message: "timeout", code: "57014" } });
    expect(await getUserToolUsage(createAdminClient(), USER)).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("tools used read failed"), "timeout");
    // a failure with no code at all is logged too
    log.mockClear();
    db.answer = () => ({ data: null, error: { message: "boom" } });
    expect(await getUserToolUsage(createAdminClient(), USER)).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("tools used read failed"), "boom");
  });
});
