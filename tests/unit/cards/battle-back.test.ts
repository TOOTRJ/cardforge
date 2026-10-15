import { describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { anatomyDefaults, frameAnatomyOf, normalizeAnatomy } from "@/lib/cards/anatomy";
import { cardPageFacesOf, cardPageName } from "@/lib/cards/emblem";
import {
  DFC_BACK_BODY_MISMATCH,
  DFC_BACK_COLOR_SET,
  DFC_BATTLE_FRONT_TYPE_REFUSED,
  dfcBackArtMissing,
  dfcFrontTypeError,
  resolveDfcBackFace,
  type DfcBackFacePayload,
} from "@/lib/cards/dfc-gate";
import { bodyFor, dfcBodyOf, frontBodyFor, hasBackOfItsOwn, isBattleFront, templateHasBackFace } from "@/lib/cards/dfc";
import { backBodyOf, backPreviewData, bakedBackOf, exportFacesOf, flippableBackOf, frontPreviewData, rowHasBakedBack } from "@/lib/cards/faces";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { capabilitiesOf, profileDrawsKind } from "@/lib/cards/kind-anatomy";
import { BATTLE_REVERSE_PT, DFC_REVERSE_PT, getFrameProfile } from "@/lib/cards/template-layout";
import { battleBackBodyFor, battleBackUnavailableNote } from "@/lib/creator/battle-back";
import { dfcKindFor, kindFromCard } from "@/lib/creator/card-kinds";
import { sideBySideSize } from "@/lib/render/faces-side-by-side";
import { FRAME_TEMPLATE_VALUES, type ColorIdentity } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 5.5 (a) — the battle's back face, through the ONE gates: the battle
// frame is a transform FRONT body whose back is OPTIONAL (DfcProfile.battle).
// A battle with no back, or a LEGACY back (its content, no body — every
// battle import before 5.5), stays what it is; a back that names a body is
// the ▼ back `bodyFor` derives, gated like any double-faced back.
// ---------------------------------------------------------------------------

const KEYS = ["w", "u", "b", "r", "g", "c", "m"];
const verified = (...templates: string[]) => new Set(templates.flatMap((t) => KEYS.map((k) => frameComboKey(t, k))));
const EVERYTHING = verified("battle", "m15dfcback", "m15dfclandback");

const SERRA: DfcBackFacePayload = { title: "Serra Faithkeeper", card_type: "creature", power: "4", toughness: "4", rules_text: "Flying, vigilance" };
const ANTHEM: DfcBackFacePayload = { title: "Belenon War Anthem", card_type: "enchantment", rules_text: "Creatures you control get +1/+1." };

describe("the profile", () => {
  it("the battle declares a transform FRONT body, optional back, no icon family, and draws the reverse P/T", () => {
    expect(dfcBodyOf("battle")).toEqual({ layout: "transform", role: "front", well: "left", battle: true });
    expect(templateHasBackFace("battle")).toBe(true);
    expect(isBattleFront("battle")).toBe(true);
    for (const t of FRAME_TEMPLATE_VALUES) if (t !== "battle") expect(isBattleFront(t), t).toBe(false);
    const anatomy = frameAnatomyOf("battle");
    expect(anatomy.dfcIcon).toBe(false);
    // The crown switch is the card's: its ▼ back draws it.
    expect(anatomy.crown).toBe(true);
    expect(anatomyDefaults("battle")).toEqual({ crown: true });
    expect(normalizeAnatomy({ template: "battle", dfcIcon: "sunmoon", twoColor: true }, "battle", "battle")).toEqual({ template: "battle" });
    // Not a front of the Transform kind (the kind gate's capabilities).
    expect(capabilitiesOf(getFrameProfile("battle")).has("dfcFront")).toBe(false);
    expect(profileDrawsKind(getFrameProfile("battle"), "transform")).toBe(false);
    expect(profileDrawsKind(getFrameProfile("battle"), "battle")).toBe(true);
    expect(kindFromCard("battle", "battle")).toBe("battle");
    expect(dfcKindFor("battle")).toBeNull();
    // The admin tools pair the ▼ back with the transform front, never the battle.
    expect(frontBodyFor("m15dfcback", "creature")).toBe("m15dfcfront");
    // The tab: the transform front's ink and size, at the battle's own place.
    expect(getFrameProfile("battle").reversePt).toBe(BATTLE_REVERSE_PT);
    expect(BATTLE_REVERSE_PT).toMatchObject({ colorHex: DFC_REVERSE_PT.colorHex, weight: DFC_REVERSE_PT.weight, align: "end", sizePct: 61 / 2100 });
  });
});

describe("the gate (resolveDfcBackFace, dfcFrontTypeError, dfcBackArtMissing)", () => {
  const gate = (back: DfcBackFacePayload | null, over: Partial<Parameters<typeof resolveDfcBackFace>[0]> = {}) =>
    resolveDfcBackFace({ frontTemplate: "battle", back, family: undefined, frontColorIdentity: ["white"], verifiedKeys: EVERYTHING, ...over });

  it("a battle with no back saves as one face", () => {
    expect(gate(null)).toEqual({ ok: true, back: null, layout: "transform" });
  });

  it("a back that names no body (and none stored) is a LEGACY back: kept as sent, its colour never stored — whatever is verified", () => {
    const legacy = gate({ ...ANTHEM, color_identity: ["blue"] }, { verifiedKeys: new Set() });
    expect(legacy).toEqual({ ok: true, back: ANTHEM, layout: null });
  });

  it("a back that names its body is the ▼ back of its type, in its colour, with no cost — a family on the card is ignored", () => {
    expect(gate({ ...SERRA, cost: "{3}", frame_style: { template: "m15dfcback" } }, { family: "sunmoon" })).toEqual({
      ok: true,
      layout: "transform",
      back: { ...SERRA, frame_style: { template: "m15dfcback" }, color_identity: ["white"] },
    });
    expect(gate({ ...SERRA, frame_style: { template: "m15dfcback" }, color_identity: ["blue", "white"] })).toMatchObject({ ok: true, back: { color_identity: ["blue", "white"] } });
    expect(gate({ ...SERRA, frame_style: { template: "m15dfcbackleft" } })).toEqual({ ok: false, field: "back_face.frame_style", message: DFC_BACK_BODY_MISMATCH });
    // A land back wears the land back (no print; what bodyFor answers).
    expect(gate({ title: "Skyclave", card_type: "land", frame_style: { template: "m15dfclandback" }, color_identity: ["colorless"] })).toMatchObject({ ok: true });
  });

  it("the back's body is verified in its colour, as every double-faced back", () => {
    const refused = gate({ ...SERRA, frame_style: { template: "m15dfcback" } }, { verifiedKeys: verified("battle") });
    expect(refused).toMatchObject({ ok: false, field: "back_face.color_identity", code: "unverified" });
    expect(gate({ ...SERRA, frame_style: { template: "m15dfcback" } }, { verifiedKeys: verified("battle"), skipVerification: true })).toMatchObject({ ok: true });
  });

  it("on an edit a stored body wins (a patch with none keeps it) and its colour is locked; a stored legacy back stays legacy", () => {
    const stored = { ...SERRA, frame_style: { template: "m15dfcback" }, color_identity: ["white"] as ColorIdentity[] };
    expect(gate({ ...SERRA, title: "Serra, Renamed" }, { stored: { back: stored, familyChanged: false } })).toMatchObject({
      ok: true,
      back: { title: "Serra, Renamed", frame_style: { template: "m15dfcback" }, color_identity: ["white"] },
    });
    expect(gate({ ...SERRA, color_identity: ["blue"] }, { stored: { back: stored, familyChanged: false } })).toEqual({
      ok: false,
      field: "back_face.color_identity",
      message: DFC_BACK_COLOR_SET,
    });
    expect(gate({ ...ANTHEM, title: "Retitled" }, { stored: { back: ANTHEM, familyChanged: false } })).toEqual({ ok: true, back: { ...ANTHEM, title: "Retitled" }, layout: null });
  });

  it("the battle frame dresses battles only; a back's art is asked for only on a back of its own", () => {
    expect(dfcFrontTypeError("battle", "battle")).toBeNull();
    for (const t of ["creature", "enchantment", "land", "planeswalker", "token"]) expect(dfcFrontTypeError("battle", t), t).toBe(DFC_BATTLE_FRONT_TYPE_REFUSED);
    expect(dfcBackArtMissing("battle", null)).toBe(false);
    expect(dfcBackArtMissing("battle", ANTHEM)).toBe(false);
    expect(dfcBackArtMissing("battle", { ...SERRA, frame_style: { template: "m15dfcback" } })).toBe(true);
    expect(dfcBackArtMissing("battle", { ...SERRA, frame_style: { template: "m15dfcback" }, art_url: "https://x.test/a.png" })).toBe(false);
  });

  it("hasBackOfItsOwn: a DFC front's any back, a battle's only with a body", () => {
    expect(hasBackOfItsOwn("m15dfcfront", ANTHEM)).toBe(true);
    expect(hasBackOfItsOwn("battle", ANTHEM)).toBe(false);
    expect(hasBackOfItsOwn("battle", { frame_style: { template: "m15dfcback" } })).toBe(true);
    expect(hasBackOfItsOwn("battle", null)).toBe(false);
    expect(hasBackOfItsOwn("m15", { frame_style: { template: "m15dfcback" } })).toBe(false);
  });
});

describe("the faces (lib/cards/faces.ts) — what both renderers and both bakes read", () => {
  const card = (backFace: CardPreviewData["backFace"]): CardPreviewData => ({
    title: "Invasion of Dominaria",
    cardType: "battle",
    subtypes: ["Siege"],
    cost: "{2}{W}",
    defense: "5",
    colorIdentity: ["white"],
    frameStyle: { template: "battle", crown: true },
    backFace,
  });

  it("no back, or a legacy back: the battle as it always was — no cross-face block, no bake of a back, the old flip", () => {
    expect(frontPreviewData(card(null)).dfc).toBeUndefined();
    const legacy = card({ ...ANTHEM, subtypes: [] } as never);
    expect(frontPreviewData(legacy)).toBe(legacy);
    expect(backBodyOf(legacy)).toBeNull();
    expect(bakedBackOf(legacy)).toBeNull();
    // The legacy flip draws the back's content on the battle frame, as before.
    expect(flippableBackOf(legacy)?.frameStyle?.template).toBe("battle");
    expect(rowHasBakedBack({ frame_style: { template: "battle" }, back_face: ANTHEM })).toBe(false);
    expect(exportFacesOf({ frame_style: { template: "battle" }, back_face: ANTHEM })).toEqual(["front"]);
  });

  it("a back of its own: the front carries the block (the back's P/T for the tab, the plain family), the back draws on the ▼ back, portrait, and is baked", () => {
    const own = card({ ...SERRA, subtypes: ["Angel"], frame_style: { template: "m15dfcback" }, color_identity: ["white"] } as never);
    expect(frontPreviewData(own).dfc).toMatchObject({ layout: "transform", role: "front", icon: "arrows", otherFace: { printsPt: true, power: "4", toughness: "4" } });
    const back = backPreviewData(own)!;
    expect(back.frameStyle?.template).toBe("m15dfcback");
    expect(getFrameProfile(back.frameStyle?.template).orientation ?? "portrait").toBe("portrait");
    expect(back.dfc).toMatchObject({ role: "back", icon: "arrows" });
    // The card's crown switch rides to the back (the back draws the crown).
    expect(back.frameStyle?.crown).toBe(true);
    expect(bakedBackOf(own)).not.toBeNull();
    expect(exportFacesOf({ frame_style: { template: "battle" }, back_face: { ...SERRA, frame_style: { template: "m15dfcback" } } })).toEqual(["front", "back"]);
    expect(cardPageName("Invasion of Dominaria", "battle", cardPageFacesOf({ frame_style: { template: "battle" }, back_face: { ...SERRA, frame_style: { template: "m15dfcback" } } }))).toBe(
      "Invasion of Dominaria // Serra Faithkeeper",
    );
  });

  it("both faces in one PNG: the landscape front beside the portrait back, centred on its height, the gutter the portrait card's", () => {
    expect(sideBySideSize({ width: 2100, height: 1500 }, { width: 1500, height: 2100 })).toEqual({ width: 2100 + 60 + 1500, height: 2100, gutter: 60, frontTop: 300, backTop: 0 });
    expect(sideBySideSize({ width: 750, height: 536 }, { width: 750, height: 1050 })).toMatchObject({ gutter: 30, frontTop: 257, backTop: 0 });
    // Every other two-faced card: as before.
    expect(sideBySideSize({ width: 1500, height: 2100 }, { width: 1500, height: 2100 })).toEqual({ width: 3060, height: 2100, gutter: 60, frontTop: 0, backTop: 0 });
  });
});

describe("the creator's rule (lib/creator/battle-back.ts)", () => {
  it("a NEW battle edits its back as a face once the ▼ back is published somewhere; an edit only with a stored body", () => {
    expect(battleBackUnavailableNote({ mode: "create", storedBack: null, verifiedKeys: verified("battle", "m15dfcback") })).toBeNull();
    expect(battleBackUnavailableNote({ mode: "create", storedBack: null, verifiedKeys: verified("battle") })).toBe("The back face's frame isn't published yet");
    expect(battleBackUnavailableNote({ mode: "edit", storedBack: { frame_style: { template: "m15dfcback" } }, verifiedKeys: new Set() })).toBeNull();
    expect(battleBackUnavailableNote({ mode: "edit", storedBack: null, verifiedKeys: EVERYTHING })).toMatch(/one face/);
    expect(battleBackUnavailableNote({ mode: "remix", storedBack: { title: "x" } as never, verifiedKeys: EVERYTHING })).toMatch(/keeps the back/);
  });

  it("the body the back saves on: the ▼ back while it is published in the back's colour (its own, else the front's), else a legacy back", () => {
    const args = { mode: "create" as const, backType: "creature", frontColorIdentity: ["white"] as ColorIdentity[] };
    expect(battleBackBodyFor({ ...args, backColorIdentity: [], verifiedKeys: verified("m15dfcback") })).toBe("m15dfcback");
    const onlyWhite = new Set([frameComboKey("m15dfcback", "w")]);
    expect(battleBackBodyFor({ ...args, backColorIdentity: [], verifiedKeys: onlyWhite })).toBe("m15dfcback");
    expect(battleBackBodyFor({ ...args, backColorIdentity: ["blue", "white"], verifiedKeys: onlyWhite })).toBeNull();
    expect(battleBackBodyFor({ ...args, backType: "land", backColorIdentity: ["colorless"], verifiedKeys: verified("m15dfclandback") })).toBe("m15dfclandback");
    expect(battleBackBodyFor({ ...args, mode: "edit", backColorIdentity: [], verifiedKeys: new Set() })).toBe("m15dfcback");
    expect(bodyFor("transform", "back", "creature")).toBe("m15dfcback");
  });
});
