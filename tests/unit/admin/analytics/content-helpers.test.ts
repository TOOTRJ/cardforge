import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// /admin/analytics — the Content tab's data (lib/admin/analytics/content.ts):
// 0203's jsonb read defensively into totals for two periods, three
// zero-filled day series and the two top-ten lists; one call with the
// page's period and its "Include admins" switch; null when it fails. The
// read checks the viewer is an admin ITSELF (requireAdminClient): for anyone
// else it is null and nothing is asked of the database.
// ---------------------------------------------------------------------------

const db = vi.hoisted(() => ({
  answer: { data: null as unknown, error: null as null | { message: string } },
  calls: [] as Array<[string, Record<string, unknown>]>,
  /** Whether the viewer is an admin: what requireAdminClient answers. */
  admin: true,
  /** How often the read asked who the viewer is. */
  gate: 0,
  /** The gate itself fails (the viewer's profile, or the service client). */
  throws: false,
}));

function fakeAdmin() {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      db.calls.push([name, args]);
      return db.answer;
    },
  };
}

// The read's own gate: the service client for an admin, null for anyone else.
vi.mock("@/lib/admin/users-queries", () => ({
  requireAdminClient: async () => {
    db.gate += 1;
    if (db.throws) throw new Error("Supabase admin key is not configured (SUPABASE_SECRET_KEY).");
    return db.admin ? fakeAdmin() : null;
  },
}));
// …and the only way to a client: a read that built the service client
// itself would never have asked who is looking.
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => {
    throw new Error("an analytics read takes its client from requireAdminClient, never createAdminClient");
  },
}));

import { getContentStats, parseContentStats } from "@/lib/admin/analytics/content";
import { analyticsPeriod } from "@/lib/admin/analytics/params";

const period = analyticsPeriod(7, new Date("2026-11-10T15:00:00Z"));

const RAW = {
  since: "2026-11-04T00:00:00+00:00",
  until: "2026-11-10T15:00:00+00:00",
  previousSince: "2026-10-28T00:00:00+00:00",
  previousUntil: "2026-11-03T15:00:00+00:00",
  current: { cardsCreated: 106, cardsPublic: "31", cardsUnlisted: 67, cardsPrivate: 8, decksCreated: 29, cardLikes: 11, deckLikes: 8, cardViews: 12, deckViews: 3 },
  previous: { cardsCreated: 9, cardsPublic: 5, cardsUnlisted: 3, cardsPrivate: 1, decksCreated: 0, cardLikes: 0, deckLikes: 3, cardViews: 2, deckViews: 0 },
  perDay: [
    { day: "2026-11-04", cardsCreated: 4, decksCreated: 0, cardViews: 1 },
    { day: "2026-11-06", cardsCreated: 0, decksCreated: 24, cardViews: "9" },
    { day: "2026-11-10", cardsCreated: 26, decksCreated: 5, cardViews: 2 },
    // Outside the period's days, and junk: neither may reach a chart.
    { day: "2026-10-01", cardsCreated: 99, decksCreated: 99, cardViews: 99 },
    { nope: true },
    null,
  ],
  topCards: [
    { id: "c1", title: "Archivist of Lost Hours", slug: "archivist-of-lost-hours", ownerId: "u1", username: "dev_pro", views: 3 },
    { id: "c2", title: "Forgemaster's Decree", slug: "forgemasters-decree", ownerId: "u2", username: "dev_artist", views: "6" },
    { id: "c3", slug: "no-title", ownerId: null, username: null, views: 1 },
    { title: "No id", slug: "x", views: 50 },
    { id: "c5", title: "No slug", views: 50 },
  ],
  topDecks: [{ id: "d1", title: "Cinderwing Dragonstorm", slug: "cinderwing-dragonstorm", ownerId: "u1", username: "dev_pro", views: 105 }],
};

beforeEach(() => {
  db.answer = { data: RAW, error: null };
  db.calls = [];
  db.admin = true;
  db.gate = 0;
  db.throws = false;
});

describe("parseContentStats", () => {
  const stats = parseContentStats(RAW, period.dayKeys);

  it("reads both periods' totals, a count that arrives as a string included", () => {
    expect(stats.current).toEqual({ cardsCreated: 106, cardsPublic: 31, cardsUnlisted: 67, cardsPrivate: 8, decksCreated: 29, cardLikes: 11, deckLikes: 8, cardViews: 12, deckViews: 3 });
    expect(stats.previous).toMatchObject({ cardsCreated: 9, deckLikes: 3, cardViews: 2 });
  });

  it("gives each series one point per UTC day of the period, a day with no row as zero", () => {
    for (const series of [stats.cardsPerDay, stats.decksPerDay, stats.cardViewsPerDay]) {
      expect(series.map((p) => p.day)).toEqual(period.dayKeys);
    }
    expect(stats.cardsPerDay.map((p) => p.value)).toEqual([4, 0, 0, 0, 0, 0, 26]);
    expect(stats.decksPerDay.map((p) => p.value)).toEqual([0, 0, 24, 0, 0, 0, 5]);
    expect(stats.cardViewsPerDay.map((p) => p.value)).toEqual([1, 0, 9, 0, 0, 0, 2]);
  });

  it("lists the top cards most viewed first, dropping a row it could not link", () => {
    expect(stats.topCards).toEqual([
      { id: "c2", title: "Forgemaster's Decree", slug: "forgemasters-decree", ownerId: "u2", username: "dev_artist", views: 6 },
      { id: "c1", title: "Archivist of Lost Hours", slug: "archivist-of-lost-hours", ownerId: "u1", username: "dev_pro", views: 3 },
      { id: "c3", title: "no-title", slug: "no-title", ownerId: null, username: null, views: 1 },
    ]);
    expect(stats.topDecks).toHaveLength(1);
  });

  it("never more than ten of either", () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ id: `c${i}`, title: `T${i}`, slug: `s${i}`, views: i }));
    const top = parseContentStats({ topCards: many, topDecks: many }, period.dayKeys);
    expect(top.topCards).toHaveLength(10);
    expect(top.topCards[0].views).toBe(13);
    expect(top.topDecks).toHaveLength(10);
  });

  it("an empty or strange answer is zeros and empty lists — never a throw", () => {
    for (const raw of [null, undefined, "x", [], {}, { current: [], perDay: "no", topCards: {} }]) {
      const empty = parseContentStats(raw, period.dayKeys);
      expect(empty.current).toEqual({ cardsCreated: 0, cardsPublic: 0, cardsUnlisted: 0, cardsPrivate: 0, decksCreated: 0, cardLikes: 0, deckLikes: 0, cardViews: 0, deckViews: 0 });
      expect(empty.previous.cardsCreated).toBe(0);
      expect(empty.cardsPerDay).toHaveLength(7);
      expect(empty.cardsPerDay.every((p) => p.value === 0)).toBe(true);
      expect(empty.topCards).toEqual([]);
      expect(empty.topDecks).toEqual([]);
    }
  });
});

describe("getContentStats", () => {
  it("asks once, for the page's period, with admins left out unless the switch is on", async () => {
    const stats = await getContentStats(period, false);
    await getContentStats(period, true);
    expect(db.calls).toEqual([
      ["admin_content_stats", { p_since: "2026-11-04T00:00:00.000Z", p_until: "2026-11-10T15:00:00.000Z", p_include_admins: false }],
      ["admin_content_stats", { p_since: "2026-11-04T00:00:00.000Z", p_until: "2026-11-10T15:00:00.000Z", p_include_admins: true }],
    ]);
    expect(stats?.current.cardsCreated).toBe(106);
    expect(stats?.cardsPerDay).toHaveLength(7);
  });

  it("is null when the read fails, or cannot even start — never zeros as the truth", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.answer = { data: null, error: { message: "statement timeout" } };
    expect(await getContentStats(period, false)).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("admin_content_stats failed"), "statement timeout");
    db.throws = true;
    expect(await getContentStats(period, false)).toBeNull();
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });

  it("a viewer who is not an admin gets null, and the function is never called", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.admin = false;
    // The database WOULD answer (beforeEach: RAW): it must not be asked.
    expect(await getContentStats(period, false)).toBeNull();
    expect(await getContentStats(period, true)).toBeNull();
    // each asked who the viewer is, and stopped there
    expect(db.gate).toBe(2);
    expect(db.calls).toEqual([]);
    // not a failed read: nothing to log
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("an admin's read asks who the viewer is once, before the call", async () => {
    expect(await getContentStats(period, false)).not.toBeNull();
    expect(db.gate).toBe(1);
    expect(db.calls).toHaveLength(1);
  });
});
