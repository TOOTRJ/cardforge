import { describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { anatomyDefaults, frameAnatomyOf, normalizeAnatomy } from "@/lib/cards/anatomy";
import {
  DFC_NEEDS_BACK_FACE,
  DFC_SAGA_FRONT_TYPE_REFUSED,
  dfcBackArtMissing,
  dfcFrontTypeError,
  resolveDfcBackFace,
  type DfcBackFacePayload,
} from "@/lib/cards/dfc-gate";
import { bodyFor, dfcBodyOf, frontBodyFor, hasBackOfItsOwn, isDeclaredDfcBody, isOwnKindFront, isSagaFront, templateHasBackFace } from "@/lib/cards/dfc";
import { backPreviewData, bakedBackOf, frontPreviewData } from "@/lib/cards/faces";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { frameKindGateError } from "@/lib/cards/frame-kind-gate";
import { capabilitiesOf, profileDrawsKind } from "@/lib/cards/kind-anatomy";
import { SAGA_DFC_RAIL_FOOT_PX, SAGA_DFC_REVERSE_PT, getFrameProfile } from "@/lib/cards/template-layout";
import { endAlignedStatKeepOut } from "@/lib/cards/stat-fit";
import {
  KIND_DEFS,
  dfcKindFor,
  dfcLayoutForCard,
  dfcLayoutForKind,
  framesForKind,
  kindFromCard,
  sagaTwoFacesAvailable,
  templateRefusesKind,
} from "@/lib/creator/card-kinds";
import { secondPartWordsFor, secondPartWordsOfCard } from "@/lib/creator/second-part";
import { remixSecondHalfLayout } from "@/lib/ai/remix-names";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 5.5 (b), PR 1 — the double-faced saga FRONT (`sagadfcfront`, NEO's
// transforming Sagas) through the ONE gates: a transform front body that is
// the SAGA kind's frame (DfcProfile.saga), never a front of the Transform
// kind; its back is required, on the body the card's icon family derives
// (bodyFor — NEO's fans the 2016–22 back, the arrows the ▼ back), gated as
// every double-faced back is (resolveDfcBackFace). The renderers' half is
// tests/unit/render/saga-dfc-front.test.tsx; the import's
// tests/unit/scryfall/saga-dfc-imports.test.ts.
// ---------------------------------------------------------------------------

const KEYS = ["w", "u", "b", "r", "g", "c", "m"];
const verified = (...templates: string[]) => new Set(templates.flatMap((t) => KEYS.map((k) => frameComboKey(t, k))));
const EVERYTHING = verified("saga", "sagadfcfront", "m15dfcback", "m15dfcbackleft", "m15dfclandback");

const KIKI: DfcBackFacePayload = { title: "Reflection of Kiki-Jiki", card_type: "creature", supertype: "Enchantment", power: "2", toughness: "2", rules_text: "Haste" };

describe("the profile", () => {
  it("declares a transform FRONT body of the Saga kind: the icon family, the crown switch for its back, the saga's rail", () => {
    expect(dfcBodyOf("sagadfcfront")).toEqual({ layout: "transform", role: "front", well: "left", saga: true });
    expect(templateHasBackFace("sagadfcfront")).toBe(true);
    expect(isSagaFront("sagadfcfront")).toBe(true);
    expect(isOwnKindFront("sagadfcfront")).toBe(true);
    expect(isOwnKindFront("battle")).toBe(true);
    expect(isOwnKindFront("m15dfcfront")).toBe(false);
    expect(isDeclaredDfcBody("sagadfcfront")).toBe(true);
    for (const t of FRAME_TEMPLATE_VALUES) if (t !== "sagadfcfront") expect(isSagaFront(t), t).toBe(false);
    const anatomy = frameAnatomyOf("sagadfcfront");
    expect(anatomy).toMatchObject({ dfcIcon: true, crown: true, twoColor: [], stamp: false, collector: false });
    expect(anatomyDefaults("sagadfcfront")).toEqual({ crown: true, dfcIcon: "arrows" });
    expect(normalizeAnatomy({ template: "sagadfcfront", dfcIcon: "fan", twoColor: true }, "sagadfcfront", "enchantment")).toEqual({ template: "sagadfcfront", dfcIcon: "fan" });
    // The saga's capabilities, not the Transform kind's.
    expect([...capabilitiesOf(getFrameProfile("sagadfcfront"))]).toEqual(["chapters"]);
    expect(profileDrawsKind(getFrameProfile("sagadfcfront"), "saga")).toBe(true);
    expect(profileDrawsKind(getFrameProfile("sagadfcfront"), "transform")).toBe(false);
    expect(kindFromCard("enchantment", "sagadfcfront")).toBe("saga");
    expect(dfcKindFor("sagadfcfront")).toBeNull();
  });

  it("the saga's geometry, but the rail ends at the tab's top and the name starts past the well", () => {
    const saga = getFrameProfile("saga");
    const front = getFrameProfile("sagadfcfront");
    expect(front.artSlot).toEqual(saga.artSlot);
    expect(front.type).toEqual(saga.type);
    expect(front.symbolRect).toEqual(saga.symbolRect);
    expect(front.chapters!.rect.topPct).toBe(saga.chapters!.rect.topPct);
    expect((front.chapters!.rect.topPct + front.chapters!.rect.heightPct) * 21).toBeCloseTo(SAGA_DFC_RAIL_FOOT_PX, 6);
    expect(SAGA_DFC_RAIL_FOOT_PX).toBeLessThanOrEqual(SAGA_DFC_REVERSE_PT.rect.topPct * 21);
    expect(front.title.rect.leftPct).toBe(getFrameProfile("m15dfcfront").title.rect.leftPct);
    expect(front.reversePt).toBe(SAGA_DFC_REVERSE_PT);
    // The digits sit LEFT of the chapters' column and under the rail's foot:
    // no chapter line ever shares a row with them, so the rail needs no float.
    const keepOut = endAlignedStatKeepOut(SAGA_DFC_REVERSE_PT, "2/2");
    expect(keepOut.leftPct).toBe(SAGA_DFC_REVERSE_PT.rect.leftPct);
    expect(keepOut.topPct * 21).toBeGreaterThanOrEqual(SAGA_DFC_RAIL_FOOT_PX);
  });

  it("is never a front the Transform kind derives, and never answers bodyFor", () => {
    for (const layout of ["transform", "modal"] as const) {
      for (const type of ["creature", "land", "enchantment"]) {
        for (const role of ["front", "back"] as const) expect(bodyFor(layout, role, type)).not.toBe("sagadfcfront");
      }
    }
    for (const back of ["m15dfcback", "m15dfcbackleft", "m15dfclandback"]) {
      expect(frontBodyFor(back, "enchantment")).not.toBe("sagadfcfront");
    }
  });
});

describe("the kinds", () => {
  it("is the Saga kind's second frame — the kind's default stays the one-faced saga", () => {
    expect(KIND_DEFS.saga.layoutTemplates).toEqual(["saga", "sagadfcfront"]);
    expect(KIND_DEFS.saga.inlineSecondFace).toBe(false);
    expect(framesForKind("saga", EVERYTHING).map((f) => f.template)).toEqual(["saga", "sagadfcfront"]);
    expect(templateRefusesKind("sagadfcfront", "saga")).toBe(false);
    expect(frameKindGateError("sagadfcfront", { cardType: "enchantment" } as never)).toBeNull();
    // (A crafted creature on it is the Saga kind by its template — the type
    // is refused by dfcFrontTypeError, below, as on every front body.)
  });

  it("dfcLayoutForCard: a saga on its double-faced front is a transform; on the saga none; the DFC kinds their own", () => {
    expect(dfcLayoutForKind("saga")).toBeNull();
    expect(dfcLayoutForCard("saga", "sagadfcfront")).toBe("transform");
    expect(dfcLayoutForCard("saga", "saga")).toBeNull();
    expect(dfcLayoutForCard("transform", "m15dfcfront")).toBe("transform");
    expect(dfcLayoutForCard("mdfc", "m15mdfcfront")).toBe("modal");
    expect(dfcLayoutForCard("creature", "sagadfcfront")).toBeNull();
  });

  it("Two faces is offered once the front AND the default back are published in some colour", () => {
    expect(sagaTwoFacesAvailable(new Set())).toBe(false);
    expect(sagaTwoFacesAvailable(verified("sagadfcfront"))).toBe(false);
    expect(sagaTwoFacesAvailable(verified("m15dfcback"))).toBe(false);
    expect(sagaTwoFacesAvailable(new Set([frameComboKey("sagadfcfront", "r"), frameComboKey("m15dfcback", "u")]))).toBe(true);
  });

  it("the words: the switch reads Saga | Back face; a one-faced saga has none", () => {
    expect(secondPartWordsFor("saga")).toMatchObject({ first: "Saga", second: "Back face", blankCardType: "creature", available: true });
    expect(secondPartWordsOfCard("enchantment", "sagadfcfront").second).toBe("Back face");
  });
});

describe("the back's gate (resolveDfcBackFace)", () => {
  const gate = (over: Partial<Parameters<typeof resolveDfcBackFace>[0]> = {}) =>
    resolveDfcBackFace({ frontTemplate: "sagadfcfront", back: KIKI, family: "fan", frontColorIdentity: ["red"], verifiedKeys: EVERYTHING, ...over });

  it("a create: the back on the body its family derives, in its colour, with no cost", () => {
    expect(gate()).toEqual({ ok: true, layout: "transform", back: { ...KIKI, frame_style: { template: "m15dfcbackleft" }, color_identity: ["red"] } });
    expect(gate({ family: "arrows" })).toMatchObject({ ok: true, back: { frame_style: { template: "m15dfcback" } } });
    expect(gate({ family: null })).toMatchObject({ ok: true, back: { frame_style: { template: "m15dfcback" } } });
    expect(gate({ back: { ...KIKI, cost: "{1}{R}" } })).toMatchObject({ ok: true, back: { frame_style: { template: "m15dfcbackleft" } } });
    expect((gate({ back: { ...KIKI, cost: "{1}{R}" } }) as { back: Record<string, unknown> }).back).not.toHaveProperty("cost");
  });

  it("the back is required (the master paints the well), and verified in its colour", () => {
    expect(gate({ back: null })).toEqual({ ok: false, field: "back_face.frame_style", message: DFC_NEEDS_BACK_FACE });
    expect(gate({ verifiedKeys: verified("sagadfcfront") })).toMatchObject({ ok: false, field: "back_face.color_identity", code: "unverified" });
    expect(dfcBackArtMissing("sagadfcfront", KIKI)).toBe(true);
    expect(dfcBackArtMissing("sagadfcfront", { ...KIKI, art_url: "https://example.supabase.co/x.png" })).toBe(false);
  });

  it("the front is a saga — an enchantment — and nothing else", () => {
    expect(dfcFrontTypeError("sagadfcfront", "enchantment")).toBeNull();
    for (const type of ["creature", "land", "instant", "battle", "planeswalker"]) {
      expect(dfcFrontTypeError("sagadfcfront", type), type).toBe(DFC_SAGA_FRONT_TYPE_REFUSED);
    }
  });

  it("an edit: the stored body and colour win, as on every double-faced card", () => {
    const stored = { back: { ...KIKI, frame_style: { template: "m15dfcbackleft" }, color_identity: ["red" as const] }, familyChanged: false };
    expect(gate({ stored, back: { ...KIKI, title: "Renamed" } })).toMatchObject({ ok: true, back: { title: "Renamed", frame_style: { template: "m15dfcbackleft" } } });
    expect(gate({ stored, back: { ...KIKI, color_identity: ["blue"] } })).toMatchObject({ ok: false, field: "back_face.color_identity" });
  });
});

describe("the faces", () => {
  const card = (back: Record<string, unknown> | null = { ...KIKI, frame_style: { template: "m15dfcbackleft" }, color_identity: ["red"] }) =>
    ({
      title: "Fable of the Mirror-Breaker",
      cost: "{2}{R}",
      cardType: "enchantment",
      supertype: null,
      subtypes: ["Saga"],
      colorIdentity: ["red"],
      rulesText: null,
      power: null,
      toughness: null,
      frameStyle: { template: "sagadfcfront", dfcIcon: "fan" },
      backFace: back,
    }) as unknown as CardPreviewData;

  it("the front carries the back's P/T for the tab and the closed fan; the back draws on its body with the open fan", () => {
    expect(frontPreviewData(card()).dfc).toMatchObject({ layout: "transform", role: "front", icon: "fan", otherFace: { printsPt: true, power: "2", toughness: "2" } });
    const back = backPreviewData(card())!;
    expect(back.frameStyle?.template).toBe("m15dfcbackleft");
    expect(back.dfc).toMatchObject({ role: "back", icon: "fan" });
    expect(hasBackOfItsOwn("sagadfcfront", { frame_style: { template: "m15dfcbackleft" } })).toBe(true);
  });

  it("a stored row on the front bakes its back (two PNGs)", () => {
    expect(bakedBackOf(card())?.frameStyle?.template).toBe("m15dfcbackleft");
    expect(bakedBackOf(card({ ...KIKI }))).toBeNull();
  });

  it("the remix names and paints its back as a transform back", () => {
    expect(remixSecondHalfLayout("sagadfcfront" as FrameTemplate)).toBe("transform");
    expect(remixSecondHalfLayout("saga")).toBeNull();
  });
});
