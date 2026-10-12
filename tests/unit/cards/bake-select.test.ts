import { describe, expect, it, vi } from "vitest";
import { BAKE_SELECT_COLUMNS } from "@/lib/cards/bake-core";
import { bakeSelectColumnsWithout0137, isMissing0137Column, selectBakeColumns } from "@/lib/cards/bake-select";

// The deploy window of migration 0137 (TODO 3b.16): the new code live on a
// database that has no `printed_types` column yet. PostgREST's answers below
// are the ones the local stack gives for a column that does not exist.
const MISSING = { code: "42703", message: "column cards.printed_types does not exist" };

describe("the bake's read on a database from before migration 0137", () => {
  it("the list without the column is the list from before the migration", () => {
    expect(BAKE_SELECT_COLUMNS.split(/,\s*/)).toContain("printed_types");
    const before = bakeSelectColumnsWithout0137().split(", ");
    expect(before).not.toContain("printed_types");
    expect(before).toEqual(BAKE_SELECT_COLUMNS.split(/,\s*/).filter((column) => column !== "printed_types"));
    expect(before).toContain("supertype");
  });

  it("reads once when the column is there", async () => {
    const run = vi.fn(async (columns: string) => ({ data: [{ columns }], error: null }));
    const result = await selectBakeColumns(run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(BAKE_SELECT_COLUMNS);
    expect(result.data).toEqual([{ columns: BAKE_SELECT_COLUMNS }]);
  });

  it("reads again without the column when the database says it does not exist", async () => {
    const run = vi.fn(async (columns: string) =>
      columns.includes("printed_types") ? { data: null, error: MISSING } : { data: [{ id: "a" }], error: null },
    );
    const result = await selectBakeColumns(run);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith(bakeSelectColumnsWithout0137());
    expect(result).toEqual({ data: [{ id: "a" }], error: null });
  });

  it("tolerates nothing else: another missing column, another error, a second failure", async () => {
    expect(isMissing0137Column({ code: "42703", message: "column cards.set_code does not exist" })).toBe(false);
    expect(isMissing0137Column({ code: "42501", message: "permission denied for table cards (printed_types)" })).toBe(false);
    expect(isMissing0137Column({ code: "PGRST204", message: "Could not find the 'printed_types' column of 'cards' in the schema cache" })).toBe(false);
    expect(isMissing0137Column(null)).toBe(false);
    const other = { code: "42501", message: "permission denied for table cards" };
    const run = vi.fn(async () => ({ data: null, error: other }));
    expect(await selectBakeColumns(run)).toEqual({ data: null, error: other });
    expect(run).toHaveBeenCalledTimes(1);
    const always = vi.fn(async () => ({ data: null, error: MISSING }));
    expect((await selectBakeColumns(always)).error).toEqual(MISSING);
    expect(always).toHaveBeenCalledTimes(2);
  });
});
