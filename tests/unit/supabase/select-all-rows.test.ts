import { describe, expect, it } from "vitest";
import { chunkIds, selectAllRows } from "@/lib/supabase/select-all-rows";

// ---------------------------------------------------------------------------
// selectAllRows: a COMPLETE read or an error — never part of a table handed
// back as all of it (the account export promises exactly that).
//   * a server whose max_rows is below the page asked for answers short
//     pages; the next page starts after the rows received, so nothing is
//     skipped, and only an EMPTY page (or the exact count) ends the read;
//   * a failed page and the safety stop are errors.
// ---------------------------------------------------------------------------

/** A table of `total` rows behind a server that answers at most `maxRows`
 *  per request; records the ranges asked for. */
function table(total: number, maxRows: number, withCount = false) {
  const ranges: Array<[number, number]> = [];
  const page = async (from: number, to: number) => {
    ranges.push([from, to]);
    const end = Math.min(to, from + maxRows - 1, total - 1);
    const data = Array.from({ length: Math.max(0, end - from + 1) }, (_, i) => from + i);
    return { data, error: null, count: withCount ? total : null };
  };
  return { page, ranges };
}

describe("selectAllRows", () => {
  it("reads past the 1000-row cap and ends on an empty page", async () => {
    const t = table(2500, 1000);
    const result = await selectAllRows(t.page);
    expect(result.error).toBeNull();
    expect(result.data).toEqual(Array.from({ length: 2500 }, (_, i) => i));
    expect(t.ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [2500, 3499],
    ]);
  });

  it("never skips rows when the server's max_rows is smaller than the page asked for", async () => {
    const t = table(1200, 500);
    const result = await selectAllRows(t.page);
    expect(result.error).toBeNull();
    expect(result.data).toEqual(Array.from({ length: 1200 }, (_, i) => i));
    expect(t.ranges.map(([from]) => from)).toEqual([0, 500, 1000, 1200]);
  });

  it("with an exact count, stops as soon as every row is in (no empty-page round trip)", async () => {
    const t = table(42, 1000, true);
    const result = await selectAllRows(t.page);
    expect(result.data).toHaveLength(42);
    expect(t.ranges).toEqual([[0, 999]]);
  });

  it("an empty table is one request and no error", async () => {
    const t = table(0, 1000);
    expect(await selectAllRows(t.page)).toEqual({ data: [], error: null });
    expect(t.ranges).toHaveLength(1);
  });

  it("a failed page is an error", async () => {
    let calls = 0;
    const result = await selectAllRows(async () => {
      calls += 1;
      return calls === 1
        ? { data: Array.from({ length: 1000 }, (_, i) => i), error: null }
        : { data: null, error: { message: "boom" } };
    });
    expect(result.error?.message).toBe("boom");
  });

  it("the safety stop is an error, never partial data that looks complete", async () => {
    const t = table(5000, 1000);
    const result = await selectAllRows(t.page, { maxRows: 2500 });
    expect(result.error).not.toBeNull();
    expect(result.error?.message).toMatch(/stopped after 2,500 rows/);
  });
});

describe("chunkIds", () => {
  it("splits ids 100 a request by default", () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    expect(chunkIds(ids).map((c) => c.length)).toEqual([100, 100, 50]);
    expect(chunkIds([])).toEqual([]);
  });

  it("keeps a 100-uuid .in() filter far below an 8 KB request line", () => {
    const uuid = "123e4567-e89b-42d3-a456-426614174000";
    const [chunk] = chunkIds(Array.from({ length: 250 }, () => uuid));
    const filter = `deck_id=in.(${chunk!.join(",")})`;
    expect(encodeURIComponent(filter).length).toBeLessThan(4_500);
  });
});
