import { describe, expect, it } from "vitest";
import {
  CARD_KIND_VALUES,
  KIND_DEFS,
  KIND_PICKER_KINDS,
  LAYOUT_KIND_CARD_TYPES,
  dfcFrontDressesKind,
  dfcKindFor,
  framesForKind,
  importedCardTypeForKind,
  kindFromCard,
  kindHasAvailableFrame,
  templateRefusesKind,
  templateSupportsKind,
} from "@/lib/creator/card-kinds";
import { cardFieldsFace, frameKindGateError, frameKindUpdateGateError } from "@/lib/cards/frame-kind-gate";
import { KIND_REQUIRES, capabilitiesOf, profileDrawsKind } from "@/lib/cards/kind-anatomy";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { walkthroughKindFor } from "@/lib/creator/frame-preview";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 5.1a — the Transform kind and the kind gate on the transform bodies:
// the kind is a layout kind over the two FRONT bodies (the land front for a
// land), needs a double-faced front (`dfcFront`, read from the profile's
// `dfc`), draws the six card types a 2015-frame transform printed; a BACK
// body is never a card's own template — it refuses every kind, the server's
// gate included; the kind's chip is dark until a colour is verified on a
// front body AND on the default back body (the chip itself joined the kind
// picker with its editor, TODO 5.2).
// ---------------------------------------------------------------------------

const EVERY_COMBO: ReadonlySet<string> = new Set(
  FRAME_TEMPLATE_VALUES.flatMap((t) => ["w", "u", "b", "r", "g", "c", "m"].map((k) => frameComboKey(t, k))),
);
const FRONTS = ["m15dfcfront", "m15dfclandfront"] as const;
const BACKS = ["m15dfcback", "m15dfcbackleft", "m15dfclandback"] as const;

describe("the Transform kind (TODO 5.1a)", () => {
  it("is a layout kind over the two front bodies, needing a double-faced front, drawing the six transform card types", () => {
    expect(CARD_KIND_VALUES).toContain("transform");
    expect(KIND_DEFS.transform).toMatchObject({ label: "Transform", cardType: "creature", layoutTemplates: ["m15dfcfront", "m15dfclandfront"], previewTemplate: "m15dfcfront", inlineSecondFace: false });
    expect(KIND_REQUIRES.transform).toEqual(["dfcFront"]);
    expect(LAYOUT_KIND_CARD_TYPES.transform).toEqual(["creature", "artifact", "enchantment", "land", "instant", "sorcery"]);
    for (const front of FRONTS) {
      expect(capabilitiesOf(getFrameProfile(front)), front).toContain("dfcFront");
      expect(profileDrawsKind(getFrameProfile(front), "transform"), front).toBe(true);
    }
    for (const back of BACKS) {
      expect(capabilitiesOf(getFrameProfile(back)), back).not.toContain("dfcFront");
      expect(profileDrawsKind(getFrameProfile(back), "transform"), back).toBe(false);
    }
    // No other template is a double-faced front.
    for (const t of FRAME_TEMPLATE_VALUES) {
      if ((FRONTS as readonly string[]).includes(t)) continue;
      expect(capabilitiesOf(getFrameProfile(t)), t).not.toContain("dfcFront");
    }
    // A card on a front body IS the transform kind, whatever its type.
    expect(kindFromCard("creature", "m15dfcfront")).toBe("transform");
    expect(kindFromCard("land", "m15dfclandfront")).toBe("transform");
    expect(kindFromCard("enchantment", "m15dfcfront")).toBe("transform");
    // An import keeps the printed type the front draws, else the kind's own.
    expect(importedCardTypeForKind("transform", "enchantment")).toBe("enchantment");
    expect(importedCardTypeForKind("transform", "land")).toBe("land");
    expect(importedCardTypeForKind("transform", "planeswalker")).toBe("creature");
    expect(importedCardTypeForKind("transform", "token")).toBe("creature");
  });

  it("its gallery is exactly the two front bodies; no other kind lists a DFC body", () => {
    expect(framesForKind("transform", EVERY_COMBO).map((f) => [f.template, f.group])).toEqual([
      ["m15dfcfront", "layout"],
      ["m15dfclandfront", "layout"],
    ]);
    for (const kind of CARD_KIND_VALUES) {
      if (kind === "transform") continue;
      for (const t of [...FRONTS, ...BACKS]) expect(templateSupportsKind(t, kind), `${t}/${kind}`).toBe(false);
    }
    for (const t of FRONTS) expect(templateSupportsKind(t, "transform"), t).toBe(true);
    for (const t of BACKS) expect(templateSupportsKind(t, "transform"), t).toBe(false);
  });

  it("a BACK body refuses every kind — the server's gate too; a front body refuses the exclusive emblem only, as every layout frame", () => {
    for (const back of BACKS) {
      for (const kind of CARD_KIND_VALUES) expect(templateRefusesKind(back, kind), `${back}/${kind}`).toBe(true);
      // (A back body is in no kind's TEMPLATE_KIND, so the gate names the
      // card's own type.)
      expect(frameKindGateError(back, cardFieldsFace({ card_type: "creature", title: "Insectile Aberration" })), back).toMatch(/doesn't dress Creature cards/);
      expect(frameKindGateError(back, cardFieldsFace({ card_type: "land", title: "Cooking Campsite" })), back).not.toBeNull();
    }
    for (const front of FRONTS) {
      for (const kind of CARD_KIND_VALUES) expect(templateRefusesKind(front, kind), `${front}/${kind}`).toBe(kind === "emblem");
      expect(frameKindGateError(front, cardFieldsFace({ card_type: "creature", title: "Delver of Secrets" })), front).toBeNull();
    }
    // A patch that moves a stored card onto a back body is refused; one
    // that keeps the card on a front body passes.
    const creature = cardFieldsFace({ card_type: "creature", title: "Delver of Secrets" });
    expect(frameKindUpdateGateError({ existingTemplate: "m15", nextTemplate: "m15dfcback", existing: creature, next: creature })).not.toBeNull();
    expect(frameKindUpdateGateError({ existingTemplate: "m15dfcfront", nextTemplate: undefined, existing: creature, next: creature })).toBeNull();
  });

  it("the chip lights only with a colour verified on a FRONT body AND on the DEFAULT back body (bodyFor's arrows row)", () => {
    const front = frameComboKey("m15dfcfront", "u");
    const back = frameComboKey("m15dfcback", "u");
    expect(kindHasAvailableFrame("transform", new Set())).toBe(false);
    expect(kindHasAvailableFrame("transform", new Set([front]))).toBe(false);
    expect(kindHasAvailableFrame("transform", new Set([back]))).toBe(false);
    // The 2016–22 back alone is not the default back.
    expect(kindHasAvailableFrame("transform", new Set([front, frameComboKey("m15dfcbackleft", "u")]))).toBe(false);
    expect(kindHasAvailableFrame("transform", new Set([front, back]))).toBe(true);
    // Any colour of each will do (the front and back needn't share one yet).
    expect(kindHasAvailableFrame("transform", new Set([frameComboKey("m15dfclandfront", "c"), frameComboKey("m15dfcback", "g")]))).toBe(true);
    // Every other kind is unchanged by the rule.
    expect(kindHasAvailableFrame("creature", new Set([frameComboKey("m15", "w")]))).toBe(true);
    expect(kindHasAvailableFrame("creature", new Set())).toBe(false);
    // A chip of the kind picker since its editor (TODO 5.2) — dark until
    // both bodies are verified (the rule above).
    expect(KIND_PICKER_KINDS).toContain("transform");
  });

  it("dfcFrontDressesKind / dfcKindFor: the front bodies dress the transform's types (the land front a land only); the back bodies belong to the Transform kind for the walkthrough", () => {
    for (const kind of ["creature", "artifact", "enchantment", "instant", "sorcery"] as const) {
      expect(dfcFrontDressesKind("m15dfcfront", kind), kind).toBe(true);
      expect(dfcFrontDressesKind("m15dfclandfront", kind), kind).toBe(false);
    }
    expect(dfcFrontDressesKind("m15dfcfront", "land")).toBe(false);
    expect(dfcFrontDressesKind("m15dfclandfront", "land")).toBe(true);
    for (const kind of ["planeswalker", "battle", "token", "emblem", "saga", "adventure", "split", "aftermath", "flip", "transform"] as const) {
      expect(dfcFrontDressesKind("m15dfcfront", kind), kind).toBe(false);
    }
    for (const t of BACKS) for (const kind of CARD_KIND_VALUES) expect(dfcFrontDressesKind(t, kind), `${t}/${kind}`).toBe(false);
    expect(dfcFrontDressesKind("m15", "creature")).toBe(false);
    for (const t of [...FRONTS, ...BACKS]) expect(dfcKindFor(t), t).toBe("transform");
    expect(dfcKindFor("m15")).toBeNull();
    for (const t of BACKS) expect(walkthroughKindFor(t), t).toBe("transform");
  });
});
