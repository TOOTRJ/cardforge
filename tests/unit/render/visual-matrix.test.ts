import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";
import { frameAnatomyOf } from "@/lib/cards/anatomy";
import { PAIR_TEMPLATES, STAMP_ARCH_RULES, STAMP_PAIR_TEMPLATES, STAMP_TEMPLATES, VISUAL_COLOURS, caseInput, frameKeyOf, shardCases, visualCases } from "@/tests/visual/matrix";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { resolveSagaChapters } from "@/lib/cards/face-content";
import { sagaRail } from "@/lib/cards/saga-rail";
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
        /^[a-z0-9]+\/(w|u|b|r|g|c|wu|wub)\/[a-z]+-(short|long|edge)(@(hd|foil|etched|square|noart|notext|creature|vehicle|spacecraft|nopt|nodefense|dense|longpage|stack3(-hd)?|prodshape|six(-hd)?|stack5(-tight)?|stack6|combined|longintro|grownintro|pastfloor|introonly|legacy8|emptytab|legacyback|sunmoon|moon|compass|fan|stripequipment|stripgod|stripenchantment|striptibalt|strip-(u|w|a|m|l|g|c)(-hd)?|crown(-(hd|foil|etched|square))?|pair(-(hybrid|foil|etched|hd|square|br|gw|ub))?(-crown(-hd)?)?|centred(-hd)?|collector(-2015)?(-(noplate|star|foil|etched|lang|empty|artist|hd|square))?|stamp(-(c|m|always|arch|hd|foil|etched|square|token|pair-(split|hybrid|crown|hd|foil)))?))?$/,
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

  it("pins every row rule of the saga's printed rail on its own case (TODO 4.21c)", () => {
    const slot = getFrameProfile("saga").chapters!;
    const rails = new Map(
      cases
        .filter((c) => c.template === "saga")
        .map((c) => [c.id, sagaRail(slot, ...((s) => [s.intro, s.chapters] as const)(resolveSagaChapters(c.row.face_content as never, c.row.rules_text)))] as const),
    );
    const rail = (id: string) => {
      const r = rails.get(id);
      expect(r, id).toBeDefined();
      return r!;
    };
    const stacks = (id: string) => rail(id).rows.map((row) => row.labels.length);
    // The plain cases: no reminder and three singles; a reminder and a
    // two-badge stack — every colour of both, so all seven masters.
    for (const colour of VISUAL_COLOURS) {
      expect(rail(`saga/${colour}/saga-short`).intro, colour).toBeNull();
      expect(stacks(`saga/${colour}/saga-short`), colour).toEqual([1, 1, 1]);
      expect(rail(`saga/${colour}/saga-long`).intro, colour).not.toBeNull();
      expect(stacks(`saga/${colour}/saga-long`), colour).toEqual([2, 1]);
    }
    // Stacks at the roomy pitch (the DOM prints' 160 px), a tighter one and
    // the tightest (LTC #58's 138 px).
    expect(stacks("saga/u/saga-long@stack3")).toEqual([3, 1]);
    expect(rail("saga/u/saga-long@stack3")).toMatchObject({ sizePx: 64, pitchPx: 160, clipped: false, combinedFallback: false });
    expect(stacks("saga/g/saga-long@stack5")).toEqual([1, 5]);
    expect(rail("saga/g/saga-long@stack5")).toMatchObject({ sizePx: 64, pitchPx: 150, clipped: false });
    expect(rail("saga/g/saga-long@stack5-tight")).toMatchObject({ sizePx: 62, pitchPx: 138, clipped: false });
    expect(stacks("saga/r/saga-short@stack6")).toEqual([6]);
    expect(rail("saga/r/saga-short@stack6")).toMatchObject({ sizePx: 64, pitchPx: 160, clipped: false, combinedFallback: false });
    // A stored production saga's shape: no reminder, I / II,III,IV / V / VI,
    // at the stored bake's size.
    expect(stacks("saga/u/saga-short@prodshape")).toEqual([1, 3, 1, 1]);
    expect(rail("saga/u/saga-short@prodshape").intro).toBeNull();
    expect(cases.find((c) => c.id === "saga/u/saga-short@prodshape")?.preset).toBe("hd");
    // Six rows from the rail's own top.
    expect(stacks("saga/g/saga-short@six")).toEqual([1, 1, 1, 1, 1, 1]);
    expect(rail("saga/g/saga-short@six")).toMatchObject({ sizePx: 64, clipped: false });
    expect(rail("saga/g/saga-short@six").rowsRect.topPct).toBe(slot.rect.topPct);
    // Repeated numerals whose stacks can never fit: ONE badge per row.
    expect(rail("saga/w/saga-short@combined").combinedFallback).toBe(true);
    expect(rail("saga/w/saga-short@combined").rows.map((row) => row.labels)).toEqual([["I–VI"], ["I,III,V"], ["II,IV,VI"], ["VI"]]);
    // A reminder past its box at 62 px steps down inside it; the rows stay.
    const longIntro = rail("saga/b/saga-long@longintro");
    expect(longIntro.intro?.sizePx).toBeLessThan(62);
    expect(longIntro.intro?.clipped).toBe(false);
    expect(longIntro).toMatchObject({ sizePx: 64, clipped: false });
    expect(longIntro.rowsRect.topPct).toBe(slot.rowsTopPct);
    expect(longIntro.introGrown).toBe(false);
    // One its box can't hold at the ladder's floor outgrows it: the floor
    // size, the chapters' column, the rows under it — nothing clipped.
    const grownIntro = rail("saga/r/saga-long@grownintro");
    expect(grownIntro).toMatchObject({ introGrown: true, sizePx: 64, clipped: false });
    expect(grownIntro.intro).toMatchObject({ sizePx: 42, clipped: false });
    expect(grownIntro.intro?.input.rect.leftPct).toBe(slot.rect.leftPct);
    expect(grownIntro.rowsRect.topPct).toBeGreaterThan(slot.rowsTopPct);
    expect(stacks("saga/r/saga-long@grownintro")).toEqual([2, 1]);
    // The ladder's lower steps, then a rail past its floor.
    expect(rail("saga/wub/saga-long@dense").sizePx).toBeLessThan(60);
    expect(rail("saga/wub/saga-long@dense").clipped).toBe(false);
    expect(stacks("saga/wub/saga-long@dense")).toEqual([1, 1, 2, 1]);
    expect(rail("saga/wub/saga-long@pastfloor")).toMatchObject({ sizePx: 42, clipped: true });
    // Legacy rules text: all reminder (no rows), and markers past VI.
    expect(rail("saga/c/saga-short@introonly").rows).toEqual([]);
    expect(rail("saga/c/saga-short@introonly").intro).not.toBeNull();
    expect(rail("saga/b/saga-short@legacy8").rows.map((row) => row.labels)).toEqual([["I–VII"], ["VIII"]]);
    // Both bake sizes of the stacked and the six-row rail.
    for (const id of ["saga/u/saga-long@stack3-hd", "saga/g/saga-short@six-hd", "saga/g/saga-long@hd"]) {
      expect(cases.find((c) => c.id === id)?.preset, id).toBe("hd");
    }
  });

  it("bakes a card without art on the see-through masters and v35's art slots (the empty-art box; no under-frame layer)", () => {
    const noArt = cases.filter((c) => c.id.endsWith("@noart"));
    expect(noArt.map((c) => `${c.template}/${c.colour}`)).toEqual([
      "battle/c",
      "flip/c",
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

  it("switches the holofoil stamp on only in its stamp cases: a rare on auto on every notched template, the stamp's shapes on m15 (TODO 4.9c)", () => {
    const stamped = cases.filter((c) => c.id.includes("@stamp"));
    const keyed = cases.filter((c) => "stamp" in (c.row.frame_style as object));
    expect(keyed.map((c) => c.id)).toEqual(stamped.map((c) => c.id));
    expect([...STAMP_TEMPLATES].sort()).toEqual(FRAME_TEMPLATE_VALUES.filter((t) => frameAnatomyOf(t).stamp).sort());
    // Every notched template has its auto rare; the token case is the one
    // case on a frame without the notch (nothing drawn, pinned).
    expect([...new Set(stamped.map((c) => c.template))].sort()).toEqual([...STAMP_TEMPLATES, "m15token"].sort());
    for (const template of STAMP_TEMPLATES) {
      const auto = stamped.find((c) => c.template === template && c.id.endsWith("@stamp"));
      expect(auto, template).toBeDefined();
      expect((auto!.row.frame_style as { stamp: string }).stamp).toBe("auto");
      expect(auto!.row.rarity).toBe("rare");
    }
    for (const c of stamped) {
      const style = c.row.frame_style as { stamp?: string; collector?: string; crown?: boolean; twoColor?: boolean };
      expect(["auto", "oval"], c.id).toContain(style.stamp);
      expect(style.collector, c.id).toBeUndefined();
      // The crown rides only on the crowned pair case (the split crown and
      // the pair notch on one card).
      expect(style.crown, c.id).toBe(c.id.endsWith("@stamp-pair-crown") ? true : undefined);
    }
    // The pair notch (the 4.9c follow-up): a rare on auto drawn as its pair
    // master on every template with BOTH pairs and the notch — and on no
    // other (a template that gains pairs with the notch declared joins
    // STAMP_PAIR_TEMPLATES by this check); the hybrid dress, the crowned
    // pair, the HD size and the foil pair on m15.
    expect([...STAMP_PAIR_TEMPLATES].sort()).toEqual(
      FRAME_TEMPLATE_VALUES.filter((t) => frameAnatomyOf(t).stamp && frameAnatomyOf(t).twoColor.length > 0).sort(),
    );
    const pairStamped = stamped.filter((c) => (c.row.frame_style as { twoColor?: boolean }).twoColor === true);
    expect([...new Set(pairStamped.map((c) => c.template))].sort()).toEqual([...STAMP_PAIR_TEMPLATES].sort());
    for (const template of STAMP_PAIR_TEMPLATES) {
      const auto = pairStamped.find((c) => c.template === template && c.id.endsWith("@stamp-pair-split"));
      expect(auto, template).toBeDefined();
      expect(auto!.row).toMatchObject({ rarity: "rare", frame_style: { stamp: "auto", twoColor: true } });
      expect(auto!.colour).toBe("wu");
    }
    for (const c of pairStamped) expect(c.colour, c.id).toBe("wu");
    const byId = new Map(cases.map((c) => [c.id, c]));
    expect(byId.get("m15/wu/creature-short@stamp-pair-hybrid")?.row.cost).toBe("{W/U}{W/U}");
    expect(byId.get("m15/wu/creature-long@stamp-pair-crown")?.row).toMatchObject({ rarity: "mythic", frame_style: { crown: true, twoColor: true, stamp: "auto" } });
    expect(byId.get("m15/wu/creature-long@stamp-pair-hd")?.preset).toBe("hd");
    expect(byId.get("m15/wu/creature-short@stamp-pair-foil")?.finish).toBe("foil");
    expect(byId.get("m15/w/creature-short@stamp-always")?.row).toMatchObject({ rarity: "common", frame_style: { stamp: "oval" } });
    expect(byId.get("m15/b/creature-long@stamp-arch")?.row.rules_text).toBe(STAMP_ARCH_RULES);
    expect(byId.get("m15/g/creature-long@stamp-hd")?.preset).toBe("hd");
    expect(byId.get("m15/r/creature-short@stamp-foil")?.finish).toBe("foil");
    expect(byId.get("m15/u/creature-long@stamp-etched")?.finish).toBe("etched");
    expect(byId.get("m15/u/creature-short@stamp-square")?.corners).toBe("square");
    // Wave 1's "@stamp-pair" pin (nothing drawn on a pair) is retired.
    expect(byId.has("m15/wu/creature-short@stamp-pair")).toBe(false);
    expect(byId.get("m15token/g/token-short@stamp-token")?.row.card_type).toBe("token");
    expect(byId.get("m15pw/u/planeswalker-short@stamp")?.row.card_type).toBe("planeswalker");
    // Every stored card's case names no stamp key.
    for (const c of cases.filter((x) => !stamped.includes(x))) expect(c.row.frame_style, c.id).not.toHaveProperty("stamp");
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
    expect(crowned.map((c) => c.id)).toEqual(cases.filter((c) => /@(stamp-)?(pair(-hybrid)?-)?crown/.test(c.id)).map((c) => c.id));
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
    const stamped = cases.filter((c) => c.id.includes("@stamp"));
    // A transform row with a stored icon family (TODO 5.1a: the 2016–22
    // back's cases and the family cases) names `dfcIcon` — a family, not a
    // switch, and the default (`arrows`) is never stored.
    for (const c of cases.filter((x) => !crowned.includes(x) && !paired.includes(x) && !lined.includes(x) && !stamped.includes(x))) {
      const keys = Object.keys(c.row.frame_style as object).sort();
      const family = (c.row.frame_style as { dfcIcon?: string }).dfcIcon;
      if (family) {
        expect(c.kind, c.id).toBe("transform");
        expect(family, c.id).not.toBe("arrows");
        expect(keys, c.id).toEqual(["dfcIcon", "finish", "template"]);
        continue;
      }
      // The text alignment's cases (TODO 4.21e) name "center" — and are the
      // ONLY cases that do: every other case is a stored card's shape.
      if (c.id.includes("@centred")) {
        expect((c.row.frame_style as { rulesAlign?: string }).rulesAlign, c.id).toBe("center");
        expect(keys, c.id).toEqual(["finish", "rulesAlign", "template"]);
        continue;
      }
      expect(keys, c.id).toEqual(["finish", "template"]);
    }
    expect(cases.filter((c) => "rulesAlign" in (c.row.frame_style as object)).every((c) => c.id.includes("@centred"))).toBe(true);
    // The split crown: both switches on, on every template that draws both
    // (the borderless land draws its pairs and no crown, 4.56: none there).
    const both = crowned.filter((c) => paired.includes(c));
    expect([...new Set(both.map((c) => c.template))].sort()).toEqual(PAIR_TEMPLATES.filter((t) => frameAnatomyOf(t).crown).sort());
    // …and the old frames' (4.6h): pairs, no crown.
    expect(PAIR_TEMPLATES.filter((t) => !frameAnatomyOf(t).crown)).toEqual(["m15borderlessland", "modern", "modernland", "retroland"]);
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
    // The borderless land's pairs (TODO 4.56): its W|U card, the HD bake, a
    // pair with black, the foil and the squared print — and the SAME land
    // without the switch stays a stored card's case (the gold master).
    const land = on.filter((c) => c.template === "m15borderlessland").map((c) => c.id).sort();
    expect(land).toEqual([
      "m15borderlessland/wu/land-long@pair-hd",
      "m15borderlessland/wu/land-short@pair",
      "m15borderlessland/wu/land-short@pair-br",
      "m15borderlessland/wu/land-short@pair-foil",
      "m15borderlessland/wu/land-short@pair-square",
    ]);
    const byId = new Map(cases.map((c) => [c.id, c]));
    expect(byId.get("m15borderlessland/wu/land-short@pair-br")?.row.color_identity).toEqual(["black", "red"]);
    expect(byId.get("m15borderlessland/wu/land-short")?.row.frame_style).toEqual({ template: "m15borderlessland", finish: "regular" });
    expect(byId.get("m15borderlessland/wu/land-short")?.row.color_identity).toEqual(["white", "blue"]);
  });

  it("fingerprints what each case draws: the row, preset and corners — not the field order", () => {
    const [c] = cases;
    expect(caseInput(c)).toBe(c.input);
    expect(caseInput({ ...c, row: Object.fromEntries(Object.entries(c.row).reverse()) as typeof c.row })).toBe(c.input);
    expect(caseInput({ ...c, row: { ...c.row, rules_text: "Changed." } })).not.toBe(c.input);
    expect(caseInput({ ...c, corners: c.corners === "round" ? "square" : "round" })).not.toBe(c.input);
    expect(caseInput({ ...c, preset: c.preset === "hd" ? "default" : "hd" })).not.toBe(c.input);
  });

  it("bakes each case in the finish it names: the row's frame_style carries the case's finish (a row override must not reset it)", () => {
    // The transform bodies' first "@foil" cases (5.1a) baked REGULAR: their
    // row override carried `finish: "regular"` over the case's foil, so the
    // rider, the dot and the dark plate were never under the sheen.
    for (const c of cases) {
      const rowFinish = (c.row.frame_style as { finish?: string } | null)?.finish ?? "regular";
      expect(rowFinish, c.id).toBe(c.finish);
    }
    expect(cases.filter((c) => c.finish === "foil" && c.face === "back").map((c) => c.id)).toEqual(["m15dfcback/r/transform-short@foil", "m15mdfcback/r/mdfc-short@foil"]);
  });

  it("bakes the long back-body cases with the LONG back (dense rules, the long name, 12/12 on the dark plate): never the short back under a long id (TODO 5.1a; the modal backs too, 5.1b)", () => {
    for (const c of cases) {
      if (c.face !== "back") continue;
      const back = c.row.back_face as { title?: string; rules_text?: string } | null;
      const short = cases.find((s) => s.id === c.id.replace(/(transform|mdfc)-long/, "$1-short"));
      if (c.shape === "long" && short && short !== c) {
        expect(JSON.stringify(c.row.back_face), c.id).not.toBe(JSON.stringify(short.row.back_face));
        expect(back?.title?.length ?? 0, c.id).toBeGreaterThan(((short.row.back_face as { title?: string } | null)?.title?.length ?? 0));
      }
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
