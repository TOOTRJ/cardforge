import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// supabase/seed.sql seeds the verified frame combos for preview branches and
// local resets. frame_reviews.template is free text in the DB, so a renamed or
// removed FrameTemplate would leave an orphan row that verifies nothing — and
// the creator on that branch would quietly lose the frame. Pin the names.

const COLOR_KEYS = new Set(["w", "u", "b", "r", "g", "c", "m"]);

function seedSql(): string {
  return readFileSync(join(process.cwd(), "supabase/seed.sql"), "utf8");
}

function seededFrameBlock(): string {
  const match = /-- frame_reviews:begin\n([\s\S]*?)-- frame_reviews:end/.exec(seedSql());
  if (!match) throw new Error("frame_reviews block markers missing from seed.sql");
  // Drop SQL comments so prose can't be mistaken for a literal.
  return match[1].replace(/--.*$/gm, "");
}

/** Every "template/color" row the block inserts, duplicates kept: the
 *  every-colour list crossed with its colour list, then the single rows. */
function seededCombos(): string[] {
  const block = seededFrameBlock();
  const lits = (s: string) => [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const cross =
    /unnest\(array\[([^\]]*)\]\)\s+as t \(template\)\s+cross join unnest\(array\[([^\]]*)\]\)\s+as c \(color_key\)/.exec(
      block,
    );
  if (!cross) throw new Error("the every-colour cross join is missing from seed.sql");
  const combos = lits(cross[1]).flatMap((t) => lits(cross[2]).map((c) => `${t}/${c}`));
  for (const [, template, color] of block.matchAll(/\('([^']+)',\s*'([^']+)',\s*true/g)) {
    combos.push(`${template}/${color}`);
  }
  return combos;
}

describe("supabase/seed.sql verified frames", () => {
  const literals = [...seededFrameBlock().matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const templates = [...new Set(literals.filter((l) => !COLOR_KEYS.has(l)))];

  it("seeds at least the standard M15 frame — the creator's default", () => {
    expect(templates).toContain("m15");
  });

  it("only names real frame templates", () => {
    const known = new Set<string>(FRAME_TEMPLATE_VALUES);
    expect(templates.filter((t) => !known.has(t))).toEqual([]);
  });

  it("only uses the color keys the frame_reviews CHECK allows", () => {
    // Every single-letter literal must be one of the seven keys.
    const stray = literals.filter((l) => l.length === 1 && !COLOR_KEYS.has(l));
    expect(stray).toEqual([]);
  });

  it("names every combo once — a single row never repeats an every-colour template", () => {
    const combos = seededCombos();
    expect(combos.filter((combo, i) => combos.indexOf(combo) !== i)).toEqual([]);
  });

  it("seeds the four 2014–19 token frames in every colour, as production verified them (2026-09-29)", () => {
    // Migration 0129 moves stored cards with text onto the text-box pair
    // (TODO 4.49 (b)): a preview branch without them would offer a moved
    // card no frame it can save on.
    const combos = new Set(seededCombos());
    for (const template of ["m15token", "m15tokenartifact", "m15tokentext", "m15tokenartifacttext"]) {
      for (const colour of COLOR_KEYS) expect(combos.has(`${template}/${colour}`), `${template}/${colour}`).toBe(true);
    }
  });

  it("seeds the nine double-faced bodies and the portrait layouts in every colour, as production verified them (2026-10-06)", () => {
    // supabase/seeds/10_dev_data.sql holds cards on the double-faced bodies
    // (a transform pair, a modal spell // land): a preview branch that does
    // not offer their frames shows the Transform and Modal kinds as "Soon"
    // and cannot save an edit to those cards.
    const combos = new Set(seededCombos());
    const templates = [
      "m15dfcfront", "m15dfcback", "m15dfcbackleft", "m15dfclandfront", "m15dfclandback",
      "m15mdfcfront", "m15mdfcback", "m15mdfclandfront", "m15mdfclandback",
      "adventure", "aftermath", "flip",
    ];
    for (const template of templates) {
      for (const colour of COLOR_KEYS) expect(combos.has(`${template}/${colour}`), `${template}/${colour}`).toBe(true);
    }
  });

  it("the snapshot count in the header is the number of seeded combos", () => {
    // Refreshing the list from production means refreshing the date and the
    // count beside it; a count that disagrees is a half-done refresh.
    const header = /snapshotted (\d{4}-\d{2}-\d{2}) \((\d+) combos\)/.exec(seedSql());
    expect(header, "the 'snapshotted <date> (<n> combos)' line").not.toBeNull();
    expect(seededCombos()).toHaveLength(Number(header![2]));
  });
});
