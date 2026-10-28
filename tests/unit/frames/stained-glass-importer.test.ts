import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  CC_OVERLAY_BANDS,
  CC_TEMPLATES,
  SG,
  SG_BOX_RAMP,
  SG_CROWN_BAND,
  SG_CROWN_BOUNDS,
  SG_CROWN_MASK,
  SG_CROWN_RAMP,
  SG_NOTCH,
  SG_PRINT_TONES,
  SG_RULES_MASK,
  SG_SOURCE_TONES,
  clearZnrOvalCut,
  geomRegionPlane,
  restoredZnrMaster,
  sgCrownFindings,
  sgCrownLayers,
  sourceFilesFor,
  sourceTonesOf,
  splitWarpNotch,
  toneSourceRegions,
} from "../../../scripts/lib/cc-frames.mjs";
import { TWO_COLOR_PAIRS } from "../../../scripts/lib/pair-ramp.mjs";
import { frameAnatomyOf, resolveFrameOverlays } from "@/lib/cards/anatomy";
import { COLLECTOR_TEMPLATES } from "@/lib/cards/collector-line";
import { M15_FAMILY_TEMPLATES } from "@/lib/cards/m15-family";
import { PLATE_INK } from "@/lib/cards/plate-ink";
import {
  M15_COLLECTOR,
  STAINEDGLASS_ART_SLOT,
  STAINEDGLASS_COLLECTOR,
  STAINEDGLASS_CROWN,
  STAINEDGLASS_HOLO_STAMP,
  STAINEDGLASS_HOLO_STAMP_OVAL,
  getFrameProfile,
} from "@/lib/cards/template-layout";
import { EDGE_CONTRACTS, EDGE_CONTRACT_KNOWN_FAILURES } from "@/lib/frames/edge-contract";
import { ART_WINDOW_KNOWN_FAILURES } from "@/lib/frames/art-window";
import { SQUARE_CORNERS, squareCornerKind } from "@/lib/frames/square-corners";
import { BORDER_PENDING_TEMPLATES } from "@/lib/scryfall/frame-signatures";
import { FRAME_ERA_LABELS, FRAME_SET_ERA, FRAME_SET_LABELS, FRAME_TEMPLATE_LABELS, FRAME_TEMPLATE_SET } from "@/types/card";
import manifestJson from "@/lib/frames/frame-manifest.json";
import provenance from "@/lib/cards/frame-sources.json";

// ---------------------------------------------------------------------------
// TODO 4.11 wave 2: the Dominaria United STAINED GLASS showcase
// (`stainedglass`; DMU #287–368, MUL's Dominaria legends) from Card
// Conjurer's 'Stained Glass (DMU)' pack (1500 × 2100 native) — a NEW
// template, an addition. The recipe (the six frames, `c` the gold one, the
// ten pair masters), the tones (the ring's rule, a shift per channel), the
// notch split off every master, the crown band, the edges, the profile and,
// where the published objects are on disk at the manifest's sha256
// (FRAMES_BUILD_DIR, else .frames-build; CI fetches them), their pixels.
// ---------------------------------------------------------------------------

type Layer = { src: string; right?: string; ramp?: number[]; mask?: string };
const def = (CC_TEMPLATES as unknown as Record<string, { colors: Record<string, Layer[]>; plates: Record<string, string>; notch: typeof SG_NOTCH }>).stainedglass;
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
type Entry = { sha256: string; width: number; height: number };
const MANIFEST = (manifestJson as { files: Record<string, Entry> }).files;
const MASTER_KEYS = ["w", "u", "b", "r", "g", "c", "m"];
const KEYS = [...MASTER_KEYS, ...TWO_COLOR_PAIRS];

function published(rel: string): Buffer | null {
  const file = path.join(BUILD, rel);
  if (!MANIFEST[rel] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === MANIFEST[rel].sha256 ? bytes : null;
}

describe("the Stained Glass recipe", () => {
  it("draws the pack's six frames, `c` the gold one, and the ten pair masters: gold frame, the box split", () => {
    expect(SG).toBe("img/frames/dmu/stainedGlass");
    expect(Object.keys(def.colors).sort()).toEqual([...KEYS].sort());
    for (const k of ["w", "u", "b", "r", "g", "m"]) expect(def.colors[k], k).toEqual([{ src: `${SG}/${k}.png` }]);
    // No colourless frame in the pack and no colourless print: the gold one.
    expect(def.colors.c).toEqual([{ src: `${SG}/m.png` }]);
    for (const pair of TWO_COLOR_PAIRS) {
      expect(def.colors[pair], pair).toEqual([
        { src: `${SG}/m.png` },
        { src: `${SG}/${pair[0]}.png`, right: `${SG}/${pair[1]}.png`, ramp: [...SG_BOX_RAMP], mask: SG_RULES_MASK },
      ]);
    }
    for (const k of MASTER_KEYS) expect(def.plates[k], k).toBe(`${SG}/pt/${k === "c" ? "m" : k}.png`);
    expect(sourceFilesFor(def as never)).toEqual(
      expect.arrayContaining([...["w", "u", "b", "r", "g", "m"].flatMap((k) => [`${SG}/${k}.png`, `${SG}/pt/${k}.png`]), SG_RULES_MASK]),
    );
    // The box ramp: the run's two-colour boxes, 10 / 50 / 90 % at 47.1 /
    // 51.5 / 55.8 %W.
    expect(SG_BOX_RAMP).toEqual([46, 57]);
  });

  it("tones each region the ring's rule finds ≥ 9 levels off — and only those — by a shift per channel", () => {
    let regions = 0;
    for (const [region, byKey] of Object.entries(SG_PRINT_TONES)) {
      for (const [key, tone] of Object.entries(byKey as Record<string, { from: number[]; to: number[]; shift: boolean }>)) {
        regions += 1;
        expect(tone.shift, `${region}/${key}`).toBe(true);
        expect(Math.max(...tone.to.map((v, c) => Math.abs(v - tone.from[c]))), `${region}/${key}`).toBeGreaterThanOrEqual(9);
      }
    }
    expect(regions).toBe(28);
    // The green bars, panes and plate have no print (no mono-green card):
    // as drawn; so are the w and b boxes (5 off) and the w plate (6).
    for (const region of ["title", "type"] as const) expect(SG_PRINT_TONES[region]).not.toHaveProperty("g");
    expect(SG_PRINT_TONES.box).not.toHaveProperty("w");
    expect(SG_PRINT_TONES.box).not.toHaveProperty("b");
    expect(SG_PRINT_TONES.plate).not.toHaveProperty("w");
    expect(sourceTonesOf(`${SG}/pt/g.png`)).toBeNull();
    expect(sourceTonesOf(`${SG}/m.png`)).toBe(SG_SOURCE_TONES[`${SG}/m.png`]);
    // Every region is the pack's glass: where its blue and red files differ.
    const m = sourceTonesOf(`${SG}/m.png`) as { geom: Record<string, { a: string; b: string; rows?: number[] }> };
    expect(Object.keys(m.geom).sort()).toEqual(["box", "lead", "title", "type"]);
    expect([m.geom.title.a, m.geom.title.b]).toEqual([`${SG}/u.png`, `${SG}/r.png`]);
  });

  it("a shifted tone moves each channel by (to − from) at the region's tone, nothing at white", () => {
    const buf = Buffer.from([100, 70, 10, 255, 255, 255, 255, 255, 50, 40, 30, 255]);
    const out = toneSourceRegions(buf, 3, 1, { r: new Uint8Array([255, 255, 0]) }, { r: { from: [100, 70, 10], to: [110, 80, 50], shift: true } });
    expect([...out.subarray(0, 3)]).toEqual([110, 80, 50]);
    expect([...out.subarray(4, 7)]).toEqual([255, 255, 255]);
    expect([...out.subarray(8, 11)]).toEqual([50, 40, 30]);
  });

  it("a glass region is where two other files differ, kept to its rows and columns, above its luma floor", () => {
    const px = (r: number, g: number, b: number) => [r, g, b, 255];
    // 4 × 1: differs at x 0, 1, 2; x 2 is dark (a lead line); x 3 the same.
    const a = Buffer.from([...px(200, 0, 0), ...px(200, 0, 0), ...px(10, 10, 10), ...px(90, 90, 90)]);
    const b = Buffer.from([...px(0, 0, 200), ...px(0, 0, 200), ...px(30, 30, 30), ...px(90, 90, 90)]);
    const self = Buffer.from([...px(120, 120, 120), ...px(120, 120, 120), ...px(15, 15, 15), ...px(120, 120, 120)]);
    const plane = geomRegionPlane(a, b, 4, 1, { full: 40, none: 16, luma: [24, 40], cols: [[1, 4]] }, null, null, self as never);
    expect([...plane]).toEqual([0, 255, 0, 0]);
  });
});

describe("the stamp notch, split off every master", () => {
  /** A synthetic master: a box of flat glass over the mask's interior, an
   *  arch (bright) where the mask leaves the box above the straight foot,
   *  the straight bar (a two-tone rim) under it, black below. */
  function synthetic(): { master: Buffer; mask: Buffer } {
    const W = 1500;
    const H = 2100;
    const master = Buffer.alloc(W * H * 4);
    const mask = Buffer.alloc(W * H * 4);
    const archTop = (x: number) => (x < 659 || x > 841 ? 1922 : Math.round(1895 + 27 * ((x - 750) / 91) ** 2));
    for (let y = 1700; y < 2100; y += 1) {
      for (let x = 500; x < 1000; x += 1) {
        const o = (y * W + x) * 4;
        const top = archTop(x);
        if (y < top) {
          master.set([60, 70 + (y % 7), 110, 255], o);
          mask[o + 3] = 255;
        } else if (y < 1922) master.set([200, 180, 150, 255], o);
        else if (y < 1934) master.set([20, 15, 15, 255], o);
        else if (y < 1950) master.set([120 + Math.round((x - 500) / 10), 100, 90, 255], o);
        else master.set([0, 0, 0, 255], o);
      }
    }
    return { master, mask };
  }

  it("writes the box's foot straight, the glass stretched onto it, and the arch as the piece", () => {
    const { master, mask } = synthetic();
    const { plain, piece, findings } = splitWarpNotch(master, 1500, 2100, mask, SG_NOTCH);
    expect(findings.failures).toEqual([]);
    expect(findings.archColumns).toBeGreaterThan(150);
    expect(findings.kept).toBeGreaterThan(0);
    const at = (x: number, y: number) => [...plain.subarray((y * 1500 + x) * 4, (y * 1500 + x) * 4 + 4)];
    // Under the arch's crown: glass down to the foot, the dark band, the rim.
    expect(at(750, 1915)[2]).toBe(110);
    expect(at(750, 1925)).toEqual([20, 15, 15, 255]);
    // The rim blended between the two anchor columns (647 and 851).
    const left = master[(1940 * 1500 + 647) * 4];
    const right = master[(1940 * 1500 + 851) * 4];
    expect(at(749, 1940)[0]).toBe(Math.round(left * (1 - 102 / 204) + right * (102 / 204)));
    // The piece over the plain master draws the original back, but for the
    // oval cut.
    const restored = restoredZnrMaster(plain, piece, 1500, 2100, SG_NOTCH as never);
    expect(restored.equals(clearZnrOvalCut(Buffer.from(master), 1500, SG_NOTCH as never))).toBe(true);
  });

  it("refuses a mask with no arch", () => {
    const { master, mask } = synthetic();
    for (let y = 1780; y < 1922; y += 1) for (let x = 640; x < 860; x += 1) mask[(y * 1500 + x) * 4 + 3] = 255;
    expect(splitWarpNotch(master, 1500, 2100, mask, SG_NOTCH).findings.failures.join(" ")).toMatch(/no arch/);
  });

  it("the piece's box and oval are the profile's", () => {
    expect(STAINEDGLASS_HOLO_STAMP.rect).toEqual({
      leftPct: (SG_NOTCH.box.x / 1500) * 100,
      topPct: (SG_NOTCH.box.y / 2100) * 100,
      widthPct: (SG_NOTCH.box.width / 1500) * 100,
      heightPct: (SG_NOTCH.box.height / 2100) * 100,
    });
    expect(STAINEDGLASS_HOLO_STAMP_OVAL).toEqual({
      leftPct: (SG_NOTCH.oval.x / 1500) * 100,
      topPct: (SG_NOTCH.oval.y / 2100) * 100,
      widthPct: (SG_NOTCH.oval.width / 1500) * 100,
      heightPct: (SG_NOTCH.oval.height / 2100) * 100,
    });
    // On CC's own 'Rare Stamp' centre (750, 1959.5).
    expect(SG_NOTCH.oval.x + SG_NOTCH.oval.width / 2).toBe(750);
    expect(SG_NOTCH.oval.y + SG_NOTCH.oval.height / 2).toBe(1959.5);
    expect(STAINEDGLASS_HOLO_STAMP.anatomy === "holoStamp" && STAINEDGLASS_HOLO_STAMP.stamp.shape).toBe("oval");
    expect([...STAINEDGLASS_HOLO_STAMP.keys].sort()).toEqual([...KEYS].sort());
    expect(STAINEDGLASS_HOLO_STAMP.assetPathTemplate).toBe("/frames/stainedglass/holostamp/{key}.png");
  });
});

describe("the crown band", () => {
  it("is the pack's crown at its bounds, 1:1; a pair's the gold crown with the two domes lerped through the Inner Crown mask", () => {
    const band = (CC_OVERLAY_BANDS as unknown as Record<string, { keys: string[] }>).stainedglasscrown;
    expect(band.keys).toEqual(SG_CROWN_BAND.keys);
    expect([...STAINEDGLASS_CROWN.keys].sort()).toEqual([...SG_CROWN_BAND.keys].sort());
    expect(STAINEDGLASS_CROWN.assetPathTemplate).toBe("/frames/stainedglasscrown/{key}.png");
    expect((STAINEDGLASS_CROWN.rect.heightPct / 100) * 2100).toBeCloseTo(SG_CROWN_BAND.rows, 6);
    expect([(SG_CROWN_BOUNDS.leftPct / 100) * 1500, (SG_CROWN_BOUNDS.topPct / 100) * 2100, (SG_CROWN_BOUNDS.widthPct / 100) * 1500, (SG_CROWN_BOUNDS.heightPct / 100) * 2100].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([170, 29, 1160, 55]);
    expect(sgCrownLayers("r")).toEqual([{ src: `${SG}/crowns/r.png`, at: { ...SG_CROWN_BOUNDS } }]);
    expect(sgCrownLayers("c")).toEqual([{ src: `${SG}/crowns/m.png`, at: { ...SG_CROWN_BOUNDS } }]);
    expect(sgCrownLayers("rg")).toEqual([
      { src: `${SG}/crowns/m.png`, at: { ...SG_CROWN_BOUNDS } },
      { src: `${SG}/crowns/r.png`, at: { ...SG_CROWN_BOUNDS }, right: `${SG}/crowns/g.png`, ramp: [...SG_CROWN_RAMP], mask: SG_CROWN_MASK },
    ]);
    expect(SG_CROWN_RAMP).toEqual([47, 53]);
  });

  it("checks the composite: nothing above row 29 or past the band, the crown opaque", () => {
    const W = 1500;
    const buf = Buffer.alloc(W * 300 * 4);
    for (let y = 29; y < 84; y += 1) for (let x = 170; x < 1330; x += 1) buf[(y * W + x) * 4 + 3] = 255;
    expect(sgCrownFindings(buf, W, 300, 120).failures).toEqual([]);
    buf[(10 * W + 700) * 4 + 3] = 255;
    expect(sgCrownFindings(buf, W, 300, 120).failures.join(" ")).toMatch(/above the crown's bounds/);
  });

  it("is opt-in per card, the pair's crown over the pair master", () => {
    const p = getFrameProfile("stainedglass");
    const facts = { cardType: "creature", supertype: "Legendary", colors: ["red", "green"] as const, colorKey: "m", rarity: "rare" };
    expect(resolveFrameOverlays(p, {}, facts as never).filter((o) => o.anatomy === "crown")).toEqual([]);
    expect(resolveFrameOverlays(p, { crown: true, twoColor: true } as never, facts as never).find((o) => o.anatomy === "crown")).toMatchObject({ path: "/frames/stainedglasscrown/rg.png" });
    expect(resolveFrameOverlays(p, { crown: true } as never, { ...facts, colors: ["red", "green", "white"] } as never).find((o) => o.anatomy === "crown")).toMatchObject({ path: "/frames/stainedglasscrown/m.png" });
  });
});

describe("the edges and corners", () => {
  it("the printed black border all round: on no pending list", () => {
    const border = { kind: "border" };
    expect(EDGE_CONTRACTS.stainedglass).toEqual({ top: border, right: border, bottom: border, left: border });
    expect(EDGE_CONTRACT_KNOWN_FAILURES.stainedglass).toBeUndefined();
    expect(ART_WINDOW_KNOWN_FAILURES.stainedglass).toBeUndefined();
    expect(BORDER_PENDING_TEMPLATES.has("stainedglass")).toBe(false);
    expect(SQUARE_CORNERS.stainedglass).toBeUndefined();
    expect(["tl", "tr", "bl", "br"].map((c) => squareCornerKind("stainedglass", "w", c as never))).toEqual(["border", "border", "border", "border"]);
  });
});

describe("the profile rides the pack's own bars", () => {
  const p = getFrameProfile("stainedglass");

  it("is a new showcase set of its own, Dominaria United — Stained Glass", () => {
    expect(FRAME_TEMPLATE_LABELS.stainedglass).toBe("Stained Glass");
    expect(FRAME_TEMPLATE_SET.stainedglass).toBe("dominariaunited");
    expect(FRAME_SET_LABELS.dominariaunited).toBe("Dominaria United");
    expect(FRAME_ERA_LABELS[FRAME_SET_ERA.dominariaunited]).toBe("Showcase & Universes Beyond");
  });

  it("is an M15-era family member on the run's cost row, name, type line and rules box", () => {
    expect(M15_FAMILY_TEMPLATES).toContain("stainedglass");
    expect(COLLECTOR_TEMPLATES).toContain("stainedglass");
    expect(p.title.fit).toBe("measured");
    expect(p.type.fit).toBe("measured");
    expect(p.costSizePct).toBeCloseTo(70 / 1500, 12);
    expect(p.costDy).toBeCloseTo(-7.6 / 1500, 12);
    expect(p.costDx).toBeCloseTo(11.5 / 1500, 12);
    expect(p.artSlot).toBe(STAINEDGLASS_ART_SLOT);
    const a = p.artSlot;
    expect([(a.leftPct / 100) * 1500, ((a.leftPct + a.widthPct) / 100) * 1500, (a.topPct / 100) * 2100, ((a.topPct + a.heightPct) / 100) * 2100].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([59, 1441, 231, 1170]);
    expect(p.underFrameArt).toBeUndefined();
    expect((p.rules.rect.topPct / 100) * 2100).toBeCloseTo(1345.2, 6);
    expect(((p.rules.rect.topPct + p.rules.rect.heightPct) / 100) * 2100).toBeCloseTo(1914, 6);
    expect(p.pt?.plateAssetPathTemplate).toBe("/frames/stainedglass/pt/{color}.png");
    expect(p.pt?.plateRect).toEqual({ topPct: (1863 / 2100) * 100, leftPct: (1162 / 1500) * 100, widthPct: (262 / 1500) * 100, heightPct: (127 / 2100) * 100 });
    expect(PLATE_INK["/frames/stainedglass/pt/{color}.png"]).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
    // White ink everywhere: the glass is dark.
    expect([p.title.colorHex, p.type.colorHex, p.rules.colorHex, p.pt?.colorHex]).toEqual(["#ffffff", "#ffffff", "#ffffff", "#ffffff"]);
    expect(p.collector).toBe(STAINEDGLASS_COLLECTOR);
    expect({ ...STAINEDGLASS_COLLECTOR, line1BaselinePct: 0, line2BaselinePct: 0 }).toEqual({ ...M15_COLLECTOR, line1BaselinePct: 0, line2BaselinePct: 0 });
    expect((STAINEDGLASS_COLLECTOR.line1BaselinePct / 100) * 2100).toBeCloseTo(1997.5, 9);
    expect((STAINEDGLASS_COLLECTOR.line2BaselinePct / 100) * 2100).toBeCloseTo(2036, 9);
    expect(p.twoColorMasters).toEqual(["split"]);
    expect(frameAnatomyOf("stainedglass")).toMatchObject({ crown: true, twoColor: ["split"], collector: true, stamp: true });
  });

  it("keys the stamp by the master drawn; \"auto\" a rare or mythic", () => {
    const keysOf = (style: Record<string, unknown>, facts: Record<string, unknown>) =>
      resolveFrameOverlays(p, { stamp: "auto", ...style } as never, { cardType: "creature", supertype: "Legendary", rarity: "rare", ...facts } as never)
        .filter((o) => o.anatomy === "holoStamp")
        .map((o) => o.key);
    expect(keysOf({}, { colors: ["white"], colorKey: "w" })).toEqual(["w"]);
    expect(keysOf({ twoColor: true }, { colors: ["blue", "red"], colorKey: "m" })).toEqual(["ur"]);
    expect(keysOf({}, { colors: ["green"], colorKey: "g", rarity: "uncommon" })).toEqual([]);
  });
});

const masters = KEYS.map((k) => [k, published(`stainedglass/${k}.png`)] as const);
const notches = KEYS.map((k) => [k, published(`stainedglass/holostamp/${k}.png`)] as const);
const crowns = KEYS.map((k) => [k, published(`stainedglasscrown/${k}.png`)] as const);
const available = [...masters, ...notches, ...crowns].every(([, b]) => b !== null);

describe.skipIf(!available)("the published objects (set FRAMES_BUILD_DIR if skipped)", () => {
  it("every master: 1500 × 2100, the black border all round, the corners cut, the window clear", async () => {
    for (const [k, bytes] of masters) {
      const { data, info } = await sharp(bytes!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect([info.width, info.height], k).toEqual([1500, 2100]);
      const px = (x: number, y: number) => Array.from(data.subarray((y * 1500 + x) * 4, (y * 1500 + x) * 4 + 4));
      for (const [x, y] of [[750, 10], [10, 1050], [1490, 1050], [750, 2090], [300, 2000]]) {
        const [r, g, b, a] = px(x, y);
        expect(a, `${k} (${x}, ${y})`).toBe(255);
        expect(r + g + b, `${k} (${x}, ${y})`).toBeLessThan(10);
      }
      expect([px(0, 0)[3], px(1499, 0)[3], px(0, 2099)[3], px(1499, 2099)[3]], k).toEqual([0, 0, 0, 0]);
      expect(px(750, 700)[3], k).toBe(0);
      // The plain foot: no well under the box's centre.
      expect(px(750, 1960)[3], k).toBe(255);
    }
    // `c` is the gold master, byte for byte.
    expect(MANIFEST["stainedglass/c.png"].sha256).toBe(MANIFEST["stainedglass/m.png"].sha256);
  });

  it("each notch piece laid over its plain master draws the pack's own master back (the oval cut cleared)", async () => {
    const restored = (provenance as unknown as Record<string, { notch: { restored: Record<string, string> } }>).stainedglass.notch.restored;
    for (const [k, bytes] of masters) {
      const master = await sharp(bytes!).ensureAlpha().raw().toBuffer();
      const piece = await sharp(published(`stainedglass/holostamp/${k}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect([piece.info.width, piece.info.height], k).toEqual([SG_NOTCH.box.width, SG_NOTCH.box.height]);
      for (let p = 3; p < piece.data.length; p += 4) expect(piece.data[p] === 0 || piece.data[p] === 255, k).toBe(true);
      const drawn = restoredZnrMaster(master, piece.data, 1500, 2100, SG_NOTCH as never);
      expect(createHash("sha256").update(drawn).digest("hex"), k).toBe(restored[k]);
      const plain = clearZnrOvalCut(Buffer.from(master), 1500, SG_NOTCH as never);
      expect(createHash("sha256").update(plain).digest("hex"), k).not.toBe(restored[k]);
    }
  }, 120_000);

  it("every crown band: 1500 × 120, nothing above row 29", async () => {
    for (const [k, bytes] of crowns) {
      const { data, info } = await sharp(bytes!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect([info.width, info.height], k).toEqual([1500, 120]);
      for (let y = 0; y < 29; y += 1) for (let x = 0; x < 1500; x += 25) expect(data[(y * 1500 + x) * 4 + 3], `${k} (${x}, ${y})`).toBe(0);
    }
  });
});
