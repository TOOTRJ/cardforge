import { describe, expect, it } from "vitest";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { lintCardDesign } from "@/lib/ai/mtg-rules";
import {
  AI_LAYOUT_KINDS,
  LAYOUT_TEMPLATE,
  autofixLayoutFront,
  autofixLayoutParts,
  fillSecondPartOf,
  layoutFitOf,
  layoutFrameBrief,
  layoutLockedOf,
  layoutPrecheckError,
  lintLayoutDesign,
  mergedSecondPart,
  normalizeLayoutDesign,
  repairSagaRows,
  sagaReminder,
  sagaRowProblems,
  secondPartDrawsCost,
  secondPartDrawsPt,
  type AiLayoutKind,
  type LayoutDesignCard,
} from "@/lib/ai/layout-design";
import { frameArtBrief } from "@/lib/ai/frame-art-brief";
import { neverDrawnSecondPartUnits } from "@/lib/creator/second-part-fields";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { KIND_DEFS } from "@/lib/creator/card-kinds";
import { sagaEditorRows } from "@/lib/cards/face-content";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";
import { LAYOUT_DESIGNS, SAGA, SPLIT } from "./fixtures/layout-designs";

// ---------------------------------------------------------------------------
// Sagas and the two-part cards in the AI engine (the AI dialog, PR 2) — the
// pure half: the shape the designer is told, the lint, the autofix, the
// plan-time fit (every gate the save runs) and the fill the creator pours
// into its back_face paths.
// ---------------------------------------------------------------------------

const COLOURS = ["w", "u", "b", "r", "g", "c", "m"];
const EVERY = new Set(FRAME_TEMPLATE_VALUES.flatMap((t) => COLOURS.map((k) => frameComboKey(t as FrameTemplate, k))));
const card = (kind: AiLayoutKind) => normalizeLayoutDesign(structuredClone(LAYOUT_DESIGNS[kind]) as unknown as LayoutDesignCard, kind);
const faceOf = (design: LayoutDesignCard) => ({ ...design, second_part: design.second_part ?? null });

describe("the kinds and their one frame", () => {
  it("each kind is made on its first layout template — the kind's own, never the double-faced saga front", () => {
    for (const kind of AI_LAYOUT_KINDS) {
      expect(LAYOUT_TEMPLATE[kind]).toBe(KIND_DEFS[kind].layoutTemplates![0]);
    }
    expect(LAYOUT_TEMPLATE.saga).toBe("saga");
  });

  it("a second part is offered only the fields its frame draws (lib/creator/second-part-fields.ts)", () => {
    for (const kind of AI_LAYOUT_KINDS.filter((k) => k !== "saga")) {
      const never = neverDrawnSecondPartUnits(getFrameProfile(LAYOUT_TEMPLATE[kind]));
      expect(secondPartDrawsPt(kind), kind).toBe(!never.has("pt"));
      // Flavour, artist, loyalty and defense are never drawn on any second part.
      for (const unit of ["flavor", "artist", "loyalty", "defense"] as const) expect(never.has(unit), `${kind} ${unit}`).toBe(true);
    }
    expect(secondPartDrawsPt("flip")).toBe(true);
    expect(secondPartDrawsCost("flip")).toBe(false);
    for (const kind of ["split", "aftermath", "adventure", "prepare"] as const) expect(secondPartDrawsCost(kind), kind).toBe(true);
  });

  it("the designed second part keeps only the wanted fields the frame draws", () => {
    const second = LAYOUT_DESIGNS.flip.second_part!;
    expect(fillSecondPartOf("flip", second as never, ["card_type", "title", "cost", "rules_text", "stats", "flavor_text"])).toEqual({
      card_type: "creature",
      supertype: "Legendary",
      subtypes: ["Human", "Wizard"],
      title: "Ashen Pyromancer",
      rules_text: second.rules_text,
      power: "3",
      toughness: "3",
    });
    // No P/T on a split half; the title and rules the maker KEEPS are not
    // written.
    const kept = { title: "Kept Name", rules_text: "Kept rules." };
    const half = fillSecondPartOf("split", SPLIT.second_part as never, ["card_type", "cost", "stats"], kept);
    expect(half).toEqual({ card_type: "instant", supertype: null, subtypes: [], cost: "{1}{U}" });
    expect(mergedSecondPart("split", SPLIT.second_part as never, ["card_type"], kept)).toMatchObject({
      title: "Kept Name",
      rules_text: "Kept rules.",
      cost: "{1}{U}",
    });
  });

  it("an unticked field the card holds no value for is written — the fit and the fill read the same card (the #636 check)", () => {
    // Title / Cost unticked on a card that has no second part yet: the AI
    // writes them; nothing is "kept" that isn't there.
    const out = fillSecondPartOf("split", SPLIT.second_part as never, ["card_type"]);
    expect(out).toMatchObject({ title: "Frostbind", cost: "{1}{U}", rules_text: "Tap target permanent. Draw a card." });
    const merged = mergedSecondPart("split", SPLIT.second_part as never, ["card_type"], undefined)!;
    for (const key of ["title", "cost", "rules_text"] as const) expect(merged[key]).toBe(out[key]);
    // A blank kept value is no value.
    expect(fillSecondPartOf("split", SPLIT.second_part as never, ["card_type"], { title: "  " }).title).toBe("Frostbind");
  });
});

describe("the pins a layout fill reads, and what is refused before any model call", () => {
  it("a saga or spell front drops the form's default stats; a creature front keeps them; loyalty / defense never", () => {
    const locked = { card_type: "creature" as const, power: "1", toughness: "1", loyalty: "3", defense: "4", title: "Kept" };
    expect(layoutLockedOf(locked, "saga")).toEqual({ card_type: "creature", title: "Kept" });
    expect(layoutLockedOf(locked, "split")).toEqual({ card_type: "creature", title: "Kept" });
    expect(layoutLockedOf(locked, "adventure")).toEqual({ card_type: "creature", power: "1", toughness: "1", title: "Kept" });
  });

  it("a kept saga text that is no saga's chapters, in its own words", () => {
    const at = (lockedRules: string) => layoutPrecheckError({ kind: "saga", want: ["card_type"], lockedRules, lockedColors: null, verifiedKeys: EVERY });
    expect(at("Draw a card.")).toBe(
      'The rules text you kept can\'t be a saga\'s chapters — A saga needs chapter rows (I, II, III…). Tick Rules text so the AI writes them, or write them as "I — …", "II — …". No credits were used.',
    );
    expect(at("I — Draw a card.\nIII — Scry 2.")).toContain("no gap or repeat");
    expect(at("I — Draw a card.\nII — Scry 2.")).toBeNull();
    // Writing the rules text: nothing to check.
    expect(layoutPrecheckError({ kind: "saga", want: ["card_type", "rules_text"], lockedRules: "Draw a card.", lockedColors: null, verifiedKeys: EVERY })).toBeNull();
  });

  it("a kept colour the frame isn't published in — except a gold split / aftermath, whose first half may take its own", () => {
    const greenSaga = new Set([...EVERY].filter((key) => !key.startsWith("saga/")).concat("saga/g"));
    const at = (kind: AiLayoutKind, colors: string[], keys = greenSaga) =>
      layoutPrecheckError({ kind, want: ["card_type"], lockedRules: "I — A\nII — B", lockedColors: colors as never, verifiedKeys: keys });
    expect(at("saga", ["red"])).toBe("The Saga frame isn't published in red yet. Tick Colors so the AI picks one it is, or pick another kind. No credits were used.");
    expect(at("saga", ["green"])).toBeNull();
    const noGoldSplit = new Set([...EVERY].filter((key) => key !== "split/m"));
    expect(at("split", ["multicolor"], noGoldSplit)).toBeNull();
    // An unknown (empty) verified set refuses nothing.
    expect(at("saga", ["red"], new Set())).toBeNull();
  });
});

describe("what the designer is told", () => {
  it("each kind's brief names its shape; a free colour is held to the frame's colours", () => {
    expect(layoutFrameBrief("saga")).toContain('subtypes include "Saga"');
    expect(layoutFrameBrief("saga")).toContain("chapter numbers I, II, III… in order");
    expect(layoutFrameBrief("adventure")).toContain('subtypes are ["Adventure"]');
    expect(layoutFrameBrief("aftermath")).toContain("Aftermath (Cast this spell only from your graveyard. Then exile it.)");
    expect(layoutFrameBrief("flip")).toContain('cost "" (a flipped side has no mana cost)');
    expect(layoutFrameBrief("prepare")).toContain("This creature enters prepared.");
    expect(layoutFrameBrief("split")).toContain("color_identity covers BOTH parts");
    expect(layoutFrameBrief("split", ["r", "u"])).toContain("Each part's color must be red or blue");
    expect(layoutFrameBrief("saga", ["g"])).toContain("Its color must be green");
    expect(layoutFrameBrief("saga", COLOURS)).not.toContain("color must be");
  });

  it("every kind's frame has art direction (one picture: the second part is text)", () => {
    for (const kind of AI_LAYOUT_KINDS) expect(frameArtBrief(LAYOUT_TEMPLATE[kind]), kind).not.toBe("");
    expect(frameArtBrief("split")).toContain("ONE picture shown in BOTH halves' windows");
    expect(frameArtBrief("adventure")).toContain("creature itself");
  });
});

describe("a saga's rows", () => {
  it("are its rules text, with the standard reminder, read back by the creator's editor as the same rows", () => {
    const saga = card("saga");
    expect(saga.saga!.intro).toBe(sagaReminder(3));
    expect(saga.rules_text).toBe(`${sagaReminder(3)}\nI — Draw a card.\nII, III — Create a 2/2 green Bear creature token.`);
    expect(sagaEditorRows(null, saga.rules_text)).toEqual({
      intro: sagaReminder(3),
      chapters: [
        { numerals: [1], text: "Draw a card." },
        { numerals: [2, 3], text: "Create a 2/2 green Bear creature token." },
      ],
    });
    expect(lintCardDesign(saga).errors).toEqual([]);
    expect(lintLayoutDesign(saga, "saga")).toEqual({ errors: [], warnings: [] });
  });

  it("the limits: no rows, a seventh row, a number past VI, a gap or a repeat", () => {
    expect(sagaRowProblems({ chapters: [] })).toEqual(["A saga needs chapter rows (I, II, III…)."]);
    const rows = (nums: number[][]) => ({ chapters: nums.map((numerals) => ({ numerals, text: "x" })) });
    expect(sagaRowProblems(rows([[1], [2], [3], [4], [5], [6], [7]]))).toContain("A saga has at most six chapter rows.");
    expect(sagaRowProblems(rows([[1], [7]]))).toContain("Chapter numbers run from I to VI.");
    expect(sagaRowProblems(rows([[1], [3]]))).toContain("Chapter numbers must run I, II, III… in order, with no gap or repeat.");
    expect(sagaRowProblems(rows([[1, 2], [2]]))).toContain("Chapter numbers must run I, II, III… in order, with no gap or repeat.");
    expect(sagaRowProblems(rows([[1], [2, 3]]))).toEqual([]);
  });

  it("the autofix renumbers in rows of the sizes written, drops empty and seventh rows — never invents one", () => {
    expect(repairSagaRows([{ numerals: [3], text: "C" }, { numerals: [1, 2], text: "A" }, { numerals: [9], text: "  " }])).toEqual([
      { numerals: [1, 2], text: "A" },
      { numerals: [3], text: "C" },
    ]);
    expect(repairSagaRows(Array.from({ length: 8 }, (_, i) => ({ numerals: [i + 1], text: `R${i}` })))).toHaveLength(6);
    const broken = normalizeLayoutDesign(
      { ...structuredClone(SAGA), subtypes: [], supertype: "Enchantment Creature", saga: { intro: null, chapters: [{ numerals: [2], text: "A" }, { numerals: [4], text: "B" }] } } as unknown as LayoutDesignCard,
      "saga",
    );
    expect(lintLayoutDesign(broken, "saga").errors.length).toBeGreaterThan(0);
    const fixed = autofixLayoutParts(autofixLayoutFront(broken, "saga"), "saga");
    expect(fixed.subtypes).toContain("Saga");
    expect(fixed.supertype).toBeNull();
    expect(fixed.saga!.chapters).toEqual([{ numerals: [1], text: "A" }, { numerals: [2], text: "B" }]);
    // The reminder follows the repaired rows (Sacrifice after II).
    expect(fixed.rules_text).toBe(`${sagaReminder(2)}\nI — A\nII — B`);
    expect(lintLayoutDesign(fixed, "saga").errors).toEqual([]);
  });
});

describe("a second part", () => {
  it.each(["adventure", "prepare", "split", "aftermath", "flip"] as const)("%s: the fixture design is clean", (kind) => {
    const design = card(kind);
    expect(lintLayoutDesign(design, kind)).toEqual({ errors: [], warnings: [] });
  });

  it("the lint: no second part, its name the first's, a type the kind can't take, a cost on a flip side, a P/T where none is drawn, the kind's own words, and the colours of BOTH parts", () => {
    const errors = (kind: AiLayoutKind, over: Record<string, unknown>, cardOver: Record<string, unknown> = {}) =>
      lintLayoutDesign({ ...card(kind), ...cardOver, second_part: { ...card(kind).second_part!, ...over } } as LayoutDesignCard, kind).errors.map((e) => e.message);
    expect(lintLayoutDesign({ ...card("split"), second_part: null }, "split").errors[0]!.message).toBe("A two-part card needs its second_part.");
    expect(errors("split", { title: "Emberlash" })).toContain("The second part needs a name of its own, not the first part's.");
    expect(errors("split", { card_type: "creature" })).toContain("The second part is instant or sorcery, never creature.");
    expect(errors("split", { cost: "" })).toContain("The second part needs a mana cost.");
    expect(errors("flip", { cost: "{R}" })).toContain('A flipped side has no mana cost — use "".');
    expect(errors("flip", { power: null })).toContain("The flipped side is a creature: it needs both power and toughness.");
    expect(errors("adventure", { power: "2", toughness: "2" })).toContain("The second part has no power / toughness on this frame — use null.");
    expect(errors("adventure", { subtypes: [] })).toContain('An adventure spell\'s subtypes are ["Adventure"].');
    expect(errors("aftermath", { rules_text: "Draw two cards." })[0]).toMatch(/^The aftermath half's rules begin with/);
    expect(errors("split", {}, { color_identity: ["red"] })[0]).toMatch(/^The second part's mana symbols use U/);
    // The creator's gold (a two-colour card kept as ["multicolor"]) covers any colours.
    expect(errors("split", {}, { color_identity: ["multicolor"] })).toEqual([]);
    expect(layoutFitOf("split", { ...faceOf(card("split")), color_identity: ["multicolor"] }, EVERY)).toMatchObject({ ok: true, partColour: { on: true, first: ["red"], second: ["blue"] } });
    expect(errors("split", {}, { card_type: "creature" })[0]).toMatch(/first part is instant or sorcery/);
  });

  it("the autofix: the kind's words and shape, and the whole card's colours from both parts — never a part invented", () => {
    const broken = {
      ...card("aftermath"),
      color_identity: ["red"],
      second_part: { ...card("aftermath").second_part!, rules_text: "Create two 2/2 green Wolf creature tokens.", power: "1", toughness: "1" },
    } as LayoutDesignCard;
    const fixed = autofixLayoutParts(broken, "aftermath");
    expect(fixed.second_part!.rules_text).toBe("Aftermath (Cast this spell only from your graveyard. Then exile it.)\nCreate two 2/2 green Wolf creature tokens.");
    expect(fixed.second_part!.power).toBeNull();
    expect(fixed.color_identity).toEqual(["green", "red", "multicolor"]);
    expect(lintLayoutDesign(fixed, "aftermath").errors).toEqual([]);
    const adventure = autofixLayoutParts({ ...card("adventure"), second_part: { ...card("adventure").second_part!, subtypes: [], card_type: "creature" } } as LayoutDesignCard, "adventure");
    expect(adventure.second_part).toMatchObject({ card_type: "instant", subtypes: ["Adventure"] });
    const flip = autofixLayoutParts({ ...card("flip"), second_part: { ...card("flip").second_part!, cost: "{2}" } } as LayoutDesignCard, "flip");
    expect(flip.second_part!.cost).toBe("");
    expect(autofixLayoutParts({ ...card("split"), second_part: null }, "split").second_part).toBeNull();
  });
});

describe("the fit — every gate the save runs, at plan time", () => {
  it.each(AI_LAYOUT_KINDS)("%s: the fixture design fits its frame with every colour verified", (kind) => {
    const fit = layoutFitOf(kind, faceOf(card(kind)), EVERY);
    expect(fit).toMatchObject({ ok: true, reason: null });
  });

  it("each part in its own colour: on where both are verified, the split's first half its own colour (M2), the whole card's colour unchanged", () => {
    expect(layoutFitOf("split", faceOf(card("split")), EVERY).partColour).toEqual({ on: true, first: ["red"], second: ["blue"] });
    // Prepare's page: the second part's colour, no first-half colour.
    expect(layoutFitOf("prepare", faceOf(card("prepare")), EVERY).partColour).toEqual({ on: true, second: ["white"] });
    // The adventure's page too; the flip side draws no part colour.
    expect(layoutFitOf("adventure", faceOf(card("adventure")), EVERY).partColour).toEqual({ on: true, second: ["green"] });
    expect(layoutFitOf("flip", faceOf(card("flip")), EVERY).partColour).toEqual({});
  });

  it("a part's colour not verified: the look goes OFF and the frame is judged in the whole colour — never a refusal while that is published", () => {
    const noBlue = new Set([...EVERY].filter((key) => key !== "split/u"));
    expect(layoutFitOf("split", faceOf(card("split")), noBlue)).toMatchObject({ ok: true, partColour: { on: false, second: [] } });
    const noBlueNoGold = new Set([...noBlue].filter((key) => key !== "split/m"));
    expect(layoutFitOf("split", faceOf(card("split")), noBlueNoGold)).toMatchObject({ ok: false });
  });

  it("the kind's frame not published in the card's colour, or a saga with no rows: not a fit", () => {
    const noGreenSaga = new Set([...EVERY].filter((key) => key !== "saga/g"));
    expect(layoutFitOf("saga", faceOf(card("saga")), noGreenSaga).ok).toBe(false);
    expect(layoutFitOf("saga", { ...faceOf(card("saga")), rules_text: "Draw a card." }, EVERY)).toMatchObject({ ok: false, reason: expect.stringContaining("chapter rows") });
    expect(layoutFitOf("prepare", { ...faceOf(card("prepare")), card_type: "instant", power: null, toughness: null }, EVERY).ok).toBe(false);
  });
});
