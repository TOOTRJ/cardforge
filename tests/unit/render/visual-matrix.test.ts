import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";
import { frameAnatomyOf } from "@/lib/cards/anatomy";
import { PAIR_TEMPLATES, VISUAL_COLOURS, caseInput, frameKeyOf, shardCases, visualCases } from "@/tests/visual/matrix";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { COLLECTOR_TEMPLATES } from "@/lib/cards/collector-line";

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
/** A case's row without its id (siblings differ only by id). */
const canonicalRow = (c: (typeof cases)[number]) => JSON.stringify({ ...c.row, id: null });
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
    for (const id of ids) {
      expect(id).toMatch(
        /^[a-z0-9]+\/(w|u|b|r|g|c|wu|wub)\/[a-z]+-(short|long|edge)(@(hd|foil|etched|square|noart|notext|creature|vehicle|spacecraft|crown(-(hd|foil|etched|square))?|pair(-(hybrid|foil|etched|hd))?(-crown(-hd)?)?|collector(-2015)?(-(noplate|star|foil|etched|lang|empty|artist|hd|square))?))?$/,
      );
    }
    expect(ids).toEqual([...ids].sort());
  });

  it("pins the P/T a card TYPE prints on a body: a saga creature, a Vehicle, a Spacecraft (TODO 4.5.0)", () => {
    const byId = new Map(cases.map((c) => [c.id, c]));
    const saga = byId.get("saga/w/saga-short@creature");
    expect(saga?.row).toMatchObject({ card_type: "enchantment", supertype: "Creature", power: "3", toughness: "3" });
    expect(saga?.row.subtypes).toContain("Saga");
    for (const id of ["m15/c/artifact-short@vehicle", "m15artifact/c/artifact-short@vehicle"]) {
      expect(byId.get(id)?.row, id).toMatchObject({ card_type: "artifact", subtypes: ["Vehicle"], power: "3", toughness: "3" });
    }
    expect(byId.get("m15artifact/c/artifact-short@spacecraft")?.row).toMatchObject({ card_type: "artifact", subtypes: ["Spacecraft"] });
  });

  it("bakes a card without art on the see-through masters and v35's art slots (the empty-art box; no under-frame layer)", () => {
    const noArt = cases.filter((c) => c.id.endsWith("@noart"));
    expect(noArt.map((c) => `${c.template}/${c.colour}`)).toEqual([
      "fullart/g",
      "m15/c",
      "m15/w",
      "m15devoid/b",
      "m15pw/c",
      "m15token/c",
      "m15tokentext/c",
      "nyx/w",
    ]);
    for (const c of noArt) expect(c.row.art_url, c.id).toBeNull();
  });

  it("bakes a borderless walker with no ability text on both boxes (4.33: the light first stripe, never the bare art)", () => {
    const noText = cases.filter((c) => c.id.endsWith("@notext"));
    expect(noText.map((c) => `${c.template}/${c.colour}/${c.kind}`)).toEqual([
      "m15borderlesspw/w/planeswalker",
      "m15borderlesspwtall/wub/planeswalker",
    ]);
    for (const c of noText) {
      expect(c.row.rules_text, c.id).toBeNull();
      expect(c.row.face_content, c.id).toBeNull();
      expect(c.row.art_url, c.id).toBe("ART");
    }
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

  it("switches the collector line on only in its collector cases: both styles on every slotted template, the line's shapes on m15 (TODO 4.9b)", () => {
    const lined = cases.filter((c) => c.id.includes("@collector"));
    const keyed = cases.filter((c) => "collector" in (c.row.frame_style as object));
    expect(keyed.map((c) => c.id)).toEqual(lined.map((c) => c.id));
    expect([...new Set(lined.map((c) => c.template))].sort()).toEqual([...COLLECTOR_TEMPLATES].sort());
    for (const template of COLLECTOR_TEMPLATES) {
      const styles = lined.filter((c) => c.template === template).map((c) => (c.row.frame_style as { collector: string }).collector);
      expect(styles, template).toContain("2023");
      expect(styles, template).toContain("2015");
    }
    for (const c of lined) {
      const style = c.row.frame_style as { collector?: string; star?: true; crown?: boolean; twoColor?: boolean };
      expect(["2015", "2023"], c.id).toContain(style.collector);
      expect(style.crown, c.id).toBeUndefined();
      expect(style.twoColor, c.id).toBeUndefined();
      expect(c.row.set_code, c.id).toBe(c.id.includes("@collector-empty") ? null : "DMU");
      expect(c.row.lang, c.id).toBe(c.id.includes("@collector-lang") ? "es" : "en");
    }
    const byId = new Map(cases.map((c) => [c.id, c]));
    expect((byId.get("m15/r/creature-short@collector-star")?.row.frame_style as { star?: true }).star).toBe(true);
    expect(byId.get("m15/r/creature-short@collector-foil")?.finish).toBe("foil");
    expect(byId.get("m15/u/instant-short@collector-noplate")?.row.power).toBeNull();
    expect(byId.get("m15/g/creature-long@collector-artist")?.row.artist_credit).toMatch(/Extraordinarily/);
    expect(byId.get("m15/g/creature-long@collector-hd")?.preset).toBe("hd");
    expect(byId.get("m15/u/creature-short@collector-2015-square")?.corners).toBe("square");
    // Every stored card's case names no collector key.
    for (const c of cases.filter((x) => !lined.includes(x))) expect(c.row.frame_style, c.id).not.toHaveProperty("collector");
  });

  it("marks exactly the square-corner (print) cases print-only — each has a stored round sibling", () => {
    for (const c of cases) expect(c.printOnly, c.id).toBe(c.corners === "square");
    for (const c of cases.filter((x) => x.printOnly)) {
      const sibling = cases.find((x) => !x.printOnly && x.preset === c.preset && x.finish === c.finish && canonicalRow(x) === canonicalRow(c));
      expect(sibling, `${c.id}'s round sibling`).toBeDefined();
    }
  });

  it("switches the legendary crown on only in its crown cases, on each template that draws it (TODO 4.6a)", () => {
    const crowned = cases.filter((c) => (c.row.frame_style as { crown?: boolean }).crown === true);
    expect(crowned.map((c) => c.id)).toEqual(cases.filter((c) => /@(pair(-hybrid)?-)?crown/.test(c.id)).map((c) => c.id));
    expect([...new Set(crowned.map((c) => c.template))].sort()).toEqual(
      FRAME_TEMPLATE_VALUES.filter((t) => frameAnatomyOf(t).crown).sort(),
    );
    // Every one is Legendary (it draws the crown), in every finish and at HD;
    // every case with neither switch is a stored card, which names none.
    for (const c of crowned) expect(c.row.supertype, c.id).toMatch(/Legendary/);
    expect(new Set(crowned.map((c) => `${c.preset}/${c.finish}/${c.corners}`))).toEqual(
      new Set(["default/regular/round", "hd/regular/round", "default/foil/round", "default/etched/round", "default/regular/square"]),
    );
    const paired = cases.filter((c) => (c.row.frame_style as { twoColor?: boolean }).twoColor === true);
    const lined = cases.filter((c) => c.id.includes("@collector"));
    for (const c of cases.filter((x) => !crowned.includes(x) && !paired.includes(x) && !lined.includes(x))) {
      expect(Object.keys(c.row.frame_style as object).sort(), c.id).toEqual(["finish", "template"]);
    }
    // The split crown: both switches on, on every template that draws both.
    const both = crowned.filter((c) => paired.includes(c));
    expect([...new Set(both.map((c) => c.template))].sort()).toEqual([...PAIR_TEMPLATES].sort());
  });

  it("bakes the two-colour frame (TODO 4.6b) on every template that draws pairs, in each dress it draws", () => {
    const paired = FRAME_TEMPLATE_VALUES.filter((t) => (getFrameProfile(t).twoColorMasters ?? []).length > 0);
    expect([...PAIR_TEMPLATES].sort()).toEqual([...paired].sort());
    const on = cases.filter((c) => (c.row.frame_style as { twoColor?: boolean }).twoColor === true);
    for (const template of paired) expect(on.some((c) => c.template === template && c.colour === "wu"), template).toBe(true);
    // The hybrid dress (every coloured pip hybrid), a foil and an etched pair,
    // and the stored bake's HD size.
    expect(on.some((c) => c.template === "m15" && /^(\{[^}]*\/[^}]*\})+$/.test(String(c.row.cost)))).toBe(true);
    expect(new Set(on.map((c) => c.finish))).toEqual(new Set(["regular", "foil", "etched"]));
    expect(on.some((c) => c.preset === "hd")).toBe(true);
    // Every other case is a stored card: it never names the switch.
    for (const c of cases.filter((x) => !on.includes(x))) expect(c.row.frame_style, c.id).not.toHaveProperty("twoColor");
  });

  it("fingerprints what each case draws: the row, preset and corners — not the field order", () => {
    const [c] = cases;
    expect(caseInput(c)).toBe(c.input);
    expect(caseInput({ ...c, row: Object.fromEntries(Object.entries(c.row).reverse()) as typeof c.row })).toBe(c.input);
    expect(caseInput({ ...c, row: { ...c.row, rules_text: "Changed." } })).not.toBe(c.input);
    expect(caseInput({ ...c, corners: c.corners === "round" ? "square" : "round" })).not.toBe(c.input);
    expect(caseInput({ ...c, preset: c.preset === "hd" ? "default" : "hd" })).not.toBe(c.input);
  });

  it("splits into shards that cover every case exactly once", () => {
    for (const count of [1, 4, 12]) {
      const all = Array.from({ length: count }, (_, i) => shardCases(cases, i, count).map((c) => c.id)).flat();
      expect(all.sort()).toEqual([...ids].sort());
    }
  });
});

describe("tests/visual/baseline.json", () => {
  it("records exactly the matrix's cases, as they are drawn now — regenerate it after changing the matrix", () => {
    expect(Object.keys(baseline.cases).sort()).toEqual([...ids].sort());
    for (const entry of Object.values(baseline.cases)) expect(entry).toMatch(/^[0-9a-f]{16}:[0-9a-f]{8}$/);
    // A case whose content, preset or corners changed since the baseline was
    // made (`npm run test:visual -- --update` restamps it).
    expect(cases.filter((c) => baseline.cases[c.id]?.split(":")[1] !== c.input).map((c) => c.id)).toEqual([]);
  });

  it("was made at the current CARD_LAYOUT_VERSION — a bump regenerates it in the same PR", () => {
    expect(baseline.layoutVersion).toBe(CARD_LAYOUT_VERSION);
  });
});
