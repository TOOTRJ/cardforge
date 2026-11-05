import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dailyHeroPair, utcDayNumber, HERO_REFUSAL_LABELS } from "@/lib/featured/hero-rotation";

// ---------------------------------------------------------------------------
// The home hero's daily pair (TODO HM4, migration 0169): the same two cards
// all UTC day, a new pair at midnight, every pool card equally often, and the
// fallback slots only while the pool has fewer than two.
// ---------------------------------------------------------------------------

const pool = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, source: "pool" as const }));
const fallback = (...ids: string[]) => ids.map((id) => ({ id, source: "fallback" as const }));
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("dailyHeroPair", () => {
  it("is the same pair all UTC day and a new pair at midnight", () => {
    const rows = pool(5);
    const morning = dailyHeroPair(rows, new Date("2026-11-04T00:00:00Z"));
    const night = dailyHeroPair(rows, new Date("2026-11-04T23:59:59.999Z"));
    const next = dailyHeroPair(rows, new Date("2026-11-05T00:00:00Z"));
    expect(ids(night)).toEqual(ids(morning));
    expect(ids(next)).not.toEqual(ids(morning));
    expect(morning).toHaveLength(2);
  });

  it("walks the pool in pairs: positions (2d, 2d+1) mod N", () => {
    const at = new Date("2026-11-04T12:00:00Z");
    const d = utcDayNumber(at);
    expect(ids(dailyHeroPair(pool(7), at))).toEqual([`p${(2 * d) % 7}`, `p${(2 * d + 1) % 7}`]);
  });

  it.each([2, 3, 4, 5, 8, 11])("shows every card of a pool of %i equally often, never one twice in a pair", (n) => {
    const seen = new Map<string, number>();
    const start = Date.UTC(2026, 0, 1);
    for (let day = 0; day < n * 10; day++) {
      const pair = dailyHeroPair(pool(n), new Date(start + day * 86_400_000));
      expect(new Set(ids(pair)).size).toBe(2);
      for (const id of ids(pair)) seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    expect(new Set(seen.values())).toEqual(new Set([20]));
  });

  it("never reads the fallback slots while the pool has two", () => {
    const pair = dailyHeroPair([...pool(2), ...fallback("f1", "f2")], new Date());
    expect(ids(pair).sort()).toEqual(["p0", "p1"]);
  });

  it("tops a short pool up with the fallback slots, in slot order, the same card never twice", () => {
    const now = new Date();
    expect(ids(dailyHeroPair([...pool(1), ...fallback("f1", "f2")], now))).toEqual(["p0", "f1"]);
    expect(ids(dailyHeroPair(fallback("f1", "f2"), now))).toEqual(["f1", "f2"]);
    expect(ids(dailyHeroPair([{ id: "x", source: "pool" }, { id: "x", source: "fallback" }], now))).toEqual(["x"]);
    expect(dailyHeroPair([], now)).toEqual([]);
  });

  it("labels every refusal home_hero_refusal can give", () => {
    const sql = readFileSync("supabase/migrations/0169_featured_pool.sql", "utf8");
    const codes = [...sql.matchAll(/then '([a-z_]+)'/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThanOrEqual(5);
    for (const code of [...codes, "missing"]) expect(HERO_REFUSAL_LABELS[code]).toBeTruthy();
  });
});
