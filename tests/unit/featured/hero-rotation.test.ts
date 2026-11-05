import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  dailyHeroPair,
  orderHeroRows,
  utcDayNumber,
  HERO_REFUSAL_LABELS,
  NOT_ORIGINAL_LABELS,
} from "@/lib/featured/hero-rotation";

// ---------------------------------------------------------------------------
// The home hero's daily pair (TODO HM4, migration 0169): the same two cards
// all UTC day, a new pair at midnight, every pool card equally often, and the
// fallback slots only while the pool has fewer than two — and never two
// cards by the same maker (owner 2026-11-04).
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const START = Date.UTC(2026, 0, 1);
const pool = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    source: "pool" as const,
    ord: i + 1,
    username: `maker_p${i}`,
  }));
const fallback = (...ids: string[]) =>
  ids.map((id, i) => ({ id, source: "fallback" as const, ord: i + 1, username: `maker_${id}` }));
/** Pool cards by the makers given, in pool order. */
const poolBy = (...makers: string[]) =>
  makers.map((username, i) => ({ id: `p${i}`, source: "pool" as const, ord: i + 1, username }));
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
const day = (d: number) => new Date(START + d * DAY + 12 * 3_600_000);

describe("dailyHeroPair", () => {
  it("is the same pair all UTC day, whatever the hour", () => {
    const rows = pool(6);
    const morning = dailyHeroPair(rows, new Date("2026-11-04T00:00:00Z"));
    const night = dailyHeroPair(rows, new Date("2026-11-04T23:59:59.999Z"));
    expect(morning).toHaveLength(2);
    expect(ids(night)).toEqual(ids(morning));
  });

  it("is a new pair at midnight", () => {
    const rows = pool(5);
    const today = dailyHeroPair(rows, new Date("2026-11-04T23:59:59.999Z"));
    const next = dailyHeroPair(rows, new Date("2026-11-05T00:00:00Z"));
    expect(ids(next)).not.toEqual(ids(today));
  });

  it("walks the pool in pairs: positions (2d, 2d+1) mod N", () => {
    const at = new Date("2026-11-04T12:00:00Z");
    const d = utcDayNumber(at);
    expect(ids(dailyHeroPair(pool(7), at))).toEqual([`p${(2 * d) % 7}`, `p${(2 * d + 1) % 7}`]);
  });

  it.each([2, 3, 4, 5, 8, 11])("shows every card of a pool of %i equally often, never one twice in a pair", (n) => {
    const seen = new Map<string, number>();
    for (let d = 0; d < n * 10; d++) {
      const pair = ids(dailyHeroPair(pool(n), day(d)));
      expect(new Set(pair).size).toBe(2);
      for (const id of pair) seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    expect(new Set(seen.values())).toEqual(new Set([20]));
  });

  it("walks the pool's order, not the order the rows arrived in", () => {
    const rows = [...pool(7), ...fallback("f1", "f2")];
    const shuffled = [rows[8], rows[3], rows[0], rows[6], rows[7], rows[1], rows[5], rows[2], rows[4]];
    for (let d = 0; d < 50; d++) {
      expect(ids(dailyHeroPair(shuffled, day(d)))).toEqual(ids(dailyHeroPair(rows, day(d))));
    }
    expect(ids(orderHeroRows(shuffled))).toEqual(ids(rows));
  });

  it("shows both cards of a pool of two, and never the fallback slots", () => {
    for (let d = 0; d < 30; d++) {
      expect(ids(dailyHeroPair([...fallback("f1", "f2"), ...pool(2)], day(d))).sort()).toEqual(["p0", "p1"]);
    }
  });

  it("tops a pool of one up with a fallback card that isn't it", () => {
    expect(ids(dailyHeroPair([...pool(1), ...fallback("f1", "f2")], day(0)))).toEqual(["p0", "f1"]);
    const same = [{ id: "x", source: "pool" as const, ord: 1, username: "maker_x" }, ...fallback("x", "f2")];
    expect(ids(dailyHeroPair(same, day(0)))).toEqual(["x", "f2"]);
    expect(
      ids(
        dailyHeroPair(
          [
            { id: "x", source: "pool", ord: 1, username: "maker_x" },
            { id: "x", source: "fallback", ord: 1, username: "maker_x" },
          ],
          day(0),
        ),
      ),
    ).toEqual(["x"]);
  });

  it("never shows two cards by the same maker, whatever the pool", () => {
    const pools = [
      poolBy("a", "a"),
      poolBy("a", "a", "b"),
      poolBy("a", "b", "a", "b"),
      poolBy("a", "a", "a", "b", "c", "c"),
      poolBy("a", "b", "b", "b", "b"),
    ];
    for (const p of pools) {
      for (const rows of [p, [...p, ...fallback("f1", "f2")]]) {
        for (let d = 0; d < 40; d++) {
          const makers = dailyHeroPair(rows, day(d)).map((r) => r.username);
          expect(new Set(makers).size).toBe(makers.length);
        }
      }
    }
  });

  it("pairs the day's first pool card with the next one by another maker", () => {
    const rows = poolBy("a", "a", "a", "b");
    for (let d = 0; d < 20; d++) {
      const pair = dailyHeroPair(rows, day(d));
      expect(pair).toHaveLength(2);
      expect(pair[0].id).toBe(`p${(2 * utcDayNumber(day(d))) % 4}`);
      expect(pair.map((r) => r.username).sort()).toEqual(["a", "b"]);
    }
  });

  it("tops up a one-maker pool with a fallback card by someone else, else shows one card", () => {
    const fb = [
      { id: "f1", source: "fallback" as const, ord: 1, username: "a" },
      { id: "f2", source: "fallback" as const, ord: 2, username: "z" },
    ];
    expect(dailyHeroPair([...poolBy("a", "a"), ...fb], day(0)).map((r) => r.username)).toEqual(["a", "z"]);
    expect(dailyHeroPair(poolBy("a", "a", "a"), day(0))).toHaveLength(1);
    expect(dailyHeroPair([...poolBy("a"), fb[0]], day(0))).toHaveLength(1);
    expect(ids(dailyHeroPair([...poolBy("a"), ...fb], day(0)))).toEqual(["p0", "f2"]);
    const twoSlotsOneMaker = fb.map((r) => ({ ...r, username: "q" }));
    expect(ids(dailyHeroPair(twoSlotsOneMaker, day(0)))).toEqual(["f1"]);
  });

  it("falls back to the slots in slot order with an empty pool, else nothing (the placeholder)", () => {
    expect(ids(dailyHeroPair(fallback("f1", "f2").reverse(), day(0)))).toEqual(["f1", "f2"]);
    expect(dailyHeroPair([], day(0))).toEqual([]);
  });

  it("labels every refusal the checks can give, and every not-original reason", () => {
    const sql = readFileSync("supabase/migrations/0169_featured_pool.sql", "utf8");
    const codes = [...sql.matchAll(/then '([a-z_]+)'/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThanOrEqual(5);
    for (const code of [...codes, "missing", "no_handle", "render_not_drawable"]) {
      expect(HERO_REFUSAL_LABELS[code]).toBeTruthy();
    }
    for (const code of ["from_real_card", "remix", "not_creator"]) expect(NOT_ORIGINAL_LABELS[code]).toBeTruthy();
  });
});
