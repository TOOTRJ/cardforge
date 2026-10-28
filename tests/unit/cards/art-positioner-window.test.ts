import { describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { frameMasterKey } from "@/components/cards/frame-layer";
import {
  LEGACY_POSITIONER_ASPECT,
  POSITIONER_MAX_HEIGHT_PX,
  artPositionerWindows,
  artPrintPpi,
  backFaceArtWindow,
  faceArtWindow,
  focalTravel,
  positionerSurfaceStyle,
  recommendedArtSize,
  secondFaceArtWindow,
} from "@/lib/cards/art-positioner-window";
import { artWindowPlacement } from "@/lib/cards/foil-finish";
import { resolveFrameProfile } from "@/lib/cards/profile-override";
import { artLayersFor } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES, type CardType, type ColorIdentity, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// The art positioner's surface is the card's art window (TODO 3b.13).
//
// WINDOWS below is the table: every template's art box on the HD card
// (1500 × 2100, landscape 2100 × 1500), as [width, height] px — the box both
// renderers crop the art to. A template that is not listed fails the test,
// and so does one whose window moved: whoever adds or re-cuts a frame looks
// at what the positioner will show for it. `second` is an inline second
// face's own window (in its UNTURNED box); `masters` lists a master whose
// window differs from the template's (a see-through master's own slot).
// ---------------------------------------------------------------------------

type Row = {
  front: [number, number];
  second?: { size: [number, number]; rotation: number };
  masters?: Record<string, [number, number]>;
};

const M15_WINDOW: [number, number] = [1271, 931];
const DFC_WINDOW: [number, number] = [1272, 932];
const M20_TOKEN: [number, number] = [1383, 1882];
const BORDERLESS: [number, number] = [1500, 1937];

const WINDOWS: Record<FrameTemplate, Row> = {
  m15: { front: M15_WINDOW },
  m15land: { front: M15_WINDOW },
  // The arch tokens on their windows (TODO 4.53 (e), v59): the see-through
  // c and the coloured artifact dresses 4 px wider each side.
  m15token: { front: [1272, 1446], masters: { c: [1280, 1454] } },
  m15artifact: { front: M15_WINDOW },
  m15vehicle: { front: M15_WINDOW },
  m15nyx: { front: M15_WINDOW },
  // The station frame (TODO 4.27a): ONE picture under the whole frame.
  m15station: { front: [1392, 1959] },
  m15stationland: { front: [1392, 1959] },
  // The Spacecraft's dresses (TODO 4.27a step 2): one picture under the
  // whole frame — from the border's inner edge to the card's sides on
  // extended art; the borderless frame's own window.
  extendedartstation: { front: [1500, 1959] },
  m15borderlessstation: { front: BORDERLESS },
  m15ub: { front: M15_WINDOW },
  m15ubartifact: { front: M15_WINDOW },
  m15ubland: { front: M15_WINDOW },
  m15snow: { front: M15_WINDOW },
  m15snowland: { front: M15_WINDOW },
  m15devoid: { front: M15_WINDOW },
  // The colourless walker is ONE picture under the whole frame (v35).
  m15pw: { front: [1296, 1716], masters: { c: [1389, 1959] } },
  m15tokenartifact: { front: [1280, 1454] },
  m15tokentext: { front: [1272, 1146], masters: { c: [1280, 1154] } },
  m15tokenartifacttext: { front: [1280, 1154] },
  // The tall box (TODO 4.55): the text box's window, 238 px shorter.
  m15tokentall: { front: [1272, 908], masters: { c: [1280, 916] } },
  m15tokenartifacttall: { front: [1280, 916] },
  emblem: { front: [1216, 1163] },
  m20token: { front: M20_TOKEN },
  m20tokentext: { front: M20_TOKEN },
  m20tokentall: { front: M20_TOKEN },
  m20tokenartifact: { front: M20_TOKEN },
  m20tokenartifacttext: { front: M20_TOKEN },
  m20tokenartifacttall: { front: M20_TOKEN },
  m20tokennyx: { front: M20_TOKEN },
  m20tokennyxtext: { front: M20_TOKEN },
  m20tokennyxtall: { front: M20_TOKEN },
  m20tokenartifactnyx: { front: M20_TOKEN },
  m20tokenartifactnyxtext: { front: M20_TOKEN },
  m20tokenartifactnyxtall: { front: M20_TOKEN },
  m15borderless: { front: BORDERLESS },
  m15borderlessartifact: { front: BORDERLESS },
  m15borderlessland: { front: BORDERLESS },
  m15borderlesspw: { front: [1500, 1922] },
  m15borderlesspwtall: { front: [1500, 1922] },
  m15dfcfront: { front: DFC_WINDOW },
  m15dfcback: { front: DFC_WINDOW },
  m15dfcbackleft: { front: DFC_WINDOW },
  m15dfclandfront: { front: DFC_WINDOW },
  m15dfclandback: { front: DFC_WINDOW },
  m15mdfcfront: { front: DFC_WINDOW },
  m15mdfcback: { front: DFC_WINDOW },
  m15borderlessdfcfront: { front: BORDERLESS },
  m15borderlessdfcback: { front: BORDERLESS },
  m15borderlessmdfcfront: { front: BORDERLESS },
  m15borderlessmdfcback: { front: BORDERLESS },
  m15mdfclandfront: { front: DFC_WINDOW },
  m15mdfclandback: { front: DFC_WINDOW },
  agclassic: { front: [1154, 930] },
  alphaland: { front: [1154, 930] },
  // Landscape canvas (2100 × 1500).
  battle: { front: [1877, 1381] },
  saga: { front: [636, 1526] },
  // The double-faced saga front (TODO 5.5 (b)): the saga's window.
  sagadfcfront: { front: [636, 1526] },
  sagadfcback: { front: [636, 1526] },
  adventure: { front: [1273, 933] },
  // The Prepare frame (TODO 4.27): M15's window (its masters are M15's above the type bar).
  prepare: { front: M15_WINDOW },
  flip: { front: [1273, 691] },
  // Landscape canvas; the right half has its own window.
  split: { front: [817, 559], second: { size: [816, 559], rotation: 0 } },
  // The bottom half is drawn in this box and turned a quarter turn.
  aftermath: { front: [1273, 471], second: { size: [741, 427], rotation: 90 } },
  // Card Conjurer's ring window (TODO 4.11, layout v65): the pack's artBounds.
  lotr: { front: [1202, 918] },
  // Card Conjurer's scroll window (TODO 4.11, layout v62).
  lotrscroll: { front: [1280, 941] },
  // The Enchanting Tales showcase (TODO 4.11 wave 2): CC's artBounds, the
  // art under the whole frame from the title bar to the text box's foot.
  enchantingtales: { front: [1500, 1821] },
  avatar: { front: [1500, 1168] },
  bloomburrow: { front: [1500, 954] },
  bloomanime: { front: [1500, 2100] },
  // The Tarkir: Dragonstorm showcases (TODO 4.11, layout v68): the
  // draconic's window and the dragons' gaps; the ghostfire's inside its
  // painted ring.
  tarkirdraconic: { front: [1390, 944] },
  tarkirghostfire: { front: [1344, 1806] },
  // Card Conjurer's Tarkir window (TODO 4.11, layout v67): its shadow + 0.05 %.
  tarkirdragon: { front: [1237, 929] },
  // The MKM dossier showcase (TODO 4.11 wave 2): the tilted photo's
  // half-transparent rim covered with the art-window check's spare.
  dossier: { front: [1319, 859] },
  // The Doctor Who TARDIS showcase (TODO 4.11 wave 2): the police box's
  // window covered with the art-window check's spare.
  tardis: { front: [1273, 902] },
  fullart: { front: [1383, 1819] },
  // The D&D Sourcebook showcase (TODO 4.11 wave 2): the window's torn,
  // half-transparent edges covered with the art-window check's spare.
  dndsourcebook: { front: [1349, 957] },
  // The extended-art frame (layout v58): CC's window to the side edges;
  // its see-through colourless master is ONE picture under the frame.
  extendedart: { front: [1500, 1142], masters: { c: [1500, 1959] } },
  extendedartland: { front: [1500, 1142] },
  m15fullartland: { front: [1382, 1875] },
  fullartland: { front: [1500, 2100] },
  // The older full-art basics (TODO 4.40 / 4.41): the stone ring's window,
  // the art under SNC's ring, the plain bar's art to the black ring.
  m15fullartlandzen: { front: [1278, 1520] },
  m15fullartlandsnc: { front: [1382, 1880] },
  m15fullartlandthb: { front: [1382, 1876] },
  m15textless: { front: [1314, 1816] },
  m15textlessland: { front: [1314, 1816] },
  // The Expeditions (TODO 4.11 wave 1, layout v64): CC's window + the
  // translucent rules panel under the same picture, both looks.
  expeditionland: { front: [1382, 1500] },
  expeditionlandbfz: { front: [1276, 1471] },
  nyx: { front: [1320, 1718] },
  retro: { front: [1154, 931] },
  retroland: { front: [1154, 931] },
  modern: { front: [1245, 917] },
  modernland: { front: [1245, 917] },
};

const COLOURS: ColorIdentity[][] = [[], ["white"], ["blue"], ["black"], ["red"], ["green"], ["white", "blue"]];
const TYPES: CardType[] = ["creature", "artifact", "land", "planeswalker", "token"];

function cardOn(template: FrameTemplate, more: Partial<CardPreviewData> = {}): CardPreviewData {
  return { frameStyle: { template }, colorIdentity: [], cardType: "creature", ...more };
}

const size = (w: { width: number; height: number }): [number, number] => [Math.round(w.width), Math.round(w.height)];

describe("the art window per template", () => {
  it("lists every template", () => {
    expect(Object.keys(WINDOWS).sort()).toEqual([...FRAME_TEMPLATE_VALUES].sort());
  });

  it.each(FRAME_TEMPLATE_VALUES.map((t) => [t] as const))("%s: the positioner's window is the table's, for every colour and type", (template) => {
    const row = WINDOWS[template];
    for (const colorIdentity of COLOURS) {
      for (const cardType of TYPES) {
        const window = faceArtWindow(cardOn(template, { colorIdentity, cardType }));
        expect(size(window), `${template} ${window.masterKey}`).toEqual(row.masters?.[window.masterKey] ?? row.front);
        expect(window.aspect).toBeCloseTo(window.width / window.height, 12);
        expect(window.rotation).toBe(0);
      }
    }
    const second = secondFaceArtWindow(cardOn(template));
    expect(second ? { size: size(second), rotation: second.rotation } : undefined).toEqual(row.second);
  });

  it.each(FRAME_TEMPLATE_VALUES.map((t) => [t] as const))("%s: it is the box both renderers draw the art in", (template) => {
    // The renderers' own resolution, repeated here: the profile, the master
    // the card paints, and artLayersFor's slot for a face WITH art.
    for (const colorIdentity of COLOURS) {
      for (const cardType of TYPES) {
        const card = cardOn(template, { colorIdentity, cardType });
        const profile = resolveFrameProfile(template, null);
        const masterKey = frameMasterKey(profile, colorIdentity, card, card.frameStyle);
        const window = faceArtWindow(card);
        expect(window.masterKey).toBe(masterKey);
        expect(window.rect).toEqual(artLayersFor(profile, masterKey, true).slot);
      }
    }
    const profile = resolveFrameProfile(template, null);
    expect(secondFaceArtWindow(cardOn(template))?.rect).toEqual(profile.secondFace?.artSlot);
  });

  it("the surface's CSS box has the window's aspect for every template", () => {
    for (const template of FRAME_TEMPLATE_VALUES) {
      const window = faceArtWindow(cardOn(template));
      const style = positionerSurfaceStyle(window.aspect);
      const [w, h] = style.aspectRatio.split(" / ").map(Number);
      expect(w / h, template).toBeCloseTo(window.aspect, 3);
      // Never taller than the cap: the width is the cap's width or the column.
      expect(style.width).toBe(`min(100%, ${Math.round(POSITIONER_MAX_HEIGHT_PX * window.aspect)}px)`);
    }
  });
});

describe("what the fixed 5:4 surface got wrong (before 3b.13)", () => {
  /** How much of the old surface's crop the card never showed (or the
   *  reverse): 0 for the same aspect, → 1 as they part. */
  const mismatch = (aspect: number) => 1 - Math.min(aspect, LEGACY_POSITIONER_ASPECT) / Math.max(aspect, LEGACY_POSITIONER_ASPECT);
  const front = (t: FrameTemplate) => faceArtWindow(cardOn(t)).aspect;

  it("one example per failure class", () => {
    // A classic window: mild (the surface was a little too tall).
    expect(front("m15")).toBeCloseTo(1.3657, 3);
    expect(mismatch(front("m15"))).toBeCloseTo(0.085, 2);
    // A tall side window: the surface showed three times the width.
    expect(front("saga")).toBeCloseTo(0.4167, 3);
    expect(mismatch(front("saga"))).toBeCloseTo(0.667, 2);
    // Art to the card's edge (borderless, full art, full-art tokens).
    expect(front("m15borderless")).toBeCloseTo(0.7744, 3);
    expect(front("m20token")).toBeCloseTo(0.735, 3);
    expect(front("fullartland")).toBeCloseTo(5 / 7, 6);
    expect(mismatch(front("m20token"))).toBeCloseTo(0.412, 2);
    // A walker, and its see-through colourless master's one picture.
    expect(faceArtWindow(cardOn("m15pw", { colorIdentity: ["white"] })).aspect).toBeCloseTo(0.7554, 3);
    expect(faceArtWindow(cardOn("m15pw", { colorIdentity: [] })).aspect).toBeCloseTo(0.7089, 3);
    // A flat half: the surface showed twice the height.
    expect(front("aftermath")).toBeCloseTo(2.7015, 3);
    expect(mismatch(front("aftermath"))).toBeCloseTo(0.537, 2);
    // A second face's own window (the same fixed surface served it).
    expect(secondFaceArtWindow(cardOn("aftermath"))!.aspect).toBeCloseTo(1.736, 3);
    expect(secondFaceArtWindow(cardOn("split"))!.aspect).toBeCloseTo(1.46, 2);
    // Landscape.
    expect(front("battle")).toBeCloseTo(1.3598, 3);
  });

  it("no template's window was 5:4, and 33 were more than a quarter off", () => {
    const off = FRAME_TEMPLATE_VALUES.map((t) => mismatch(front(t)));
    expect(off.filter((m) => m < 0.005)).toHaveLength(0);
    // (25 before the station frame, TODO 4.27a: its two templates' one
    // picture under the whole frame is far taller than 5:4; 27 before the
    // extended-art frame's see-through colourless master, layout v58; 28
    // before the older full-art basics, TODO 4.40 / 4.41: three tall windows more; 31 before the Spacecraft's
    // extended-art and borderless dresses, 4.27a step 2; 33 before the
    // borderless double-faced bodies, TODO 5.7: four full-bleed windows; 37
    // before the double-faced saga front, 5.5 (b): the saga's tall column; 38
    // before its back, 5.5 (b) PR 2: the same column; 39 before the full-art
    // token's Nyx dress, TODO 4.51: six more full-art token windows; 45
    // before the Expeditions' window + panel, TODO 4.11 wave 1: the 2020
    // look's 1382 × 1500 and the new 2015 look's 1276 × 1471; 47 before the
    // Enchanting Tales showcase, TODO 4.11 wave 2: the art under its whole
    // frame, 1500 × 1821.)
    expect(off.filter((m) => m > 0.25)).toHaveLength(48);
  });
});

describe("faces", () => {
  it("a card with no second window and no back body has only the front", () => {
    const windows = artPositionerWindows(cardOn("m15"));
    expect(windows.second).toBeNull();
    expect(windows.back).toBeNull();
    expect(windows.front.template).toBe("m15");
  });

  it("flip and adventure share the front's window (no second one)", () => {
    expect(secondFaceArtWindow(cardOn("flip"))).toBeNull();
    expect(secondFaceArtWindow(cardOn("adventure"))).toBeNull();
  });

  it("a double-faced back reads its own body and colour", () => {
    const card = cardOn("m15dfcfront", {
      colorIdentity: ["green"],
      backFace: { title: "Back", frame_style: { template: "m15dfcback" }, color_identity: ["red"] },
    });
    const back = backFaceArtWindow(card);
    expect(back?.template).toBe("m15dfcback");
    expect(back?.masterKey).toBe("r");
    expect(size(back!)).toEqual(DFC_WINDOW);
  });

  it("a legacy back (no body) has no window of its own — it draws on the front's frame", () => {
    const card = cardOn("m15", { backFace: { title: "Back" } });
    expect(backFaceArtWindow(card)).toBeNull();
    // A body stored on a card whose front is not a DFC front is ignored, as
    // the renderers ignore it (backBodyOf).
    expect(backFaceArtWindow(cardOn("m15", { backFace: { title: "B", frame_style: { template: "m15dfcback" } } }))).toBeNull();
  });

  it("follows a frame-compare override of the art slot, on both faces", () => {
    const profileOverrides = {
      m15: { artSlot: { widthPct: 50 } },
      split: { secondFace: { artSlot: { heightPct: 20 } } },
    };
    const m15 = faceArtWindow(cardOn("m15", { profileOverrides }));
    expect(Math.round(m15.width)).toBe(750);
    expect(Math.round(m15.height)).toBe(M15_WINDOW[1]);
    const split = secondFaceArtWindow(cardOn("split", { profileOverrides }))!;
    expect(Math.round(split.height)).toBe(300);
  });

  it("a retired or unknown template falls back as the renderers do", () => {
    expect(faceArtWindow({ frameStyle: { template: "nope" as FrameTemplate } }).template).toBe("m15");
    expect(faceArtWindow({}).template).toBe("m15");
  });
});

describe("the surface", () => {
  it("is as wide as the column for a wide window and height-capped for a tall one", () => {
    expect(positionerSurfaceStyle(2, 400)).toEqual({ aspectRatio: "2 / 1", width: "min(100%, 800px)" });
    expect(positionerSurfaceStyle(0.5, 400)).toEqual({ aspectRatio: "0.5 / 1", width: "min(100%, 200px)" });
  });

  it("never divides by a broken aspect", () => {
    expect(positionerSurfaceStyle(0).aspectRatio).toBe("1.25 / 1");
    expect(positionerSurfaceStyle(Number.NaN).aspectRatio).toBe("1.25 / 1");
  });

  it("names the picture size that fills the window at HD", () => {
    expect(recommendedArtSize(faceArtWindow(cardOn("m15")))).toEqual({ width: 1271, height: 931 });
    expect(recommendedArtSize(faceArtWindow(cardOn("saga")))).toEqual({ width: 636, height: 1526 });
  });
});

describe("focalTravel — the drag follows the renderers' placement", () => {
  const natural = { width: 1600, height: 1200 };
  const boxes = [
    { width: 400, height: 293 }, // m15
    { width: 183, height: 440 }, // saga
    { width: 500, height: 185 }, // aftermath
  ];

  it.each([0.5, 0.8, 1, 1.4, 3, 4])("zoom %s: one unit of focal moves the drawn picture by exactly the travel", (scale) => {
    for (const box of boxes) {
      const travel = focalTravel(box, natural, scale);
      // artWindowPlacement is the placement the bake and the foil mask draw
      // from (lib/cards/foil-finish.tsx): where the whole picture lands.
      const at = (fx: number, fy: number) => artWindowPlacement({ x: 0, y: 0, ...box }, natural, fx, fy, scale).image;
      const a = at(0.2, 0.3);
      const b = at(0.7, 0.9);
      const moved = { x: (b.x - a.x) / 0.5, y: (b.y - a.y) / 0.6 };
      expect(travel.x).toBeCloseTo(Math.abs(moved.x) < 0.5 ? 0 : moved.x, 6);
      expect(travel.y).toBeCloseTo(Math.abs(moved.y) < 0.5 ? 0 : moved.y, 6);
    }
  });

  it("is negative for a picture larger than its window, positive when zoomed out smaller, 0 when it spans it", () => {
    const box = { width: 400, height: 300 }; // the picture's own aspect
    expect(focalTravel(box, natural, 2)).toEqual({ x: -400, y: -300 });
    expect(focalTravel(box, natural, 0.5)).toEqual({ x: 200, y: 150 });
    expect(focalTravel(box, natural, 1)).toEqual({ x: 0, y: 0 });
  });

  it("an unknown picture size moves nothing", () => {
    expect(focalTravel({ width: 400, height: 300 }, { width: 0, height: 0 }, 1)).toEqual({ x: 0, y: 0 });
  });
});

describe("artPrintPpi — how sharp a picture prints in its window", () => {
  it("600 for a picture the size of the window, less as it is stretched or zoomed", () => {
    const m15 = faceArtWindow(cardOn("m15"));
    expect(artPrintPpi(m15, { width: m15.width, height: m15.height }, 1)).toBe(600);
    expect(artPrintPpi(m15, { width: m15.width, height: m15.height }, 2)).toBe(300);
    expect(artPrintPpi(m15, { width: m15.width * 2, height: m15.height * 2 }, 1)).toBe(1200);
  });

  it("1.18's case: Scryfall's 626 × 457 crop is sharp on M15's window and soft on the borderless one", () => {
    const crop = { width: 626, height: 457 };
    expect(artPrintPpi(faceArtWindow(cardOn("m15")), crop, 1)).toBe(295);
    // 1937 / 457 = 4.24× (the item's own number).
    expect(artPrintPpi(faceArtWindow(cardOn("m15borderless")), crop, 1)).toBe(142);
  });

  it("null until the picture's size is known", () => {
    expect(artPrintPpi(faceArtWindow(cardOn("m15")), null, 1)).toBeNull();
    expect(artPrintPpi(faceArtWindow(cardOn("m15")), { width: 0, height: 10 }, 1)).toBeNull();
  });
});
