import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  CC_OVERLAY_BANDS,
  CC_TEMPLATES,
  HOLO_STAMP_NOTCHES,
  TARKIR,
  TARKIR_CROWN_BAND,
  TARKIR_NOTCH,
  TARKIR_NOTCH_BOX,
  TARKIR_PAIR_RAMP,
  TARKIR_PRINT_TONES,
  TARKIR_SOURCE_TONES,
  TARKIR_STAMP_OVAL_PX,
  TARKIR_WING_DIFF,
  blackoutAndCut,
  capturePlane,
  cutInside,
  diffRegionPlane,
  notchCutOf,
  notchSourceFiles,
  pieceNotchFindings,
  sourceFilesFor,
  sourceTonesOf,
  tarkirCrownFindings,
  tarkirCrownLayers,
  toneSourceRegions,
} from "../../../scripts/lib/cc-frames.mjs";
import { resolveFrameOverlays } from "@/lib/cards/anatomy";
import { COLLECTOR_TEMPLATES } from "@/lib/cards/collector-line";
import { M15_FAMILY_TEMPLATES } from "@/lib/cards/m15-family";
import { PLATE_INK } from "@/lib/cards/plate-ink";
import {
  EXPEDITION_ZNR_COLLECTOR,
  TARKIRDRAGON_CROWN,
  TARKIRDRAGON_HOLO_STAMP,
  TARKIRDRAGON_HOLO_STAMP_OVAL,
  getFrameProfile,
} from "@/lib/cards/template-layout";
import { EDGE_CONTRACTS, EDGE_CONTRACT_KNOWN_FAILURES } from "@/lib/frames/edge-contract";
import { ART_WINDOW_KNOWN_FAILURES } from "@/lib/frames/art-window";
import { SQUARE_CORNERS, squareCornerKind } from "@/lib/frames/square-corners";
import { BORDER_PENDING_TEMPLATES } from "@/lib/scryfall/frame-signatures";
import { NEVER_NORMALISE } from "../../../scripts/lib/frame-corners.mjs";
import manifestJson from "@/lib/frames/frame-manifest.json";

// ---------------------------------------------------------------------------
// TODO 4.11 (showcase rebuild; layout v67): the Multiverse Legends TARKIR
// "Dragon Wing" showcase re-sourced from Card Conjurer's 'Tarkir' pack
// (1500 × 2100 native) — the recipe (whole files, `c` the pack's artifact
// frame: its Colorless frame is not in the tree), the w / u wing tones, its
// crown band (the ten pairs across the pack's own ramp) and its OVAL notch
// (the pack's one piece, the hologram oval cut), the edges, the profile that
// rides the masters and, where the published objects are on disk at the
// manifest's sha256 (FRAMES_BUILD_DIR, else .frames-build; CI fetches
// them), their pixels.
// ---------------------------------------------------------------------------

type Layer = { src: string };
const def = (CC_TEMPLATES as unknown as Record<string, { colors: Record<string, Layer[]>; plates: Record<string, string> }>).tarkirdragon;
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
type Entry = { sha256: string; width: number; height: number };
const MANIFEST = (manifestJson as { files: Record<string, Entry> }).files;

function published(rel: string): Buffer | null {
  const file = path.join(BUILD, rel);
  if (!MANIFEST[rel] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === MANIFEST[rel].sha256 ? bytes : null;
}

const MASTER_KEYS = ["w", "u", "b", "r", "g", "c", "m"];
const PAIRS = ["wu", "wb", "ub", "ur", "br", "bg", "rg", "rw", "gw", "gu"];

describe("the Tarkir recipe", () => {
  it("is the pack's whole file per key, `c` the pack's artifact frame (its Colorless frame is not in the tree)", () => {
    expect(TARKIR).toBe("img/frames/tarkir");
    expect(Object.keys(def.colors).sort()).toEqual([...MASTER_KEYS].sort());
    for (const key of ["w", "u", "b", "r", "g", "m"]) expect(def.colors[key], key).toEqual([{ src: `${TARKIR}/${key}.png` }]);
    expect(def.colors.c).toEqual([{ src: `${TARKIR}/a.png` }]);
    for (const key of ["w", "u", "b", "r", "g", "m"]) expect(def.plates[key], key).toBe(`${TARKIR}/pt/${key}.png`);
    expect(def.plates.c).toBe(`${TARKIR}/pt/a.png`);
  });

  it("the crown band and the notch publish the keys the profile's slots ask for, at the importer's boxes", () => {
    expect([...TARKIR_CROWN_BAND.keys]).toEqual(TARKIRDRAGON_CROWN.keys);
    expect(CC_OVERLAY_BANDS.tarkirdragoncrown.keys).toBe(TARKIR_CROWN_BAND.keys);
    expect(TARKIRDRAGON_CROWN.rect).toEqual({ topPct: 0, leftPct: 0, widthPct: 100, heightPct: (TARKIR_CROWN_BAND.rows / 2100) * 100 });
    expect(TARKIRDRAGON_CROWN.anatomy === "crown" && TARKIRDRAGON_CROWN.pairCrownOnGold).toBe(true);
    // A pair: the first colour's crown left, the second's right, across the
    // pack's own 'Right Half' ramp.
    expect(tarkirCrownLayers("wu")).toEqual([
      expect.objectContaining({ src: `${TARKIR}/crowns/w.png`, right: `${TARKIR}/crowns/u.png`, ramp: [...TARKIR_PAIR_RAMP] }),
    ]);
    expect(tarkirCrownLayers("c")).toEqual([expect.objectContaining({ src: `${TARKIR}/crowns/a.png` })]);
    expect([...TARKIR_PAIR_RAMP]).toEqual([41.7, 61.3]);
    // The notch: the importer's box, 1:1, the pack's one piece for every key.
    expect([...TARKIR_NOTCH.keys]).toEqual(TARKIRDRAGON_HOLO_STAMP.keys);
    expect(TARKIRDRAGON_HOLO_STAMP.rect).toEqual({
      leftPct: (TARKIR_NOTCH_BOX.x / 1500) * 100,
      topPct: (TARKIR_NOTCH_BOX.y / 2100) * 100,
      widthPct: (TARKIR_NOTCH_BOX.width / 1500) * 100,
      heightPct: (TARKIR_NOTCH_BOX.height / 2100) * 100,
    });
    const { x, y, width } = TARKIR_NOTCH.placeAt;
    expect(TARKIR_NOTCH_BOX.x).toBeLessThan(x);
    expect(TARKIR_NOTCH_BOX.y).toBeLessThan(y);
    expect(TARKIR_NOTCH_BOX.x + TARKIR_NOTCH_BOX.width).toBeGreaterThan(x + width);
    // The oval's cut and its black ring fit inside the box.
    expect(TARKIR_NOTCH_BOX.y + TARKIR_NOTCH_BOX.height).toBeGreaterThanOrEqual(TARKIR_STAMP_OVAL_PX.y + TARKIR_STAMP_OVAL_PX.height + 2 + 2);
    expect(notchCutOf(HOLO_STAMP_NOTCHES.tarkirdragonholostamp)).toBe(TARKIR_NOTCH.oval);
    expect(TARKIRDRAGON_HOLO_STAMP.anatomy === "holoStamp" && TARKIRDRAGON_HOLO_STAMP.stamp.shape).toBe("oval");
    // The slot's oval is the cut's.
    for (const k of ["leftPct", "topPct", "widthPct", "heightPct"] as const) expect(TARKIRDRAGON_HOLO_STAMP_OVAL[k]).toBeCloseTo(TARKIR_NOTCH.oval[k], 9);
    expect(notchSourceFiles(HOLO_STAMP_NOTCHES.tarkirdragonholostamp)).toEqual([`${TARKIR}/stamp.png`]);
  });
});

describe("the wing tones onto print", () => {
  it("tones the w and u wings — the masters and crowns — against the artifact file of their kind, nothing else", () => {
    expect(Object.keys(TARKIR_PRINT_TONES).sort()).toEqual(["u", "w"]);
    expect(Object.keys(TARKIR_SOURCE_TONES).sort()).toEqual([`${TARKIR}/crowns/u.png`, `${TARKIR}/crowns/w.png`, `${TARKIR}/u.png`, `${TARKIR}/w.png`]);
    expect(sourceTonesOf(`${TARKIR}/w.png`)!.diff).toEqual({ wing: { file: `${TARKIR}/a.png`, ...TARKIR_WING_DIFF } });
    expect(sourceTonesOf(`${TARKIR}/crowns/u.png`)!.diff).toEqual({ wing: { file: `${TARKIR}/crowns/a.png`, ...TARKIR_WING_DIFF } });
    for (const f of ["b", "r", "g", "m", "a"].map((k) => `${TARKIR}/${k}.png`).concat([`${TARKIR}/pt/w.png`, `${TARKIR}/stamp.png`])) expect(sourceTonesOf(f), f).toBeNull();
    // The reference file is an importer input of the recipe.
    expect(sourceFilesFor(def as never)).toContain(`${TARKIR}/a.png`);
  });

  it("the wing region is where the file differs from the reference; the tone lands the wing's colour on print's", () => {
    const px = (r: number, g: number, b: number, a = 255) => [r, g, b, a];
    const ref = Buffer.from([...px(150, 160, 170), ...px(150, 160, 170), ...px(150, 160, 170), ...px(150, 160, 170)]);
    const buf = Buffer.from([...px(56, 110, 211), ...px(150, 160, 170), ...px(150 + 28, 160, 170), ...px(56, 110, 211, 0)]);
    const plane = diffRegionPlane(buf, ref, 4, 1, TARKIR_WING_DIFF);
    expect([...plane]).toEqual([255, 0, Math.round((255 * 12) / 24), 0]);
    const toned = toneSourceRegions(buf, 4, 1, { wing: plane }, TARKIR_PRINT_TONES.u);
    expect([...toned.subarray(0, 3)]).toEqual([75, 105, 177]);
    expect([...toned.subarray(4, 8)]).toEqual([150, 160, 170, 255]);
  });
});

describe("the importer's pieces", () => {
  const shape = TARKIR_NOTCH.shape;
  const { width, height } = shape.size;
  /** A synthetic piece: rim everywhere, a bright "hologram" oval in the
   *  well where the pack paints it, clear corners. */
  function piece(grow = 0): Buffer {
    const buf = Buffer.alloc(width * height * 4);
    const holo = cutInside(shape, TARKIR_NOTCH.oval, grow);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const o = (y * width + x) * 4;
        if ((x < 3 || x > width - 4) && (y < 3 || y > height - 4)) continue;
        const v = holo(x, y, 0) ? 220 : 20;
        buf.set([v, v, v - 10, 255], o);
      }
    }
    return buf;
  }

  it("cuts the oval clear, blacks its ring and holds every lit pixel of the well inside them", () => {
    const placed = piece();
    const captured = capturePlane(placed, width, height, TARKIR_NOTCH.capture);
    const out = blackoutAndCut(placed, shape, TARKIR_NOTCH.oval, 2, 2);
    expect(pieceNotchFindings(out, shape, TARKIR_NOTCH.oval, 2, 2, captured).failures).toEqual([]);
  });

  it("a capture drawn wider than the cut is refused", () => {
    const placed = piece(6);
    const captured = capturePlane(placed, width, height, TARKIR_NOTCH.capture);
    const out = blackoutAndCut(placed, shape, TARKIR_NOTCH.oval, 2, 2);
    expect(pieceNotchFindings(out, shape, TARKIR_NOTCH.oval, 2, 2, captured).failures.join(" ")).toMatch(/stamp shape/);
  });

  it("the crown band's findings want the spikes inside their rows", () => {
    const W = 1500;
    const band = Buffer.alloc(W * 2100 * 4);
    for (let y = 51; y < 116; y += 1) for (let x = 180; x < 1325; x += 1) band[(y * W + x) * 4 + 3] = 255;
    expect(tarkirCrownFindings(band, W, 2100, TARKIR_CROWN_BAND.rows).failures).toEqual([]);
    band[(30 * W + 700) * 4 + 3] = 9; // above the bounds
    band[(130 * W + 700) * 4 + 3] = 9; // past the band
    expect(tarkirCrownFindings(band, W, 2100, TARKIR_CROWN_BAND.rows).failures).toHaveLength(2);
  });
});

describe("the edges and corners", () => {
  it("the printed black border all round: struck from every pending list", () => {
    const border = { kind: "border" };
    expect(EDGE_CONTRACTS.tarkirdragon).toEqual({ top: border, right: border, bottom: border, left: border });
    expect(EDGE_CONTRACT_KNOWN_FAILURES.tarkirdragon).toBeUndefined();
    expect(ART_WINDOW_KNOWN_FAILURES.tarkirdragon).toBeUndefined();
    expect(BORDER_PENDING_TEMPLATES.has("tarkirdragon")).toBe(false);
    expect(NEVER_NORMALISE.test("tarkirdragon")).toBe(false);
    // …while the MSE Tarkir showcases stay on them.
    expect(NEVER_NORMALISE.test("tarkirdraconic")).toBe(true);
    expect(NEVER_NORMALISE.test("tarkirghostfire")).toBe(true);
    expect(SQUARE_CORNERS.tarkirdragon).toBeUndefined();
    expect(["tl", "tr", "bl", "br"].map((c) => squareCornerKind("tarkirdragon", "w", c as never))).toEqual(["border", "border", "border", "border"]);
  });
});

describe("the profile rides the masters", () => {
  const p = getFrameProfile("tarkirdragon");

  it("is an M15-era family member on the CC M15 cost row, its slots on the pack's bars", () => {
    expect(M15_FAMILY_TEMPLATES).toContain("tarkirdragon");
    expect(COLLECTOR_TEMPLATES).toContain("tarkirdragon");
    expect(p.collector).toBe(EXPEDITION_ZNR_COLLECTOR);
    expect(p.title.fit).toBe("measured");
    expect(p.type.fit).toBe("measured");
    expect([p.costSizePct, p.costDy, p.costDx]).toEqual([70 / 1500, -1.7 / 1500, 2 / 1500]);
    expect(p.twoColorSplit).toEqual({ atPct: 50 });
    // The window and its soft shadow (131–1365 × 232–1158) inside the slot
    // with the art-window check's 0.05 % to spare.
    const a = p.artSlot;
    expect((a.leftPct / 100) * 1500).toBeCloseTo(130, 9);
    expect(((a.leftPct + a.widthPct) / 100) * 1500).toBeCloseTo(1367, 9);
    expect((a.topPct / 100) * 2100).toBeCloseTo(231, 9);
    expect(((a.topPct + a.heightPct) / 100) * 2100).toBeCloseTo(1160, 9);
    expect(p.underFrameArt).toBeUndefined();
    expect(p.pt?.plateAssetPathTemplate).toBe("/frames/tarkirdragon/pt/{color}.png");
    expect(PLATE_INK["/frames/tarkirdragon/pt/{color}.png"]).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
    // Black name and type line on the silver bars, white rules on the box.
    expect([p.title.colorHex, p.type.colorHex, p.rules.colorHex]).toEqual(["#17120c", "#17120c", "#ffffff"]);
  });

  it("keys the crown by the pair a two-colour card splits its wings into, the stamp by the colour key", () => {
    const style = { template: "tarkirdragon", crown: true, stamp: "auto" } as never;
    const keysOf = (facts: Record<string, unknown>) =>
      resolveFrameOverlays(p, style, { colors: [], rarity: "rare", supertype: "Legendary", cardType: "creature", ...facts, colorKey: facts.colorKey as string } as never).map((o) => `${o.anatomy}:${o.key}`);
    expect(keysOf({ colorKey: "w", colors: ["white"] })).toEqual(["crown:w", "holoStamp:w"]);
    expect(keysOf({ colorKey: "m", colors: ["white", "blue"] })).toEqual(["crown:wu", "holoStamp:m"]);
    expect(keysOf({ colorKey: "m", colors: ["white", "blue", "black"] })).toEqual(["crown:m", "holoStamp:m"]);
    expect(keysOf({ colorKey: "c", colors: [], cardType: "artifact" })).toEqual(["crown:c", "holoStamp:c"]);
    // "auto" is a rare or mythic on an oval frame; the crown wants a legend.
    expect(keysOf({ colorKey: "g", colors: ["green"], supertype: null, rarity: "common" })).toEqual([]);
    for (const pair of PAIRS) expect(TARKIRDRAGON_CROWN.keys, pair).toContain(pair);
  });
});

const masters = MASTER_KEYS.map((k) => [k, published(`tarkirdragon/${k}.png`)] as const);
const crowns = [...MASTER_KEYS, ...PAIRS].map((k) => [k, published(`tarkirdragoncrown/${k}.png`)] as const);
const notches = MASTER_KEYS.map((k) => [k, published(`tarkirdragonholostamp/${k}.png`)] as const);
const available = [...masters, ...crowns, ...notches].every(([, b]) => b !== null);

describe.skipIf(!available)("the published objects (set FRAMES_BUILD_DIR if skipped)", () => {
  it.each(MASTER_KEYS)("tarkirdragon/%s: 1500 × 2100, the black border all round, the window clear, the wings toned", async (key) => {
    const { data, info } = await sharp(published(`tarkirdragon/${key}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([1500, 2100]);
    const px = (x: number, y: number) => Array.from(data.subarray((y * 1500 + x) * 4, (y * 1500 + x) * 4 + 4));
    for (const [x, y] of [[750, 8], [8, 1050], [1491, 1050], [750, 2090]]) {
      const [r, g, b, a] = px(x, y);
      expect(a, `${key} (${x}, ${y})`).toBe(255);
      expect(r + g + b, `${key} (${x}, ${y})`).toBeLessThan(40);
    }
    expect([px(0, 0)[3], px(1499, 0)[3], px(0, 2099)[3], px(1499, 2099)[3]]).toEqual([0, 0, 0, 0]);
    expect(px(750, 700)[3]).toBe(0);
    // The two masters of a pair differ only on the wings: the seam at 50 %W
    // crosses identical pixels (checked against w).
    if (key !== "w") {
      const w = await sharp(published("tarkirdragon/w.png")!).ensureAlpha().raw().toBuffer();
      let differ = 0;
      for (let y = 0; y < 2100; y += 3) for (let x = 430; x < 1070; x += 3) if (Math.abs(w[(y * 1500 + x) * 4] - data[(y * 1500 + x) * 4]) > 2) differ += 1;
      expect(differ, key).toBe(0);
    }
  });

  it.each([...MASTER_KEYS, ...PAIRS])("tarkirdragoncrown/%s passes the importer's checks", async (key) => {
    const band = await sharp(published(`tarkirdragoncrown/${key}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([band.info.width, band.info.height]).toEqual([1500, TARKIR_CROWN_BAND.rows]);
    const full = Buffer.alloc(1500 * 2100 * 4);
    band.data.copy(full);
    expect(tarkirCrownFindings(full, 1500, 2100, TARKIR_CROWN_BAND.rows).failures).toEqual([]);
  });

  it("tarkirdragonholostamp: one piece for every key, its oval cut and ringed", async () => {
    const shas = new Set(MASTER_KEYS.map((k) => MANIFEST[`tarkirdragonholostamp/${k}.png`].sha256));
    expect(shas.size).toBe(1);
    const notch = await sharp(published("tarkirdragonholostamp/w.png")!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([notch.info.width, notch.info.height]).toEqual([TARKIR_NOTCH_BOX.width, TARKIR_NOTCH_BOX.height]);
    expect(pieceNotchFindings(notch.data, TARKIR_NOTCH.shape, TARKIR_NOTCH.oval, 2, 2).failures).toEqual([]);
  });
});
