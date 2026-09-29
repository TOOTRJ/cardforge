import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";
import { VISUAL_COLOURS, frameKeyOf, shardCases, visualCases } from "@/tests/visual/matrix";

// ---------------------------------------------------------------------------
// The visual-regression matrix (tests/visual/matrix.ts, TODO 7.1) and its
// committed baseline. CI's "Visual regression" job bakes the matrix and gates
// the hashes (scripts/visual-regression.mjs); these fast checks keep the
// matrix covering every frame the site can draw — every published combo
// included — and fail `npm run test:unit` as soon as the baseline no longer
// matches the matrix or CARD_LAYOUT_VERSION (regenerate it:
// `npm run test:visual -- --update`).
// ---------------------------------------------------------------------------

const cases = visualCases();
const ids = cases.map((c) => c.id);
const baseline = JSON.parse(readFileSync(join(process.cwd(), "tests/visual/baseline.json"), "utf8")) as {
  layoutVersion: number;
  cases: Record<string, string>;
};

/** "template/colour" combos seed.sql verifies — production's published
 *  frames (the same parse as tests/unit/cards/seed-frames.test.ts). */
function publishedCombos(): string[] {
  const sql = readFileSync(join(process.cwd(), "supabase/seed.sql"), "utf8");
  const block = /-- frame_reviews:begin\n([\s\S]*?)-- frame_reviews:end/.exec(sql)?.[1].replace(/--.*$/gm, "") ?? "";
  const lits = (s: string) => [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const cross = /unnest\(array\[([^\]]*)\]\)\s+as t \(template\)\s+cross join unnest\(array\[([^\]]*)\]\)\s+as c \(color_key\)/.exec(block);
  const combos = cross ? lits(cross[1]).flatMap((t) => lits(cross[2]).map((c) => `${t}/${c}`)) : [];
  for (const [, template, color] of block.matchAll(/\('([^']+)',\s*'([^']+)',\s*true/g)) combos.push(`${template}/${color}`);
  return combos;
}

describe("visual-regression matrix", () => {
  it("bakes every frame template in every colour, a short and a long card, plus the HD bake", () => {
    for (const template of FRAME_TEMPLATE_VALUES) {
      const mine = cases.filter((c) => c.template === template && c.preset === "default" && c.finish === "regular" && c.corners === "round");
      for (const colour of VISUAL_COLOURS) {
        expect(mine.filter((c) => c.colour === colour).map((c) => c.shape).sort(), `${template}/${colour}`).toEqual(
          expect.arrayContaining(["long", "short"]),
        );
      }
      expect(cases.some((c) => c.template === template && c.preset === "hd"), `${template} @hd`).toBe(true);
    }
  });

  it("covers every published (verified) combo in seed.sql", () => {
    const published = publishedCombos();
    expect(published.length).toBeGreaterThan(50);
    const covered = new Set(cases.map((c) => `${c.template}/${frameKeyOf(c.colour)}`));
    expect(published.filter((combo) => !covered.has(combo))).toEqual([]);
  });

  it("has unique, stable ids", () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+\/(w|u|b|r|g|c|wu|wub)\/[a-z]+-(short|long|edge)(@(hd|foil|etched|square))?$/);
    expect(ids).toEqual([...ids].sort());
  });

  it("names no picture outside the harness (hermetic: the generated art placeholders only)", () => {
    for (const c of cases) {
      expect([null, "ART"]).toContain(c.row.art_url);
      expect(c.row.set_icon_url).toBeNull();
      const back = c.row.back_face as { art_url?: string } | null;
      expect([undefined, "ART2"]).toContain(back?.art_url);
      expect(JSON.stringify(c.row)).not.toMatch(/https?:\/\//);
    }
  });

  it("splits into shards that cover every case exactly once", () => {
    for (const count of [1, 4, 12]) {
      const all = Array.from({ length: count }, (_, i) => shardCases(cases, i, count).map((c) => c.id)).flat();
      expect(all.sort()).toEqual([...ids].sort());
    }
  });
});

describe("tests/visual/baseline.json", () => {
  it("records exactly the matrix's cases — regenerate it after changing the matrix", () => {
    expect(Object.keys(baseline.cases).sort()).toEqual([...ids].sort());
    for (const hash of Object.values(baseline.cases)) expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("was made at the current CARD_LAYOUT_VERSION — a bump regenerates it in the same PR", () => {
    expect(baseline.layoutVersion).toBe(CARD_LAYOUT_VERSION);
  });
});
