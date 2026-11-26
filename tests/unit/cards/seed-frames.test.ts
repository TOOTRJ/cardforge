import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";
import { seeThroughColorlessKey, seeThroughTickKeys } from "@/lib/cards/dfc";
import { TICKED_BY_SEED_REFRESH_2026_11_22, asBeforeSeedRefresh } from "../helpers/seed-refresh-2026-11-22";

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

  it("names a template in one list only — the every-colour list or the single rows, never both", () => {
    const block = seededFrameBlock();
    const everyColour = /unnest\(array\[([^\]]*)\]\)\s+as t \(template\)/.exec(block)![1];
    const listed = new Set([...everyColour.matchAll(/'([^']+)'/g)].map((m) => m[1]));
    const singles = new Set([...block.matchAll(/\('([^']+)',\s*'([wubrgcm])',\s*true/g)].map((m) => m[1]));
    expect([...singles].filter((template) => listed.has(template))).toEqual([]);
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

  it("seeds the Vehicle frame and the 1993 and 1997 pairs in every colour, as production verified them (2026-10-13)", () => {
    // A preview branch without `m15vehicle` never offers the Vehicle frame
    // to a card whose subtypes say Vehicle (TODO 4.5c), and an import of
    // one lands on the artifact frame there while production's lands on it.
    const combos = new Set(seededCombos());
    for (const template of ["m15vehicle", "agclassic", "alphaland", "retro", "retroland"]) {
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

  it("the 2026-11-22 refresh's own list (tests/unit/helpers) is what it added to the 353 combos before it", () => {
    // Suites recorded against the earlier list read the seed through it.
    const combos = new Set(seededCombos());
    for (const combo of TICKED_BY_SEED_REFRESH_2026_11_22) expect(combos.has(combo), combo).toBe(true);
    expect(asBeforeSeedRefresh(combos).size).toBe(353);
  });

  it("mirrors the layout version of every tick: one version per every-colour template, one per single row", () => {
    // The frames audit of 2026-11-22: production's verified_layout_version
    // is mirrored, so a gate that reads it (below) answers on a seeded
    // database as on production.
    const block = seededFrameBlock();
    const everyColour = /unnest\(array\[([^\]]*)\]\)\s+as t \(template\)/.exec(block)![1];
    const listed = [...everyColour.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const table = /left join \(values([\s\S]*?)\) as v \(template, verified_layout_version\) using \(template\)/.exec(block);
    expect(table, "the version table under the every-colour list").not.toBeNull();
    const versions = [...table![1].matchAll(/\('([^']+)',\s*(\d+|null)\)/g)].map((m) => m[1]);
    expect(versions).toEqual(listed);
    // Every single row names its version (a number, or null for a tick
    // from before 0115).
    const singles = [...block.matchAll(/\('([^']+)',\s*'([wubrgcm])',\s*true,\s*now\(\),\s*(\d+|null)\)/g)];
    expect(singles.length).toBe([...block.matchAll(/\('([^']+)',\s*'([wubrgcm])',\s*true/g)].length);
  });

  it("publishes the see-through modal colourless faces as production does (TODO 5.11a)", () => {
    // seeThroughTickKeys reads the `c` row's version: a seed with no version
    // refused every colourless modal face on every seeded database.
    const block = seededFrameBlock();
    const table = /left join \(values([\s\S]*?)\) as v/.exec(block)![1];
    const rows = [...table.matchAll(/\('([^']+)',\s*(\d+|null)\)/g)].map((m) => ({
      template: m[1],
      color_key: "c",
      verified_layout_version: m[2] === "null" ? null : Number(m[2]),
    }));
    const keys = seeThroughTickKeys(rows);
    // The modal spell bodies are the see-through ones (STX #6); their
    // production `c` ticks are v75.
    expect(keys.sort()).toEqual([seeThroughColorlessKey("m15mdfcback"), seeThroughColorlessKey("m15mdfcfront")]);
  });
});
