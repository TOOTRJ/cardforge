import { describe, expect, it } from "vitest";
import { DFC_ICON_GLYPH_KEYS, DFC_ICON_GLYPHS, dfcIconGlyph } from "@/lib/cards/dfc-icons";
import {
  DEFAULT_DFC_ICON,
  DFC_ICON_FAMILY_VALUES,
  backBodyError,
  bodyFor,
  colorlessFaceAllowed,
  dfcBodyOf,
  isDfcBackBody,
  isDfcIconFamily,
  templateHasBackFace,
  transformBackBodyFor,
} from "@/lib/cards/dfc";
import { frameProfileOverrideSchema } from "@/lib/cards/profile-override";
import { DFC_ICON_RIDER, getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 5.0a / 5.1a — lib/cards/dfc.ts on the REAL profiles: the five
// transform bodies (5.1a) are the only double-faced bodies (the modal ones
// are 5.1b's), so the predicates answer for exactly them, the body table has
// its transform rows, and a back body can be stored under a transform front
// only. The declared-profile half (what the predicates answer on a fixture
// profile) is tests/unit/cards/dfc-declared.test.ts.
// ---------------------------------------------------------------------------

describe("the vocabulary", () => {
  it("five families, arrows the default (owner decision Q5); spark waits for the walker bodies (5.13)", () => {
    expect([...DFC_ICON_FAMILY_VALUES]).toEqual(["arrows", "sunmoon", "moon", "compass", "fan"]);
    expect(DEFAULT_DFC_ICON).toBe("arrows");
    for (const family of DFC_ICON_FAMILY_VALUES) expect(isDfcIconFamily(family), family).toBe(true);
    for (const bad of ["spark", "Arrows", "", null, undefined, 1, true, {}, ["arrows"]]) expect(isDfcIconFamily(bad), String(bad)).toBe(false);
  });
});

const TRANSFORM_FRONTS = ["m15dfcfront", "m15dfclandfront"] as const;
const TRANSFORM_BACKS = ["m15dfcback", "m15dfcbackleft", "m15dfclandback"] as const;
const DFC_BODIES = [...TRANSFORM_FRONTS, ...TRANSFORM_BACKS] as const;

describe("the transform bodies (5.1a) and every other template", () => {
  it("exactly the five transform bodies declare `dfc`: two fronts (a back face of their own), three backs (never a card's own)", () => {
    expect(FRAME_TEMPLATE_VALUES.length).toBeGreaterThan(40);
    for (const template of FRAME_TEMPLATE_VALUES) {
      const body = getFrameProfile(template).dfc;
      if ((DFC_BODIES as readonly string[]).includes(template)) {
        expect(body, template).toBeDefined();
        expect(body!.layout, template).toBe("transform");
        expect(dfcBodyOf(template), template).toEqual(body);
        continue;
      }
      expect(body, template).toBeUndefined();
      expect(dfcBodyOf(template), template).toBeNull();
      expect(templateHasBackFace(template), template).toBe(false);
      expect(isDfcBackBody(template), template).toBe(false);
    }
    for (const front of TRANSFORM_FRONTS) {
      expect(templateHasBackFace(front), front).toBe(true);
      expect(isDfcBackBody(front), front).toBe(false);
      expect(getFrameProfile(front).dfc?.well, front).toBe("left");
    }
    for (const back of TRANSFORM_BACKS) {
      expect(templateHasBackFace(back), back).toBe(false);
      expect(isDfcBackBody(back), back).toBe(true);
    }
    // The ▼ back's well is at the right; the 2016–22 back's at the left.
    expect(getFrameProfile("m15dfcback").dfc?.well).toBe("right");
    expect(getFrameProfile("m15dfcbackleft").dfc?.well).toBe("left");
    expect(getFrameProfile("m15dfclandback").dfc?.well).toBe("right");
    // The land pair says so.
    expect(getFrameProfile("m15dfclandfront").dfc?.land).toBe(true);
    expect(getFrameProfile("m15dfclandback").dfc?.land).toBe(true);
    for (const t of ["m15dfcfront", "m15dfcback", "m15dfcbackleft"]) expect(getFrameProfile(t).dfc?.land, t).toBeUndefined();
    // An unknown or empty template reads as m15 (no body).
    for (const template of [undefined, null, "", "{}", "no-such-frame"]) {
      expect(templateHasBackFace(template), String(template)).toBe(false);
      expect(isDfcBackBody(template), String(template)).toBe(false);
    }
  });

  it("bodyFor: the transform rows — the front by face kind, the back by family (arrows → the ▼ back, the four left families → the 2016–22 back), a land back whatever the family; modal rows still null (5.1b)", () => {
    for (const faceType of ["creature", "artifact", "instant", "enchantment", null, undefined]) {
      expect(bodyFor("transform", "front", faceType), `front ${faceType}`).toBe("m15dfcfront");
      expect(bodyFor("transform", "back", faceType), `back ${faceType} (default family)`).toBe("m15dfcback");
      expect(bodyFor("transform", "back", faceType, "arrows"), `back ${faceType} arrows`).toBe("m15dfcback");
      for (const family of ["sunmoon", "moon", "compass", "fan"] as const) {
        expect(bodyFor("transform", "back", faceType, family), `back ${faceType} ${family}`).toBe("m15dfcbackleft");
      }
    }
    expect(bodyFor("transform", "front", "land")).toBe("m15dfclandfront");
    for (const family of DFC_ICON_FAMILY_VALUES) expect(bodyFor("transform", "back", "land", family), family).toBe("m15dfclandback");
    expect(transformBackBodyFor("sunmoon", "creature")).toBe("m15dfcbackleft");
    expect(transformBackBodyFor("arrows", "land")).toBe("m15dfclandback");
    // The modal rows are 5.1b's.
    for (const role of ["front", "back"] as const) {
      for (const faceType of ["creature", "land", "instant", null]) {
        expect(bodyFor("modal", role, faceType), `modal/${role}/${faceType}`).toBeNull();
      }
    }
    // Every body bodyFor names IS a body of that role.
    for (const front of TRANSFORM_FRONTS) expect(templateHasBackFace(front)).toBe(true);
    for (const back of TRANSFORM_BACKS) expect(isDfcBackBody(back)).toBe(true);
  });

  it("the icon glyphs: one per family per role, every key one the riders publish; the ▼ is published but drawn by no wave-1 body", () => {
    expect(Object.keys(DFC_ICON_GLYPHS).sort()).toEqual([...DFC_ICON_FAMILY_VALUES].sort());
    for (const family of DFC_ICON_FAMILY_VALUES) {
      for (const role of ["front", "back"] as const) {
        expect(DFC_ICON_GLYPH_KEYS as readonly string[], `${family}/${role}`).toContain(dfcIconGlyph(family, role));
      }
      expect(dfcIconGlyph(family, "front")).not.toBe(dfcIconGlyph(family, "back"));
    }
    expect(dfcIconGlyph("arrows", "front")).toBe("default");
    expect(dfcIconGlyph("arrows", "back")).toBe("downarrow");
    expect(dfcIconGlyph("sunmoon", "front")).toBe("sun");
    expect(dfcIconGlyph("sunmoon", "back")).toBe("moon");
    expect(dfcIconGlyph("moon", "back")).toBe("emrakul");
    expect(dfcIconGlyph("compass", "back")).toBe("land");
    expect(dfcIconGlyph("fan", "front")).toBe("fanclosed");
    // The riders' keys are the profile's slot keys (lib/cards/template-layout.ts DFC_ICON_RIDER) — lowercase, the bucket's.
    expect([...DFC_ICON_RIDER.keys]).toEqual([...DFC_ICON_GLYPH_KEYS]);
    for (const key of DFC_ICON_GLYPH_KEYS) expect(key).toBe(key.toLowerCase());
    // The ▼ back carries no rider slot; the front and the 2016–22 back one.
    expect(getFrameProfile("m15dfcback").overlays).toBeUndefined();
    expect(getFrameProfile("m15dfclandback").overlays).toBeUndefined();
    expect(getFrameProfile("m15dfcfront").overlays?.map((o) => o.anatomy)).toEqual(["dfcIcon"]);
    expect(getFrameProfile("m15dfclandfront").overlays?.map((o) => o.anatomy)).toEqual(["dfcIcon"]);
    expect(getFrameProfile("m15dfcbackleft").overlays?.map((o) => o.anatomy)).toEqual(["dfcIcon"]);
  });

  it("colorlessFaceAllowed: the ordinary gate's business on a non-DFC template (always true); on a DFC body only an Artifact face (D2)", () => {
    for (const template of ["m15", "m15artifact", "m15land", "m15borderless", "emblem", "agclassic", undefined]) {
      expect(colorlessFaceAllowed(template, { cardType: "creature", supertype: null }), String(template)).toBe(true);
      expect(colorlessFaceAllowed(template, { cardType: "artifact" }), String(template)).toBe(true);
      expect(colorlessFaceAllowed(template, null), String(template)).toBe(true);
    }
    for (const body of ["m15dfcfront", "m15dfcback", "m15dfcbackleft"] as const) {
      expect(colorlessFaceAllowed(body, { cardType: "artifact" }), body).toBe(true);
      expect(colorlessFaceAllowed(body, { cardType: "creature", supertype: "Artifact" }), body).toBe(true);
      expect(colorlessFaceAllowed(body, { cardType: "creature", supertype: null }), body).toBe(false);
      expect(colorlessFaceAllowed(body, { cardType: "enchantment" }), body).toBe(false);
      expect(colorlessFaceAllowed(body, null), body).toBe(false);
    }
    // The land pair: one master under every key, no stand-in — its `c` is
    // any (land) face's.
    for (const body of ["m15dfclandfront", "m15dfclandback"] as const) {
      expect(colorlessFaceAllowed(body, { cardType: "land" }), body).toBe(true);
      expect(colorlessFaceAllowed(body, { cardType: "creature", supertype: null }), body).toBe(true);
      expect(colorlessFaceAllowed(body, null), body).toBe(true);
    }
  });

  it("backBodyError: a body-less back face is always fine; a back body only under a transform FRONT, and only a back body", () => {
    const legacy = { title: "Avacyn, the Purifier", card_type: "creature" };
    for (const front of FRAME_TEMPLATE_VALUES) {
      expect(backBodyError(front, legacy), front).toBeNull();
      expect(backBodyError(front, null), front).toBeNull();
      expect(backBodyError(front, undefined), front).toBeNull();
      if ((TRANSFORM_FRONTS as readonly string[]).includes(front)) {
        for (const back of TRANSFORM_BACKS) expect(backBodyError(front, { frame_style: { template: back } }), `${front} / ${back}`).toBeNull();
        expect(backBodyError(front, { frame_style: { template: "m15" } }), front).toBe("Not a back-face frame.");
        expect(backBodyError(front, { frame_style: { template: "m15dfcfront" } }), front).toBe("Not a back-face frame.");
        continue;
      }
      expect(backBodyError(front, { frame_style: { template: "m15" } }), front).toBe("This frame has no back face of its own.");
      expect(backBodyError(front, { frame_style: { template: "m15dfcback" } }), front).toBe("This frame has no back face of its own.");
    }
    expect(backBodyError(undefined, { frame_style: { template: "m15dfcback" } })).toBe("This frame has no back face of its own.");
    // An empty frame_style is no body.
    expect(backBodyError("m15dfcfront", { frame_style: {} })).toBeNull();
  });
});

describe("code-owned", () => {
  it("the admin override schema refuses a `dfc` declaration (like overlays and the pair masters)", () => {
    const base = frameProfileOverrideSchema.safeParse({});
    expect(base.success).toBe(true);
    const crafted = frameProfileOverrideSchema.safeParse({ dfc: { layout: "transform", role: "front", well: "left" } });
    expect(crafted.success).toBe(false);
  });
});
