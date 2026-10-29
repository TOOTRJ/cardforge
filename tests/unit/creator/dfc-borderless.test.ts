import { describe, expect, it } from "vitest";
import { bodyFor, colorlessFaceAllowed, dfcLookOf, frontBodyFor, isDfcBackBody, templateHasBackFace } from "@/lib/cards/dfc";
import { DFC_BACK_BODY_MISMATCH, DFC_LOOK_MISMATCH, DFC_NO_BACK_BODY_YET, resolveDfcBackFace } from "@/lib/cards/dfc-gate";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import {
  DFC_BORDERLESS_ICON_RIDER,
  DFC_BORDERLESS_REVERSE_PT,
  DFC_ICON_FACE_TITLE_LEFT_PCT,
  DFC_ICON_RIDER,
  DFC_REVERSE_PT,
  DFC_RIGHT_WELL_TITLE_RIGHT_PCT,
  MDFC_FLIPSIDE_BACK,
  MDFC_FLIPSIDE_FRONT,
  getFrameProfile,
} from "@/lib/cards/template-layout";
import { anatomyDefaults } from "@/lib/cards/anatomy";
import {
  CARD_KIND_VALUES,
  KIND_DEFS,
  dfcFrontBodyFor,
  kindFromCard,
  kindHasAvailableFrame,
  templateRefusesKind,
  templateSupportsKind,
} from "@/lib/creator/card-kinds";
import { DFC_ICON_FAMILY_VALUES } from "@/lib/cards/dfc";
import { FRAME_TEMPLATE_LABELS } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 5.7 — the dark borderless double-faced bodies in the creator and the
// server's gates: what each profile declares, the look a back follows, the
// faces and families that have no borderless body yet, the kinds.
// ---------------------------------------------------------------------------

const FRONTS = ["m15borderlessdfcfront", "m15borderlessmdfcfront"] as const;
const BACKS = ["m15borderlessdfcback", "m15borderlessmdfcback"] as const;
const BORDERLESS = getFrameProfile("m15borderless");
const KEYS = ["w", "u", "b", "r", "g", "c", "m"];
const every = (templates: readonly string[]) => new Set(templates.flatMap((t) => KEYS.map((k) => frameComboKey(t as never, k))));

describe("the profiles", () => {
  it("are m15borderless's geometry and ink with the double-faced slots of their bordered twins", () => {
    for (const t of [...FRONTS, ...BACKS]) {
      const p = getFrameProfile(t);
      expect(p.dfc?.look, t).toBe("borderless");
      expect(p.artSlot, t).toEqual(BORDERLESS.artSlot);
      expect(p.rules, t).toEqual(BORDERLESS.rules);
      expect(p.type, t).toEqual(BORDERLESS.type);
      expect(p.pt?.plateAssetPathTemplate, t).toBe("/frames/m15borderless/pt/{color}.png");
      expect(p.title.colorHex, t).toBe("#ffffff");
      expect(p.crownMasters, t).toBe(true);
      expect(p.twoColorMasters, t).toEqual(["split"]);
      expect(p.artifactMasterKeys, t).toEqual({ c: "a" });
      expect(p.overlays?.some((o) => o.anatomy === "holoStamp") ?? false, t).toBe(false);
      expect(p.collector, t).toBeUndefined();
      expect(FRAME_TEMPLATE_LABELS[t], t).toMatch(/^Borderless (transform|modal) (front|back)$/);
    }
    const front = getFrameProfile("m15borderlessdfcfront");
    expect(front.dfc).toEqual({ layout: "transform", role: "front", well: "left", look: "borderless" });
    expect(front.title.rect.leftPct).toBe(DFC_ICON_FACE_TITLE_LEFT_PCT);
    expect(front.overlays).toEqual([DFC_BORDERLESS_ICON_RIDER]);
    expect(front.reversePt).toBe(DFC_BORDERLESS_REVERSE_PT);
    const back = getFrameProfile("m15borderlessdfcback");
    expect(back.dfc).toEqual({ layout: "transform", role: "back", well: "right", look: "borderless" });
    expect(back.hideCost).toBe(true);
    expect(back.indicator).toBe("coloured");
    expect(back.title.rect.leftPct + back.title.rect.widthPct).toBeCloseTo(DFC_RIGHT_WELL_TITLE_RIGHT_PCT, 9);
    expect(back.overlays).toBeUndefined();
    expect(back.reversePt).toBeUndefined();
    expect(getFrameProfile("m15borderlessmdfcfront").flipside).toBe(MDFC_FLIPSIDE_FRONT);
    expect(getFrameProfile("m15borderlessmdfcback").flipside).toBe(MDFC_FLIPSIDE_BACK);
    expect(getFrameProfile("m15borderlessmdfcback").hideCost).toBeUndefined();
  });

  it("the rider and the reverse P/T sit where print puts them: the well 6 px right at × 0.95, the digits ending at 1378 px, 3 px higher", () => {
    const centre = (r: { leftPct: number; widthPct: number; topPct: number; heightPct: number }) => [
      ((r.leftPct + r.widthPct / 2) / 100) * 1500,
      ((r.topPct + r.heightPct / 2) / 100) * 2100,
    ];
    const [bx, by] = centre(DFC_ICON_RIDER.rect);
    const [x, y] = centre(DFC_BORDERLESS_ICON_RIDER.rect);
    expect(x - bx).toBeCloseTo(6, 6);
    expect(y - by).toBeCloseTo(0, 6);
    expect(DFC_BORDERLESS_ICON_RIDER.rect.widthPct / DFC_ICON_RIDER.rect.widthPct).toBeCloseTo(0.95, 9);
    expect(DFC_BORDERLESS_ICON_RIDER.keys).toEqual(DFC_ICON_RIDER.keys);
    expect(((DFC_BORDERLESS_REVERSE_PT.rect.leftPct + DFC_BORDERLESS_REVERSE_PT.rect.widthPct) / 100) * 1500).toBeCloseTo(1383.45, 1);
    expect(((DFC_REVERSE_PT.rect.topPct - DFC_BORDERLESS_REVERSE_PT.rect.topPct) / 100) * 2100).toBeCloseTo(3, 6);
    expect(DFC_BORDERLESS_REVERSE_PT.colorHex).toBe("#828282");
    expect(DFC_BORDERLESS_REVERSE_PT.align).toBe("end");
  });

  it("a new card on a front starts with the crown, the pair and (transform) the arrows on", () => {
    expect(anatomyDefaults("m15borderlessdfcfront")).toMatchObject({ crown: true, twoColor: true, dfcIcon: "arrows" });
    expect(anatomyDefaults("m15borderlessmdfcfront")).toMatchObject({ crown: true, twoColor: true });
    expect(anatomyDefaults("m15borderlessmdfcfront")).not.toHaveProperty("dfcIcon");
  });
});

describe("the look a back follows", () => {
  it("a borderless front's back is borderless; a land face and the 2016–22 families have none yet", () => {
    for (const t of FRONTS) {
      expect(templateHasBackFace(t), t).toBe(true);
      expect(dfcLookOf(t), t).toBe("borderless");
    }
    for (const t of BACKS) {
      expect(isDfcBackBody(t), t).toBe(true);
      expect(frontBodyFor(t), t).toBe(t.replace("back", "front"));
    }
    expect(bodyFor("transform", "back", "creature", "arrows", "borderless")).toBe("m15borderlessdfcback");
    for (const family of DFC_ICON_FAMILY_VALUES.filter((f) => f !== "arrows")) {
      expect(bodyFor("transform", "back", "creature", family, "borderless"), family).toBeNull();
    }
    expect(bodyFor("transform", "back", "land", "arrows", "borderless")).toBeNull();
    expect(bodyFor("modal", "back", "land", "arrows", "borderless")).toBeNull();
    // The artifact stand-in: colourless only with the Artifact word (D2).
    expect(colorlessFaceAllowed("m15borderlessdfcback", { cardType: "creature" }, new Set<string>())).toBe(false);
    expect(colorlessFaceAllowed("m15borderlessdfcback", { cardType: "artifact" }, new Set<string>())).toBe(true);
  });

  it("the server's gate derives the borderless back, refuses a bordered one by name, and a face with no body", () => {
    const base = {
      frontTemplate: "m15borderlessdfcfront",
      family: "arrows",
      frontColorIdentity: ["red"] as const,
      verifiedKeys: every(["m15borderlessdfcback"]),
    };
    const back = { title: "Ashling, Rimebound", card_type: "creature", color_identity: ["blue"] } as const;
    const ok = resolveDfcBackFace({ ...base, back });
    expect(ok.ok && ok.back?.frame_style?.template).toBe("m15borderlessdfcback");
    expect(resolveDfcBackFace({ ...base, back: { ...back, frame_style: { template: "m15dfcback" } } })).toMatchObject({
      ok: false,
      field: "back_face.frame_style",
      message: DFC_BACK_BODY_MISMATCH,
    });
    expect(resolveDfcBackFace({ ...base, back: { ...back, card_type: "land" } })).toMatchObject({ ok: false, message: DFC_NO_BACK_BODY_YET });
    expect(resolveDfcBackFace({ ...base, family: "sunmoon", back })).toMatchObject({ ok: false, message: DFC_NO_BACK_BODY_YET });
    // Unverified in the back's colour: refused like any body.
    expect(resolveDfcBackFace({ ...base, verifiedKeys: new Set(), back })).toMatchObject({ ok: false, code: "unverified" });
    // The modal front's back keeps its cost.
    const modal = resolveDfcBackFace({
      ...base,
      frontTemplate: "m15borderlessmdfcfront",
      back: { title: "Black Panther", card_type: "creature", cost: "{4}{W}{U}", color_identity: ["white", "blue"] },
      verifiedKeys: every(["m15borderlessmdfcback"]),
    });
    expect(modal.ok && modal.back?.frame_style?.template).toBe("m15borderlessmdfcback");
    expect(modal.ok && (modal.back as { cost?: string }).cost).toBe("{4}{W}{U}");
  });
});

describe("a mixed look is refused (the #578 check)", () => {
  const back = { title: "Ashling, Rimebound", card_type: "creature", color_identity: ["blue"] } as const;
  const verifiedKeys = every(["m15dfcback", "m15borderlessdfcback", "m15mdfcback", "m15borderlessmdfcback"]);
  it("an edit that moves a stored DFC's front onto the other look while its back keeps its body", () => {
    for (const [front, storedBody] of [
      ["m15borderlessdfcfront", "m15dfcback"],
      ["m15dfcfront", "m15borderlessdfcback"],
      ["m15borderlessmdfcfront", "m15mdfcback"],
      ["m15mdfcfront", "m15borderlessmdfcback"],
    ] as const) {
      const stored = { back: { ...back, frame_style: { template: storedBody } }, familyChanged: false };
      expect(
        resolveDfcBackFace({ frontTemplate: front, back: stored.back, family: "arrows", frontColorIdentity: ["red"], verifiedKeys, stored }),
        `${front} over ${storedBody}`,
      ).toMatchObject({ ok: false, field: "back_face.frame_style", message: DFC_LOOK_MISMATCH });
    }
  });
  it("the same look keeps its stored body; a create derives the front's look", () => {
    const stored = { back: { ...back, frame_style: { template: "m15borderlessdfcback" } }, familyChanged: false };
    const same = resolveDfcBackFace({ frontTemplate: "m15borderlessdfcfront", back: stored.back, family: "arrows", frontColorIdentity: ["red"], verifiedKeys, stored });
    expect(same.ok && same.back?.frame_style?.template).toBe("m15borderlessdfcback");
    const create = resolveDfcBackFace({ frontTemplate: "m15dfcfront", back, family: "arrows", frontColorIdentity: ["red"], verifiedKeys });
    expect(create.ok && create.back?.frame_style?.template).toBe("m15dfcback");
  });
});

describe("the kinds", () => {
  it("a front is a third body of its double-faced kind, never its default; a back refuses every kind", () => {
    expect(KIND_DEFS.transform.layoutTemplates?.[0]).toBe("m15dfcfront");
    expect(KIND_DEFS.transform.layoutTemplates).toContain("m15borderlessdfcfront");
    expect(KIND_DEFS.mdfc.layoutTemplates?.[0]).toBe("m15mdfcfront");
    expect(KIND_DEFS.mdfc.layoutTemplates).toContain("m15borderlessmdfcfront");
    expect(kindFromCard("creature", "m15borderlessdfcfront")).toBe("transform");
    expect(kindFromCard("instant", "m15borderlessmdfcfront")).toBe("mdfc");
    for (const kind of CARD_KIND_VALUES) {
      for (const t of BACKS) {
        expect(templateSupportsKind(t, kind), `${t}/${kind}`).toBe(false);
        expect(templateRefusesKind(t, kind), `${t}/${kind}`).not.toBeNull();
      }
    }
    // The face-type row keeps the look: a spell type stays borderless, a
    // land has no borderless front (its chip is off).
    expect(dfcFrontBodyFor("transform", "creature", "borderless")).toBe("m15borderlessdfcfront");
    expect(dfcFrontBodyFor("transform", "land", "borderless")).toBeNull();
    expect(dfcFrontBodyFor("mdfc", "sorcery", "borderless")).toBe("m15borderlessmdfcfront");
    expect(dfcFrontBodyFor("transform", "creature")).toBe("m15dfcfront");
  });

  it("verifying the borderless bodies alone never lights a kind chip (the kind's default back is the bordered one)", () => {
    const borderlessOnly = every([...FRONTS, ...BACKS]);
    expect(kindHasAvailableFrame("transform", borderlessOnly)).toBe(false);
    expect(kindHasAvailableFrame("mdfc", borderlessOnly)).toBe(false);
  });
});
