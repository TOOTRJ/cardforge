import { describe, expect, it } from "vitest";
import type { Card } from "@/types/card";
import { frameAnatomyOf } from "@/lib/cards/anatomy";
import { frameKindGateError, frameKindUpdateGateError } from "@/lib/cards/frame-kind-gate";
import { frameComboKey, FRAME_COLOR_KEYS, sampleFramePreview } from "@/lib/cards/frame-reference-registry";
import { frontDrawsPowerToughness } from "@/lib/cards/pt-drawn";
import { M15UB_HOLO_STAMP, getFrameProfile } from "@/lib/cards/template-layout";
import {
  CARD_KIND_VALUES,
  KIND_DEFS,
  framesForKind,
  isSagaCreatureDress,
  kindFromCard,
  sagaCreatureDressReason,
  sagaCreatureFrameFits,
  sagaCreatureFrameFor,
  templateRefusesKind,
} from "@/lib/creator/card-kinds";
import { defaultValuesFor } from "@/lib/creator/card-fields";
import { resolveDeckCardFrame } from "@/lib/creator/frame-random";
import { frameFitsImport } from "@/lib/creator/import-frame-choice";
import { submittedRulesOf, structuredRowsUntouched, type StructuredRulesValues } from "@/lib/creator/structured-rules";
import { typographyFieldOf } from "@/lib/validation/print-typography";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.5d — the saga creature body (`sagacreature`): the Saga kind's frame
// for a saga whose type words say Creature (FIN's "Summon:" cards). The
// creator and the server read ONE gate (sagaCreatureFrameFits), a NEW saga
// follows its Creature word onto the body where it is verified, the AI deck
// follows too, and the creature's box is the text after the chapters.
// ---------------------------------------------------------------------------

const EVERY = new Set(FRAME_TEMPLATE_VALUES.flatMap((t) => FRAME_COLOR_KEYS.map((k) => frameComboKey(t, k))));
const keys = (...pairs: Array<[string, string]>) => new Set(pairs.map(([t, c]) => frameComboKey(t as never, c)));

const summon = { cardType: "enchantment", supertype: "Creature", subtypes: ["Saga", "Knight"], title: "Summon: Knights of Round" };
const saga = { cardType: "enchantment", supertype: null, subtypes: ["Saga"], title: "The Eldest Reborn" };

describe("the body", () => {
  it("is the saga's rail with a P/T, a second box, the UB triangle stamp and the collector line", () => {
    const p = getFrameProfile("sagacreature");
    expect(p.chapters?.creatureBox).toBe(true);
    expect(p.pt?.plateAssetPathTemplate).toBe("/frames/m15nyx/pt/{color}.png");
    expect(frontDrawsPowerToughness("sagacreature")).toBe(true);
    expect(frontDrawsPowerToughness("saga")).toBe(false);
    expect(p.overlays).toEqual([{ ...M15UB_HOLO_STAMP, keyMap: { c: "a" } }]);
    expect(frameAnatomyOf("sagacreature")).toMatchObject({ stamp: true, collector: true });
    expect(p.rules.alignSingleLine).toBe("centerAny");
    expect(p.rules.ptFloat).toBe(true);
  });

  it("raises the type line and the set symbol 173 px with the bar; the rail ends on it", () => {
    const [p, s] = [getFrameProfile("sagacreature"), getFrameProfile("saga")];
    expect((s.type.rect.topPct - p.type.rect.topPct) * 21).toBeCloseTo(173, 6);
    expect((s.symbolRect!.topPct - p.symbolRect!.topPct) * 21).toBeCloseTo(173, 6);
    expect((p.chapters!.rect.topPct + p.chapters!.rect.heightPct) * 21).toBeCloseTo(1586, 6);
  });
});

describe("the kind gate — the creator and the server read the same rule", () => {
  it("is the Saga kind's third layout frame, never its default", () => {
    expect(KIND_DEFS.saga.layoutTemplates).toEqual(["saga", "sagadfcfront", "sagacreature"]);
    expect(KIND_DEFS.saga.previewTemplate).toBe("saga");
    expect(kindFromCard("enchantment", "sagacreature")).toBe("saga");
    expect(framesForKind("saga", EVERY).map((f) => f.template)).toContain("sagacreature");
    for (const kind of CARD_KIND_VALUES) expect(templateRefusesKind("sagacreature", kind), kind).toBe(kind !== "saga");
  });

  it("takes a saga whose words say Creature and refuses a plain saga, in the same words", () => {
    expect(isSagaCreatureDress("sagacreature")).toBe(true);
    expect(isSagaCreatureDress("saga")).toBe(false);
    expect(sagaCreatureFrameFits("sagacreature", summon)).toBe(true);
    expect(sagaCreatureFrameFits("sagacreature", saga)).toBe(false);
    // Any other frame: no gate here.
    expect(sagaCreatureFrameFits("saga", saga)).toBe(true);
    const reason = "The Saga creature frame is for sagas that are creatures — pick another frame.";
    expect(sagaCreatureDressReason("sagacreature")).toBe("The Saga creature frame is for sagas that are creatures");
    expect(frameKindGateError("sagacreature", summon)).toBeNull();
    expect(frameKindGateError("sagacreature", saga)).toBe(reason);
    // A creature card type with "Enchantment" in its words reads as Creature too.
    expect(frameKindGateError("sagacreature", { ...summon, cardType: "creature", supertype: "Enchantment" })).toBeNull();
    // The saga frame keeps every saga, the creature one included (a stored card).
    expect(frameKindGateError("saga", summon)).toBeNull();
  });

  it("refuses an edit that takes the Creature word off a card on the body, or moves a plain saga onto it", () => {
    expect(frameKindUpdateGateError({ existingTemplate: "sagacreature", nextTemplate: undefined, existing: summon, next: saga })).toMatch(/for sagas that are creatures/);
    expect(frameKindUpdateGateError({ existingTemplate: "saga", nextTemplate: "sagacreature", existing: saga, next: saga })).toMatch(/for sagas that are creatures/);
    expect(frameKindUpdateGateError({ existingTemplate: "saga", nextTemplate: "sagacreature", existing: summon, next: summon })).toBeNull();
  });

  it("the import chooser offers it to a saga creature only", () => {
    const patch = { card_type: "enchantment" as const, supertype: "Creature", subtypes_text: "Saga, Knight", title: "x", rules_text: "", color_identity: ["white" as const] };
    const input = { kind: "saga" as const, verifiedKeys: EVERY };
    expect(frameFitsImport("sagacreature", { ...input, patch })).toBe(true);
    expect(frameFitsImport("sagacreature", { ...input, patch: { ...patch, supertype: "" } })).toBe(false);
  });

  it("the walk-through's sample is a saga creature (its rail, its box, its P/T)", () => {
    const sample = sampleFramePreview("sagacreature", "w");
    expect(sample.supertype).toBe("Creature");
    expect(sample.subtypes).toContain("Saga");
    expect(sample.power).toBe("3");
    expect(frameKindGateError("sagacreature", { cardType: sample.cardType, supertype: sample.supertype, subtypes: sample.subtypes, title: sample.title })).toBeNull();
  });
});

describe("the follow (a NEW card) — sagaCreatureFrameFor", () => {
  it("moves a saga onto the body when its words say Creature, and back when they no longer do", () => {
    expect(sagaCreatureFrameFor("saga", "saga", summon)).toBe("sagacreature");
    expect(sagaCreatureFrameFor("saga", "sagacreature", saga)).toBe("saga");
    expect(sagaCreatureFrameFor("saga", "sagacreature", summon)).toBe("sagacreature");
    expect(sagaCreatureFrameFor("saga", "saga", saga)).toBe("saga");
  });

  it("never moves another kind, or a saga on its two-faced front", () => {
    expect(sagaCreatureFrameFor("saga", "sagadfcfront", summon)).toBe("sagadfcfront");
    expect(sagaCreatureFrameFor("creature", "m15", { cardType: "creature" })).toBe("m15");
    expect(sagaCreatureFrameFor("enchantment", "saga", summon)).toBe("saga");
  });

  it("the AI deck: a saga creature on the body where it is verified in the card's colour, else the saga frame", () => {
    const face = {
      cardType: "enchantment" as const,
      supertype: "Creature",
      subtypes: ["Saga", "Knight"],
      title: "Summon: Knights of Round",
      rulesText: "I — Create a 2/2 white Knight creature token.\nII — Draw a card.\nIndestructible",
      power: "3",
      toughness: "3",
    };
    const input = { cardType: "enchantment" as const, colorIdentity: ["white" as const], face };
    expect(resolveDeckCardFrame({ ...input, verifiedKeys: keys(["saga", "w"], ["sagacreature", "w"]) })).toBe("sagacreature");
    expect(resolveDeckCardFrame({ ...input, verifiedKeys: keys(["saga", "w"], ["sagacreature", "u"]) })).toBe("saga");
    // A plain saga never lands there.
    expect(resolveDeckCardFrame({ ...input, face: { ...face, supertype: null }, verifiedKeys: keys(["saga", "w"], ["sagacreature", "w"]) })).toBe("saga");
  });
});

describe("the creature's box in the creator — the text after the chapters", () => {
  const REMINDER = "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after II.)";
  const values = (over: Partial<StructuredRulesValues> = {}): StructuredRulesValues => ({
    rules_text: "",
    loyalty_abilities: [],
    saga_intro: REMINDER,
    saga_chapters: [
      { numerals: [1], text: "Draw a card." },
      { numerals: [2], text: "Scry 2." },
    ],
    saga_creature_text: "Flying",
    ...over,
  });

  it("a NEW saga creature saves its rows and writes the box's lines after the last chapter", () => {
    const out = submittedRulesOf("saga", values(), { sagaCreatureFrame: true });
    expect(out.rulesText).toBe(`${REMINDER}\nI — Draw a card.\nII — Scry 2.\nFlying`);
    expect(out.faceContent).toEqual({
      v: 1,
      saga: { intro: REMINDER, chapters: [{ numerals: [1], text: "Draw a card." }, { numerals: [2], text: "Scry 2." }] },
    });
  });

  it("an empty box writes nothing; off the body a box that HOLDS lines keeps them (never dropped in silence)", () => {
    expect(submittedRulesOf("saga", values({ saga_creature_text: "" }), { sagaCreatureFrame: true }).rulesText).toBe(
      `${REMINDER}\nI — Draw a card.\nII — Scry 2.`,
    );
    expect(submittedRulesOf("saga", values({ saga_creature_text: "" }), {}).rulesText).toBe(`${REMINDER}\nI — Draw a card.\nII — Scry 2.`);
    // (The field stays shown there while it holds them, and says the frame
    // doesn't print them — components/creator/panels/saga-editor.tsx.)
    expect(submittedRulesOf("saga", values(), {}).rulesText).toBe(`${REMINDER}\nI — Draw a card.\nII — Scry 2.\nFlying`);
  });

  it("an EDIT opens the rows from the rail's text and the box from the lines after it; untouched, the stored text is kept", () => {
    const stored = {
      id: "00000000-0000-4000-8000-000000000045",
      title: "Summon: Shiva",
      slug: "summon-shiva",
      game_system_id: "gs",
      cost: "{3}{U}{U}",
      color_identity: ["blue"],
      supertype: "Creature",
      card_type: "enchantment",
      subtypes: ["Saga", "Elemental"],
      tags: [],
      rarity: "uncommon",
      rules_text: `${REMINDER}\nI — Draw a card.\nII — Scry 2.\nFlying`,
      flavor_text: null,
      power: "4",
      toughness: "5",
      loyalty: null,
      defense: null,
      artist_credit: null,
      art_url: null,
      art_position: {},
      frame_style: { template: "sagacreature" },
      visibility: "public",
      back_face: null,
      back_card_id: null,
      source_scryfall_id: null,
      set_icon_url: null,
      set_icon_code: null,
      face_content: null,
      watermark: null,
      footer_text: null,
    } as unknown as Card;
    const opened = defaultValuesFor(stored, []);
    expect(opened.saga_intro).toBe(REMINDER);
    expect(opened.saga_chapters.map((r) => r.text)).toEqual(["Draw a card.", "Scry 2."]);
    expect(opened.saga_creature_text).toBe("Flying");
    // Untouched: the stored text byte for byte.
    expect(structuredRowsUntouched("saga", opened, opened)).toBe(true);
    const kept = submittedRulesOf("saga", opened, { opened, storedFaceContent: null, sagaCreatureFrame: true });
    expect(kept.rulesText).toBe(stored.rules_text);
    // The box edited alone is an edit: its new line is written.
    const edited = { ...opened, saga_creature_text: "Flying, vigilance" };
    expect(structuredRowsUntouched("saga", edited, opened)).toBe(false);
    expect(submittedRulesOf("saga", edited, { opened, sagaCreatureFrame: true }).rulesText).toBe(
      `${REMINDER}\nI — Draw a card.\nII — Scry 2.\nFlying, vigilance`,
    );
    // The same card on the SAGA frame opens as every saga does.
    const plain = defaultValuesFor({ ...stored, frame_style: { template: "saga" } } as unknown as Card, []);
    expect(plain.saga_chapters.at(-1)!.text).toBe("Scry 2. Flying");
    expect(plain.saga_creature_text).toBe("");
  });

  it("is typeset as rules text on blur", () => {
    expect(typographyFieldOf("saga_creature_text")).toBe("rules");
  });
});
