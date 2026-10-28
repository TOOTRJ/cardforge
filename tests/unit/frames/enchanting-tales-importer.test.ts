import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  CC_TEMPLATES,
  ETALES,
  ETALES_KEEP_CORNERS,
  ETALES_LOWER_RECUT,
  ETALES_NOTCH,
  ETALES_NOTCH_BOX,
  ETALES_PRINT_TONE,
  ETALES_SOLID_ROWS,
  ETALES_STAMP_OVAL_PX,
  ETALES_WELL_TONE,
  HOLO_STAMP_NOTCHES,
  blackoutAndCut,
  capturePlane,
  cutInside,
  fillRowsOutsideCut,
  flattenNearToneRgba8,
  notchCutOf,
  notchSourceFiles,
  pieceNotchFindings,
  shiftBlocksRgba8,
  solidifyRowsRgba8,
  sourceFilesFor,
  sourceTonesOf,
} from "../../../scripts/lib/cc-frames.mjs";
import { resolveFrameOverlays } from "@/lib/cards/anatomy";
import { COLLECTOR_TEMPLATES } from "@/lib/cards/collector-line";
import { M15_FAMILY_TEMPLATES } from "@/lib/cards/m15-family";
import { PLATE_INK } from "@/lib/cards/plate-ink";
import {
  ENCHANTINGTALES_ART_SLOT,
  ENCHANTINGTALES_COLLECTOR,
  ENCHANTINGTALES_HOLO_STAMP,
  ENCHANTINGTALES_HOLO_STAMP_OVAL,
  M15_COLLECTOR,
  artReachesCardEdge,
  getFrameProfile,
} from "@/lib/cards/template-layout";
import { EDGE_CONTRACTS, EDGE_CONTRACT_KNOWN_FAILURES } from "@/lib/frames/edge-contract";
import { ART_WINDOW_KNOWN_FAILURES } from "@/lib/frames/art-window";
import { SQUARE_CORNERS, squareCornerKind } from "@/lib/frames/square-corners";
import { BORDER_PENDING_TEMPLATES } from "@/lib/scryfall/frame-signatures";
import { FRAME_ERA_LABELS, FRAME_SET_ERA, FRAME_SET_LABELS, FRAME_TEMPLATE_LABELS, FRAME_TEMPLATE_SET } from "@/types/card";
import manifestJson from "@/lib/frames/frame-manifest.json";

// ---------------------------------------------------------------------------
// TODO 4.11 wave 2: the Wilds of Eldraine ENCHANTING TALES showcase
// (`enchantingtales`; WOT #1–63) from Card Conjurer's 'Enchanting Tales'
// pack (2010 × 2814, downscaled once) — a NEW template, an addition. The
// recipe (the six colour frames, `c` the white one), the tone rule's verdict
// (nothing toned), the lower block's lossless move onto print, the solid top
// rows and kept corners, its OVAL notch (the pack's piece per colour,
// resampled once and placed on print, the hologram oval cut, no black ring),
// no crown, the borderless edges, the profile and, where the published
// objects are on disk at the manifest's sha256 (FRAMES_BUILD_DIR, else
// .frames-build; CI fetches them), their pixels.
// ---------------------------------------------------------------------------

type Layer = { src: string };
type Def = { colors: Record<string, Layer[]>; plates: Record<string, string>; shift: unknown; shiftOnOutput: boolean; solidRows: unknown; keepCorners: readonly string[] };
const def = (CC_TEMPLATES as unknown as Record<string, Def>).enchantingtales;
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
const fileOf = (k: string) => (k === "c" ? "w" : k);

describe("the Enchanting Tales recipe", () => {
  it("is the pack's six colour frames whole, `c` the white one, and their plates — no pair, no artifact master", () => {
    expect(ETALES).toBe("img/frames/enchantingTales");
    expect(Object.keys(def.colors).sort()).toEqual([...MASTER_KEYS].sort());
    for (const key of MASTER_KEYS) expect(def.colors[key], key).toEqual([{ src: `${ETALES}/${fileOf(key)}.png` }]);
    for (const key of MASTER_KEYS) expect(def.plates[key], key).toBe(`${ETALES}/pt/${fileOf(key)}.png`);
    expect(sourceFilesFor(def as never).sort()).toEqual(
      [...["w", "u", "b", "r", "g", "m"].map((k) => `${ETALES}/${k}.png`), ...["w", "u", "b", "r", "g", "m"].map((k) => `${ETALES}/pt/${k}.png`)].sort(),
    );
  });

  it("tones nothing: every opaque region within 5 levels of the 63 prints' raw medians", () => {
    for (const k of ["w", "u", "b", "r", "g", "m"]) {
      expect(sourceTonesOf(`${ETALES}/${k}.png`), k).toBeNull();
      expect(sourceTonesOf(`${ETALES}/pt/${k}.png`), k).toBeNull();
      expect(sourceTonesOf(`${ETALES}/stamp/${k}.png`), k).toBeNull();
    }
    for (const [key, regions] of Object.entries(ETALES_PRINT_TONE)) {
      for (const [region, [pack, print]] of Object.entries(regions as Record<string, number[][]>)) {
        const off = pack.map((v, i) => Math.abs(v - print[i]));
        expect(Math.max(...off), `${key} ${region}`).toBeLessThan(9);
      }
    }
  });

  it("moves the lower block 3 px up through the flat zones, in the written master's rows; keeps the top block", () => {
    expect(def.shift).toBe(ETALES_LOWER_RECUT);
    expect(def.shiftOnOutput).toBe(true);
    expect(ETALES_LOWER_RECUT).toEqual({ axis: "y", blocks: [{ from: 0, to: 472, by: 0 }, { from: 1163, to: 1954, by: -3 }] });
    // On a synthetic master with the pack's shape (flat zones where the
    // pack has them), the block lands 3 px up byte for byte, the zones
    // repeated.
    const W = 4;
    const H = 2100;
    const buf = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y += 1) {
      const v = y < 472 ? y % 251 : y < 1163 ? 0 : y < 1954 ? (y * 7) % 253 : 9;
      for (let x = 0; x < W; x += 1) buf.set([v, v, v, y >= 472 && y < 1163 ? 0 : 255], (y * W + x) * 4);
    }
    const out = shiftBlocksRgba8(buf, W, H, ETALES_LOWER_RECUT);
    const row = (b: Buffer, y: number) => b.subarray(y * W * 4, (y + 1) * W * 4);
    for (const y of [0, 471, 1163, 1500, 1953]) expect(row(out, y + (y >= 1163 ? -3 : 0)).equals(row(buf, y)), String(y)).toBe(true);
    for (const y of [1159, 1951, 2099]) expect(row(out, y).equals(row(buf, y < 1163 ? 1000 : 2000)), String(y)).toBe(true);
    // A zone that is not flat is refused.
    buf[(1000 * W) * 4 + 3] = 7;
    expect(() => shiftBlocksRgba8(buf, W, H, ETALES_LOWER_RECUT)).toThrow(/not flat/);
  });

  it("makes the top rows solid where Card Conjurer left them nearly so, and keeps all four corners", () => {
    expect(def.solidRows).toBe(ETALES_SOLID_ROWS);
    expect(ETALES_SOLID_ROWS).toEqual({ y0: 0, y1: 80, minAlpha: 128 });
    const W = 3;
    const H = 100;
    const buf = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) buf.set([10, 20, 30, [0, 100, 128, 250][x % 4] ?? 0], (y * W + x) * 4);
    const changed = solidifyRowsRgba8(buf, W, H, ETALES_SOLID_ROWS);
    expect(changed).toBe(80);
    expect(Array.from(buf.subarray(0, 12))).toEqual([10, 20, 30, 0, 10, 20, 30, 100, 10, 20, 30, 255]);
    expect(buf[(85 * W + 2) * 4 + 3]).toBe(128);
    expect(def.keepCorners).toBe(ETALES_KEEP_CORNERS);
    expect([...ETALES_KEEP_CORNERS]).toEqual(["tl", "tr", "bl", "br"]);
  });

  it("builds no crown band: the pack draws none and no printing is legendary", () => {
    expect(getFrameProfile("enchantingtales").overlays?.map((o) => o.anatomy)).toEqual(["holoStamp"]);
  });

  it("the notch publishes the keys the profile's slot asks for, at the importer's box, its oval the prints'", () => {
    expect([...ETALES_NOTCH.keys]).toEqual(ENCHANTINGTALES_HOLO_STAMP.keys);
    expect(ENCHANTINGTALES_HOLO_STAMP.rect).toEqual({
      leftPct: (ETALES_NOTCH_BOX.x / 1500) * 100,
      topPct: (ETALES_NOTCH_BOX.y / 2100) * 100,
      widthPct: (ETALES_NOTCH_BOX.width / 1500) * 100,
      heightPct: (ETALES_NOTCH_BOX.height / 2100) * 100,
    });
    // The pack's 306 × 176 piece, resampled once to 171 × 99 and placed on
    // print: 3 px up with the lower block, 2 px right of CC's bounds
    // (664.2 / 1901.5 px).
    expect(ETALES_NOTCH.nativeSize).toEqual({ width: 306, height: 176 });
    expect(ETALES_NOTCH.placeAt).toEqual({ x: 666, y: 1898, width: 171, height: 99 });
    const { x, y, width, height } = ETALES_NOTCH.placeAt;
    expect([ETALES_NOTCH_BOX.x, ETALES_NOTCH_BOX.y, ETALES_NOTCH_BOX.width, ETALES_NOTCH_BOX.height]).toEqual([x - 1, y - 1, width + 2, height + 2]);
    expect(ETALES_STAMP_OVAL_PX).toEqual({ x: 688, y: 1923, width: 127, height: 64 });
    expect(notchCutOf(HOLO_STAMP_NOTCHES.enchantingtalesholostamp)).toBe(ETALES_NOTCH.oval);
    expect(HOLO_STAMP_NOTCHES.enchantingtalesholostamp.blackoutPx).toBe(0);
    expect(ENCHANTINGTALES_HOLO_STAMP.anatomy === "holoStamp" && ENCHANTINGTALES_HOLO_STAMP.stamp.shape).toBe("oval");
    for (const k of ["leftPct", "topPct", "widthPct", "heightPct"] as const) expect(ENCHANTINGTALES_HOLO_STAMP_OVAL[k]).toBeCloseTo(ETALES_NOTCH.oval[k], 9);
    expect(notchSourceFiles(HOLO_STAMP_NOTCHES.enchantingtalesholostamp)).toEqual(["w", "u", "b", "r", "g", "m"].map((k) => `${ETALES}/stamp/${k}.png`).sort());
  });
});

describe("the importer's notch piece", () => {
  const shape = ETALES_NOTCH.shape;
  const { width, height } = shape.size;
  /** A synthetic piece: a well in the footer's tone, a light rim in the box's
   *  top corners, a bright "hologram" oval where the pack paints it. */
  function piece(grow = 0): Buffer {
    const buf = Buffer.alloc(width * height * 4);
    const holo = cutInside(shape, ETALES_NOTCH.oval, grow);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const o = (y * width + x) * 4;
        if ((x < 3 || x > width - 4) && (y < 3 || y > height - 4)) continue;
        const rim = y < 28 && (x < 30 || x > width - 30);
        const v = holo(x, y, 0) ? 220 : rim ? 245 : 72;
        buf.set([v, v, v - 10, 255], o);
      }
    }
    return buf;
  }

  it("cuts the oval clear with no ring and holds every lit pixel of the capture's ellipse inside the cut — the light rim is no capture", () => {
    const placed = piece();
    const captured = capturePlane(placed, width, height, ETALES_NOTCH.capture);
    // Without the ellipse the box's corners would read the rim as capture.
    expect(capturePlane(placed, width, height, { ...ETALES_NOTCH.capture, oval: false }).some((v, p) => v > 0 && p % width < 30 && p / width < 28)).toBe(true);
    const out = blackoutAndCut(placed, shape, ETALES_NOTCH.oval, 2, 0);
    expect(pieceNotchFindings(out, shape, ETALES_NOTCH.oval, 2, 0, captured).failures).toEqual([]);
    // The well round the cut keeps its tone: no black ring.
    const inside = cutInside(shape, ETALES_NOTCH.oval, 2);
    let ring = 0;
    for (let yy = 0; yy < height; yy += 1) for (let xx = 0; xx < width; xx += 1) if (!inside(xx, yy, 0) && inside(xx, yy, 2) && out[(yy * width + xx) * 4] === 0) ring += 1;
    expect(ring).toBe(0);
  });

  it("flattens the well into the footer tone and fills the piece's own pixels below the rim — the cut and what the piece leaves clear stay clear", () => {
    expect(HOLO_STAMP_NOTCHES.enchantingtalesholostamp.wellTone).toBe(ETALES_WELL_TONE);
    expect(ETALES_WELL_TONE).toEqual({ master: "enchantingtales", at: { x: 750, y: 2060 }, within: 12, footerFromRow: 51 });
    // Row 51 of the piece is card row 1948: below the box's rim, on the
    // master's flat footer (from 1947).
    expect(ETALES_NOTCH_BOX.y + ETALES_WELL_TONE.footerFromRow).toBe(1948);
    const tone = [72, 71, 61];
    const px = Buffer.from([65, 65, 53, 180, 72, 71, 61, 255, 245, 245, 235, 255, 70, 69, 57, 0]);
    expect(flattenNearToneRgba8(px, tone, 12)).toBe(1);
    expect(Array.from(px)).toEqual([72, 71, 61, 180, 72, 71, 61, 255, 245, 245, 235, 255, 70, 69, 57, 0]);
    const placed = blackoutAndCut(piece(), shape, ETALES_NOTCH.oval, 2, 0);
    // A soft, darker outer edge and a light low-α fringe below the rim.
    placed.set([60, 60, 50, 120], (90 * width + 30) * 4);
    placed.set([160, 160, 150, 40], (90 * width + 31) * 4);
    placed.set([0, 0, 0, 0], (90 * width + 2) * 4);
    fillRowsOutsideCut(placed, shape, ETALES_NOTCH.oval, 2, ETALES_WELL_TONE.footerFromRow, tone);
    expect(Array.from(placed.subarray((90 * width + 30) * 4, (90 * width + 32) * 4))).toEqual([...tone, 255, ...tone, 255]);
    expect(placed[(90 * width + 2) * 4 + 3]).toBe(0);
    const inside = cutInside(shape, ETALES_NOTCH.oval, 2);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (inside(x, y, 0)) expect(placed[(y * width + x) * 4 + 3], `${x},${y}`).toBe(0);
  });

  it("a capture drawn wider than the cut is refused", () => {
    const placed = piece(6);
    const captured = capturePlane(placed, width, height, ETALES_NOTCH.capture);
    const out = blackoutAndCut(placed, shape, ETALES_NOTCH.oval, 2, 0);
    expect(pieceNotchFindings(out, shape, ETALES_NOTCH.oval, 2, 0, captured).failures.join(" ")).toMatch(/stamp shape/);
  });
});

describe("the edges and corners", () => {
  it("borderless as printed: design top and bottom, the art to the sides between the swirls; on no pending list", () => {
    expect(EDGE_CONTRACTS.enchantingtales).toEqual({
      top: { kind: "design" },
      right: { kind: "art", except: [[0, 5.8], [65.8, 100]] },
      bottom: { kind: "design" },
      left: { kind: "art", except: [[0, 22.4], [65.8, 100]] },
    });
    expect(EDGE_CONTRACT_KNOWN_FAILURES.enchantingtales).toBeUndefined();
    expect(ART_WINDOW_KNOWN_FAILURES.enchantingtales).toBeUndefined();
    expect(BORDER_PENDING_TEMPLATES.has("enchantingtales")).toBe(false);
    expect(SQUARE_CORNERS.enchantingtales).toEqual({ kinds: "frame" });
    expect(["tl", "tr", "bl", "br"].map((c) => squareCornerKind("enchantingtales", "w", c as never))).toEqual(["frame", "frame", "frame", "frame"]);
  });
});

describe("the profile", () => {
  const p = getFrameProfile("enchantingtales");

  it("is a new showcase set of its own, Wilds of Eldraine — Enchanting Tales", () => {
    expect(FRAME_TEMPLATE_LABELS.enchantingtales).toBe("Enchanting Tales");
    expect(FRAME_TEMPLATE_SET.enchantingtales).toBe("eldraine");
    expect(FRAME_SET_LABELS.eldraine).toBe("Wilds of Eldraine");
    expect(FRAME_ERA_LABELS[FRAME_SET_ERA.eldraine]).toBe("Showcase & Universes Beyond");
  });

  it("is an M15-era family member: the CC M15 row 3 px right, the name riding the pack's bar, the lower slots on print", () => {
    expect(M15_FAMILY_TEMPLATES).toContain("enchantingtales");
    expect(COLLECTOR_TEMPLATES).toContain("enchantingtales");
    expect(p.title.fit).toBe("measured");
    expect(p.type.fit).toBe("measured");
    expect(p.costSizePct).toBeCloseTo(70 / 1500, 12);
    expect(p.costDy).toBeCloseTo(-6.6 / 1500, 12);
    expect(p.costDx).toBeCloseTo(5 / 1500, 12);
    expect(p.title.dy! - getFrameProfile("m15").title.dy!).toBeCloseTo(-3.5 / 1500, 12);
    // The art under the whole frame from the title bar to the box's foot:
    // to the side edges, never to the top or bottom — not edge-to-edge.
    const a = p.artSlot;
    expect(a).toBe(ENCHANTINGTALES_ART_SLOT);
    expect([a.leftPct, a.widthPct]).toEqual([0, 100]);
    expect((a.topPct / 100) * 2100).toBeCloseTo(111, 9);
    expect(((a.topPct + a.heightPct) / 100) * 2100).toBeCloseTo(1932, 9);
    expect(artReachesCardEdge(p)).toBe(false);
    // White rules in Card Conjurer's rect 3 px up: 1313–1917 px.
    expect(p.rules.colorHex).toBe("#ffffff");
    expect((p.rules.rect.topPct / 100) * 2100).toBeCloseTo(1313, 9);
    expect(((p.rules.rect.topPct + p.rules.rect.heightPct) / 100) * 2100).toBeCloseTo(1916.75, 9);
    // The pack's plate at its bounds, 3 px up with the block.
    expect(p.pt?.plateAssetPathTemplate).toBe("/frames/enchantingtales/pt/{color}.png");
    expect(((p.pt!.plateRect!.topPct / 100) * 2100)).toBeCloseTo((2458 / 2814) * 2100 - 3, 9);
    expect(PLATE_INK["/frames/enchantingtales/pt/{color}.png"]).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
    // The collector line on the run's rows, M15's pen and sizes.
    expect(p.collector).toBe(ENCHANTINGTALES_COLLECTOR);
    expect({ ...ENCHANTINGTALES_COLLECTOR, line1BaselinePct: 0, line2BaselinePct: 0 }).toEqual({ ...M15_COLLECTOR, line1BaselinePct: 0, line2BaselinePct: 0 });
    expect((ENCHANTINGTALES_COLLECTOR.line1BaselinePct / 100) * 2100).toBeCloseTo(1990, 9);
    expect((ENCHANTINGTALES_COLLECTOR.line2BaselinePct / 100) * 2100).toBeCloseTo(2029, 9);
    expect(p.twoColorMasters).toBeUndefined();
    expect(p.twoColorSplit).toBeUndefined();
  });

  it("keys the stamp by the colour key; 'auto' is a rare or mythic", () => {
    const style = { template: "enchantingtales", crown: true, stamp: "auto" } as never;
    const keysOf = (facts: Record<string, unknown>) =>
      resolveFrameOverlays(p, style, { colors: [], rarity: "rare", supertype: null, cardType: "enchantment", ...facts, colorKey: facts.colorKey as string } as never).map((o) => `${o.anatomy}:${o.key}`);
    expect(keysOf({ colorKey: "u", colors: ["blue"] })).toEqual(["holoStamp:u"]);
    expect(keysOf({ colorKey: "m", colors: ["white", "blue"] })).toEqual(["holoStamp:m"]);
    expect(keysOf({ colorKey: "c", colors: [] })).toEqual(["holoStamp:c"]);
    expect(keysOf({ colorKey: "g", colors: ["green"], rarity: "uncommon" })).toEqual([]);
  });
});

const masters = MASTER_KEYS.map((k) => [k, published(`enchantingtales/${k}.png`)] as const);
const plates = MASTER_KEYS.map((k) => [k, published(`enchantingtales/pt/${k}.png`)] as const);
const notches = MASTER_KEYS.map((k) => [k, published(`enchantingtalesholostamp/${k}.png`)] as const);
const available = [...masters, ...plates, ...notches].every(([, b]) => b !== null);

describe.skipIf(!available)("the published objects (set FRAMES_BUILD_DIR if skipped)", () => {
  it("`c` is the white frame, plate and piece; every other key its own", () => {
    for (const folder of ["enchantingtales", "enchantingtales/pt", "enchantingtalesholostamp"]) {
      expect(MANIFEST[`${folder}/c.png`].sha256, folder).toBe(MANIFEST[`${folder}/w.png`].sha256);
      const shas = new Set(["w", "u", "b", "r", "g", "m"].map((k) => MANIFEST[`${folder}/${k}.png`].sha256));
      expect(shas.size, folder).toBe(6);
    }
  });

  it.each(["w", "u", "b", "r", "g", "m"])("enchantingtales/%s: 1500 × 2100, the corners square and solid, the window clear, the lower block on print, the footer flat", async (key) => {
    const { data, info } = await sharp(published(`enchantingtales/${key}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([1500, 2100]);
    const a = (x: number, y: number) => data[(y * 1500 + x) * 4 + 3];
    // Kept corners: solid to the card's corner (the top ones through the
    // solid rows).
    for (const [x, y] of [[0, 0], [1499, 0], [0, 2099], [1499, 2099], [26, 13], [1473, 13]]) expect(a(x, y), `(${x}, ${y})`).toBe(255);
    // The window clear, the art to the side edges between the swirls.
    for (const [x, y] of [[750, 700], [3, 900], [1496, 300]]) expect(a(x, y), `(${x}, ${y})`).toBe(0);
    // The type bar's top outline where print draws it (from 1165–1167), the
    // translucent box over the art, the footer's flat rows to the bottom.
    expect(a(750, 1150)).toBe(0);
    expect(a(750, 1167)).toBe(255);
    expect(a(750, 1600)).toBeGreaterThan(190);
    expect(a(750, 1600)).toBeLessThan(250);
    const row = (y: number) => data.subarray(y * 6000, (y + 1) * 6000);
    for (const y of [1960, 2050, 2099]) expect(row(y).equals(row(1951)), String(y)).toBe(true);
  });

  it.each(MASTER_KEYS)("enchantingtalesholostamp/%s: the cut clear at the oval, the well's tone round it, the rim at its top", async (key) => {
    const { data, info } = await sharp(published(`enchantingtalesholostamp/${key}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([ETALES_NOTCH_BOX.width, ETALES_NOTCH_BOX.height]);
    const px = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4));
    const cx = ETALES_STAMP_OVAL_PX.x + ETALES_STAMP_OVAL_PX.width / 2 - ETALES_NOTCH_BOX.x;
    const cy = ETALES_STAMP_OVAL_PX.y + ETALES_STAMP_OVAL_PX.height / 2 - ETALES_NOTCH_BOX.y;
    expect(px(Math.floor(cx), Math.floor(cy))[3]).toBe(0);
    // Just outside the cut, below the oval: the well, opaque and not black.
    const below = px(Math.floor(cx), ETALES_STAMP_OVAL_PX.y + ETALES_STAMP_OVAL_PX.height + 4 - ETALES_NOTCH_BOX.y);
    expect(below[3]).toBe(255);
    expect(below[0] + below[1] + below[2]).toBeGreaterThan(0);
    const found = pieceNotchFindings(Buffer.from(data), ETALES_NOTCH.shape, ETALES_NOTCH.oval, 2, 0, capturePlane(Buffer.from(data), info.width, info.height, ETALES_NOTCH.capture));
    expect(found.failures).toEqual([]);
    // Below the rim the piece IS the master's footer (no line round the
    // well): every pixel it draws there outside the cut is the tone, opaque.
    const master = await sharp(published(`enchantingtales/${key}.png`)!).ensureAlpha().raw().toBuffer();
    const t = (ETALES_WELL_TONE.at.y * 1500 + ETALES_WELL_TONE.at.x) * 4;
    const tone = [master[t], master[t + 1], master[t + 2]];
    const inside = cutInside(ETALES_NOTCH.shape, ETALES_NOTCH.oval, 2);
    for (let y = ETALES_WELL_TONE.footerFromRow; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        if (inside(x, y, 0)) continue;
        const p = px(x, y);
        if (p[3] === 0) continue;
        expect(p, `${key} ${x},${y}`).toEqual([...tone, 255]);
      }
    }
  });
});
