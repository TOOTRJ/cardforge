import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The Overview tab's data (/admin/analytics): the event counts of the period
// and the one before, signups per day, and revenue per currency — money
// taken (the Revenue tab's own headline: one number under one name), by the
// day it was paid. It is the page's front door,
// so it reads those three things and nothing else; the money rows are read
// in pages (an un-ranged read stops at 1,000 rows and says nothing).
// ---------------------------------------------------------------------------

const MAX_ROWS = 1000;
type Row = Record<string, unknown>;
type Call = { table: string; filters: Array<[string, string, unknown]>; ranges: Array<[number, number]>; or: string[] };

const db = vi.hoisted(() => ({
  admin: true,
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  /** `table` → the first row offset whose page fails. */
  failAt: {} as Record<string, number>,
  rpc: {} as Record<string, unknown[]>,
  rpcFail: null as string | null,
  calls: [] as Array<{ table: string; filters: Array<[string, string, unknown]>; ranges: Array<[number, number]>; or: string[] }>,
  rpcArgs: [] as Array<[string, Record<string, unknown>]>,
}));

function fakeAdmin() {
  return {
    from(table: string) {
      const call: Call = { table, filters: [], ranges: [], or: [] };
      db.calls.push(call);
      let rows: Row[] = [...(db.tables[table] ?? [])];
      let window: [number, number] = [0, MAX_ROWS - 1];
      const chain: Record<string, unknown> = {
        select: () => chain,
        gte: (column: string, value: string) => {
          call.filters.push(["gte", column, value]);
          rows = rows.filter((row) => String(row[column]) >= value);
          return chain;
        },
        lt: (column: string, value: string) => {
          call.filters.push(["lt", column, value]);
          rows = rows.filter((row) => String(row[column]) < value);
          return chain;
        },
        or: (filter: string) => {
          call.or.push(filter);
          return chain;
        },
        order: () => chain,
        range: (from: number, to: number) => {
          call.ranges.push([from, to]);
          window = [from, to];
          return chain;
        },
        then: (resolve: (value: unknown) => void) => {
          const [from, to] = window;
          if (table in db.failAt && from >= db.failAt[table]) return resolve({ data: null, error: { message: "canceling statement due to statement timeout" } });
          return resolve({ data: rows.slice(from, Math.min(to + 1, from + MAX_ROWS)), error: null });
        },
      };
      return chain;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      db.rpcArgs.push([name, args]);
      if (db.rpcFail === name) return { data: null, error: { message: "boom" } };
      return { data: db.rpc[name] ?? [], error: null };
    },
  };
}

vi.mock("@/lib/admin/users-queries", () => ({ requireAdminClient: async () => (db.admin ? fakeAdmin() : null) }));

import { getOverviewSummary, revenueByCurrency, type MoneyRow } from "@/lib/admin/analytics/overview";
import { analyticsPeriod } from "@/lib/admin/analytics/params";

const NOW = new Date("2026-11-10T15:30:00.000Z");
const period = analyticsPeriod(30, NOW);
// The period is Oct 12 00:00 UTC → now (Nov 10 15:30); the one before is the
// same stretch 30 days earlier, cut at the same time of day: Sep 12 00:00 →
// Oct 11 15:30. The rest of Oct 11 is in neither.
const IN = "2026-11-01T10:00:00.000Z";
const BEFORE = "2026-09-20T10:00:00.000Z";
const TOO_OLD = "2026-09-11T23:59:59.000Z";
/** In the rest of that earlier day: after the previous period's cut, before this period. */
const GAP = "2026-10-11T20:00:00.000Z";

/** A sale as the logs hold it — a row carries what was refunded on it too,
 *  which the Overview does not read (revenue is money TAKEN). */
const sale = (
  key: string,
  paid_at: string,
  amount_cents: number,
  patch: Partial<MoneyRow> & { refunded_cents?: number } = {},
): MoneyRow => ({
  key,
  paid_at,
  amount_cents,
  currency: "usd",
  ...patch,
});

beforeEach(() => {
  db.admin = true;
  db.tables = {};
  db.failAt = {};
  db.rpc = {};
  db.rpcFail = null;
  db.calls = [];
  db.rpcArgs = [];
});

describe("revenueByCurrency", () => {
  it("adds up money taken — the Revenue tab's own figure, refunds not taken off — in the period a sale was paid in", () => {
    expect(period.since.toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(period.previousSince.toISOString()).toBe("2026-09-12T00:00:00.000Z");
    expect(period.previousUntil.toISOString()).toBe("2026-10-11T15:30:00.000Z");
    expect(
      revenueByCurrency(
        [
          sale("invoice:a", IN, 1200),
          sale("invoice:b", IN, 800, { refunded_cents: 800 }),
          sale("pack:c", IN, 400, { refunded_cents: 100 }),
          sale("invoice:d", BEFORE, 1200),
          sale("pack:e", BEFORE, 400),
          // A $0 trial-start invoice is a row, and no money.
          sale("invoice:f", IN, 0),
        ],
        period,
      ),
    ).toEqual([{ currency: "usd", currentCents: 1200 + 800 + 400, previousCents: 1600 }]);
  });

  it("the period is [since, until) and the one before [previousSince, previousUntil), the same stretch 30 days earlier: a sale on an edge counts once, one in the rest of that earlier day or outside counts nowhere", () => {
    const rows = [
      sale("a", "2026-10-12T00:00:00.000Z", 100), // the first instant of this period
      sale("b", "2026-10-11T15:29:59.999Z", 10), // the last instant of the previous one
      sale("c", "2026-09-12T00:00:00.000Z", 1), // the first of the previous one
      sale("d", TOO_OLD, 5000),
      sale("e", NOW.toISOString(), 7000), // `until` itself is outside
      // The rest of that earlier day, [previousUntil, since): in neither period.
      sale("f", "2026-10-11T15:30:00.000Z", 20_000), // `previousUntil` itself
      sale("g", GAP, 30_000),
      sale("h", "2026-10-11T23:59:59.999Z", 40_000), // the last instant before this period
      sale("i", "2026-09-11T23:59:59.999Z", 50_000), // the last instant before the previous one
    ];
    expect(revenueByCurrency(rows, period)).toEqual([{ currency: "usd", currentCents: 100, previousCents: 11 }]);
    // A currency sold only in that gap has no row at all — it was sold in neither period.
    expect(revenueByCurrency([sale("a", IN, 500), sale("gap", GAP, 900, { currency: "eur" })], period)).toEqual([
      { currency: "usd", currentCents: 500, previousCents: 0 },
    ]);
    expect(revenueByCurrency([sale("gap", GAP, 900)], period)).toEqual([{ currency: "usd", currentCents: 0, previousCents: 0 }]);
  });

  it("never adds two currencies together: one row each, USD first", () => {
    expect(
      revenueByCurrency(
        [sale("a", IN, 900, { currency: "eur" }), sale("b", IN, 500, { currency: "USD" }), sale("c", BEFORE, 700, { currency: "cad" })],
        period,
      ),
    ).toEqual([
      { currency: "usd", currentCents: 500, previousCents: 0 },
      { currency: "cad", currentCents: 0, previousCents: 700 },
      { currency: "eur", currentCents: 900, previousCents: 0 },
    ]);
  });

  it("counts a sale once when two pages hand it back, and nothing sold is one USD row of zeros (the tile is always there)", () => {
    expect(revenueByCurrency([sale("a", IN, 500), sale("a", IN, 500)], period)).toEqual([{ currency: "usd", currentCents: 500, previousCents: 0 }]);
    expect(revenueByCurrency([], period)).toEqual([{ currency: "usd", currentCents: 0, previousCents: 0 }]);
    expect(revenueByCurrency([sale("old", TOO_OLD, 500)], period)).toEqual([{ currency: "usd", currentCents: 0, previousCents: 0 }]);
  });
});

describe("getOverviewSummary", () => {
  const invoice = (i: number, paid_at: string, patch: Row = {}) => ({ invoice_id: `in_${String(i).padStart(5, "0")}`, amount_cents: 500, refunded_cents: 0, currency: "usd", paid_at, ...patch });
  const pack = (i: number, paid_at: string, patch: Row = {}) => ({ checkout_session_id: `cs_${i}`, amount_cents: 400, refunded_cents: 0, currency: "usd", paid_at, ...patch });

  it("reads only what the front door shows: the counts twice, the signups per day, the two money logs", async () => {
    db.rpc.admin_funnel_counts = [{ event: "signup", n: 12, users: 11 }];
    db.rpc.admin_signups_daily = [{ day: "2026-11-09", method: "google", n: 12 }];
    db.tables.billing_payments = [invoice(1, IN), invoice(2, BEFORE)];
    // The second pack was sold in the rest of that earlier day: read with the rows, in neither total.
    db.tables.billing_pack_payments = [pack(1, IN, { refunded_cents: 150 }), pack(2, GAP)];
    const summary = await getOverviewSummary(period);
    expect(summary?.counts?.current.signup).toEqual({ n: 12, users: 11 });
    expect(summary?.signups?.total).toBe(12);
    expect(summary?.signups?.points).toHaveLength(30);
    expect(summary?.revenue).toEqual([{ currency: "usd", currentCents: 500 + 400, previousCents: 500 }]);
    // Nothing of the Funnel tab's heavier reads.
    expect(db.rpcArgs.map(([name]) => name).sort()).toEqual(["admin_funnel_counts", "admin_funnel_counts", "admin_signups_daily"]);
    expect([...new Set(db.calls.map((call) => call.table))].sort()).toEqual(["billing_pack_payments", "billing_payments"]);
    // The counts: this period, and the same stretch 30 days earlier — cut at
    // the same time of day (Oct 11 15:30), not at this period's start.
    const ranges = db.rpcArgs.filter(([name]) => name === "admin_funnel_counts").map(([, args]) => [args.p_since, args.p_until]);
    expect(ranges).toHaveLength(2);
    expect(ranges).toContainEqual([period.since.toISOString(), NOW.toISOString()]);
    expect(ranges).toContainEqual([period.previousSince.toISOString(), period.previousUntil.toISOString()]);
    expect(ranges).toContainEqual(["2026-09-12T00:00:00.000Z", "2026-10-11T15:30:00.000Z"]);
  });

  it("reads the money rows of both periods in pages — 2,500 invoices are 2,500, not the first 1,000", async () => {
    db.tables.billing_payments = [
      ...Array.from({ length: 2500 }, (_, i) => invoice(i, new Date(Date.parse(IN) + i * 1000).toISOString())),
      invoice(9000, TOO_OLD),
    ];
    db.tables.billing_pack_payments = [];
    const summary = await getOverviewSummary(period);
    expect(summary?.revenue).toEqual([{ currency: "usd", currentCents: 2500 * 500, previousCents: 0 }]);
    const reads = db.calls.filter((call) => call.table === "billing_payments");
    expect(reads.flatMap((call) => call.ranges.map(([from]) => from))).toEqual([0, 1000, 2000, 2500]);
    // Only rows since the previous period began, up to now.
    for (const read of reads) {
      expect(read.filters).toEqual([
        ["gte", "paid_at", period.previousSince.toISOString()],
        ["lt", "paid_at", NOW.toISOString()],
      ]);
    }
  });

  it("a money page that fails is 'could not load' — never the pages before it as the total — and the counts still show", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.rpc.admin_funnel_counts = [{ event: "signup", n: 3, users: 3 }];
    db.tables.billing_payments = Array.from({ length: 1500 }, (_, i) => invoice(i, IN));
    db.failAt.billing_payments = 1000;
    const summary = await getOverviewSummary(period);
    expect(summary?.revenue).toBeNull();
    expect(summary?.counts?.current.signup?.n).toBe(3);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("overview revenue read failed"), expect.any(String));
    log.mockRestore();
  });

  it("a comparison with half its numbers is not one: either count read failing leaves no counts, and the rest still loads", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.rpcFail = "admin_funnel_counts";
    db.rpc.admin_signups_daily = [{ day: "2026-11-09", method: "email", n: 2 }];
    const summary = await getOverviewSummary(period);
    expect(summary?.counts).toBeNull();
    expect(summary?.signups?.total).toBe(2);
    expect(summary?.revenue).toEqual([{ currency: "usd", currentCents: 0, previousCents: 0 }]);
    log.mockRestore();
  });

  it("'Include admins' goes to the counts and the signups; revenue counts everyone either way", async () => {
    db.tables.billing_payments = [invoice(1, IN)];
    const without = await getOverviewSummary(period, false);
    for (const [, args] of db.rpcArgs) expect(args.p_include_admins).toBe(false);
    db.rpcArgs = [];
    db.calls = [];
    const withAdmins = await getOverviewSummary(period, true);
    for (const [, args] of db.rpcArgs) expect(args.p_include_admins).toBe(true);
    expect(withAdmins?.revenue).toEqual(without?.revenue);
    // No admin filter on money, and no read of who the admins are.
    for (const call of db.calls) expect(call.or).toEqual([]);
    expect(db.calls.some((call) => call.table === "profiles")).toBe(false);
  });

  it("is null for a viewer who is not an admin — nothing is read", async () => {
    db.admin = false;
    expect(await getOverviewSummary(period)).toBeNull();
    expect(db.rpcArgs).toEqual([]);
    expect(db.calls).toEqual([]);
  });
});
