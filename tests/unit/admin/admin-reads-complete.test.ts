import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The admin Revenue and Funnel panels read every row they claim to
// (2026-11-10). PostgREST answers an un-ranged select with at most
// `max_rows` rows — 1,000 — and says nothing about the rest, whatever
// `.limit()` asks for: "All time" quietly became "the newest 1,000
// invoices", and the signup-source list the first 1,000 signups. Both now
// page through the table. The funnel's row reads also leave the team's own
// accounts out.
// ---------------------------------------------------------------------------

const MAX_ROWS = 1000;

type Row = Record<string, unknown>;
type Call = { table: string; or: string[]; ranges: Array<[number, number]>; filters: Array<[string, string, unknown]> };

const db = vi.hoisted(() => ({
  /** `table` → the first row offset whose page fails (a timeout mid-read). */
  failAt: {} as Record<string, number>,
  /** A read of this table with this filter value fails outright. */
  failWhere: null as null | { table: string; column: string; value: unknown },
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  rpc: {} as Record<string, unknown[]>,
  calls: [] as Array<{ table: string; or: string[]; ranges: Array<[number, number]>; filters: Array<[string, string, unknown]> }>,
  rpcArgs: [] as Array<[string, Record<string, unknown>]>,
}));

/** A PostgREST-like client: filters, an order nobody needs here, and a
 *  server that never answers more than MAX_ROWS rows a request. */
function fakeAdmin() {
  return {
    from(table: string) {
      const call: Call = { table, or: [], ranges: [], filters: [] };
      db.calls.push(call);
      let rows: Row[] = [...(db.tables[table] ?? [])];
      let head = false;
      let window: [number, number] | null = null;
      const answer = () => {
        const f = db.failWhere;
        if (f && f.table === table && call.filters.some(([, column, value]) => column === f.column && value === f.value)) {
          return { data: null, error: { message: "canceling statement due to statement timeout" } };
        }
        if (head) return { data: null, error: null, count: rows.length };
        const [from, to] = window ?? [0, MAX_ROWS - 1];
        if (table in db.failAt && from >= db.failAt[table]) return { data: null, error: { message: "canceling statement due to statement timeout" } };
        return { data: rows.slice(from, Math.min(to + 1, from + MAX_ROWS)), error: null };
      };
      const chain: Record<string, unknown> = {
        select: (_cols: string, options?: { head?: boolean }) => {
          head = options?.head === true;
          return chain;
        },
        eq: (column: string, value: unknown) => {
          call.filters.push(["eq", column, value]);
          rows = rows.filter((row) => row[column] === value);
          return chain;
        },
        gte: (column: string, value: unknown) => {
          call.filters.push(["gte", column, value]);
          return chain;
        },
        lt: (column: string, value: unknown) => {
          call.filters.push(["lt", column, value]);
          return chain;
        },
        contains: () => chain,
        in: () => chain,
        or: (filter: string) => {
          call.or.push(filter);
          const ids = /not\.in\.\(([^)]*)\)/.exec(filter)?.[1].split(",") ?? [];
          rows = rows.filter((row) => row.user_id == null || !ids.includes(String(row.user_id)));
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        range: (from: number, to: number) => {
          call.ranges.push([from, to]);
          window = [from, to];
          return chain;
        },
        then: (resolve: (value: unknown) => void) => resolve(answer()),
      };
      return chain;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      db.rpcArgs.push([name, args]);
      return { data: db.rpc[name] ?? [], error: null };
    },
  };
}

vi.mock("@/lib/admin/users-queries", () => ({ requireAdminClient: async () => fakeAdmin() }));

import { getRevenueSummary } from "@/lib/admin/revenue-queries";
import { adminIdFilter, getFunnelSummary } from "@/lib/admin/funnel-queries";
import { analyticsPeriod } from "@/lib/admin/analytics/params";

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const recent = () => new Date(Date.now() - 3_600_000).toISOString();

beforeEach(() => {
  db.failAt = {};
  db.failWhere = null;
  db.tables = {};
  db.rpc = {};
  db.calls = [];
  db.rpcArgs = [];
});

describe("getRevenueSummary reads every invoice and pack sale", () => {
  const invoice = (i: number) => ({
    invoice_id: `in_${String(i).padStart(5, "0")}`,
    user_id: USER,
    amount_cents: 500,
    currency: "usd",
    billing_reason: "subscription_cycle",
    tier: "plus",
    billing_interval: "month",
    paid_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
    invoice_number: null,
    hosted_invoice_url: null,
    refunded_cents: 0,
    dispute_status: null,
  });
  // The Revenue tab's period: the 30 days up to Jan 20 — every row below is in it.
  const january = analyticsPeriod(30, new Date("2026-01-20T12:00:00Z"));

  it("2,500 invoices are 2,500 payments — not the first page of 1,000", async () => {
    db.tables.billing_payments = Array.from({ length: 2500 }, (_, i) => invoice(i));
    db.tables.billing_pack_payments = [];
    db.tables.credit_ledger = [];
    db.tables.profiles = [{ id: USER, username: "payer" }];
    const summary = await getRevenueSummary(january);
    expect(summary?.allTimeCount).toBe(2500);
    expect(summary?.currencies).toEqual([
      expect.objectContaining({ currency: "usd", cents: 2500 * 500, count: 2500, allTimeCents: 2500 * 500, allTimeCount: 2500 }),
    ]);
    // Every one is counted; the tab lists the newest fifty and says how many there are.
    expect(summary?.entriesTotal).toBe(2500);
    expect(summary?.entries).toHaveLength(50);
    // In pages, each starting after the rows already received.
    const pages = db.calls.filter((c) => c.table === "billing_payments").flatMap((c) => c.ranges);
    expect(pages.map(([from]) => from)).toEqual([0, 1000, 2000, 2500]);
  });

  it("a page that fails is a failed read — never the pages before it summed as 'All time'", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    db.tables.billing_payments = Array.from({ length: 2500 }, (_, i) => invoice(i));
    db.tables.billing_pack_payments = [];
    db.tables.credit_ledger = [];
    db.failAt.billing_payments = 1000;
    expect(await getRevenueSummary(january)).toBeNull();
  });

  it("reads oldest first (a sale landing mid-read is appended, it cannot shift a row into two pages) and counts a row once", async () => {
    // The same invoice handed back by two pages, as an offset read over a moving newest-first list could.
    db.tables.billing_payments = [invoice(1), invoice(2), invoice(2), invoice(3)];
    db.tables.billing_pack_payments = [];
    db.tables.credit_ledger = [];
    db.tables.profiles = [{ id: USER, username: "payer" }];
    const summary = await getRevenueSummary(january);
    expect(summary?.allTimeCount).toBe(3);
    // Newest first on the screen, whatever order the pages came in — with the payer's name.
    expect(summary?.entries.map((entry) => entry.id)).toEqual(["in_00003", "in_00002", "in_00001"]);
    expect(summary?.entries[0].username).toBe("payer");
  });

  it("pack sales and the pack-grant ledger are paged the same way", async () => {
    db.tables.billing_payments = [];
    db.tables.billing_pack_payments = Array.from({ length: 1200 }, (_, i) => ({
      checkout_session_id: `cs_${i}`,
      user_id: USER,
      amount_cents: 400,
      currency: "usd",
      pack: "mini",
      credits: 10,
      paid_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
      refunded_cents: 0,
      dispute_status: null,
    }));
    db.tables.credit_ledger = Array.from({ length: 1300 }, (_, i) => ({ idempotency_key: `pack:cs_${i}`, reason: "pack_purchase" }));
    db.tables.profiles = [];
    const summary = await getRevenueSummary(january);
    expect(summary?.allTimeCount).toBe(1200);
    expect(summary?.currencies[0]).toMatchObject({ packCount: 1200, packCents: 1200 * 400 });
    // 1,300 grants read, 1,200 priced: the other hundred were sold before packs were logged.
    expect(summary?.unpricedPackSales).toBe(100);
  });
});

describe("the funnel's row reads", () => {
  it("adminIdFilter keeps rows with no user (a deleted account) and drops only the admins'", () => {
    expect(adminIdFilter([])).toBeNull();
    expect(adminIdFilter([ADMIN])).toBe(`user_id.is.null,user_id.not.in.(${ADMIN})`);
    // Only real ids ever reach the filter string.
    expect(adminIdFilter([ADMIN, "x); drop", ""])).toBe(`user_id.is.null,user_id.not.in.(${ADMIN})`);
  });

  // The Funnel tab reads the page's PERIOD (lib/admin/analytics/params.ts).
  const period = () => analyticsPeriod(30);

  it("a signup page that fails leaves NO source list — never the first 1,000 signups as if they were all — and says which read failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.tables.profiles = [{ id: USER, is_admin: false }];
    db.tables.funnel_events = Array.from({ length: 1500 }, (_, i) => ({ id: `s${i}`, event: "signup", user_id: USER, props: { referrer: "reddit.com" }, created_at: recent() }));
    db.failAt.funnel_events = 1000;
    const summary = await getFunnelSummary(period());
    expect(summary?.signupSources).toEqual([]);
    expect(summary?.signupSurfaces).toEqual([]);
    expect(summary?.guestCard.signups).toBe(0);
    // The tab shows "couldn't load" for these lists, not "no signups".
    expect(summary?.failed.signups).toBe(true);
  });

  it("without the admins' ids the row lists are not shown at all (the counts leave admins out; the rows could not)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.tables.profiles = [{ id: ADMIN, is_admin: true }];
    db.tables.funnel_events = [{ id: "s1", event: "signup", user_id: ADMIN, props: { referrer: "localhost" }, created_at: recent() }];
    db.failWhere = { table: "profiles", column: "is_admin", value: true };
    const summary = await getFunnelSummary(period());
    expect(summary?.signupSources).toEqual([]);
    expect(summary?.cancelReasons).toEqual([]);
    expect(summary?.failed).toEqual({ signups: true, cancellations: true });
    expect(summary?.guestCard.firstCardsSaved).toBeNull();
  });

  it("reads every signup of the period in pages, without the team's own, and gives every counting function the period and the same switch", async () => {
    db.tables.profiles = [
      { id: ADMIN, is_admin: true },
      { id: USER, is_admin: false },
    ];
    db.tables.funnel_events = [
      ...Array.from({ length: 1500 }, (_, i) => ({ id: `s${i}`, event: "signup", user_id: USER, props: { referrer: "reddit.com" }, created_at: recent() })),
      ...Array.from({ length: 40 }, (_, i) => ({ id: `a${i}`, event: "signup", user_id: ADMIN, props: { referrer: "localhost" }, created_at: recent() })),
      // An account since deleted: no user id, still a signup.
      { id: "gone", event: "signup", user_id: null, props: { utmSource: "newsletter" }, created_at: recent() },
    ];
    const asked = period();
    const summary = await getFunnelSummary(asked);
    expect(summary).not.toBeNull();
    expect(summary!.failed).toEqual({ signups: false, cancellations: false });
    const sources = Object.fromEntries(summary!.signupSources.map((row) => [row.source, row.n]));
    expect(sources).toEqual({ "reddit.com": 1500, newsletter: 1 });
    const signupPages = db.calls.filter((c) => c.table === "funnel_events" && c.filters.some(([, col, v]) => col === "event" && v === "signup") && c.ranges.length > 0);
    // Every page carries the filter and the period, and there is more than one page.
    expect(signupPages.length).toBeGreaterThan(1);
    for (const page of signupPages) {
      expect(page.or).toEqual([`user_id.is.null,user_id.not.in.(${ADMIN})`]);
      expect(page.filters).toContainEqual(["gte", "created_at", asked.since.toISOString()]);
      expect(page.filters).toContainEqual(["lt", "created_at", asked.until.toISOString()]);
    }
    expect(signupPages.flatMap((c) => c.ranges.map(([from]) => from))).toEqual([0, 1000, 1501]);
    // Five reads of four functions (0200): the counts twice — this period and the one before — at once.
    expect(db.rpcArgs.map(([name]) => name).sort()).toEqual([
      "admin_funnel_cohort",
      "admin_funnel_counts",
      "admin_funnel_counts",
      "admin_signups_daily",
      "admin_trial_engagement",
    ]);
    for (const [, args] of db.rpcArgs) {
      expect(Object.keys(args).sort()).toEqual(["p_include_admins", "p_since", "p_until"]);
      expect(args.p_include_admins).toBe(false);
    }
    const counts = db.rpcArgs.filter(([name]) => name === "admin_funnel_counts").map(([, args]) => [args.p_since, args.p_until]);
    expect(counts).toHaveLength(2);
    expect(counts).toContainEqual([asked.since.toISOString(), asked.until.toISOString()]);
    // The one before is the same stretch 30 days earlier, cut at the same time
    // of day: [previousSince, previousUntil) — exactly as long as this one,
    // and stopping short of this period's start (the rest of that earlier day
    // is in neither).
    expect(counts).toContainEqual([asked.previousSince.toISOString(), asked.previousUntil.toISOString()]);
    expect(asked.until.getTime() - asked.previousUntil.getTime()).toBe(30 * 86_400_000);
    expect(asked.since.getTime() - asked.previousSince.getTime()).toBe(30 * 86_400_000);
    expect(asked.previousUntil.getTime()).toBeLessThan(asked.since.getTime());
    // The other three functions are asked for this period alone.
    for (const [name, args] of db.rpcArgs) {
      if (name !== "admin_funnel_counts") expect([args.p_since, args.p_until]).toEqual([asked.since.toISOString(), asked.until.toISOString()]);
    }
  });

  it("'Include admins' reaches every counting function and lifts the row filter — the admins' ids are not even read", async () => {
    db.tables.profiles = [{ id: ADMIN, is_admin: true }];
    db.tables.funnel_events = [
      { id: "s1", event: "signup", user_id: ADMIN, props: { referrer: "localhost" }, created_at: recent() },
      { id: "s2", event: "signup", user_id: USER, props: { referrer: "reddit.com" }, created_at: recent() },
    ];
    const summary = await getFunnelSummary(period(), true);
    expect(Object.fromEntries(summary!.signupSources.map((row) => [row.source, row.n]))).toEqual({ localhost: 1, "reddit.com": 1 });
    expect(db.calls.filter((c) => c.table === "profiles")).toEqual([]);
    for (const call of db.calls) expect(call.or).toEqual([]);
    expect(db.rpcArgs).toHaveLength(5);
    for (const [, args] of db.rpcArgs) expect(args.p_include_admins).toBe(true);
  });
});
