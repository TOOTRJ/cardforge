import { describe, expect, it } from "vitest";
import {
  CARD_KIND_VALUES,
  KIND_DEFS,
  KIND_PICKER_KINDS,
  LAYOUT_KIND_CARD_TYPES,
  baseFrameFor,
  framesForKind,
  skinVariantsFor,
  importedCardTypeForKind,
  kindFromCard,
  templatePaintsSecondFace,
  templateRefusesKind,
  templateSupportsKind,
} from "@/lib/creator/card-kinds";
import { KIND_REQUIRES, capabilitiesOf } from "@/lib/cards/kind-anatomy";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { cardFieldsFace, frameKindGateError } from "@/lib/cards/frame-kind-gate";
import { blankSecondFaceFor } from "@/lib/creator/card-fields";
import { secondPartWordsFor, secondPartWordsOfCard } from "@/lib/creator/second-part";
import { neverDrawnSecondPartUnits } from "@/lib/creator/second-part-fields";
import { partOutlineRects, secondPartHasOwnArt } from "@/lib/creator/part-outline";
import { panelConfigFor } from "@/lib/creator/steps";
import { remixSecondHalfLayout } from "@/lib/ai/remix-names";
import { SECOND_HALF_RELATIONSHIP } from "@/lib/ai/remix";
import { profileSecondFaceDrawsPowerToughness } from "@/lib/cards/pt-drawn";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.27 — the Prepare kind and its frame through the ONE gates:
//   • the kind wears the `prepare` template alone and the template dresses
//     the kind alone (TREATMENT_KINDS + EXCLUSIVE_KINDS): the adventure frame
//     draws the same page anatomy, but neither takes the other's cards;
//   • the spell is the card's second part — the creator's "Creature |
//     Prepare spell" switch, its fields, its outline — with no picture of
//     its own, and the renderers' never-drawn units are the adventure's;
//   • the AI remix names the spell as the creature's; the AI never DESIGNS
//     one (its design types are one-faced: lib/ai/card-design.ts).
// ---------------------------------------------------------------------------

const EVERY_COMBO = new Set(FRAME_TEMPLATE_VALUES.flatMap((t) => ["w", "u", "b", "r", "g", "m", "c"].map((k) => `${t}/${k}`)));

describe("the Prepare kind", () => {
  it("is a layout kind on its own template, a creature, offered as a chip", () => {
    expect(CARD_KIND_VALUES).toContain("prepare");
    expect(KIND_PICKER_KINDS).toContain("prepare");
    expect(KIND_DEFS.prepare).toMatchObject({ label: "Prepare", cardType: "creature", layoutTemplates: ["prepare"], previewTemplate: "prepare", inlineSecondFace: true });
    expect(kindFromCard("creature", "prepare")).toBe("prepare");
    expect(kindFromCard("instant", "prepare")).toBe("prepare");
    expect(templatePaintsSecondFace("prepare")).toBe(true);
    // Every printed Prepare card is a creature: an import keeps that alone.
    expect(LAYOUT_KIND_CARD_TYPES.prepare).toEqual(["creature"]);
    expect(importedCardTypeForKind("prepare", "creature")).toBe("creature");
    expect(importedCardTypeForKind("prepare", "enchantment")).toBe("creature");
  });

  it("draws the adventure's page anatomy with the P/T plate — and so needs the page", () => {
    expect(KIND_REQUIRES.prepare).toEqual(["adventure"]);
    expect([...capabilitiesOf(getFrameProfile("prepare"))].sort()).toEqual(["adventure", "pt"]);
    expect(profileSecondFaceDrawsPowerToughness(getFrameProfile("prepare"))).toBe(false);
  });

  it("wears the Prepare frame alone, and the frame dresses it alone — the adventure frame neither way", () => {
    for (const kind of CARD_KIND_VALUES) {
      expect(templateRefusesKind("prepare", kind), `prepare/${kind}`).toBe(kind !== "prepare");
      expect(templateSupportsKind("prepare", kind), `prepare/${kind}`).toBe(kind === "prepare");
    }
    // (…and its extended-art dress, TODO 4.27b: the Prepare kind's too.)
    const PREPARE_FRAMES: readonly string[] = ["prepare", "extendedartprepare"];
    for (const template of FRAME_TEMPLATE_VALUES) {
      expect(templateRefusesKind(template, "prepare"), `${template}/prepare`).toBe(!PREPARE_FRAMES.includes(template));
    }
    for (const kind of CARD_KIND_VALUES) {
      expect(templateRefusesKind("extendedartprepare", kind), `extendedartprepare/${kind}`).toBe(kind !== "prepare");
      expect(templateSupportsKind("extendedartprepare", kind), `extendedartprepare/${kind}`).toBe(kind === "prepare");
    }
    expect(templateRefusesKind("adventure", "prepare")).toBe(true);
    expect(templateRefusesKind("prepare", "adventure")).toBe(true);
    // Only the Prepare kind's gallery lists it, published or not.
    for (const kind of CARD_KIND_VALUES) {
      const listed = framesForKind(kind, EVERY_COMBO).map((f) => f.template);
      expect(listed.includes("prepare"), kind).toBe(kind === "prepare");
    }
    // The extended-art dress is the layout template's skin — the Variations
    // section's (TODO 4.27b).
    expect(framesForKind("prepare", EVERY_COMBO).map((f) => [f.template, f.group])).toEqual([
      ["prepare", "layout"],
      ["extendedartprepare", "skin"],
    ]);
    expect(framesForKind("prepare", new Set()).map((f) => f.availableColorKeys)).toEqual([[], []]);
    expect(baseFrameFor("prepare", "extendedartprepare")).toBe("prepare");
    expect(skinVariantsFor("prepare", "prepare")).toEqual(["extendedartprepare"]);
    // A card stored on the dress IS the Prepare kind (the template wins).
    expect(kindFromCard("creature", "extendedartprepare")).toBe("prepare");
  });

  it("the server's kind gate: a Prepare card saves on its frame; the frame refuses a card of another kind", () => {
    const creature = cardFieldsFace({ card_type: "creature", title: "Blazing Firesinger" });
    expect(frameKindGateError("prepare", creature)).toBeNull();
    // A card on the adventure frame is an adventure; the Prepare frame is
    // only ever a Prepare card (the template IS the kind).
    expect(frameKindGateError("adventure", creature)).toBeNull();
  });
});

describe("the spell — the card's second part", () => {
  it("has words of its own: Creature | Prepare spell, a sorcery to start", () => {
    const words = secondPartWordsFor("prepare")!;
    expect([words.first, words.second, words.phrase, words.both]).toEqual(["Creature", "Prepare spell", "the prepare spell", "both parts"]);
    expect(words.namePlaceholder).toBe("Seething Song");
    expect(words.available).toBe(true);
    expect(secondPartWordsOfCard("creature", "prepare").second).toBe("Prepare spell");
    expect(blankSecondFaceFor("prepare").card_type).toBe("sorcery");
    expect(panelConfigFor({ kind: "prepare" } as never).forcedBackFace).toBe(true);
    expect(panelConfigFor({ kind: "prepare" } as never).artSlots).toEqual(["front"]);
  });

  it("has no picture of its own, and never draws a P/T, loyalty, defense, flavour or artist", () => {
    const profile = getFrameProfile("prepare");
    expect(secondPartHasOwnArt(profile)).toBe(false);
    expect([...neverDrawnSecondPartUnits(profile)].sort()).toEqual(["art", "artist", "defense", "flavor", "loyalty", "pt"]);
  });

  it("is outlined on the page, right of the creature's box", () => {
    const rects = partOutlineRects(getFrameProfile("prepare"))!;
    // The creature: the title, type line, its box and the plate; the spell:
    // the page's bars and box on the right.
    expect(rects.back.leftPct).toBeGreaterThan(49);
    expect(rects.back.leftPct + rects.back.widthPct).toBeLessThanOrEqual(99.5);
    expect(rects.back.topPct).toBeGreaterThan(60);
    const adventure = partOutlineRects(getFrameProfile("adventure"))!;
    expect(adventure.back.leftPct).toBeLessThan(10);
  });

  it("the AI remix names it as the creature's own spell", () => {
    expect(remixSecondHalfLayout("prepare")).toBe("prepare");
    expect(SECOND_HALF_RELATIONSHIP.prepare).toMatch(/prepared/);
  });
});
