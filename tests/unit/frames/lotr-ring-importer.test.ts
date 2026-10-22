import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  CC_OVERLAY_BANDS,
  CC_TEMPLATES,
  HOLO_STAMP_NOTCHES,
  RING,
  RING_CROWN_BAND,
  RING_KEEP_CORNERS,
  RING_NOTCH,
  RING_NOTCH_BOX,
  blackoutAndCut,
  blackoutStampShape,
  cutInside,
  notchSourceFiles,
  pieceNotchFindings,
  ringCrownFindings,
  roundCornersRgba8,
  stampShapeBlackFindings,
} from "../../../scripts/lib/cc-frames.mjs";
import { resolveFrameOverlays } from "@/lib/cards/anatomy";
import { cardCornerRadiusPx } from "@/lib/cards/card-corner";
import { COLLECTOR_TEMPLATES } from "@/lib/cards/collector-line";
import { M15_FAMILY_TEMPLATES } from "@/lib/cards/m15-family";
import { PLATE_INK } from "@/lib/cards/plate-ink";
import { UB_STAMP_HOLE } from "@/lib/cards/holo-stamp";
import { LOTR_CROWN, LOTR_HOLO_STAMP, getFrameProfile } from "@/lib/cards/template-layout";
import { EDGE_CONTRACTS, EDGE_CONTRACT_KNOWN_FAILURES, cornerViolations, edgeContractViolations } from "@/lib/frames/edge-contract";
import { ART_WINDOW_KNOWN_FAILURES } from "@/lib/frames/art-window";
import { SQUARE_CORNERS, squareCornerKind } from "@/lib/frames/square-corners";
import { BORDER_PENDING_TEMPLATES } from "@/lib/scryfall/frame-signatures";
import { NEVER_NORMALISE } from "../../../scripts/lib/frame-corners.mjs";
import manifestJson from "@/lib/frames/frame-manifest.json";

// ---------------------------------------------------------------------------
// TODO 4.11 (showcase rebuild, wave 1; layout v63): the Lord of the Rings
// RING showcase re-sourced from Card Conjurer's 'Ring' pack (1500 × 2100
// native) — the recipe (whole files, `c` the land frame, `a` the artifact
// frame, the ring plates, the top corners kept square), its crown band and
// triangle notch (the pack's own piece per key, its hologram shape blacked
// out, the Universes Beyond hole cut), the edges (the frame field's `design`
// edges, the black border's shoulders), the profile that rides the masters
// and, where the published objects are on disk at the manifest's sha256
// (FRAMES_BUILD_DIR, else .frames-build; CI fetches them), their pixels.
// ---------------------------------------------------------------------------

type Layer = { src: string };
const def = (CC_TEMPLATES as unknown as Record<string, { colors: Record<string, Layer[]>; plates: Record<string, string>; keepCorners?: readonly string[] }>).lotr;
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
type Entry = { sha256: string; width: number; height: number };
const MANIFEST = (manifestJson as { files: Record<string, Entry> }).files;

function published(rel: string): Buffer | null {
  const file = path.join(BUILD, rel);
  if (!MANIFEST[rel] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === MANIFEST[rel].sha256 ? bytes : null;
}

const MASTER_KEYS = ["w", "u", "b", "r", "g", "c", "m", "a"];
const OVERLAY_KEYS = ["w", "u", "b", "r", "g", "m", "a", "l"];

describe("the ring recipe", () => {
  it("is the pack's whole file per key: `c` the brown land frame, `a` the artifact frame, the top corners kept", () => {
    expect(RING).toBe("img/frames/lotr");
    expect(Object.keys(def.colors).sort()).toEqual([...MASTER_KEYS].sort());
    for (const key of ["w", "u", "b", "r", "g", "m", "a"]) expect(def.colors[key], key).toEqual([{ src: `${RING}/${key}.png` }]);
    expect(def.colors.c).toEqual([{ src: `${RING}/l.png` }]);
    expect(def.keepCorners).toBe(RING_KEEP_CORNERS);
    expect([...RING_KEEP_CORNERS]).toEqual(["tl", "tr"]);
    expect(CC_OVERLAY_BANDS.lotrcrown.keepCorners).toBe(RING_KEEP_CORNERS);
  });

  it("its plates: the pack's plates, the colourless card the artifact's", () => {
    for (const key of ["w", "u", "b", "r", "g", "m"]) expect(def.plates[key], key).toBe(`${RING}/pt/${key}.png`);
    expect(def.plates.c).toBe(`${RING}/pt/a.png`);
  });

  it("the crown band and the notch publish the keys the profile's slots ask for, at the importer's boxes", () => {
    expect([...RING_CROWN_BAND.keys]).toEqual(LOTR_CROWN.keys);
    expect(CC_OVERLAY_BANDS.lotrcrown.keys).toBe(RING_CROWN_BAND.keys);
    expect([...RING_NOTCH.keys]).toEqual(LOTR_HOLO_STAMP.keys);
    expect([...LOTR_CROWN.keys].sort()).toEqual([...OVERLAY_KEYS].sort());
    // The crown repaints the card's top 272 rows, 1:1.
    expect(LOTR_CROWN.rect).toEqual({ topPct: 0, leftPct: 0, widthPct: 100, heightPct: (RING_CROWN_BAND.rows / 2100) * 100 });
    expect(RING_CROWN_BAND.rows).toBe(272);
    // The notch slot's rect is the importer's box, 1:1 at HD…
    expect(LOTR_HOLO_STAMP.rect).toEqual({
      leftPct: (RING_NOTCH_BOX.x / 1500) * 100,
      topPct: (RING_NOTCH_BOX.y / 2100) * 100,
      widthPct: (RING_NOTCH_BOX.width / 1500) * 100,
      heightPct: (RING_NOTCH_BOX.height / 2100) * 100,
    });
    // …which holds the pack's piece at its bounds (644 / 1893, 212 × 95)
    // with a pixel to spare, and the stamp hole with its cut and ring.
    const { x, y, width, height } = RING_NOTCH.placeAt;
    expect(RING_NOTCH_BOX.x).toBeLessThan(x);
    expect(RING_NOTCH_BOX.y).toBeLessThan(y);
    expect(RING_NOTCH_BOX.x + RING_NOTCH_BOX.width).toBeGreaterThan(x + width);
    expect(RING_NOTCH_BOX.y + RING_NOTCH_BOX.height).toBeGreaterThanOrEqual(UB_STAMP_HOLE.points[2][1] + 2 + 2);
    expect(HOLO_STAMP_NOTCHES.lotrholostamp.triangle).toBe(UB_STAMP_HOLE);
    expect(LOTR_HOLO_STAMP.anatomy === "holoStamp" && LOTR_HOLO_STAMP.stamp.shape).toBe("triangle");
    expect(notchSourceFiles(HOLO_STAMP_NOTCHES.lotrholostamp)).toEqual([...OVERLAY_KEYS.map((k) => `${RING}/stamp/${k}.png`), `${RING}/stamp/gray.png`].sort());
  });
});

describe("the importer's pieces", () => {
  it("keeps a recipe's square corners: the cut lands on the others only", () => {
    const W = 200;
    const H = 280;
    const r = cardCornerRadiusPx(W, H);
    const buf = Buffer.alloc(W * H * 4, 255);
    roundCornersRgba8(buf, W, H, r, ["tl", "tr"]);
    const a = (x: number, y: number) => buf[(y * W + x) * 4 + 3];
    expect([a(0, 0), a(W - 1, 0)]).toEqual([255, 255]);
    expect([a(0, H - 1), a(W - 1, H - 1)]).toEqual([0, 0]);
    // No list = every corner cut, as before.
    const all = Buffer.alloc(W * H * 4, 255);
    roundCornersRgba8(all, W, H, r);
    expect([all[3], all[(W - 1) * 4 + 3]]).toEqual([0, 0]);
  });

  const shape = RING_NOTCH.shape;
  const { width, height } = shape.size;
  /** A synthetic piece: rim everywhere, a bright "hologram" triangle drawn
   *  10 px HIGHER than the hole (as the pack draws it), clear corners. */
  function piece(): { buf: Buffer; stamp: Uint8Array } {
    const buf = Buffer.alloc(width * height * 4);
    const stamp = new Uint8Array(width * height);
    const holo = cutInside(shape, UB_STAMP_HOLE, 0);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const o = (y * width + x) * 4;
        if ((x < 3 || x > width - 4) && (y < 3 || y > height - 4)) continue;
        const inHolo = y + 10 < height && holo(x, y + 10, 0);
        if (inHolo) stamp[y * width + x] = 255;
        const v = inHolo ? 220 : 180;
        buf[o] = v;
        buf[o + 1] = v;
        buf[o + 2] = v - 40;
        buf[o + 3] = 255;
      }
    }
    return { buf, stamp };
  }

  it("blacks out the pack's hologram shape, then cuts the hole clear and blacks its ring", () => {
    const { buf, stamp } = piece();
    const out = blackoutAndCut(blackoutStampShape(buf, stamp, width, height, 1), shape, UB_STAMP_HOLE, 2, 2);
    expect(pieceNotchFindings(out, shape, UB_STAMP_HOLE, 2, 2).failures).toEqual([]);
    expect(stampShapeBlackFindings(out, stamp, width, height).failures).toEqual([]);
  });

  it("the hole's own ring alone leaves the higher hologram showing: refused", () => {
    const { buf, stamp } = piece();
    const out = blackoutAndCut(buf, shape, UB_STAMP_HOLE, 2, 2);
    expect(stampShapeBlackFindings(out, stamp, width, height).failures.join(" ")).toMatch(/stamp shape/);
  });

  it("the crown band's findings want the frame field edge to edge and the title bar see-through", () => {
    const W = 1500;
    const rows = RING_CROWN_BAND.rows;
    const band = Buffer.alloc(W * 2100 * 4);
    for (let y = 0; y < rows; y += 1) for (let x = 0; x < W; x += 1) band[(y * W + x) * 4 + 3] = y > 110 && y < 236 && x > 95 && x < 1405 ? 0 : 255;
    expect(ringCrownFindings(band, W, 2100, rows).failures).toEqual([]);
    band[(300 * W + 700) * 4 + 3] = 9; // past the band
    band[(50 * W + 0) * 4 + 3] = 9; // a gap at the edge
    band[(170 * W + 700) * 4 + 3] = 9; // over the master's own bar
    expect(ringCrownFindings(band, W, 2100, rows).failures).toHaveLength(3);
  });
});

describe("the edges and corners", () => {
  it("declares the frame field's design edges and the black border's bottom", () => {
    expect(EDGE_CONTRACTS.lotr).toEqual({ top: { kind: "design" }, right: { kind: "design" }, bottom: { kind: "border" }, left: { kind: "design" } });
    expect(EDGE_CONTRACT_KNOWN_FAILURES.lotr).toBeUndefined();
    expect(ART_WINDOW_KNOWN_FAILURES.lotr).toBeUndefined();
    expect(BORDER_PENDING_TEMPLATES.has("lotr")).toBe(false);
    expect(NEVER_NORMALISE.test("lotr")).toBe(false);
    // A square output keeps the frame field in the top corners, the border
    // black in the bottom ones.
    expect(SQUARE_CORNERS.lotr).toEqual({ kinds: { tl: "frame", tr: "frame" } });
    expect(["tl", "tr", "bl", "br"].map((c) => squareCornerKind("lotr", "g", c as never))).toEqual(["frame", "frame", "border", "border"]);
  });

  it("a design edge is held opaque, never dark at its corner; a border edge is held both", () => {
    const W = 300;
    const H = 420;
    // A taupe field to the edges, square at the top, cut at the bottom.
    const buf = Buffer.alloc(W * H * 4);
    for (let p = 0; p < W * H; p += 1) buf.set([134, 123, 105, 255], p * 4);
    for (let y = Math.round(H * 0.8); y < H; y += 1) for (let x = 0; x < W; x += 1) buf.set([0, 0, 0, 255], (y * W + x) * 4);
    roundCornersRgba8(buf, W, H, cardCornerRadiusPx(W, H), ["tl", "tr"]);
    expect(edgeContractViolations(EDGE_CONTRACTS.lotr, buf, W, H)).toEqual([]);
    expect(cornerViolations(EDGE_CONTRACTS.lotr, buf, W, H)).toEqual([]);
    // The same master held to a border all round fails at its taupe corners.
    const border = { top: { kind: "border" }, right: { kind: "border" }, bottom: { kind: "border" }, left: { kind: "border" } } as const;
    expect(cornerViolations(border, buf, W, H).join(" ")).toMatch(/luma/);
    // A hole in the design edge is refused.
    buf[(0 * W + 150) * 4 + 3] = 0;
    expect(edgeContractViolations(EDGE_CONTRACTS.lotr, buf, W, H).join(" ")).toMatch(/top: design/);
  });
});

describe("the profile rides the masters", () => {
  const p = getFrameProfile("lotr");

  it("is an M15-era family member on the CC M15 cost row centred on the pack's bar, its art slot the pack's art bounds", () => {
    expect(M15_FAMILY_TEMPLATES).toContain("lotr");
    expect(COLLECTOR_TEMPLATES).toContain("lotr");
    expect(p.title.fit).toBe("measured");
    expect(p.type.fit).toBe("measured");
    expect([p.costSizePct, p.costDy, p.costDx]).toEqual([70 / 1500, -2 / 1500, 2 / 1500]);
    expect(p.artifactMasterKeys).toEqual({ c: "a" });
    // The window, 150–1350 × 254–1160 (and its α 90 foot to 1170), inside
    // the pack's artBounds with the art-window check's 0.05 % to spare.
    const a = p.artSlot;
    expect((a.leftPct / 100) * 1500).toBeCloseTo(149, 9);
    expect(((a.leftPct + a.widthPct) / 100) * 1500).toBeCloseTo(1351, 9);
    expect((a.topPct / 100) * 2100).toBeCloseTo(252, 9);
    expect(((a.topPct + a.heightPct) / 100) * 2100).toBeCloseTo(1170, 9);
    expect(p.underFrameArt).toBeUndefined();
    expect(p.pt?.plateAssetPathTemplate).toBe("/frames/lotr/pt/{color}.png");
    expect(PLATE_INK["/frames/lotr/pt/{color}.png"]).toBeDefined();
    expect(p.collector).toBeDefined();
    // White name and type line, as every print sets them.
    expect([p.title.colorHex, p.type.colorHex]).toEqual(["#f4eee2", "#f4eee2"]);
  });

  it("keys the crown and the notch by the master drawn: a colourless artifact's `a`, a colourless land's `l`", () => {
    const style = { template: "lotr", crown: true, stamp: "auto" } as never;
    const keysOf = (facts: Record<string, unknown>) =>
      resolveFrameOverlays(p, style, { colors: [], rarity: "rare", supertype: "Legendary", ...facts, colorKey: facts.colorKey as string } as never).map((o) => `${o.anatomy}:${o.key}`);
    expect(keysOf({ colorKey: "c", cardType: "artifact" })).toEqual(["crown:a", "holoStamp:a"]);
    expect(keysOf({ colorKey: "c", cardType: "land" })).toEqual(["crown:l", "holoStamp:l"]);
    expect(keysOf({ colorKey: "w", cardType: "creature" })).toEqual(["crown:w", "holoStamp:w"]);
    expect(keysOf({ colorKey: "m", cardType: "creature" })).toEqual(["crown:m", "holoStamp:m"]);
    // "auto" stamps every rarity on a triangle frame; the crown wants a legend.
    expect(keysOf({ colorKey: "g", cardType: "creature", supertype: null, rarity: "common" })).toEqual(["holoStamp:g"]);
  });
});

const masters = MASTER_KEYS.map((k) => [k, published(`lotr/${k}.png`)] as const);
const crowns = OVERLAY_KEYS.map((k) => [k, published(`lotrcrown/${k}.png`)] as const);
const notches = OVERLAY_KEYS.map((k) => [k, published(`lotrholostamp/${k}.png`)] as const);
const available = [...masters, ...crowns, ...notches].every(([, b]) => b !== null);

describe.skipIf(!available)("the published objects (set FRAMES_BUILD_DIR if skipped)", () => {
  it.each(MASTER_KEYS)("lotr/%s: 1500 × 2100, the frame field to the top and sides, the black border's shoulders, the round window", async (key) => {
    const { data, info } = await sharp(published(`lotr/${key}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([1500, 2100]);
    const px = (x: number, y: number) => Array.from(data.subarray((y * 1500 + x) * 4, (y * 1500 + x) * 4 + 4));
    // The frame field to the top and side edges, opaque and not black.
    for (const [x, y] of [[750, 4], [4, 900], [1495, 900]]) {
      const [r, g, b, a] = px(x, y);
      expect(a, `${key} (${x}, ${y})`).toBe(255);
      expect(r + g + b, `${key} (${x}, ${y})`).toBeGreaterThan(60);
    }
    // The black border along the bottom.
    for (const [x, y] of [[750, 2090], [8, 2000], [1491, 2000]]) {
      const [r, g, b, a] = px(x, y);
      expect(a, `${key} (${x}, ${y})`).toBe(255);
      expect(r + g + b, `${key} (${x}, ${y})`).toBeLessThan(40);
    }
    // The top corners kept square, the bottom ones cut; the window clear.
    expect([px(0, 0)[3], px(1499, 0)[3], px(0, 2099)[3], px(1499, 2099)[3]]).toEqual([255, 255, 0, 0]);
    expect(px(750, 700)[3]).toBe(0);
    expect(px(170, 270)[3]).toBe(255); // the frame round the circle
  });

  it.each(OVERLAY_KEYS)("lotrcrown/%s and lotrholostamp/%s pass the importer's checks", async (key) => {
    const band = await sharp(published(`lotrcrown/${key}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([band.info.width, band.info.height]).toEqual([1500, RING_CROWN_BAND.rows]);
    const full = Buffer.alloc(1500 * 2100 * 4);
    band.data.copy(full);
    expect(ringCrownFindings(full, 1500, 2100, RING_CROWN_BAND.rows).failures).toEqual([]);
    const notch = await sharp(published(`lotrholostamp/${key}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([notch.info.width, notch.info.height]).toEqual([RING_NOTCH_BOX.width, RING_NOTCH_BOX.height]);
    expect(pieceNotchFindings(notch.data, RING_NOTCH.shape, UB_STAMP_HOLE, 2, 2).failures).toEqual([]);
  });
});
