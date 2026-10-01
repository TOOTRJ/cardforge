import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The seeds' card ids (supabase/seeds/*.sql). Every card row is inserted
// `on conflict (id) do nothing`, so two branches that each add a row with the
// SAME id merge without a textual conflict and the second row silently never
// exists on the dev DB and the preview branches (the emblems seed and the
// 4.6 anatomy seed both took …026, 2026-09-29). This holds the merged file:
// one definition per id, and every card id a later row points at defined.
// ---------------------------------------------------------------------------

const DIR = join(process.cwd(), "supabase/seeds");
const sql = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ file: f, text: readFileSync(join(DIR, f), "utf8") }));

const CARD_ID = /c0000000-0000-4000-a000-[0-9a-f]{12}/g;
// A card row: the id first, then (the main block) its owner's id, then a
// quoted string — the title. A row that only POINTS at a card (likes,
// stats, deck slots) has something else after the id, or the id later on.
const DEFINITION = /^\s*\('(c0000000-0000-4000-a000-[0-9a-f]{12})'::uuid,\s*(?:'d0000000-[0-9a-f-]{28}'::uuid,\s*)?'/gm;

function seedCardDefinitions(texts: readonly string[]): string[] {
  return texts.flatMap((text) => [...text.matchAll(DEFINITION)].map((m) => m[1]!));
}

describe("seed card ids", () => {
  const defined = seedCardDefinitions(sql.map((s) => s.text));

  it("finds the card rows", () => {
    // 25 in the main block, 9 in 2b (the 4.6 anatomy switches, and the
    // round-17 land fix's no-template land) and 5 in 2c (the 4.9a
    // collector fields) at least.
    expect(defined.length).toBeGreaterThanOrEqual(39);
  });

  it("gives every card row its own id (a reused id is a row that silently never lands)", () => {
    const seen = new Map<string, number>();
    for (const id of defined) seen.set(id, (seen.get(id) ?? 0) + 1);
    const reused = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
    expect(reused).toEqual([]);
  });

  it("points only at cards it defines", () => {
    const known = new Set(defined);
    const referenced = new Set(sql.flatMap((s) => s.text.match(CARD_ID) ?? []));
    expect([...referenced].filter((id) => !known.has(id))).toEqual([]);
  });

  it("the regex tells a definition from a reference", () => {
    const rows = [
      "  ('c0000000-0000-4000-a000-000000000001'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid, 'Title', 'slug',",
      "  ('c0000000-0000-4000-a000-000000000034'::uuid, 'Kesh, Emberforge Warden', 'kesh', '{2}{R}{R}',",
      "  ('c0000000-0000-4000-a000-000000000001'::uuid, 420, 12),",
      "  ('d0000000-0000-4000-a000-000000000002'::uuid, 'c0000000-0000-4000-a000-000000000001'::uuid),",
    ].join("\n");
    expect(seedCardDefinitions([rows])).toEqual([
      "c0000000-0000-4000-a000-000000000001",
      "c0000000-0000-4000-a000-000000000034",
    ]);
    // Two branches' rows merged into one file: caught.
    const merged = seedCardDefinitions([rows, "  ('c0000000-0000-4000-a000-000000000034'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid, 'Emblem',"]);
    expect(merged.filter((id) => id.endsWith("034"))).toHaveLength(2);
  });
});
