import { describe, expect, it, vi } from "vitest";

// The bodies 5.1a / 5.1b will declare, on four existing templates (never
// the real PROFILES): m15 = a transform FRONT, m15land = the transform land
// front, m15artifact = a transform BACK, m15snow = a modal front, m15devoid
// = a modal back (tests/unit/cards/dfc-fixture.ts).
vi.mock("@/lib/cards/template-layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/template-layout")>();
  const { dfcGetFrameProfile } = await import("./dfc-fixture");
  return { ...real, getFrameProfile: dfcGetFrameProfile(real.getFrameProfile) };
});

import {
  anatomyDefaults,
  anatomyOn,
  applyFrameAnatomyPatch,
  frameAnatomyOf,
  newCardFrameStyle,
  normalizeAnatomy,
  NEW_CARD_ANATOMY,
} from "@/lib/cards/anatomy";
import {
  backBodyError,
  colorlessFaceAllowed,
  dfcBodyOf,
  faceUnderTest,
  frontBodyFor,
  isDfcBackBody,
  templateHasBackFace,
} from "@/lib/cards/dfc";
import { backBodyOf, backPreviewData, dfcIconOf, facesOf, frontPreviewData } from "@/lib/cards/faces";
import type { CardPreviewData } from "@/components/cards/card-preview";

// ---------------------------------------------------------------------------
// TODO 5.0a — what the plumbing answers ONCE a DFC body exists (the
// declared fixture): templateHasBackFace / isDfcBackBody by role,
// colorlessFaceAllowed's artifact-word rule (D2), backBodyError's structural
// gate, the `dfcIcon` key kept only on a transform front, and faces.ts's
// twins — the front's block reading the back, the back drawing on its own
// body and colour with the card's collector line and watermark (D8, D18),
// the modal strip's word and line (D9). None of this is reachable on the
// real profiles today; the legacy path is tests/unit/cards/faces.test.ts.
// ---------------------------------------------------------------------------

const card = (over: Partial<CardPreviewData> = {}): CardPreviewData => ({
  title: "Brutal Cathar",
  cost: "{2}{W}",
  cardType: "creature",
  supertype: null,
  subtypes: ["Human", "Soldier", "Werewolf"],
  rarity: "rare",
  colorIdentity: ["white"],
  rulesText: "When this creature enters, exile target creature an opponent controls.",
  flavorText: null,
  power: "2",
  toughness: "2",
  loyalty: null,
  defense: null,
  artistCredit: "Front Artist",
  artUrl: "https://auth.pipglyph.com/storage/v1/object/public/card-art/00000000-0000-4000-8000-000000000001/front.webp",
  artPosition: { scale: 1, focalX: 0.5, focalY: 0.5 },
  frameStyle: { finish: "foil", template: "m15", crown: true, collector: "2023", dfcIcon: "sunmoon" },
  setIconUrl: null,
  setIconCode: "mid",
  setCode: "MID",
  collectorNumber: "169",
  lang: "en",
  faceContent: null,
  watermark: { kind: "preset", key: "wm-x" } as never,
  backFace: {
    title: "Moonrage Brute",
    card_type: "creature",
    subtypes: ["Werewolf"],
    power: "3",
    toughness: "3",
    rules_text: "Daybound",
    artist_credit: "Back Artist",
    art_url: "https://auth.pipglyph.com/storage/v1/object/public/card-art/00000000-0000-4000-8000-000000000001/back.webp",
    frame_style: { template: "m15artifact" },
    color_identity: ["red"],
  },
  brandMark: true,
  ...over,
});

describe("the predicates by role", () => {
  it("a front body has a back face; a back body is a back body and never a front", () => {
    expect(dfcBodyOf("m15")).toEqual({ layout: "transform", role: "front", well: "left" });
    expect(templateHasBackFace("m15")).toBe(true);
    expect(templateHasBackFace("m15land")).toBe(true);
    expect(templateHasBackFace("m15snow")).toBe(true);
    expect(templateHasBackFace("m15artifact")).toBe(false);
    expect(templateHasBackFace("m15devoid")).toBe(false);
    expect(isDfcBackBody("m15artifact")).toBe(true);
    expect(isDfcBackBody("m15devoid")).toBe(true);
    expect(isDfcBackBody("m15")).toBe(false);
    // A template that declares nothing is neither (m15borderless).
    expect(templateHasBackFace("m15borderless")).toBe(false);
    expect(isDfcBackBody("m15borderless")).toBe(false);
  });

  it("colorlessFaceAllowed (D2): on a DFC body only a face whose type line says Artifact; elsewhere always", () => {
    for (const body of ["m15", "m15artifact", "m15snow", "m15devoid"]) {
      expect(colorlessFaceAllowed(body, { cardType: "artifact" }), body).toBe(true);
      expect(colorlessFaceAllowed(body, { cardType: "creature", supertype: "Artifact" }), body).toBe(true);
      expect(colorlessFaceAllowed(body, { cardType: "creature", supertype: "Legendary Artifact" }), body).toBe(true);
      expect(colorlessFaceAllowed(body, { cardType: "creature", supertype: null }), body).toBe(false);
      expect(colorlessFaceAllowed(body, { cardType: "creature", supertype: "Legendary" }), body).toBe(false);
      expect(colorlessFaceAllowed(body, null), body).toBe(false);
    }
    expect(colorlessFaceAllowed("m15borderless", { cardType: "creature" })).toBe(true);
  });

  it("backBodyError: a back body under a DFC front; a front body as a back, or a body under a plain front, is refused", () => {
    expect(backBodyError("m15", { frame_style: { template: "m15artifact" } })).toBeNull();
    expect(backBodyError("m15snow", { frame_style: { template: "m15devoid" } })).toBeNull();
    expect(backBodyError("m15", { frame_style: { template: "m15" } })).toBe("Not a back-face frame.");
    expect(backBodyError("m15", { frame_style: { template: "m15borderless" } })).toBe("Not a back-face frame.");
    expect(backBodyError("m15borderless", { frame_style: { template: "m15artifact" } })).toBe("This frame has no back face of its own.");
    expect(backBodyError("m15artifact", { frame_style: { template: "m15artifact" } })).toBe("This frame has no back face of its own.");
    expect(backBodyError("m15", { title: "x" })).toBeNull();
  });
});

describe("the `dfcIcon` key (lib/cards/anatomy.ts)", () => {
  it("is drawn by a transform FRONT only: kept there, dropped on a modal front, a back body and every other template", () => {
    expect(frameAnatomyOf("m15").dfcIcon).toBe(true);
    expect(frameAnatomyOf("m15land").dfcIcon).toBe(true);
    expect(frameAnatomyOf("m15snow").dfcIcon).toBe(false);
    expect(frameAnatomyOf("m15artifact").dfcIcon).toBe(false);
    expect(frameAnatomyOf("m15devoid").dfcIcon).toBe(false);
    expect(frameAnatomyOf("m15borderless").dfcIcon).toBe(false);
    const style = { template: "m15", dfcIcon: "moon" as const, finish: "regular" as const };
    expect(normalizeAnatomy(style, "m15", "creature")).toBe(style);
    expect(normalizeAnatomy(style, "m15land", "land")).toBe(style);
    expect(normalizeAnatomy({ ...style, template: "m15snow" }, "m15snow", "creature")).not.toHaveProperty("dfcIcon");
    expect(normalizeAnatomy({ ...style, template: "m15artifact" }, "m15artifact", "creature")).not.toHaveProperty("dfcIcon");
    expect(normalizeAnatomy({ ...style, template: "m15borderless" }, "m15borderless", "creature")).not.toHaveProperty("dfcIcon");
    // Nothing else is dropped with it.
    expect(normalizeAnatomy({ ...style, template: "m15snow", collector: "2023" }, "m15snow", "creature")).toEqual({ template: "m15snow", collector: "2023", finish: "regular" });
  });

  it("is on only when it names a family; a new card gets no default from the template (the kind's default is 5.2's)", () => {
    expect(anatomyOn({ dfcIcon: "arrows" }, "dfcIcon")).toBe(true);
    expect(anatomyOn({ dfcIcon: "fan" }, "dfcIcon")).toBe(true);
    expect(anatomyOn({}, "dfcIcon")).toBe(false);
    expect(anatomyOn(null, "dfcIcon")).toBe(false);
    expect(anatomyOn({ dfcIcon: "spark" as never }, "dfcIcon")).toBe(false);
    expect(anatomyOn({ dfcIcon: true as never }, "dfcIcon")).toBe(false);
    expect("dfcIcon" in NEW_CARD_ANATOMY).toBe(false);
    expect(anatomyDefaults("m15")).not.toHaveProperty("dfcIcon");
    expect(newCardFrameStyle({ template: "m15" }, "creature")).not.toHaveProperty("dfcIcon");
    // An explicit family on a transform front survives the new-card stamp.
    expect(newCardFrameStyle({ template: "m15", dfcIcon: "compass" }, "creature").dfcIcon).toBe("compass");
  });

  it("an edit's frame_anatomy carries it: merged over the stored style on a transform front, dropped elsewhere", () => {
    const onFront = applyFrameAnatomyPatch(
      { frameStyle: { template: "m15", finish: "foil", crown: false }, colorIdentity: ["white"], cardType: "creature" },
      { dfcIcon: "fan" },
    );
    expect(onFront).toEqual({ ok: true, frameStyle: { template: "m15", finish: "foil", crown: false, dfcIcon: "fan" }, colorIdentity: null });
    const onPlain = applyFrameAnatomyPatch(
      { frameStyle: { template: "m15borderless", finish: "foil" }, colorIdentity: ["white"], cardType: "creature" },
      { dfcIcon: "fan" },
    );
    expect(onPlain).toEqual({ ok: true, frameStyle: { template: "m15borderless", finish: "foil" }, colorIdentity: null });
  });
});

describe("faces.ts with a body (the twins)", () => {
  it("the back's body and colour are honoured only under a DFC front and only for a back body", () => {
    expect(backBodyOf(card())).toEqual({ template: "m15artifact", colorIdentity: ["red"] });
    // A plain front: the body is ignored (a stray value can't move a card).
    expect(backBodyOf(card({ frameStyle: { template: "m15borderless" } }))).toBeNull();
    // A body naming a front body: ignored.
    expect(backBodyOf(card({ backFace: { ...card().backFace!, frame_style: { template: "m15" } } }))).toBeNull();
    // No colour: the front's.
    expect(backBodyOf(card({ backFace: { ...card().backFace!, color_identity: undefined } }))).toEqual({ template: "m15artifact", colorIdentity: null });
    expect(backBodyOf(card({ backFace: null }))).toBeNull();
  });

  it("the family: the stored key, else arrows", () => {
    expect(dfcIconOf(card())).toBe("sunmoon");
    expect(dfcIconOf(card({ frameStyle: { template: "m15" } }))).toBe("arrows");
    expect(dfcIconOf(card({ frameStyle: { template: "m15", dfcIcon: "spark" as never } }))).toBe("arrows");
  });

  it("the front carries the layout, its role, the family and the BACK's tab data; the card is otherwise untouched", () => {
    const c = card();
    const front = frontPreviewData(c);
    expect(front.dfc).toEqual({
      layout: "transform",
      role: "front",
      icon: "sunmoon",
      otherFace: { typeWord: "Werewolf", line: null, printsPt: true, power: "3", toughness: "3" },
    });
    const rest = { ...front };
    delete rest.dfc;
    expect(rest).toEqual(c);
    // A back that prints no P/T: the tab stays empty (Q7) — printsPt false.
    const landBack = card({ backFace: { ...c.backFace!, card_type: "land", subtypes: [], power: undefined, toughness: undefined, rules_text: "{T}: Add {W}." } });
    expect(frontPreviewData(landBack).dfc?.otherFace).toEqual({ typeWord: "Land", line: "{T}: Add {W}.", printsPt: false, power: null, toughness: null });
    // A DFC front with no back face at all: no block (nothing to read).
    expect(frontPreviewData(card({ backFace: null })).dfc).toBeUndefined();
  });

  it("the back draws on its own body and colour, with the card's rarity, finish, switches, set symbol, collector line and watermark, and the FRONT's data in its block", () => {
    const c = card();
    const back = backPreviewData(c)!;
    expect(back).toMatchObject({
      title: "Moonrage Brute",
      cost: null,
      cardType: "creature",
      supertype: null,
      subtypes: ["Werewolf"],
      rulesText: "Daybound",
      flavorText: null,
      power: "3",
      toughness: "3",
      artistCredit: "Back Artist",
      artUrl: c.backFace!.art_url,
      frameStyle: { finish: "foil", template: "m15artifact", crown: true, collector: "2023", dfcIcon: "sunmoon" },
      colorIdentity: ["red"],
      rarity: "rare",
      setIconCode: "mid",
      setCode: "MID",
      collectorNumber: "169",
      lang: "en",
      watermark: c.watermark,
      faceContent: null,
      backFace: null,
      backCard: null,
      brandMark: true,
    });
    expect(back.dfc).toEqual({
      layout: "transform",
      role: "back",
      icon: "sunmoon",
      otherFace: { typeWord: "Werewolf", line: "{2}{W}", printsPt: true, power: "2", toughness: "2" },
    });
    expect(facesOf(c)).toEqual({ front: frontPreviewData(c), back });
  });

  it("a modal card: no family; the strip's word is the other face's LAST type word, its line the cost or a land's mana ability (D9)", () => {
    const znr12 = card({
      title: "Emeria's Call",
      cost: "{4}{W}{W}{W}",
      cardType: "sorcery",
      subtypes: [],
      power: null,
      toughness: null,
      frameStyle: { template: "m15snow", collector: "2023" },
      backFace: {
        title: "Emeria, Shattered Skyclave",
        card_type: "land",
        subtypes: [],
        rules_text: "As Emeria, Shattered Skyclave enters, you may pay 3 life. If you don't, it enters tapped.\n{T}: Add {W}.",
        frame_style: { template: "m15devoid" },
      },
    });
    expect(frontPreviewData(znr12).dfc).toEqual({
      layout: "modal",
      role: "front",
      icon: null,
      otherFace: { typeWord: "Land", line: "{T}: Add {W}.", printsPt: false, power: null, toughness: null },
    });
    const back = backPreviewData(znr12)!;
    expect(back.frameStyle?.template).toBe("m15devoid");
    expect(back.colorIdentity).toEqual(["white"]); // no back colour stored: the front's
    expect(back.dfc).toEqual({
      layout: "modal",
      role: "back",
      icon: null,
      otherFace: { typeWord: "Sorcery", line: "{4}{W}{W}{W}", printsPt: false, power: null, toughness: null },
    });
  });
});


describe("the face under test and the paired front (TODO 5.0b) once a body exists", () => {
  it("a back body is always its printing's back face — the admin tools never show its front", () => {
    expect(faceUnderTest("m15artifact")).toBe("back");
    expect(faceUnderTest("m15artifact", "front")).toBe("back");
    expect(faceUnderTest("m15devoid", null)).toBe("back");
    // A front body, like any other template, is the face asked for.
    expect(faceUnderTest("m15")).toBe("front");
    expect(faceUnderTest("m15", "back")).toBe("back");
    expect(faceUnderTest("m15snow")).toBe("front");
  });

  it("frontBodyFor pairs a back body with a front of its layout; bodyFor first, else the first non-land front", () => {
    // bodyFor's table is empty until 5.1a: the fallback scans the declared
    // fronts of the same layout, skipping the land one.
    expect(frontBodyFor("m15artifact")).toBe("m15");
    expect(frontBodyFor("m15artifact", "creature", "sunmoon")).toBe("m15");
    expect(frontBodyFor("m15devoid")).toBe("m15snow");
    // Not a back body: null.
    expect(frontBodyFor("m15")).toBeNull();
    expect(frontBodyFor("m15land")).toBeNull();
    expect(frontBodyFor("m15borderless")).toBeNull();
  });
});
