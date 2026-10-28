import { describe, expect, it, vi } from "vitest";
import { BAKE_SELECT_COLUMNS } from "@/lib/cards/bake-core";
import {
  SCOPE_CARD_COLUMNS,
  bakeSelectColumnsWithout0137,
  isMissing0137Column,
  missingLateColumn,
  selectBakeColumns,
  selectScopeColumns,
} from "@/lib/cards/bake-select";
import { CARD_LAYOUT_VERSION, FLAVOR_MARKUP_LAYOUT_VERSION, isRenderStale, type ScopeCard } from "@/lib/cards/layout-version";

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

  it("…and the same for the nickname (migration 0141, TODO 6.3), one column at a time", async () => {
    expect(BAKE_SELECT_COLUMNS.split(/,\s*/)).toContain("nickname");
    const NICK = { code: "42703", message: "column cards.nickname does not exist" };
    expect(missingLateColumn(NICK)).toBe("nickname");
    // A database from before 0141: read once more without the nickname.
    const before0141 = vi.fn(async (columns: string) =>
      columns.split(", ").includes("nickname") ? { data: null, error: NICK } : { data: [{ id: "a" }], error: null },
    );
    expect(await selectBakeColumns(before0141)).toEqual({ data: [{ id: "a" }], error: null });
    expect(before0141).toHaveBeenCalledTimes(2);
    expect(before0141.mock.calls[1]![0].split(", ")).toEqual(BAKE_SELECT_COLUMNS.split(/,\s*/).filter((c) => c !== "nickname"));
    // …and from before 0137 too: both dropped, each once.
    const before0137 = vi.fn(async (columns: string) => {
      const list = columns.split(", ");
      if (list.includes("nickname")) return { data: null, error: NICK };
      if (list.includes("printed_types")) return { data: null, error: MISSING };
      return { data: [{ id: "b" }], error: null };
    });
    expect(await selectBakeColumns(before0137)).toEqual({ data: [{ id: "b" }], error: null });
    expect(before0137).toHaveBeenCalledTimes(3);
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

// ---------------------------------------------------------------------------
// The scope scans (render-update-notify.ts, frame-profile-override-actions.ts):
// a ScopeCard column a scan leaves out reads as "can't judge → affected" on
// every card, so v72's kerningGuardsChanged (the nickname, the typed type
// words, the artist credit) made every card owe a sweep — silencing every
// opt-in badge and null-stamping cards that owe nothing on an override save.
// ---------------------------------------------------------------------------

describe("the scope scans' columns (SCOPE_CARD_COLUMNS)", () => {
  it("are exactly ScopeCard's keys (a new scope column joins the list)", () => {
    // Typed as every key of ScopeCard: a key added there fails typecheck
    // here until it is named, and then this test until the list has it.
    const every: Record<keyof ScopeCard, true> = {
      rarity: true, set_icon_url: true, set_icon_code: true, frame_style: true, color_identity: true, art_url: true,
      title: true, nickname: true, supertype: true, printed_types: true, artist_credit: true, card_type: true,
      subtypes: true, power: true, toughness: true, loyalty: true, defense: true, back_face: true, rules_text: true,
      flavor_text: true, face_content: true, cost: true, art_position: true,
    };
    expect([...SCOPE_CARD_COLUMNS].sort()).toEqual(Object.keys(every).sort());
    expect(new Set(SCOPE_CARD_COLUMNS).size).toBe(SCOPE_CARD_COLUMNS.length);
  });

  it("…because a card read without one owes the v72 sweep, and with all of them does not", () => {
    // A bake stamped v71 on m15 whose texts hold no zeroed pair: only v72 is
    // newer, and it never touched this card.
    const row = Object.fromEntries(SCOPE_CARD_COLUMNS.map((column) => [column, null])) as Record<string, unknown>;
    Object.assign(row, { title: "Serra Angel", card_type: "creature", subtypes: ["Angel"], frame_style: { template: "m15" }, color_identity: ["W"] });
    expect(isRenderStale(FLAVOR_MARKUP_LAYOUT_VERSION, "m15", undefined, CARD_LAYOUT_VERSION, row)).toBe(false);
    for (const column of ["nickname", "printed_types", "artist_credit"]) {
      const without = { ...row };
      delete without[column];
      expect(isRenderStale(FLAVOR_MARKUP_LAYOUT_VERSION, "m15", undefined, CARD_LAYOUT_VERSION, without), column).toBe(true);
    }
    expect(isRenderStale(FLAVOR_MARKUP_LAYOUT_VERSION, "m15", undefined, CARD_LAYOUT_VERSION, { ...row, title: "Kylox" })).toBe(true);
  });
});

describe("selectScopeColumns", () => {
  const LEADING = "id, layout_version";
  const ALL = [LEADING, ...SCOPE_CARD_COLUMNS].join(", ");

  it("reads the scan's columns and every scope column, once, when the database has them", async () => {
    const run = vi.fn(async (columns: string) => ({ data: [{ id: "a", printed_types: "Kindred Elf" }], error: null, read: columns }));
    const result = await selectScopeColumns(LEADING, run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.read).toBe(ALL);
    expect(result.data).toEqual([{ id: "a", printed_types: "Kindred Elf" }]);
  });

  it("on a database without a late column: reads again without it, and each row carries it as NULL", async () => {
    const NICK = { code: "42703", message: "column cards.nickname does not exist" };
    const run = vi.fn(async (columns: string) => {
      const list = columns.split(", ");
      if (list.includes("nickname")) return { data: null, error: NICK };
      if (list.includes("printed_types")) return { data: null, error: MISSING };
      return { data: [{ id: "a", title: "Kylox" }, { id: "b", title: "Serra Angel" }], error: null };
    });
    const result = await selectScopeColumns(LEADING, run);
    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls[2]![0].split(", ")).toEqual(ALL.split(", ").filter((c) => c !== "nickname" && c !== "printed_types"));
    expect(result.data).toEqual([
      { id: "a", title: "Kylox", nickname: null, printed_types: null },
      { id: "b", title: "Serra Angel", nickname: null, printed_types: null },
    ]);
  });

  it("tolerates nothing else: another error comes back as it is, with no rows touched", async () => {
    const other = { code: "42501", message: "permission denied for table cards" };
    const run = vi.fn(async () => ({ data: null, error: other }));
    expect(await selectScopeColumns(LEADING, run)).toEqual({ data: null, error: other });
    expect(run).toHaveBeenCalledTimes(1);
    const always = vi.fn(async () => ({ data: null, error: MISSING }));
    expect((await selectScopeColumns(LEADING, always)).error).toEqual(MISSING);
    expect(always).toHaveBeenCalledTimes(2);
  });
});
