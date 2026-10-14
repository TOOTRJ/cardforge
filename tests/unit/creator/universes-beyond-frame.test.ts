import { describe, expect, it } from "vitest";
import printingsData from "./fixtures/universes-beyond-printings.json";
import { anatomyDefaults, frameAnatomyOf, resolveHoloStamp } from "@/lib/cards/anatomy";
import { frameComboKey, FRAME_COLOR_KEYS, TWO_COLOR_PAIRS } from "@/lib/cards/frame-reference-registry";
import {
  HOLO_STAMP_ART_MARGIN_PX,
  HOLO_STAMP_CUT_MARGIN_PX,
  M15UB_HOLO_STAMP_BOX,
  M15UB_HOLO_STAMP_KEEP_OUT,
  UB_STAMP_FACE,
  UB_STAMP_HOLE,
  holoStampArtRect,
  roundTriangleBounds,
  roundTriangleDistance,
} from "@/lib/cards/holo-stamp";
import { HOLO_STAMP_OVAL_ART, HOLO_STAMP_TRIANGLE_ART, HOLO_STAMP_TRIANGLE_MATTE_ART, holoStampArtOf } from "@/lib/cards/holo-stamp-art";
import { TRIANGLE_STAMP_HELP, holoStampAnswer, holoStampChipOptions } from "@/components/creator/panels/collector-panel";
import { M15_FAMILY_TEMPLATES } from "@/lib/cards/m15-family";
import { PLATE_INK } from "@/lib/cards/plate-ink";
import { M15UB_HOLO_STAMP, M15_COLLECTOR, M15_CROWN, M15_HOLO_STAMP, UB_CROWN, getFrameProfile } from "@/lib/cards/template-layout";
import { CARD_KIND_VALUES, borrowedFrameFits, framesForKind, isSubtypeDress, templateRefusesKind, templateSupportsKind } from "@/lib/creator/card-kinds";
import { finalizeImportMatch, withVerification } from "@/lib/creator/frame-resolve";
import { scryfallRemixMechanics } from "@/lib/ai/remix-mechanics";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { FRAME_SIGNATURE_KEYS, signatureDrawnOn } from "@/lib/scryfall/frame-signatures";
import { frameMatchFromScryfall, mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { ERA_TYPE_FRAME, FRAME_TEMPLATE_LABELS, FRAME_TEMPLATE_SET, FRAME_TEMPLATE_VALUES, TEMPLATE_SKIN_VARIANTS, type FrameTemplate } from "@/types/card";
import {
  CC_OVERLAY_BANDS,
  CC_SOURCE_TONES,
  CC_TEMPLATES,
  CROWN_BAND,
  UB_PRINT_TONES,
  checkSourceTone,
  describeSourceTones,
  sourceToneGain,
  sourceTonesOf,
  toneSourceRegions,
  HOLO_STAMP_NOTCHES,
  NOTCH_FOOT,
  UB_CROWN_BAND,
  UB_CROWN_BAND_KEYS,
  UB_NOTCH_BOX,
  crownBandRecipe,
  crownBandSourceFiles,
  cutInside,
  notchCutOf,
  snapResampledPiece,
  ubFrameFile,
} from "@/scripts/lib/cc-frames.mjs";

// ---------------------------------------------------------------------------
// TODO 4.25 — the Universes Beyond frames (`m15ub`, `m15ubartifact`,
// `m15ubland`; owner 2026-10-13, roadmap Q5): three frames of their own on
// M15's geometry, reached by a pick or an import only. Additions: no new
// card starts on them, no stored card moves, an import names them only once
// they are verified in the card's colour.
// ---------------------------------------------------------------------------

const UB = ["m15ub", "m15ubartifact", "m15ubland"] as const satisfies readonly FrameTemplate[];
const TWIN: Record<(typeof UB)[number], FrameTemplate> = { m15ub: "m15", m15ubartifact: "m15artifact", m15ubland: "m15land" };
const printings = printingsData as Record<string, unknown>;
const printing = (key: string) => {
  if (!printings[key]) throw new Error(`no captured printing ${key}`);
  return scryfallCardSchema.parse(printings[key]);
};
const keys = (...pairs: Array<[string, string]>) => new Set(pairs.map(([t, c]) => frameComboKey(t as never, c)));
const EVERY = new Set(FRAME_TEMPLATE_VALUES.flatMap((t) => FRAME_COLOR_KEYS.map((k) => frameComboKey(t, k))));
const NO_UB = new Set([...EVERY].filter((key) => !UB.some((t) => key.startsWith(`${t}/`))));

describe("three templates of their own", () => {
  it("are registered in the M15 set as skins of the M15 standard, the artifact frame and the land frame — never an era standard", () => {
    for (const t of UB) {
      expect(FRAME_TEMPLATE_VALUES).toContain(t);
      expect(FRAME_TEMPLATE_SET[t]).toBe("m15");
      expect(M15_FAMILY_TEMPLATES).toContain(t);
      expect(isSubtypeDress(t)).toBe(false);
      // No era's standard for any card type: a NEW card never starts on one.
      for (const era of Object.values(ERA_TYPE_FRAME)) expect(Object.values(era as Record<string, string>)).not.toContain(t);
    }
    expect(FRAME_TEMPLATE_LABELS.m15ub).toBe("Universes Beyond");
    expect(FRAME_TEMPLATE_LABELS.m15ubartifact).toBe("Universes Beyond Artifact");
    expect(FRAME_TEMPLATE_LABELS.m15ubland).toBe("Universes Beyond Land");
    expect(TEMPLATE_SKIN_VARIANTS.m15).toContain("m15ub");
    expect(TEMPLATE_SKIN_VARIANTS.m15artifact).toContain("m15ubartifact");
    expect(TEMPLATE_SKIN_VARIANTS.m15land).toContain("m15ubland");
  });

  it("dress the kinds their M15 twins dress and no other: a look any card of the kind may pick", () => {
    for (const kind of CARD_KIND_VALUES) {
      expect(templateSupportsKind("m15ub", kind), `m15ub/${kind}`).toBe(["creature", "instant", "sorcery", "enchantment"].includes(kind));
      expect(templateSupportsKind("m15ubartifact", kind), `m15ubartifact/${kind}`).toBe(["artifact", "creature"].includes(kind));
      expect(templateSupportsKind("m15ubland", kind), `m15ubland/${kind}`).toBe(kind === "land");
      for (const t of UB) expect(templateRefusesKind(t, kind), `${t}/${kind}`).toBe(!templateSupportsKind(t, kind));
    }
    // An Artifact Creature borrows the artifact frame, as it borrows m15artifact (1.7).
    expect(borrowedFrameFits("creature", "m15ubartifact", { cardType: "creature", supertype: "Artifact" })).toBe(true);
    expect(borrowedFrameFits("creature", "m15ubartifact", { cardType: "creature", supertype: null })).toBe(false);
    expect(borrowedFrameFits("creature", "m15artifact", { cardType: "creature", supertype: null })).toBe(false);
  });

  it("are offered under Variations only where they are verified in the colour, after the kind's other skins", () => {
    const skins = (kind: Parameters<typeof framesForKind>[0], verified: ReadonlySet<string>) =>
      framesForKind(kind, verified)
        .filter((f) => f.group === "skin")
        .map((f) => f.template);
    expect(skins("instant", EVERY).at(-1)).toBe("m15ub");
    expect(skins("land", EVERY).at(-1)).toBe("m15ubland");
    // …the last of the standard's OWN skins: the dress another type lends
    // (the Nyx dress an Enchantment Artifact borrows, the Enchantment kind's
    // own — TODO 4.7) is listed after them.
    expect(skins("artifact", EVERY).slice(-2)).toEqual(["m15ubartifact", "m15nyx"]);
    expect(skins("enchantment", EVERY).slice(-2)).toEqual(["m15ub", "m15nyx"]);
    const verifiedInRed = framesForKind("instant", keys(["m15", "r"], ["m15ub", "r"])).find((f) => f.template === "m15ub");
    expect(verifiedInRed?.availableColorKeys).toEqual(["r"]);
  });
});

describe("the profiles", () => {
  it("are their M15 twins' slots, sizes and pieces with the Universes Beyond masters, plates, crown band and triangle notch", () => {
    for (const t of UB) {
      const { label, pt, overlays, underFrameArt, ...rest } = getFrameProfile(t);
      const { label: twinLabel, pt: twinPt, overlays: twinOverlays, underFrameArt: twinUnder, ...twinRest } = getFrameProfile(TWIN[t]);
      expect(rest, t).toEqual(twinRest);
      expect(label).not.toBe(twinLabel);
      // The plates are the UB pack's own, at the twin's box and ink.
      expect(pt, t).toEqual({ ...twinPt, plateAssetPathTemplate: t === "m15ubartifact" ? "/frames/m15ubartifact/pt/{color}.png" : "/frames/m15ub/pt/{color}.png" });
      // The crown and the stamp ride the twin's key map, on the UB pieces.
      const map = t === "m15ubland" ? { c: "l" } : { c: "a" };
      expect(overlays, t).toEqual([
        { ...UB_CROWN, keyMap: map },
        { ...M15UB_HOLO_STAMP, keyMap: map },
      ]);
      expect(twinOverlays?.map((o) => o.anatomy)).toEqual(["crown", "holoStamp"]);
      // The colourless master is the pack's opaque artifact frame: no art under it.
      expect(underFrameArt, t).toBeUndefined();
      expect(twinUnder === undefined).toBe(t !== "m15ub");
      expect(getFrameProfile(t).collector).toEqual(M15_COLLECTOR);
      expect(frameAnatomyOf(t)).toEqual(frameAnatomyOf(TWIN[t]));
      expect(anatomyDefaults(t)).toEqual(anatomyDefaults(TWIN[t]));
      expect(PLATE_INK[pt!.plateAssetPathTemplate!], t).toBeDefined();
    }
    expect(getFrameProfile("m15ub").twoColorMasters).toEqual(["split", "hybrid"]);
    expect(getFrameProfile("m15ubartifact").twoColorMasters).toEqual(["split"]);
    expect(getFrameProfile("m15ubland").twoColorMasters).toEqual(["split"]);
    expect(getFrameProfile("m15ubland").twoColorForLands).toBe(true);
  });

  it("the crown slot is the standard crown's rect on the Universes Beyond band, keyed as the importer builds it", () => {
    expect(UB_CROWN.rect).toEqual(M15_CROWN.rect);
    expect(UB_CROWN.assetPathTemplate).toBe("/frames/m15ubcrown/{key}.png");
    expect([...UB_CROWN.keys]).toEqual([...UB_CROWN_BAND_KEYS]);
    expect(UB_CROWN.keys).not.toContain("c");
  });
});

describe("the triangle stamp", () => {
  const facts = { cardType: "creature", supertype: null, colors: ["red"], colorKey: "r" } as const;

  it("is this frame's shape: every 'on' value draws the triangle; 'auto' stamps EVERY rarity here, matte below a rare (Round 57)", () => {
    const profile = getFrameProfile("m15ub");
    for (const stamp of ["oval", "triangle"] as const) {
      const drawn = resolveHoloStamp(profile, { stamp }, { ...facts, rarity: "common" });
      expect(drawn?.shape, stamp).toBe("triangle");
      expect(drawn?.notch.key).toBe("r");
      expect(drawn?.artRect).toEqual(holoStampArtRect(M15UB_HOLO_STAMP_BOX));
      expect(drawn?.keepOut).toEqual(M15UB_HOLO_STAMP_KEEP_OUT);
    }
    // "auto" is the frame's own print: every rarity carries the triangle —
    // matte grey on a common or uncommon, the hologram on a rare or mythic —
    // and "Always" takes the same tone from the rarity.
    for (const template of ["m15ub", "m15ubartifact", "m15ubland"] as const) {
      const p = getFrameProfile(template);
      const f = { ...facts, cardType: template === "m15ubland" ? "land" : template === "m15ubartifact" ? "artifact" : "creature" };
      for (const stamp of ["auto", "oval", "triangle"] as const) {
        for (const [rarity, tone] of [["common", "matte"], ["uncommon", "matte"], ["rare", "holo"], ["mythic", "holo"], [null, "matte"], ["special", "matte"]] as const) {
          const drawn = resolveHoloStamp(p, { stamp }, { ...f, rarity });
          expect(drawn?.shape, `${template} ${stamp} ${rarity}`).toBe("triangle");
          expect(drawn?.tone, `${template} ${stamp} ${rarity}`).toBe(tone);
          expect(drawn?.keepOut).toEqual(M15UB_HOLO_STAMP_KEEP_OUT);
        }
      }
      // Never a token or an emblem, never "none", never an absent key.
      for (const cardType of ["token", "emblem"]) expect(resolveHoloStamp(p, { stamp: "auto" }, { ...f, cardType, rarity: "common" })).toBeNull();
      expect(resolveHoloStamp(p, { stamp: "none" }, { ...f, rarity: "common" })).toBeNull();
      expect(resolveHoloStamp(p, {}, { ...f, rarity: "common" })).toBeNull();
    }
    // The M15 twin keeps the oval's rule: "auto" is a rare or mythic there.
    expect(resolveHoloStamp(getFrameProfile("m15"), { stamp: "auto" }, { ...facts, rarity: "common" })).toBeNull();
    expect(resolveHoloStamp(getFrameProfile("m15"), { stamp: "auto" }, { ...facts, rarity: "rare" })?.tone).toBe("holo");
    expect(resolveHoloStamp(getFrameProfile("m15"), { stamp: "oval" }, { ...facts, rarity: "common" })?.tone).toBe("holo");
    expect(resolveHoloStamp(profile, { stamp: "none" }, { ...facts, rarity: "mythic" })).toBeNull();
    expect(resolveHoloStamp(profile, {}, { ...facts, rarity: "mythic" })).toBeNull();
    // The M15 twin keeps its oval, whatever the stored word.
    expect(resolveHoloStamp(getFrameProfile("m15"), { stamp: "triangle" }, { ...facts, rarity: "common" })?.shape).toBe("oval");
    expect(M15_HOLO_STAMP.anatomy === "holoStamp" && M15_HOLO_STAMP.stamp.shape).toBe("oval");
    expect(M15UB_HOLO_STAMP.anatomy === "holoStamp" && M15UB_HOLO_STAMP.stamp.shape).toBe("triangle");
  });

  it("the creator's chips write this frame's shape, and the row says triangle", () => {
    expect(holoStampChipOptions("triangle").map((o) => o.value)).toEqual(["auto", "triangle", "none"]);
    expect(holoStampChipOptions("oval").map((o) => o.value)).toEqual(["auto", "oval", "none"]);
    expect(TRIANGLE_STAMP_HELP).toMatch(/triangle/);
    expect(TRIANGLE_STAMP_HELP).not.toMatch(/oval/);
    // The copy says what Auto does on each frame, and the live answer names the tone.
    expect(TRIANGLE_STAMP_HELP).toMatch(/every rarity/);
    expect(TRIANGLE_STAMP_HELP).toMatch(/matte grey on a common or uncommon/);
    expect(holoStampChipOptions("triangle")[0]!.label).toBe("Auto: every rarity");
    expect(holoStampChipOptions("oval")[0]!.label).toBe("Auto: rares & mythics");
    const card = (rarity: string | null) => ({ cardType: "creature", rarity });
    expect(holoStampAnswer("auto", card("common"), "triangle")).toBe("Common → matte grey triangle");
    expect(holoStampAnswer("triangle", card("uncommon"), "triangle")).toBe("Uncommon → matte grey triangle");
    expect(holoStampAnswer("auto", card("rare"), "triangle")).toBe("Rare → silver triangle");
    expect(holoStampAnswer("auto", card("mythic"), "triangle")).toBe("Mythic → silver triangle");
    expect(holoStampAnswer("none", card("mythic"), "triangle")).toBe("Mythic → no stamp");
    expect(holoStampAnswer(undefined, card("common"), "triangle")).toBe("Common → no stamp");
    expect(holoStampAnswer("auto", { cardType: "token", rarity: "common" }, "triangle")).toBe("Common → no stamp");
    expect(holoStampAnswer("auto", card("common"))).toBe("Common → no stamp");
  });

  it("each shape has its own art bitmap, at the art rect's proportions", () => {
    expect(holoStampArtOf("oval")).toBe(HOLO_STAMP_OVAL_ART);
    expect(holoStampArtOf("triangle")).toBe(HOLO_STAMP_TRIANGLE_ART);
    expect(holoStampArtOf("triangle", "holo")).toBe(HOLO_STAMP_TRIANGLE_ART);
    expect(holoStampArtOf("triangle", "matte")).toBe(HOLO_STAMP_TRIANGLE_MATTE_ART);
    // The oval has one face, whatever tone is asked.
    expect(holoStampArtOf("oval", "matte")).toBe(HOLO_STAMP_OVAL_ART);
    expect(HOLO_STAMP_TRIANGLE_MATTE_ART.width).toBe(HOLO_STAMP_TRIANGLE_ART.width);
    expect(HOLO_STAMP_TRIANGLE_MATTE_ART.height).toBe(HOLO_STAMP_TRIANGLE_ART.height);
    expect(HOLO_STAMP_TRIANGLE_MATTE_ART.dataUri).not.toBe(HOLO_STAMP_TRIANGLE_ART.dataUri);
    const art = holoStampArtRect(M15UB_HOLO_STAMP_BOX);
    expect(HOLO_STAMP_TRIANGLE_ART.width).toBe(Math.round((art.widthPct / 100) * 1500 * 2));
    expect(HOLO_STAMP_TRIANGLE_ART.height).toBe(Math.round((art.heightPct / 100) * 2100 * 2));
    expect(HOLO_STAMP_TRIANGLE_ART.dataUri.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("the hole is Card Conjurer's triangle, the face the prints': the face sits inside the hole, the art's black covers the cut", () => {
    expect(M15UB_HOLO_STAMP_BOX).toEqual(roundTriangleBounds(UB_STAMP_HOLE));
    const px = (pct: number, of: number) => (pct / 100) * of;
    // 680.4–818.8 × 1917.9–1999.2 px at HD.
    expect(px(M15UB_HOLO_STAMP_BOX.leftPct, 1500)).toBeCloseTo(680.4, 1);
    expect(px(M15UB_HOLO_STAMP_BOX.topPct, 2100)).toBeCloseTo(1917.9, 1);
    expect(px(M15UB_HOLO_STAMP_BOX.leftPct + M15UB_HOLO_STAMP_BOX.widthPct, 1500)).toBeCloseTo(818.8, 1);
    expect(roundTriangleDistance(UB_STAMP_HOLE, 749.6, 1950)).toBeLessThan(0);
    expect(roundTriangleDistance(UB_STAMP_HOLE, 640, 1950)).toBeGreaterThan(0);
    // Every point of the face is inside the hole (sampled on a 1 px grid).
    for (let y = 1915; y < 2000; y += 1) {
      for (let x = 675; x < 825; x += 1) {
        if (roundTriangleDistance(UB_STAMP_FACE, x, y) <= 0) expect(roundTriangleDistance(UB_STAMP_HOLE, x, y), `${x},${y}`).toBeLessThanOrEqual(0);
      }
    }
    // The prints' silver (61 prints): top edge 1919, apex 1991 — the face's
    // edge less its 2 px keyline.
    expect(Math.min(...UB_STAMP_FACE.points.map((p) => p[1])) - UB_STAMP_FACE.radius + 2).toBeCloseTo(1920.1, 1);
    expect(Math.max(...UB_STAMP_FACE.points.map((p) => p[1])) + UB_STAMP_FACE.radius - 2).toBeCloseTo(1992, 1);
    expect(HOLO_STAMP_ART_MARGIN_PX).toBeGreaterThan(HOLO_STAMP_CUT_MARGIN_PX);
  });

  it("the notch recipe is the slot: the box, the keys, the triangle cut and both feet", () => {
    const def = HOLO_STAMP_NOTCHES.m15ubholostamp;
    expect(def.shape.src).toBe("img/frames/m15/new/ub/stamp/u.png");
    expect(def.shape.nativeSize).toEqual({ width: 299, height: 137 });
    expect(def.shape.size).toEqual({ width: UB_NOTCH_BOX.width, height: UB_NOTCH_BOX.height });
    expect(def.shape.bounds).toEqual(M15UB_HOLO_STAMP.rect);
    expect([...def.keys]).toEqual([...M15UB_HOLO_STAMP.keys]);
    expect(def.triangle).toBe(UB_STAMP_HOLE);
    expect(notchCutOf(def)).toBe(UB_STAMP_HOLE);
    expect(def.cutMarginPx).toBe(HOLO_STAMP_CUT_MARGIN_PX);
    expect(def.barOf.a).toBe("m15ubartifact/c");
    expect(def.barOf.l).toBe("m15ubland/c");
    for (const pair of TWO_COLOR_PAIRS) {
      expect(def.barOf[pair as keyof typeof def.barOf]).toBe(`m15ub/${pair}`);
      expect(def.barSharedBy[pair]).toEqual([`m15ub/${pair}-h`, `m15ubartifact/${pair}`, `m15ubland/${pair}`]);
    }
    // The feet are read on the bar's rows, inside the piece.
    expect(NOTCH_FOOT.m15ubholostamp.y + UB_NOTCH_BOX.y).toBe(1944);
    // The cut in the piece's own pixels: the triangle's centre is inside, the
    // feet and the top rim are not.
    const inside = cutInside(def.shape, UB_STAMP_HOLE, def.cutMarginPx);
    expect(inside(750 - UB_NOTCH_BOX.x, 1950 - UB_NOTCH_BOX.y)).toBe(true);
    expect(inside(5, NOTCH_FOOT.m15ubholostamp.y)).toBe(false);
    expect(inside(110, 14)).toBe(false);
  });

  it("a resampled piece is snapped back onto its flat rim and black, and nothing else moves", () => {
    const shape = { arc: [0, 117, 190] };
    const piece = Buffer.from([3, 113, 195, 255, 6, 2, 0, 255, 0, 117, 190, 120, 200, 200, 200, 255, 120, 117, 190, 255]);
    snapResampledPiece(shape, piece);
    expect([...piece]).toEqual([0, 117, 190, 255, 0, 0, 0, 255, 0, 117, 190, 120, 200, 200, 200, 255, 120, 117, 190, 255]);
  });
});

describe("the importer's recipes", () => {
  it("are the M15 twins' recipes over the Universes Beyond pack's files; the missing colourless frame is the artifact one", () => {
    expect(ubFrameFile("r")).toBe("img/frames/m15/new/ub/r.png");
    expect(ubFrameFile("c")).toBe("img/frames/m15/new/ub/a.png");
    expect(ubFrameFile("wl")).toBe("img/frames/m15/new/ub/lw.png");
    const ub = CC_TEMPLATES.m15ub;
    expect(ub.colors.c).toEqual([{ src: "img/frames/m15/new/ub/a.png" }]);
    expect(ub.colors.c).toEqual(CC_TEMPLATES.m15ubartifact.colors.c);
    expect(ub.notes.join(" ")).toMatch(/SUBSTITUTION: colourless/);
    for (const k of ["w", "u", "b", "r", "g", "m"]) expect(ub.colors[k as "w"]).toEqual([{ src: `img/frames/m15/new/ub/${k}.png` }]);
    expect(CC_TEMPLATES.m15ubland.colors.c).toEqual([{ src: "img/frames/m15/new/ub/l.png" }]);
    expect(CC_TEMPLATES.m15ubland.colors.g).toEqual([{ src: "img/frames/m15/new/ub/lg.png" }]);
    // Seven mono keys each; 20 pair keys on the spell frame, 10 on the others.
    const pairKeys = (t: (typeof UB)[number]) => Object.keys(CC_TEMPLATES[t].colors).filter((k) => k.length > 1);
    expect(pairKeys("m15ub")).toHaveLength(20);
    expect(pairKeys("m15ubartifact")).toEqual([...TWO_COLOR_PAIRS]);
    expect(pairKeys("m15ubland")).toEqual([...TWO_COLOR_PAIRS]);
    // No layer of any key reads a file outside the UB pack or its shared masks.
    for (const t of UB) {
      for (const layers of Object.values(CC_TEMPLATES[t].colors) as { src: string; right?: string; mask?: string }[][]) {
        for (const l of layers) {
          expect(l.src.startsWith("img/frames/m15/new/ub/"), `${t}: ${l.src}`).toBe(true);
          if (l.right) expect(l.right.startsWith("img/frames/m15/new/ub/"), `${t}: ${l.right}`).toBe(true);
          if (l.mask) expect(l.mask).toMatch(/^img\/frames\/m15\/new\/(border|frame|rules|title|type|pinline)\.png$/);
        }
      }
    }
    expect(Object.values(CC_TEMPLATES.m15ub.plates!).every((f) => (f as string).startsWith("img/frames/m15/ub/pt/"))).toBe(true);
    expect(CC_TEMPLATES.m15ub.plates!.c).toBe("img/frames/m15/ub/pt/c.png");
    expect(CC_TEMPLATES.m15ubartifact.plates!.c).toBe("img/frames/m15/ub/pt/a.png");
    expect("plates" in CC_TEMPLATES.m15ubland).toBe(false);
  });

  it("the crown band is the standard crown's recipe over the Universes Beyond crowns", () => {
    const UB_BAND = UB_CROWN_BAND as unknown as typeof CROWN_BAND;
    expect(UB_CROWN_BAND.crown).toEqual(CROWN_BAND.crown);
    expect(UB_CROWN_BAND.cover).toEqual(CROWN_BAND.cover);
    expect(UB_CROWN_BAND.rows).toBe(CROWN_BAND.rows);
    expect(CC_OVERLAY_BANDS.m15ubcrown.band).toBe(UB_CROWN_BAND);
    expect(crownBandRecipe("a", UB_BAND).left).toBe("img/frames/m15/ub/crowns/new/a.png");
    expect(crownBandRecipe("wu", UB_BAND)).toMatchObject({ left: "img/frames/m15/ub/crowns/new/w.png", right: "img/frames/m15/ub/crowns/new/u.png" });
    expect(() => crownBandRecipe("c", UB_BAND)).toThrow(/no crown for key c/);
    // The standard band is untouched by the parameter.
    expect(crownBandRecipe("c").left).toBe("img/frames/m15/crowns/new/c.png");
    expect(crownBandSourceFiles(UB_CROWN_BAND_KEYS, UB_BAND).filter((f) => f !== "img/black.png").every((f) => f.startsWith("img/frames/m15/ub/crowns/new/"))).toBe(true);
  });
});

// Owner Round 57 (2026-10-14): the pack's green bars, gold bars + gold text
// box and land-grey bars + text box are toned onto the prints BEFORE the
// first tick — as the FILE is loaded, so every master drawn from it follows.
describe("the three tones onto print (Round 57)", () => {
  const UBP = "img/frames/m15/new/ub";
  const MASK = { title: "img/frames/m15/new/title.png", type: "img/frames/m15/new/type.png", rules: "img/frames/m15/new/rules.png" };

  it("tones five files of the pack and no other: green and gold with their land twins, and the land grey", () => {
    expect(Object.keys(CC_SOURCE_TONES).sort()).toEqual([`${UBP}/g.png`, `${UBP}/l.png`, `${UBP}/lg.png`, `${UBP}/lm.png`, `${UBP}/m.png`]);
    // The tinted lands carry their colour's own bars (and lm the gold box).
    expect(CC_SOURCE_TONES[`${UBP}/lg.png`].tones).toBe(UB_PRINT_TONES.g);
    expect(CC_SOURCE_TONES[`${UBP}/lm.png`].tones).toBe(UB_PRINT_TONES.m);
    expect(Object.keys(UB_PRINT_TONES.g)).toEqual(["title", "type"]);
    expect(Object.keys(UB_PRINT_TONES.m)).toEqual(["title", "type", "rules"]);
    expect(Object.keys(UB_PRINT_TONES.l)).toEqual(["title", "type", "rules"]);
    // Each region goes through the pack's own mask of that name.
    for (const tone of Object.values(CC_SOURCE_TONES)) {
      for (const region of Object.keys(tone.tones)) expect(tone.masks[region as "title"]).toBe(MASK[region as "title"]);
    }
    // White, blue, black, red and the artifact frame stay as drawn.
    for (const k of ["w", "u", "b", "r", "a", "lw", "lu", "lb", "lr"]) expect(sourceTonesOf(`${UBP}/${k}.png`), k).toBeNull();
    // …and no file outside the Universes Beyond pack is toned this way.
    expect(sourceTonesOf("img/frames/m15/new/g.png")).toBeNull();
    expect(sourceTonesOf("img/frames/m15/new/l.png")).toBeNull();
    expect(sourceTonesOf("toString")).toBeNull();
  });

  it("the numbers are the recipe: what the file reads, and the prints' centre", () => {
    expect(UB_PRINT_TONES).toEqual({
      g: { title: { from: [173, 211, 165], to: [188, 211, 179] }, type: { from: [170, 209, 162], to: [182, 209, 173] } },
      m: {
        title: { from: [241, 227, 157], to: [239, 220, 135] },
        type: { from: [241, 226, 154], to: [238, 219, 132] },
        rules: { from: [249, 242, 213], to: [244, 234, 197] },
      },
      l: {
        title: { from: [214, 210, 194], to: [197, 186, 177] },
        type: { from: [212, 208, 191], to: [197, 185, 176] },
        rules: { from: [220, 214, 195], to: [230, 226, 220] },
      },
    });
    // No region moves a channel by more than 28 levels (the largest miss the
    // second reading found), and no gain is past ± 15 %.
    for (const table of Object.values(UB_PRINT_TONES)) {
      for (const tone of Object.values(table) as { from: number[]; to: number[] }[]) {
        const { channel, neutral } = sourceToneGain(tone);
        for (let c = 0; c < 3; c += 1) {
          expect(Math.abs(tone.to[c] - tone.from[c])).toBeLessThanOrEqual(28);
          expect(channel[c]).toBeGreaterThan(0.85);
          expect(channel[c]).toBeLessThan(1.15);
        }
        expect(neutral).toBeGreaterThan(0.88);
        expect(neutral).toBeLessThan(1.07);
      }
    }
  });

  it("every master built from a toned file is drawn from it: the pairs' gold bars, the hybrids' and two-colour lands' grey bars", () => {
    const files = (t: (typeof UB)[number], key: string) =>
      (CC_TEMPLATES[t].colors as Record<string, { src: string; right?: string; mask?: string }[]>)[key].flatMap((l) => [[l.src, l.mask], ...(l.right ? [[l.right, l.mask]] : [])]);
    // A gold-split pair is m.png whole: its bars are the gold's.
    expect(files("m15ub", "wu")[0]).toEqual([`${UBP}/m.png`, undefined]);
    // A hybrid's bars are l.png through the Title and Type masks.
    expect(files("m15ub", "wu-h")).toContainEqual([`${UBP}/l.png`, MASK.title]);
    expect(files("m15ub", "wu-h")).toContainEqual([`${UBP}/l.png`, MASK.type]);
    // A two-colour artifact's bars are m.png through the same masks; a
    // green or gold artifact's are g.png / m.png.
    expect(files("m15ubartifact", "ur")).toContainEqual([`${UBP}/m.png`, MASK.title]);
    expect(files("m15ubartifact", "g")).toContainEqual([`${UBP}/g.png`, MASK.title]);
    expect(files("m15ubartifact", "m")).toContainEqual([`${UBP}/m.png`, MASK.rules]);
    // A two-colour land is l.png whole under its split box.
    expect(files("m15ubland", "bg")[0]).toEqual([`${UBP}/l.png`, undefined]);
    // The provenance lists the toned files of each template with their gains.
    expect(Object.keys(describeSourceTones(CC_TEMPLATES.m15ub)!).sort()).toEqual([`${UBP}/g.png`, `${UBP}/l.png`, `${UBP}/m.png`]);
    expect(Object.keys(describeSourceTones(CC_TEMPLATES.m15ubartifact)!).sort()).toEqual([`${UBP}/g.png`, `${UBP}/m.png`]);
    expect(Object.keys(describeSourceTones(CC_TEMPLATES.m15ubland)!).sort()).toEqual([`${UBP}/l.png`, `${UBP}/lg.png`, `${UBP}/lm.png`]);
    expect((describeSourceTones(CC_TEMPLATES.m15ub) as Record<string, unknown>)[`${UBP}/g.png`]).toEqual({
      table: "UB_PRINT_TONES.g",
      title: `through ${MASK.title}: × 1.087 / 1.000 / 1.085 (173, 211, 165 → 188, 211, 179), fading to × 1.021 on every channel at white`,
      type: `through ${MASK.type}: × 1.071 / 1.000 / 1.068 (170, 209, 162 → 182, 209, 173), fading to × 1.017 on every channel at white`,
    });
    expect(describeSourceTones(CC_TEMPLATES.m15)).toBeNull();
    for (const t of UB) expect(CC_TEMPLATES[t].notes.join(" ")).toMatch(/toned onto the prints before the first tick \(owner Round 57/);
  });

  it("a pixel at the file's tone lands on the prints'; black stays black, white keeps its hue, the mask is the weight, alpha is kept", () => {
    const tone = UB_PRINT_TONES.g.title;
    // Six pixels: the bar's tone, black, white, a light streak, the tone
    // under half a mask, the tone outside the mask.
    const px = [
      [173, 211, 165, 255],
      [0, 0, 0, 255],
      [255, 255, 255, 255],
      [225, 240, 222, 200],
      [173, 211, 165, 255],
      [173, 211, 165, 255],
    ];
    const out = toneSourceRegions(Buffer.from(px.flat()), 6, 1, { title: Uint8Array.from([255, 255, 255, 255, 128, 0]) }, { title: tone });
    const at = (i: number) => [...out.subarray(i * 4, i * 4 + 4)];
    expect(at(0)).toEqual([188, 211, 179, 255]);
    expect(at(1)).toEqual([0, 0, 0, 255]);
    // White stays white (a plain gain of × 1.087 / 1 / 1.085 would not move
    // it either, but a near-white turns pink under it: the streak below).
    expect(at(2)).toEqual([255, 255, 255, 255]);
    // The streak is lifted with its hue: still greenest, red and blue equal
    // within 3 as they were (a plain gain gives 245, 240, 241 — pink).
    const streak = at(3);
    expect(streak[3]).toBe(200);
    expect(streak[1]).toBeGreaterThan(streak[0]);
    expect(streak[1]).toBeGreaterThan(streak[2]);
    expect(Math.abs(streak[0] - streak[2])).toBeLessThanOrEqual(3);
    // Half a mask, half the move; no mask, no move.
    expect(at(4)).toEqual([181, 211, 172, 255]);
    expect(at(5)).toEqual([173, 211, 165, 255]);
    // Every table entry maps its own `from` onto its `to`, exactly.
    for (const table of Object.values(UB_PRINT_TONES)) {
      for (const t of Object.values(table) as { from: number[]; to: number[] }[]) {
        const one = toneSourceRegions(Buffer.from([...t.from, 255]), 1, 1, { r: Uint8Array.from([255]) }, { r: t });
        expect([...one.subarray(0, 3)]).toEqual(t.to);
      }
    }
  });

  it("refuses a region with no tone, a tone with no region and a tone it can't apply", () => {
    const one = Buffer.from([10, 10, 10, 255]);
    const tone = { from: [10, 10, 10], to: [12, 12, 12] };
    expect(() => toneSourceRegions(one, 1, 1, { a: Uint8Array.from([255]) }, {})).toThrow(/region a has no tone/);
    expect(() => toneSourceRegions(one, 1, 1, {}, { a: tone })).toThrow(/tone a has no 1x1 region/);
    expect(() => toneSourceRegions(one, 2, 1, { a: Uint8Array.from([255]) }, { a: tone })).toThrow(/not 2x1 RGBA/);
    expect(() => checkSourceTone("a", { from: [0, 10, 10], to: [1, 1, 1] })).toThrow(/can't be toned from/);
    expect(() => checkSourceTone("a", { from: [255, 255, 255], to: [1, 1, 1] })).toThrow(/can't be toned from/);
    expect(() => checkSourceTone("a", { from: [1, 2], to: [1, 1, 1] } as never)).toThrow(/needs from \/ to as RGB/);
  });
});

describe("imports follow the printing (the registry's ub/2015 rule)", () => {
  it("knows the rule and its gap", () => {
    expect(FRAME_SIGNATURE_KEYS).toContain("ub/2015");
    expect(FRAME_SIGNATURE_KEYS).toContain("ub/2015+crown");
    expect(FRAME_SIGNATURE_KEYS).toContain("era/2015+universes-beyond");
    expect(FRAME_SIGNATURE_KEYS).toContain("extendedart+universes-beyond");
    expect(FRAME_SIGNATURE_KEYS).toContain("layout/2015+universes-beyond");
    expect(FRAME_SIGNATURE_KEYS).not.toContain("ub/2015+universes-beyond");
    // A row logged under the gap is never "answered" by a frame its own
    // rule doesn't name: a saga's dress is still not drawn.
    expect(signatureDrawnOn("layout/2015+universes-beyond", "saga")).toBe(false);
    expect(signatureDrawnOn("era/2015+universes-beyond", "m15")).toBe(false);
  });

  it.each([
    ["40k-9", "m15", "m15ub", "w"],
    ["40k-192", "m15", "m15ub", "u"],
    ["40k-150", "m15artifact", "m15ubartifact", "c"],
    ["40k-25", "m15artifact", "m15ubartifact", "u"],
    ["40k-264", "m15land", "m15ubland", "m"],
    ["40k-306", "m15land", "m15ubland", "w"],
  ] as const)("%s: nearest on %s until %s is verified in its colour, then exact on it", (key, today, later, colour) => {
    const match = frameMatchFromScryfall(printing(key));
    expect(match).toMatchObject({
      signature: "ub/2015",
      status: "nearest",
      template: today,
      reason: "PipGlyph's Universes Beyond frame isn't verified yet",
      blockedBy: "4.25",
      onceVerified: later,
      onceVerifiedMatch: { status: "exact", reason: null },
    });
    // Before the tick: the landing it always had, filed as "not yet verified".
    expect(withVerification(match, colour, NO_UB)).toMatchObject({ status: "nearest", template: today, unverified: true });
    expect(withVerification(match, colour, EVERY)).toMatchObject({ status: "exact", template: later });
    // Verified in ANOTHER colour only: nothing moves.
    const other = colour === "u" ? "r" : "u";
    expect(withVerification(match, colour, new Set([...NO_UB, frameComboKey(later, other)]))).toMatchObject({ template: today });
    // The patch: the frame follows the finalized match, every other field stays.
    const patch = mapScryfallToFormPatch(printing(key));
    const before = finalizeImportMatch(patch, NO_UB);
    const after = finalizeImportMatch(patch, EVERY);
    expect(before.frame_template).toBe(today);
    expect(after.frame_template).toBe(later);
    expect({ ...after, frame_template: today, frame_match: null }).toEqual({ ...before, frame_match: null });
    expect(patch.printed_stamp).toBe("triangle");
  });

  it("a crowned, a two-colour and a hybrid printing are exact too: the frames draw the crown and both pair dresses", () => {
    for (const key of ["40k-2", "40k-104", "pip-212", "acr-55", "40k-106", "40k-110", "40k-268", "ltr-255", "ltr-173"]) {
      const match = frameMatchFromScryfall(printing(key));
      expect(match.signature, key).toMatch(/^ub\/2015/);
      expect(match.onceVerifiedMatch, key).toEqual({ status: "exact", reason: null });
    }
    expect(frameMatchFromScryfall(printing("40k-106")).onceVerified).toBe("m15ubartifact");
    expect(frameMatchFromScryfall(printing("40k-268")).onceVerified).toBe("m15ubland");
    expect(frameMatchFromScryfall(printing("pip-212"))).toMatchObject({ signature: "ub/2015+two-colour-hybrid", onceVerified: "m15ub" });
  });

  it("a Universes Beyond printing on another body keeps its frame, as the nearest, with the dress as its gap", () => {
    const gap = "this printing wears the Universes Beyond dress, which PipGlyph draws on its plain spell, artifact and land frames only";
    // A colourless non-artifact spell: print's frame is see-through, the
    // borrowed colourless master is not.
    for (const key of ["who-9", "fin-2"]) {
      const match = frameMatchFromScryfall(printing(key));
      expect(match, key).toMatchObject({ signature: "era/2015+universes-beyond", status: "nearest", template: "m15", reason: gap, blockedBy: "4.25" });
      expect(match.onceVerified, key).toBeUndefined();
      expect(withVerification(match, "c", EVERY), key).toMatchObject({ status: "nearest", template: "m15" });
    }
    expect(frameMatchFromScryfall(printing("40k-69"))).toMatchObject({ signature: "layout/2015+universes-beyond", status: "nearest", template: "saga", reason: gap });
    expect(frameMatchFromScryfall(printing("fic-264"))).toMatchObject({ signature: "layout/2015+universes-beyond", status: "nearest", template: "adventure" });
    // A Vehicle keeps the Vehicle rule (the bronze frame is the closer one).
    const ark = frameMatchFromScryfall(printing("40k-156"));
    expect(ark).toMatchObject({ signature: "vehicle/2015+universes-beyond", template: "m15artifact", onceVerified: "m15vehicle" });
    expect(withVerification(ark, "c", EVERY)).toMatchObject({ status: "nearest", template: "m15vehicle", reason: gap });
    expect(frameMatchFromScryfall(printing("pip-362"))).toMatchObject({ signature: "extendedart+universes-beyond", status: "nearest", template: "extendedart" });
    // A double-faced one stays on its body.
    expect(frameMatchFromScryfall(printing("bot-1"))).toMatchObject({ signature: "transform/2015+universes-beyond", template: "m15dfcfront" });
    // The foil-etched run is a dress of its own: never this rule.
    const etched = frameMatchFromScryfall(printing("40k-177"));
    expect(etched.signature).toBe("era/2015+etched");
    expect(etched.onceVerified).toBeUndefined();
  });

  it("only the triangle-stamped printings of 2021-11 on take it: Marvel's Spider-Man and Avatar print the M15 frame", () => {
    for (const key of ["spm-4", "spm-32", "tla-12", "sld-581"]) {
      const match = frameMatchFromScryfall(printing(key));
      expect(match.signature, key).toBe("era/2015");
      expect(match.status, key).toBe("exact");
      expect(match.onceVerified, key).toBeUndefined();
      const patch = mapScryfallToFormPatch(printing(key));
      expect(finalizeImportMatch(patch, EVERY), key).toEqual(finalizeImportMatch(patch, NO_UB));
    }
  });
});

describe("the AI deck remix lands where the import lands (#529)", () => {
  const remix = (key: string, verified: ReadonlySet<string>) => {
    const result = scryfallRemixMechanics(mapScryfallToFormPatch(printing(key)), "Entry", verified);
    if (!result.ok) throw new Error(`${key}: ${result.error}`);
    return result.mechanics;
  };

  it.each([
    ["40k-9", "m15", "m15ub"],
    ["40k-150", "m15artifact", "m15ubartifact"],
    ["40k-264", "m15land", "m15ubland"],
  ] as const)("%s: on %s until the Universes Beyond frame is ticked, then on %s — nothing else changes", (key, today, later) => {
    const before = remix(key, NO_UB);
    const after = remix(key, EVERY);
    expect(before.frame_template).toBe(today);
    expect(after.frame_template).toBe(later);
    expect({ ...after, frame_template: today }).toEqual(before);
  });

  it("a printing that is not on the frame never moves with the ticks", () => {
    for (const key of ["spm-4", "who-9", "40k-69", "40k-177"]) expect(remix(key, EVERY), key).toEqual(remix(key, NO_UB));
  });
});
