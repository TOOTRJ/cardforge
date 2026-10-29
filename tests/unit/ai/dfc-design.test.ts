import { describe, expect, it } from "vitest";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { lintCardDesign } from "@/lib/ai/mtg-rules";
import {
  AI_DFC_KINDS,
  DFC_SAGA_REMINDER,
  autofixDfcParts,
  dfcColorKeys,
  dfcFitOf,
  dfcFrameBrief,
  dfcKindOffReason,
  dfcPrecheckError,
  fillBackFaceOf,
  fillCreditsFor,
  lintDfcDesign,
  normalizeDfcDesign,
  type AiDfcKind,
  type DfcDesignCard,
  type DfcFace,
} from "@/lib/ai/dfc-design";
import { aiFrameOptions } from "@/lib/ai/frame-choices";
import { FRAME_TEMPLATE_VALUES, type ColorIdentity, type FrameTemplate } from "@/types/card";
import { DFC_DESIGNS, DFC_FRONT, type DfcFixtureDesign } from "./fixtures/dfc-designs";

// ---------------------------------------------------------------------------
// Double-faced cards in the AI engine (the AI dialog, PR 3) — the pure half:
// the kinds and their front frames, the back face's lint and autofix, the
// brief, and the plan-time fit: every gate the creator's save runs on a
// double-faced card (the front's body and gates, the back's body from the
// creator's own derivation, the server's back gate in the back's colour).
// ---------------------------------------------------------------------------

const COLOURS = ["w", "u", "b", "r", "g", "c", "m"];
const EVERY = new Set(FRAME_TEMPLATE_VALUES.flatMap((template) => COLOURS.map((colour) => frameComboKey(template as FrameTemplate, colour))));
const only = (pairs: [string, string[]][]) => new Set(pairs.flatMap(([template, keys]) => keys.map((key) => frameComboKey(template, key))));

const normalized = (kind: AiDfcKind, design: DfcFixtureDesign = DFC_DESIGNS[kind]) =>
  normalizeDfcDesign(structuredClone(design) as unknown as DfcDesignCard, kind);

const faceOf = (card: DfcDesignCard & { flavor_text?: string | null }): DfcFace => ({
  card_type: card.card_type,
  supertype: card.supertype,
  subtypes: card.subtypes,
  title: card.title,
  cost: card.cost,
  rules_text: card.rules_text,
  flavor_text: card.flavor_text ?? null,
  color_identity: card.color_identity,
  power: card.power,
  toughness: card.toughness,
  back_face: card.back_face ?? null,
});

describe("the kinds", () => {
  it("each lights where its front and its default back are published", () => {
    for (const kind of AI_DFC_KINDS) expect(dfcKindOffReason(kind, new Set())).toBe("No frame published yet");
    expect(dfcKindOffReason("transform", only([["m15dfcfront", ["r"]]]))).toBe("No frame published yet");
    expect(dfcKindOffReason("transform", only([["m15dfcfront", ["r"]], ["m15dfcback", ["r"]]]))).toBeNull();
    expect(dfcKindOffReason("mdfc", only([["m15mdfcfront", ["u"]], ["m15mdfcback", ["u"]]]))).toBeNull();
    expect(dfcKindOffReason("dfc_saga", only([["sagadfcfront", ["w"]], ["m15dfcback", ["w"]]]))).toBeNull();
    expect(dfcKindOffReason("dfc_token", only([["m20token", ["r"]]]))).toBeNull();
  });

  it("the dialog lists each kind's FRONT frames only — never a back body or another kind's", () => {
    expect(aiFrameOptions("transform", EVERY, null).map((option) => option.template)).toEqual(["m15dfcfront", "m15dfclandfront", "m15borderlessdfcfront"]);
    expect(aiFrameOptions("mdfc", EVERY, null).map((option) => option.template)).toEqual(["m15mdfcfront", "m15mdfclandfront", "m15borderlessmdfcfront"]);
    expect(aiFrameOptions("dfc_saga", EVERY, null).map((option) => option.template)).toEqual(["sagadfcfront"]);
    const tokens = aiFrameOptions("dfc_token", EVERY, null).map((option) => option.template);
    expect(tokens.length).toBeGreaterThan(4);
    expect(tokens.every((template) => template.startsWith("m15token") || template.startsWith("m20token"))).toBe(true);
    // The saga kind of PR 2 keeps its one frame.
    expect(aiFrameOptions("saga", EVERY, null).map((option) => option.template)).toEqual(["saga"]);
  });

  it("a colour is offered only where the front AND its default back are published", () => {
    const verified = only([["m15dfcfront", ["r", "g"]], ["m15dfcback", ["g"]]]);
    expect(dfcColorKeys("transform", null, verified)).toEqual(["g"]);
  });

  it("prices one credit per picture: 2 for a double-faced kind that paints, else 1", () => {
    const all = ["card_type", "art", "title"];
    for (const kind of AI_DFC_KINDS) expect(fillCreditsFor(kind, all)).toBe(2);
    expect(fillCreditsFor("transform", ["card_type", "title"])).toBe(1);
    expect(fillCreditsFor("split", all)).toBe(1);
    expect(fillCreditsFor("creature", all)).toBe(1);
    expect(fillCreditsFor(undefined, all)).toBe(1);
  });
});

describe("the brief", () => {
  it("names each kind's shape and the back face's own art prompt", () => {
    expect(dfcFrameBrief("transform", "m15dfcfront")).toMatch(/TRANSFORM double-faced card[\s\S]*`back_face`[\s\S]*cost \(""/);
    expect(dfcFrameBrief("transform", null)).toContain("art_prompt (the back face's OWN picture");
    expect(dfcFrameBrief("mdfc", "m15mdfcfront")).toContain("its OWN curly-brace mana cost");
    expect(dfcFrameBrief("mdfc", "m15mdfclandfront")).toContain('card_type "land"');
    expect(dfcFrameBrief("dfc_saga", "sagadfcfront")).toContain("return it to the battlefield transformed");
    expect(dfcFrameBrief("dfc_token", "m20token")).toContain("DOUBLE-SIDED TOKEN");
    expect(dfcFrameBrief("transform", "m15borderlessdfcfront")).toContain("The back is no land");
    expect(dfcFrameBrief("transform", null, ["r", "g"])).toContain("Each face's color must be red or green");
  });
});

describe("the fixtures are clean designs", () => {
  it.each(AI_DFC_KINDS)("%s — no lint error or warning, front and back", (kind) => {
    const card = normalized(kind);
    expect(lintCardDesign(card).errors).toEqual([]);
    // (A token with no mana symbols is asked about its colour by the
    // one-faced lint, as every token design is.)
    expect(lintCardDesign(card).warnings.filter((found) => kind !== "dfc_token" || found.field !== "color_identity")).toEqual([]);
    expect(lintDfcDesign(card, kind)).toEqual({ errors: [], warnings: [] });
  });
});

describe("normalize, lint and autofix of the back face", () => {
  it("a transform back prints no cost, and a transform LAND back is colourless", () => {
    const card = normalized("transform", {
      ...DFC_DESIGNS.transform,
      back_face: { ...DFC_DESIGNS.transform.back_face!, card_type: "land", cost: "{R}", power: null, toughness: null, rules_text: "{T}: Add {C}.", color_identity: ["red"] },
    });
    expect(card.back_face).toMatchObject({ cost: "", color_identity: ["colorless"] });
  });

  it("a double-faced saga's reminder never sacrifices", () => {
    const card = normalized("dfc_saga");
    expect(card.saga?.intro).toBe(DFC_SAGA_REMINDER);
    expect(card.rules_text.startsWith(DFC_SAGA_REMINDER)).toBe(true);
  });

  it("errors: no back, the front's name, a walker or Saga back, a modal spell back with no cost, a creature back with no stats", () => {
    const base = normalized("mdfc");
    const errorsOf = (back: Partial<NonNullable<DfcDesignCard["back_face"]>> | null) =>
      lintDfcDesign({ ...base, back_face: back === null ? null : { ...base.back_face!, ...back } }, "mdfc").errors.map((e) => e.message).join(" | ");
    expect(errorsOf(null)).toContain("needs its back_face");
    expect(errorsOf({ title: base.title })).toContain("a name of its own");
    expect(errorsOf({ subtypes: ["Saga"] })).toContain("no Saga");
    expect(errorsOf({ card_type: "instant", cost: "", rules_text: "Draw a card." })).toContain("needs its own mana cost");
    expect(errorsOf({ card_type: "creature", cost: "{2}{U}", rules_text: "Flying", power: null, toughness: null })).toContain("power and toughness");
  });

  it("the autofix repairs shape — never a name", () => {
    const base = normalized("transform");
    const fixed = autofixDfcParts({ ...base, back_face: { ...base.back_face!, cost: "{3}", power: null, subtypes: ["Werewolf", "Saga"] } }, "transform");
    expect(fixed.back_face).toMatchObject({ cost: "", power: "2", subtypes: ["Werewolf"] });
    expect(lintDfcDesign(fixed, "transform").errors).toEqual([]);
  });

  it("a colourless spell back without an Artifact word takes the front's colour", () => {
    const base = normalized("transform");
    const fixed = autofixDfcParts({ ...base, back_face: { ...base.back_face!, color_identity: ["colorless"] } }, "transform");
    expect(fixed.back_face?.color_identity).toEqual([]);
  });
});

describe("the plan-time fit — every gate a double-faced save runs", () => {
  const fit = (kind: AiDfcKind, verified: ReadonlySet<string> = EVERY, over: Partial<DfcFace> = {}, picked: string | null = DFC_FRONT[kind]) =>
    dfcFitOf(kind, { ...faceOf(normalized(kind)), ...over }, verified, { picked: picked as FrameTemplate | null, random: () => 0 });

  it.each(AI_DFC_KINDS)("%s — the front on its body, the back on the body the creator derives", (kind) => {
    const result = fit(kind);
    expect(result).toMatchObject({ ok: true, exact: true, front: DFC_FRONT[kind] });
    expect(result.back?.template).toBe({ transform: "m15dfcback", mdfc: "m15mdfclandback", dfc_saga: "m15dfcback", dfc_token: "m20token" }[kind]);
  });

  it("the back's colour: its own, else the front's", () => {
    expect(fit("transform").back?.color_identity).toEqual(["red"]);
    expect(fit("dfc_token").back?.color_identity).toEqual(["white"]);
  });

  it("a back colour its body isn't published in is refused (verified per colour)", () => {
    const verified = only([["m15dfcfront", ["r"]], ["m15dfcback", ["r"]]]);
    expect(fit("transform", verified).ok).toBe(true);
    const greenBack = { ...normalized("transform").back_face!, color_identity: ["green"] as ColorIdentity[], rules_text: "Trample" };
    const result = fit("transform", verified, { back_face: greenBack });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/green/i);
  });

  it("a front colour its body isn't published in is refused", () => {
    expect(fit("transform", only([["m15dfcfront", ["g"]], ["m15dfcback", ["r", "g"]]])).ok).toBe(false);
  });

  it("a land front type on the spell front is kept on the LAND front — and told", () => {
    const land = {
      card_type: "land" as const,
      cost: "—",
      rules_text: "{T}: Add {R}.",
      power: null,
      toughness: null,
      subtypes: [],
    };
    const result = fit("transform", EVERY, land);
    expect(result).toMatchObject({ ok: true, exact: false, front: "m15dfclandfront" });
    expect(result.notice).toBe("Designed as a land, so it's on Transform land front.");
  });

  it("a borderless front's land back has no body: refused", () => {
    const base = normalized("transform");
    const landBack = { ...base.back_face!, card_type: "land" as const, power: null, toughness: null, subtypes: [], rules_text: "{T}: Add {C}.", color_identity: ["colorless"] as ColorIdentity[] };
    const result = fit("transform", EVERY, { back_face: landBack }, "m15borderlessdfcfront");
    expect(result.ok).toBe(false);
  });

  it("a colourless front without an Artifact word is refused (dfcFrontColorError)", () => {
    const result = fit("transform", EVERY, { color_identity: ["colorless"], cost: "{3}" });
    expect(result.ok).toBe(false);
  });

  it("a token's back follows its own text onto the text-box height", () => {
    const base = normalized("dfc_token");
    const result = fit("dfc_token", EVERY, { back_face: { ...base.back_face!, rules_text: "Vigilance" } });
    expect(result.ok).toBe(true);
    expect(result.back?.template).not.toBe("m20token");
    expect(result.back?.template.startsWith("m20token")).toBe(true);
  });

  it("the fill hands the back whole, its colour explicit, a transform back with no cost", () => {
    const card = normalized("transform");
    expect(fillBackFaceOf("transform", card.back_face!, ["red"])).toEqual({
      title: "Moonlit Ravager",
      cost: "",
      card_type: "creature",
      supertype: null,
      subtypes: ["Werewolf"],
      rules_text: "Trample",
      flavor_text: null,
      power: "5",
      toughness: "4",
      color_identity: ["red"],
    });
    expect(fillBackFaceOf("mdfc", { ...card.back_face!, card_type: "instant", cost: "{1}{U}" }, ["blue"]).cost).toBe("{1}{U}");
  });
});

describe("refused before any model call", () => {
  it("a kept colour no front of the kind is published in", () => {
    const verified = only([["m15dfcfront", ["r"]], ["m15dfcback", ["r"]]]);
    const input = { kind: "transform" as const, picked: null, want: ["card_type"], lockedRules: null, verifiedKeys: verified };
    expect(dfcPrecheckError({ ...input, lockedColors: ["red"] })).toBeNull();
    expect(dfcPrecheckError({ ...input, lockedColors: ["green"] })).toMatch(/aren't published in green yet.*No credits were used\./);
    expect(dfcPrecheckError({ ...input, lockedColors: ["green"], want: ["card_type", "color_identity"] })).toBeNull();
  });

  it("a double-faced saga's kept rules text that is no saga's chapters", () => {
    expect(
      dfcPrecheckError({ kind: "dfc_saga", picked: null, want: ["card_type"], lockedRules: "Draw a card.", lockedColors: null, verifiedKeys: EVERY }),
    ).toMatch(/can't be a saga's chapters.*No credits were used\./);
  });
});

describe("review of #639", () => {
  it("the back's body follows the card's icon family (the maker's pick), as the save does", () => {
    const face = faceOf(normalized("transform"));
    expect(dfcFitOf("transform", face, EVERY, { picked: "m15dfcfront" }).back?.template).toBe("m15dfcback");
    expect(dfcFitOf("transform", face, EVERY, { picked: "m15dfcfront", family: "sunmoon" }).back?.template).toBe("m15dfcbackleft");
    // A family with no borderless back: refused at plan time, never after the art.
    expect(dfcFitOf("transform", face, EVERY, { picked: "m15borderlessdfcfront", family: "sunmoon" }).ok).toBe(false);
    // A modal card has no family: the same body whatever it says.
    expect(dfcFitOf("mdfc", faceOf(normalized("mdfc")), EVERY, { picked: "m15mdfcfront", family: "sunmoon" }).back?.template).toBe("m15mdfclandback");
  });

  it("the brief steers a transformed back to a PERMANENT (a modal back may be a spell); the lint still admits what the creator does", () => {
    for (const kind of ["transform", "dfc_saga"] as const) {
      expect(dfcFrameBrief(kind, null)).toContain("The back is a PERMANENT");
    }
    expect(dfcFrameBrief("mdfc", null)).not.toContain("PERMANENT");
    const card = normalized("transform");
    const instantBack = { ...card.back_face!, card_type: "instant" as const, power: null, toughness: null, subtypes: [], rules_text: "Draw a card." };
    expect(lintDfcDesign({ ...card, back_face: instantBack }, "transform").errors).toEqual([]);
  });
});
