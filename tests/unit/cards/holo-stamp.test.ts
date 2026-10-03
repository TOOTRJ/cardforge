import { describe, expect, it } from "vitest";
import {
  TWO_COLOR_PAIRS,
  anatomyDefaults,
  anatomyOn,
  applyFrameAnatomyPatch,
  frameAnatomyOf,
  importedAnatomy,
  importedFormAnatomy,
  newCardFrameStyle,
  normalizeAnatomy,
  pairColorIdentity,
  resolveFrameOverlays,
  resolveHoloStamp,
  storedAnatomyOf,
} from "@/lib/cards/anatomy";
import {
  HOLO_STAMP_ART_MARGIN_PX,
  HOLO_STAMP_CUT_MARGIN_PX,
  HOLO_STAMP_SWITCH_VALUES,
  M15PW_HOLO_STAMP_KEEP_OUT,
  M15PW_HOLO_STAMP_OVAL,
  M15_HOLO_STAMP_KEEP_OUT,
  M15_HOLO_STAMP_OVAL,
  STAMPLESS_CARD_TYPES,
  grownRect,
  holoStampArtRect,
  holoStampWanted,
  isHoloStampSwitch,
  offersHoloStampForType,
} from "@/lib/cards/holo-stamp";
import { M15PW_HOLO_STAMP, M15_HOLO_STAMP, getFrameProfile } from "@/lib/cards/template-layout";
import { frameAnatomyPatchSchema, frameStyleSchema } from "@/lib/validation/card";
import { FRAME_TEMPLATE_VALUES, type FrameStyle } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.9c — the holofoil stamp's rules (lib/cards/holo-stamp.ts) and its
// place in the anatomy plumbing (lib/cards/anatomy.ts): the switch's values,
// "auto" on a rare or mythic and nothing on a token or an emblem, the
// frame's own shape for every "on" value, the notch keyed like the crown
// (never a stand-in; a pair master draws the pair's notch in either dress
// since the 4.9c follow-up), the geometry
// (CC's oval, the walker's 7 px higher, the keep-out over the arch, the art
// rect's black margin past the importer's cut), and the save / default /
// edit / remix / import rules the owner set for every addition.
// ---------------------------------------------------------------------------

const m15 = getFrameProfile("m15");
const facts = (over: Record<string, unknown> = {}) => ({
  colors: ["black"] as const,
  cost: "{2}{B}{B}",
  cardType: "creature",
  supertype: null,
  rarity: "rare",
  colorKey: "b",
  ...over,
});

describe("the switch and the auto rule", () => {
  it("holds exactly auto / oval / triangle / none", () => {
    expect([...HOLO_STAMP_SWITCH_VALUES]).toEqual(["auto", "oval", "triangle", "none"]);
    for (const v of HOLO_STAMP_SWITCH_VALUES) expect(isHoloStampSwitch(v)).toBe(true);
    for (const v of [true, false, 1, "acorn", "", null, undefined, {}, ["oval"]]) expect(isHoloStampSwitch(v)).toBe(false);
  });

  it("auto wants a stamp on a rare or mythic only; oval and triangle always; none and absent never", () => {
    for (const rarity of ["rare", "mythic", "Rare", "MYTHIC"]) expect(holoStampWanted("auto", { cardType: "creature", rarity })).toBe(true);
    for (const rarity of ["common", "uncommon", "special", "bonus", "", null, undefined]) {
      expect(holoStampWanted("auto", { cardType: "creature", rarity })).toBe(false);
      expect(holoStampWanted("oval", { cardType: "creature", rarity })).toBe(true);
      expect(holoStampWanted("triangle", { cardType: "land", rarity })).toBe(true);
    }
    expect(holoStampWanted("none", { cardType: "creature", rarity: "mythic" })).toBe(false);
    expect(holoStampWanted(undefined, { cardType: "creature", rarity: "mythic" })).toBe(false);
    expect(holoStampWanted("acorn", { cardType: "creature", rarity: "mythic" })).toBe(false);
  });

  it("a token or an emblem never prints one, whatever the switch (their control is hidden)", () => {
    expect([...STAMPLESS_CARD_TYPES].sort()).toEqual(["emblem", "token"]);
    for (const cardType of ["token", "emblem"]) {
      for (const stamp of HOLO_STAMP_SWITCH_VALUES) expect(holoStampWanted(stamp, { cardType, rarity: "mythic" })).toBe(false);
      expect(offersHoloStampForType(cardType)).toBe(false);
    }
    for (const cardType of ["creature", "land", "artifact", "planeswalker", "instant", null, undefined]) expect(offersHoloStampForType(cardType)).toBe(true);
  });

  it("anatomyOn answers the switch alone: set to draw (auto / oval / triangle) or not", () => {
    expect(anatomyOn({ stamp: "auto" }, "stamp")).toBe(true);
    expect(anatomyOn({ stamp: "oval" }, "stamp")).toBe(true);
    expect(anatomyOn({ stamp: "triangle" }, "stamp")).toBe(true);
    expect(anatomyOn({ stamp: "none" }, "stamp")).toBe(false);
    expect(anatomyOn({}, "stamp")).toBe(false);
    expect(anatomyOn(null, "stamp")).toBe(false);
  });
});

describe("the geometry", () => {
  it("the oval is CC's plain-stamp box (683–817 × 1926–1993 px at HD), the walker's 7 px higher, both inside their notch rects", () => {
    expect(M15_HOLO_STAMP_OVAL).toEqual({ leftPct: 45.54, topPct: 91.72, widthPct: 8.94, heightPct: 3.2 });
    const px = (r: { leftPct: number; topPct: number; widthPct: number; heightPct: number }) => ({
      x0: (r.leftPct / 100) * 1500,
      x1: ((r.leftPct + r.widthPct) / 100) * 1500,
      y0: (r.topPct / 100) * 2100,
      y1: ((r.topPct + r.heightPct) / 100) * 2100,
    });
    const oval = px(M15_HOLO_STAMP_OVAL);
    expect([oval.x0, oval.x1, oval.y0, oval.y1].map((v) => Math.round(v))).toEqual([683, 817, 1926, 1993]);
    const walker = px(M15PW_HOLO_STAMP_OVAL);
    expect(walker.y0).toBeCloseTo(oval.y0 - 7, 6);
    expect(walker.x0).toBe(oval.x0);
    // Inside the notch slots, with room for the cut margin.
    const inside = (o: ReturnType<typeof px>, n: ReturnType<typeof px>) =>
      o.x0 - HOLO_STAMP_CUT_MARGIN_PX > n.x0 && o.x1 + HOLO_STAMP_CUT_MARGIN_PX < n.x1 && o.y0 - HOLO_STAMP_CUT_MARGIN_PX > n.y0 && o.y1 < n.y1 + 0.5;
    expect(inside(oval, px(M15_HOLO_STAMP.rect))).toBe(true);
    expect(inside(walker, px(M15PW_HOLO_STAMP.rect))).toBe(true);
  });

  it("the art rect is the oval grown by the black margin, one px past the importer's cut", () => {
    expect(HOLO_STAMP_ART_MARGIN_PX).toBe(HOLO_STAMP_CUT_MARGIN_PX + 1);
    const art = holoStampArtRect(M15_HOLO_STAMP_OVAL);
    expect(art).toEqual(grownRect(M15_HOLO_STAMP_OVAL, 3));
    expect((art.leftPct / 100) * 1500).toBeCloseTo(683.1 - 3, 6);
    expect((art.widthPct / 100) * 1500).toBeCloseTo(134.1 + 6, 6);
    expect((art.topPct / 100) * 2100).toBeCloseTo(1926.12 - 3, 6);
    expect((art.heightPct / 100) * 2100).toBeCloseTo(67.2 + 6, 6);
  });

  it("the keep-out covers the arch from 1905 px past the rules box's bottom, x 655–845 — the rules rect itself never moves", () => {
    expect(M15_HOLO_STAMP_KEEP_OUT).toEqual({ leftPct: 43.67, topPct: 90.71, widthPct: 12.67, heightPct: 0.93 });
    const rules = m15.rules.rect;
    const bottom = rules.topPct + rules.heightPct;
    expect(M15_HOLO_STAMP_KEEP_OUT.topPct + M15_HOLO_STAMP_KEEP_OUT.heightPct).toBeGreaterThan(bottom);
    expect(Math.round((M15_HOLO_STAMP_KEEP_OUT.topPct / 100) * 2100)).toBe(1905);
    expect(Math.round((M15_HOLO_STAMP_KEEP_OUT.leftPct / 100) * 1500)).toBe(655);
    expect(Math.round(((M15_HOLO_STAMP_KEEP_OUT.leftPct + M15_HOLO_STAMP_KEEP_OUT.widthPct) / 100) * 1500)).toBe(845);
    // The walker's spans its notch's top to past its rules rect's bottom.
    const pw = getFrameProfile("m15pw").rules.rect;
    expect(M15PW_HOLO_STAMP_KEEP_OUT.topPct).toBe(M15PW_HOLO_STAMP.rect.topPct);
    expect(M15PW_HOLO_STAMP_KEEP_OUT.topPct + M15PW_HOLO_STAMP_KEEP_OUT.heightPct).toBeGreaterThan(pw.topPct + pw.heightPct);
    expect(m15.rules.vAlign).toBe("center");
  });
});

describe("the notch and the resolved stamp", () => {
  it("the slot is on exactly the seven wave-1 entries, keyed by the master's bar: a colourless artifact's 'a', a colourless land's 'l', every devoid key's 'c', the walker's own piece", () => {
    const withNotch = FRAME_TEMPLATE_VALUES.filter((t) => frameAnatomyOf(t).stamp);
    expect(withNotch).toEqual(FRAME_TEMPLATE_VALUES.filter((t) => ["m15", "m15land", "m15snowland", "m15artifact", "m15snow", "m15devoid", "m15pw"].includes(t)));
    const keyOf = (template: string, colorKey: string, over: Record<string, unknown> = {}) =>
      resolveHoloStamp(getFrameProfile(template), { stamp: "oval" }, facts({ colorKey, colors: [colorKey === "c" ? "colorless" : "blue"], ...over }))?.notch.path ?? null;
    expect(keyOf("m15", "w")).toBe("/frames/m15holostamp/w.png");
    expect(keyOf("m15", "c")).toBe("/frames/m15holostamp/c.png");
    expect(keyOf("m15artifact", "c", { cardType: "artifact" })).toBe("/frames/m15holostamp/a.png");
    expect(keyOf("m15artifact", "u", { cardType: "artifact" })).toBe("/frames/m15holostamp/u.png");
    expect(keyOf("m15land", "c", { cardType: "land" })).toBe("/frames/m15holostamp/l.png");
    expect(keyOf("m15land", "g", { cardType: "land" })).toBe("/frames/m15holostamp/g.png");
    expect(keyOf("m15snow", "r")).toBe("/frames/m15holostamp/r.png");
    expect(keyOf("m15snowland", "c", { cardType: "land" })).toBe("/frames/m15holostamp/l.png");
    for (const k of ["w", "u", "b", "r", "g", "m", "c"]) expect(keyOf("m15devoid", k), k).toBe("/frames/m15holostamp/c.png");
    expect(keyOf("m15pw", "c", { cardType: "planeswalker" })).toBe("/frames/m15pwholostamp/c.png");
    expect(keyOf("m15pw", "m", { cardType: "planeswalker" })).toBe("/frames/m15pwholostamp/m.png");
    // No notch: nothing, never a stand-in.
    expect(keyOf("m15token", "g", { cardType: "creature" })).toBeNull();
    expect(keyOf("emblem", "c")).toBeNull();
    expect(keyOf("m15borderless", "w")).toBeNull();
    expect(keyOf("adventure", "w")).toBeNull();
  });

  it("resolves the frame's own oval and keep-out, and the art rect; a pair master draws the pair's notch in either dress", () => {
    const stamp = resolveHoloStamp(m15, { stamp: "auto" }, facts({ rarity: "mythic" }))!;
    expect(stamp).toMatchObject({ shape: "oval", oval: M15_HOLO_STAMP_OVAL, keepOut: M15_HOLO_STAMP_KEEP_OUT, artRect: holoStampArtRect(M15_HOLO_STAMP_OVAL) });
    expect(stamp.notch).toEqual(resolveFrameOverlays(m15, { stamp: "auto" }, facts({ rarity: "mythic" })).find((o) => o.anatomy === "holoStamp"));
    expect(resolveHoloStamp(m15, { stamp: "auto" }, facts({ rarity: "common" }))).toBeNull();
    expect(resolveHoloStamp(m15, { stamp: "none" }, facts({ rarity: "mythic" }))).toBeNull();
    expect(resolveHoloStamp(m15, {}, facts({ rarity: "mythic" }))).toBeNull();
    expect(resolveHoloStamp(m15, { stamp: "oval" }, facts({ rarity: "common" }))?.shape).toBe("oval");
    // An imported "triangle" on an oval frame draws the frame's oval.
    expect(resolveHoloStamp(m15, { stamp: "triangle" }, facts())?.shape).toBe("oval");
    // The two-colour look asks for the pair's notch (the 4.9c follow-up,
    // owner round 26): the pair key in printed order whatever the identity's
    // order, on BOTH dresses — one piece per pair, since the split and the
    // hybrid master hold the same bar under the notch — and on every
    // template with pair masters; drawn gold (the switch off) it keeps "m".
    const pair = facts({ colors: ["white", "blue"], cost: "{W}{U}", colorKey: "m" });
    expect(resolveHoloStamp(m15, { stamp: "oval", twoColor: true }, pair)?.notch).toEqual({
      anatomy: "holoStamp",
      rect: M15_HOLO_STAMP.rect,
      key: "wu",
      path: "/frames/m15holostamp/wu.png",
    });
    expect(resolveHoloStamp(m15, { stamp: "auto", twoColor: true }, facts({ colors: ["blue", "white"], cost: "{W/U}{W/U}", colorKey: "m" }))?.notch.key).toBe("wu");
    expect(resolveHoloStamp(m15, { stamp: "oval", twoColor: false }, pair)?.notch.key).toBe("m");
    expect(resolveHoloStamp(m15, { stamp: "auto", twoColor: true }, facts({ ...pair, rarity: "common" }))).toBeNull();
    expect(resolveHoloStamp(m15, { stamp: "oval", twoColor: true }, facts({ ...pair, rarity: "common" }))?.notch.key).toBe("wu");
    for (const p of TWO_COLOR_PAIRS) {
      const colors = pairColorIdentity(p);
      const cost = `{${p[0].toUpperCase()}}{${p[1].toUpperCase()}}`;
      expect(resolveHoloStamp(m15, { stamp: "oval", twoColor: true }, facts({ colors, cost, colorKey: "m" }))?.notch.key, p).toBe(p);
      expect(resolveHoloStamp(getFrameProfile("m15artifact"), { stamp: "oval", twoColor: true }, facts({ colors, cost, colorKey: "m", cardType: "artifact" }))?.notch.key, `artifact ${p}`).toBe(p);
      expect(resolveHoloStamp(getFrameProfile("m15land"), { stamp: "oval", twoColor: true }, facts({ colors, cost: null, colorKey: "m", cardType: "land" }))?.notch.key, `land ${p}`).toBe(p);
      // The snow pairs (4.6f wave 2c): the same pieces — m15snow's and
      // m15snowland's bar under the notch is m15's pair bar.
      expect(resolveHoloStamp(getFrameProfile("m15snow"), { stamp: "oval", twoColor: true }, facts({ colors, cost, colorKey: "m", supertype: "Snow" }))?.notch.path, `snow ${p}`).toBe(`/frames/m15holostamp/${p}.png`);
      expect(resolveHoloStamp(getFrameProfile("m15snowland"), { stamp: "oval", twoColor: true }, facts({ colors, cost: null, colorKey: "m", cardType: "land", supertype: "Snow" }))?.notch.path, `snow land ${p}`).toBe(`/frames/m15holostamp/${p}.png`);
    }
    // A two-colour LAND on m15 wears no pair (twoColorFits): the gold notch.
    expect(resolveHoloStamp(m15, { stamp: "oval", twoColor: true }, facts({ ...pair, cost: null, cardType: "land" }))?.notch.key).toBe("m");
    // The slot publishes exactly the nine bars and the ten pairs.
    expect([...M15_HOLO_STAMP.keys]).toEqual(["w", "u", "b", "r", "g", "m", "a", "l", "c", ...TWO_COLOR_PAIRS]);
    expect(resolveHoloStamp(m15, { stamp: "oval" }, facts({ colors: ["white", "blue", "black"], cost: "{W}{U}{B}", colorKey: "m" }))?.notch.key).toBe("m");
    // The walker: its own oval, 7 px higher, and keep-out.
    const walker = resolveHoloStamp(getFrameProfile("m15pw"), { stamp: "auto" }, facts({ cardType: "planeswalker", rarity: "mythic", colorKey: "w", colors: ["white"] }))!;
    expect(walker).toMatchObject({ oval: M15PW_HOLO_STAMP_OVAL, keepOut: M15PW_HOLO_STAMP_KEEP_OUT });
    expect(walker.notch.path).toBe("/frames/m15pwholostamp/w.png");
  });

  it("the crown's and the stamp's overlays draw together, in the slot order, each under its own rule", () => {
    const both = resolveFrameOverlays(m15, { crown: true, stamp: "auto" }, facts({ supertype: "Legendary", rarity: "rare", colorKey: "b" }));
    expect(both.map((o) => [o.anatomy, o.key])).toEqual([
      ["crown", "b"],
      ["holoStamp", "b"],
    ]);
    // A Legendary common: the crown alone; a non-legendary rare: the stamp alone.
    expect(resolveFrameOverlays(m15, { crown: true, stamp: "auto" }, facts({ supertype: "Legendary", rarity: "common" })).map((o) => o.anatomy)).toEqual(["crown"]);
    expect(resolveFrameOverlays(m15, { crown: true, stamp: "auto" }, facts({ rarity: "rare" })).map((o) => o.anatomy)).toEqual(["holoStamp"]);
  });
});

describe("the owner rule through the plumbing", () => {
  it("a new card starts on auto where the frame has the notch; the save drops the key elsewhere", () => {
    expect(anatomyDefaults("m15").stamp).toBe("auto");
    expect(anatomyDefaults("m15pw").stamp).toBe("auto");
    expect(anatomyDefaults("m15token")).not.toHaveProperty("stamp");
    expect(anatomyDefaults("emblem")).not.toHaveProperty("stamp");
    expect(anatomyDefaults("m15borderless")).not.toHaveProperty("stamp");
    expect(newCardFrameStyle({ template: "m15" } as FrameStyle, "creature").stamp).toBe("auto");
    expect(newCardFrameStyle({ template: "m15", stamp: "none" } as FrameStyle, "creature").stamp).toBe("none");
    expect(newCardFrameStyle({ template: "m15", stamp: "triangle" } as FrameStyle, "creature").stamp).toBe("triangle");
    for (const template of ["m15token", "emblem", "m15borderless", "saga", "lotr"] as const) {
      expect(normalizeAnatomy({ template, stamp: "oval" } as FrameStyle, template, "creature"), template).toEqual({ template });
      expect(newCardFrameStyle({ template, stamp: "auto" } as FrameStyle, "creature"), template).not.toHaveProperty("stamp");
    }
    // A stored card that names no key stays the same object.
    const untouched: FrameStyle = { template: "m15", finish: "regular" };
    expect(normalizeAnatomy(untouched, "m15", "creature")).toBe(untouched);
  });

  it("a remix keeps the parent's explicit value; a key-less parent's remix starts on auto", () => {
    expect(storedAnatomyOf({ template: "m15", stamp: "none" })).toEqual({ stamp: "none" });
    expect(storedAnatomyOf({ template: "m15", stamp: "oval" })).toEqual({ stamp: "oval" });
    expect(storedAnatomyOf({ template: "m15" })).toEqual({});
    expect(storedAnatomyOf({ stamp: "acorn" })).toEqual({});
    expect(storedAnatomyOf({ stamp: true })).toEqual({});
  });

  it("an edit's patch merges the switch over the stored style and normalises it to the stored template", () => {
    const stored = { frameStyle: { template: "m15", finish: "foil", collector: "2023" }, colorIdentity: ["red"] as const, cardType: "creature" };
    expect(applyFrameAnatomyPatch(stored, { stamp: "none" })).toEqual({ ok: true, frameStyle: { ...stored.frameStyle, stamp: "none" }, colorIdentity: null });
    expect(applyFrameAnatomyPatch(stored, { stamp: "auto" })).toEqual({ ok: true, frameStyle: { ...stored.frameStyle, stamp: "auto" }, colorIdentity: null });
    // On a frame without the notch the key is dropped, whatever the patch.
    const borderless = { ...stored, frameStyle: { template: "m15borderless" } };
    expect(applyFrameAnatomyPatch(borderless, { stamp: "oval" })).toEqual({ ok: true, frameStyle: { template: "m15borderless" }, colorIdentity: null });
    // A patch that names no stamp leaves a stored one alone.
    const stamped = { ...stored, frameStyle: { template: "m15", stamp: "oval" } };
    expect(applyFrameAnatomyPatch(stamped, { crown: true })).toEqual({ ok: true, frameStyle: { template: "m15", stamp: "oval", crown: true }, colorIdentity: null });
  });

  it("imports follow the printing: oval, triangle or none — always named, never auto", () => {
    expect(importedAnatomy({ printed_stamp: "oval" }, "m15").style).toEqual({ stamp: "oval" });
    expect(importedAnatomy({ printed_stamp: "triangle" }, "m15").style).toEqual({ stamp: "triangle" });
    expect(importedAnatomy({ printed_stamp: "none" }, "m15").style).toEqual({ stamp: "none" });
    expect(importedAnatomy({}, "m15").style).toEqual({});
    expect(importedFormAnatomy({ stamp: "none" }).stamp).toBe("none");
    expect(importedFormAnatomy({}).stamp).toBe("auto");
    // Dropped at the save where the landed frame has no notch (a stamped
    // SLD token on a token frame, a UB emblem).
    expect(newCardFrameStyle({ template: "m15token", ...importedAnatomy({ printed_stamp: "oval" }, "m15token").style }, "token")).not.toHaveProperty("stamp");
    expect(newCardFrameStyle({ template: "emblem", ...importedAnatomy({ printed_stamp: "triangle" }, "emblem").style }, "emblem")).not.toHaveProperty("stamp");
  });

  it("the schemas take the four values and nothing else", () => {
    for (const stamp of HOLO_STAMP_SWITCH_VALUES) {
      expect(frameStyleSchema.parse({ template: "m15", stamp })).toEqual({ template: "m15", stamp });
      expect(frameAnatomyPatchSchema.parse({ stamp })).toEqual({ stamp });
    }
    for (const bad of [true, false, 1, "acorn", "Oval", "", null, { shape: "oval" }, ["oval"]]) {
      expect(() => frameStyleSchema.parse({ template: "m15", stamp: bad }), JSON.stringify(bad)).toThrow();
      expect(() => frameAnatomyPatchSchema.parse({ stamp: bad }), JSON.stringify(bad)).toThrow();
    }
  });
});
