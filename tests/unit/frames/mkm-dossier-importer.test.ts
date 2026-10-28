import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  CC_OVERLAY_BANDS,
  CC_TEMPLATES,
  DOSSIER,
  DOSSIER_CAPTURE_PX,
  DOSSIER_CROWN_BAND,
  DOSSIER_CROWN_RAMP,
  DOSSIER_NOTCH,
  DOSSIER_NOTCH_BOX,
  DOSSIER_PAIR_RAMP,
  DOSSIER_PRINT_TONES,
  DOSSIER_STAMP_OVAL_PX,
  HOLO_STAMP_NOTCHES,
  blackoutAndCut,
  blackoutStampShape,
  capturePlane,
  cutInside,
  dossierCrownFindings,
  dossierCrownLayers,
  notchCutOf,
  notchSourceFiles,
  pieceNotchFindings,
  sourceFilesFor,
  sourceTonesOf,
  stampShapeBlackFindings,
} from "../../../scripts/lib/cc-frames.mjs";
import { TWO_COLOR_PAIRS } from "../../../scripts/lib/pair-ramp.mjs";
import { resolveFrameOverlays } from "@/lib/cards/anatomy";
import { COLLECTOR_TEMPLATES } from "@/lib/cards/collector-line";
import { M15_FAMILY_TEMPLATES } from "@/lib/cards/m15-family";
import { PLATE_INK } from "@/lib/cards/plate-ink";
import { DOSSIER_COLLECTOR, DOSSIER_CROWN, DOSSIER_HOLO_STAMP, DOSSIER_HOLO_STAMP_OVAL, M15_COLLECTOR, getFrameProfile } from "@/lib/cards/template-layout";
import { EDGE_CONTRACTS, EDGE_CONTRACT_KNOWN_FAILURES } from "@/lib/frames/edge-contract";
import { ART_WINDOW_KNOWN_FAILURES } from "@/lib/frames/art-window";
import { SQUARE_CORNERS, squareCornerKind } from "@/lib/frames/square-corners";
import { BORDER_PENDING_TEMPLATES } from "@/lib/scryfall/frame-signatures";
import { NEVER_NORMALISE } from "../../../scripts/lib/frame-corners.mjs";
import { FRAME_ERA_LABELS, FRAME_SET_ERA, FRAME_SET_LABELS, FRAME_TEMPLATE_LABELS, FRAME_TEMPLATE_SET } from "@/types/card";
import manifestJson from "@/lib/frames/frame-manifest.json";

// ---------------------------------------------------------------------------
// TODO 4.11 wave 2: the Murders at Karlov Manor DOSSIER showcase (`dossier`;
// MKM #336–389 and #433, Scryfall's `dossier` promo type) from Card
// Conjurer's 'Dossier' pack (2010 × 2814, downscaled once) — a NEW template,
// an addition. The recipe (the pack's seven frames, `c` its artifact frame,
// and the ten two-colour pairs lerped across print's ramp), the tone rule's
// verdict (only the green and blue crowns toned), the crown band (its pairs
// lerped), the OVAL notch (the pack's capture blacked out, the prints' oval
// cut), the edges, the profile on the folder's own bands and, where the
// published objects are on disk at the manifest's sha256 (FRAMES_BUILD_DIR,
// else .frames-build; CI fetches them), their pixels.
// ---------------------------------------------------------------------------

type Layer = { src: string; right?: string; ramp?: number[] };
const def = (CC_TEMPLATES as unknown as Record<string, { colors: Record<string, Layer[]>; plates: Record<string, string> }>).dossier;
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
const fileOf = (k: string) => `${DOSSIER}/${k === "c" ? "a" : k}.png`;

describe("the dossier recipe", () => {
  it("is the pack's seven frames whole (c = its artifact frame) and the ten pairs lerped across print's ramp", () => {
    expect(DOSSIER).toBe("img/frames/dossier");
    expect(Object.keys(def.colors).sort()).toEqual([...MASTER_KEYS, ...TWO_COLOR_PAIRS].sort());
    for (const key of MASTER_KEYS) expect(def.colors[key], key).toEqual([{ src: fileOf(key) }]);
    for (const pair of TWO_COLOR_PAIRS) {
      expect(def.colors[pair], pair).toEqual([{ src: fileOf(pair[0]), right: fileOf(pair[1]), ramp: [...DOSSIER_PAIR_RAMP] }]);
    }
    // Print's two-colour rules ramp 10 / 50 / 90 % at ~45 / 52 / 57.5 %W.
    expect([...DOSSIER_PAIR_RAMP]).toEqual([43.5, 59.5]);
    for (const key of MASTER_KEYS) expect(def.plates[key], key).toBe(`${DOSSIER}/pt.png`);
    expect(sourceFilesFor(def as never).sort()).toEqual(["a", "b", "g", "m", "pt", "r", "u", "w"].map((f) => `${DOSSIER}/${f}.png`));
  });

  it("tones only the green and blue crowns — every other file is within 4 levels of print", () => {
    for (const f of ["w", "u", "b", "r", "g", "m", "a", "pt", "stamp", "crown/w", "crown/b", "crown/r", "crown/m", "crown/a"]) {
      expect(sourceTonesOf(`${DOSSIER}/${f}.png`), f).toBeNull();
    }
    for (const k of ["g", "u"] as const) {
      const tone = sourceTonesOf(`${DOSSIER}/crown/${k}.png`);
      expect(tone?.tones.crown, k).toBe(DOSSIER_PRINT_TONES.crown[k]);
      expect(tone?.near?.crown, k).toBeDefined();
      // ≥ 9 levels off on some channel: toned by the ring's rule.
      const { from, to } = DOSSIER_PRINT_TONES.crown[k];
      expect(Math.max(...from.map((v: number, i: number) => Math.abs(v - to[i]))), k).toBeGreaterThanOrEqual(9);
    }
  });

  it("the crown band publishes the profile's keys at the pack's bounds, its pairs lerped", () => {
    expect([...DOSSIER_CROWN_BAND.keys]).toEqual(DOSSIER_CROWN.keys);
    expect(DOSSIER_CROWN.rect.heightPct).toBeCloseTo((DOSSIER_CROWN_BAND.rows / 2100) * 100, 12);
    expect(CC_OVERLAY_BANDS.dossiercrown.band).toBe(DOSSIER_CROWN_BAND);
    expect(dossierCrownLayers("c")).toEqual([{ src: `${DOSSIER}/crown/a.png`, at: { ...DOSSIER_CROWN_BAND.crown } }]);
    expect(dossierCrownLayers("ur")).toEqual([{ src: `${DOSSIER}/crown/u.png`, at: { ...DOSSIER_CROWN_BAND.crown }, right: `${DOSSIER}/crown/r.png`, ramp: [...DOSSIER_CROWN_RAMP] }]);
    expect(() => dossierCrownLayers("a")).toThrow();
    // The crown reaches 312.7 px down (419 / 2814 × 2100); the band's rows hold it and its ringing.
    expect(DOSSIER_CROWN_BAND.rows).toBe(316);
  });

  it("the crown's findings: clear outside its bounds, nothing past the band", () => {
    const W = 1500;
    const H = 2100;
    const buf = Buffer.alloc(W * H * 4);
    for (let y = 0; y < 313; y += 1) for (let x = 25; x < 1360; x += 1) buf[(y * W + x) * 4 + 3] = 255;
    expect(dossierCrownFindings(buf, W, H, 316).failures).toEqual([]);
    buf[(400 * W + 700) * 4 + 3] = 9;
    expect(dossierCrownFindings(buf, W, H, 316).failures.join(" ")).toMatch(/past the band/);
  });

  it("the notch publishes the profile's keys at the importer's box, its oval the prints'", () => {
    expect([...DOSSIER_NOTCH.keys]).toEqual(DOSSIER_HOLO_STAMP.keys);
    expect(DOSSIER_HOLO_STAMP.rect).toEqual({
      leftPct: (DOSSIER_NOTCH_BOX.x / 1500) * 100,
      topPct: (DOSSIER_NOTCH_BOX.y / 2100) * 100,
      widthPct: (DOSSIER_NOTCH_BOX.width / 1500) * 100,
      heightPct: (DOSSIER_NOTCH_BOX.height / 2100) * 100,
    });
    // The piece (295 × 134 at 857 / 2540 of 2010 × 2814 → 639.7–859.9 ×
    // 1895.5–1995.5 px) inside the box.
    const { x, y, width, height } = DOSSIER_NOTCH.placeAt;
    expect([x, y, width, height]).toEqual([857, 2540, 295, 134]);
    expect(DOSSIER_NOTCH_BOX.x).toBeLessThan((x / 2010) * 1500);
    expect(DOSSIER_NOTCH_BOX.y).toBeLessThan((y / 2814) * 2100);
    expect(DOSSIER_NOTCH_BOX.x + DOSSIER_NOTCH_BOX.width).toBeGreaterThan(((x + width) / 2010) * 1500);
    expect(DOSSIER_NOTCH_BOX.y + DOSSIER_NOTCH_BOX.height).toBeGreaterThan(((y + height) / 2814) * 2100);
    // The prints' oval (133 × 67), its cut and black ring inside the box.
    expect(DOSSIER_STAMP_OVAL_PX).toEqual({ x: 685, y: 1921, width: 133, height: 67 });
    expect(DOSSIER_NOTCH_BOX.y + DOSSIER_NOTCH_BOX.height).toBeGreaterThanOrEqual(DOSSIER_STAMP_OVAL_PX.y + DOSSIER_STAMP_OVAL_PX.height + 2 + 2);
    // The pack paints its capture lower than print sets the hologram: it is
    // blacked out, not cut (the cut is the prints').
    expect(DOSSIER_CAPTURE_PX.y + DOSSIER_CAPTURE_PX.height).toBeGreaterThan(DOSSIER_STAMP_OVAL_PX.y + DOSSIER_STAMP_OVAL_PX.height);
    const n = HOLO_STAMP_NOTCHES.dossierholostamp as unknown as { blackoutCapturePx: number; clearAboveY: number; capture: { oval: boolean } };
    expect(n.blackoutCapturePx).toBe(2);
    expect(n.clearAboveY).toBe(1906);
    expect(n.capture.oval).toBe(true);
    expect(notchCutOf(HOLO_STAMP_NOTCHES.dossierholostamp)).toBe(DOSSIER_NOTCH.oval);
    expect(DOSSIER_HOLO_STAMP.anatomy === "holoStamp" && DOSSIER_HOLO_STAMP.stamp.shape).toBe("oval");
    for (const k of ["leftPct", "topPct", "widthPct", "heightPct"] as const) expect(DOSSIER_HOLO_STAMP_OVAL[k]).toBeCloseTo(DOSSIER_NOTCH.oval[k], 9);
    expect(notchSourceFiles(HOLO_STAMP_NOTCHES.dossierholostamp)).toEqual([`${DOSSIER}/stamp.png`]);
  });
});

describe("the importer's notch piece", () => {
  const shape = DOSSIER_NOTCH.shape;
  const { width, height } = shape.size;
  const box = DOSSIER_NOTCH_BOX;
  /** A synthetic piece: parchment above, a black well, a bright "hologram"
   *  where the PACK paints it (DOSSIER_CAPTURE_PX, lower than the prints'
   *  oval), and parchment shoulders in the capture box's top corners. */
  function piece(): Buffer {
    const buf = Buffer.alloc(width * height * 4);
    const cx = DOSSIER_CAPTURE_PX.x + DOSSIER_CAPTURE_PX.width / 2 - box.x;
    const cy = DOSSIER_CAPTURE_PX.y + DOSSIER_CAPTURE_PX.height / 2 - box.y;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const o = (y * width + x) * 4;
        if ((x < 3 || x > width - 4) && (y < 3 || y > height - 4)) continue;
        const inHolo = ((x - cx) / (DOSSIER_CAPTURE_PX.width / 2)) ** 2 + ((y - cy) / (DOSSIER_CAPTURE_PX.height / 2)) ** 2 <= 1;
        const shoulder = y < 40 && (x < 52 || x > width - 52);
        const v = inHolo ? 200 : shoulder || y < 14 ? 240 : 6;
        buf.set([v, v, v, 255], o);
      }
    }
    return buf;
  }

  it("blacks the capture out (never the arch's parchment shoulders), cuts the prints' oval and rings it", () => {
    const placed = piece();
    const captured = capturePlane(placed, width, height, DOSSIER_NOTCH.capture);
    // The shoulders are lit but outside the capture's ellipse.
    expect(captured[34 * width + 46]).toBe(0);
    blackoutStampShape(placed, captured, width, height, 2);
    const out = blackoutAndCut(placed, shape, DOSSIER_NOTCH.oval, 2, 2);
    expect(pieceNotchFindings(out, shape, DOSSIER_NOTCH.oval, 2, 2).failures).toEqual([]);
    expect(stampShapeBlackFindings(out, captured, width, height).failures).toEqual([]);
    // Nothing of the capture is left lit; the shoulders keep their parchment.
    const inCut = cutInside(shape, DOSSIER_NOTCH.oval, 2);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!captured[y * width + x] || inCut(x, y, 0)) continue;
        expect(out[(y * width + x) * 4], `(${x}, ${y})`).toBe(0);
      }
    }
    expect(out[(34 * width + 46) * 4]).toBe(240);
  });

  it("without the blackout the capture's foot shows below the prints' oval — refused", () => {
    const placed = piece();
    const captured = capturePlane(placed, width, height, DOSSIER_NOTCH.capture);
    const out = blackoutAndCut(placed, shape, DOSSIER_NOTCH.oval, 2, 2);
    expect(pieceNotchFindings(out, shape, DOSSIER_NOTCH.oval, 2, 2, captured).failures.join(" ")).toMatch(/stamp shape/);
  });
});

describe("the edges and corners", () => {
  it("the printed black border top, right and bottom; the folder's edge to the left (design) — on no pending list", () => {
    const border = { kind: "border" };
    expect(EDGE_CONTRACTS.dossier).toEqual({ top: border, right: border, bottom: border, left: { kind: "design" } });
    expect(EDGE_CONTRACT_KNOWN_FAILURES.dossier).toBeUndefined();
    expect(ART_WINDOW_KNOWN_FAILURES.dossier).toBeUndefined();
    expect(BORDER_PENDING_TEMPLATES.has("dossier")).toBe(false);
    expect(NEVER_NORMALISE.test("dossier")).toBe(false);
    // Every corner is the border's black (the folder's edge starts below the
    // top corner and ends above the bottom one).
    expect(SQUARE_CORNERS.dossier).toBeUndefined();
    expect(["tl", "tr", "bl", "br"].map((c) => squareCornerKind("dossier", "w", c as never))).toEqual(["border", "border", "border", "border"]);
  });
});

describe("the profile rides the folder's own bands", () => {
  const p = getFrameProfile("dossier");

  it("is a new showcase set of its own, Murders at Karlov Manor — Dossier", () => {
    expect(FRAME_TEMPLATE_LABELS.dossier).toBe("Dossier");
    expect(FRAME_TEMPLATE_SET.dossier).toBe("karlov");
    expect(FRAME_SET_LABELS.karlov).toBe("Murders at Karlov Manor");
    expect(FRAME_ERA_LABELS[FRAME_SET_ERA.karlov]).toBe("Showcase & Universes Beyond");
  });

  it("is an M15-era family member on the run's cost row, name, type line, P/T and collector line", () => {
    const m15 = getFrameProfile("m15");
    expect(M15_FAMILY_TEMPLATES).toContain("dossier");
    expect(COLLECTOR_TEMPLATES).toContain("dossier");
    expect(p.title.fit).toBe("measured");
    expect(p.type.fit).toBe("measured");
    expect(p.symbolStyle).toBeUndefined();
    // The CC M15 disc (70 px) 19 px lower than the CC-framed M15 row, the
    // row ending 38 px further left (the folder's clip covers the band's end).
    expect(p.costSizePct).toBeCloseTo(70 / 1500, 12);
    expect(p.costDy).toBeCloseTo(-6.6 / 1500 + 19 / 1500, 12);
    expect(p.costDx).toBeCloseTo(2 / 1500, 12);
    expect(((p.title.rect.leftPct + p.title.rect.widthPct) / 100) * 1500).toBeCloseTo(((m15.title.rect.leftPct + m15.title.rect.widthPct) / 100) * 1500 - 38, 9);
    expect(p.title.rect.leftPct).toBe(m15.title.rect.leftPct);
    // The set symbol 17 px left of M15's (print's centres it on 1312 px).
    expect(((p.type.rect.leftPct + p.type.rect.widthPct) / 100) * 1500).toBeCloseTo(((m15.type.rect.leftPct + m15.type.rect.widthPct) / 100) * 1500 - 17, 9);
    // The window's tilted photo (α < 250 on 77–1393 × 273–1128) inside the
    // slot with the art-window check's 0.05 % to spare.
    const a = p.artSlot;
    expect((a.leftPct / 100) * 1500).toBeCloseTo(76, 9);
    expect(((a.leftPct + a.widthPct) / 100) * 1500).toBeCloseTo(1395, 9);
    expect((a.topPct / 100) * 2100).toBeCloseTo(272, 9);
    expect(((a.topPct + a.heightPct) / 100) * 2100).toBeCloseTo(1131, 9);
    expect(p.underFrameArt).toBeUndefined();
    // M15's rules box (print's short texts centre on M15's middle).
    expect(p.rules).toEqual(m15.rules);
    // The pack's tag at its ptBounds; the digits on print's centre.
    expect(p.pt?.plateAssetPathTemplate).toBe("/frames/dossier/pt/{color}.png");
    expect(p.pt?.plateRect).toEqual({ topPct: (2468 / 2814) * 100, leftPct: (1538 / 2010) * 100, widthPct: (392 / 2010) * 100, heightPct: (195 / 2814) * 100 });
    expect((p.pt!.rect.topPct / 100) * 2100).toBeCloseTo((m15.pt!.rect.topPct / 100) * 2100 - 7.5, 9);
    expect(PLATE_INK["/frames/dossier/pt/{color}.png"]).toBeDefined();
    // The collector line where the run sets it.
    expect(p.collector).toBe(DOSSIER_COLLECTOR);
    expect({ ...DOSSIER_COLLECTOR, line1BaselinePct: 0, line2BaselinePct: 0 }).toEqual({ ...M15_COLLECTOR, line1BaselinePct: 0, line2BaselinePct: 0 });
    expect((DOSSIER_COLLECTOR.line1BaselinePct / 100) * 2100).toBeCloseTo((M15_COLLECTOR.line1BaselinePct / 100) * 2100 - 5, 9);
    expect((DOSSIER_COLLECTOR.line2BaselinePct / 100) * 2100).toBeCloseTo((M15_COLLECTOR.line2BaselinePct / 100) * 2100 - 4, 9);
    // The two-colour dress is the pair masters; never a hard seam.
    expect(p.twoColorMasters).toEqual(["split"]);
    expect(p.twoColorSplit).toBeUndefined();
    expect(p.overlays?.map((o) => o.anatomy)).toEqual(["crown", "holoStamp"]);
  });

  it("keys the crown and the stamp by the colour or the pair", () => {
    const keysOf = (style: Record<string, unknown>, facts: Record<string, unknown>) =>
      resolveFrameOverlays(p, { template: "dossier", crown: true, stamp: "auto", ...style } as never, { colors: [], rarity: "rare", supertype: "Legendary", cardType: "creature", ...facts, colorKey: facts.colorKey as string } as never).map((o) => `${o.anatomy}:${o.key}`);
    expect(keysOf({}, { colorKey: "w", colors: ["white"] })).toEqual(["crown:w", "holoStamp:w"]);
    expect(keysOf({ twoColor: true }, { colorKey: "m", colors: ["blue", "red"] })).toEqual(["crown:ur", "holoStamp:ur"]);
    expect(keysOf({}, { colorKey: "m", colors: ["blue", "red"] })).toEqual(["crown:m", "holoStamp:m"]);
    expect(keysOf({}, { colorKey: "c", colors: [], cardType: "artifact" })).toEqual(["crown:c", "holoStamp:c"]);
    // "auto" is a rare or mythic on an oval frame, as the run prints it.
    expect(keysOf({}, { colorKey: "g", colors: ["green"], supertype: null, rarity: "uncommon" })).toEqual([]);
  });
});

const ALL_KEYS = [...MASTER_KEYS, ...TWO_COLOR_PAIRS];
const masters = ALL_KEYS.map((k) => [k, published(`dossier/${k}.png`)] as const);
const plates = MASTER_KEYS.map((k) => [k, published(`dossier/pt/${k}.png`)] as const);
const crowns = ALL_KEYS.map((k) => [k, published(`dossiercrown/${k}.png`)] as const);
const notches = ALL_KEYS.map((k) => [k, published(`dossierholostamp/${k}.png`)] as const);
const available = [...masters, ...plates, ...crowns, ...notches].every(([, b]) => b !== null);

describe.skipIf(!available)("the published objects (set FRAMES_BUILD_DIR if skipped)", () => {
  it("one plate under every key, one notch piece under every key and pair", () => {
    expect(new Set(MASTER_KEYS.map((k) => MANIFEST[`dossier/pt/${k}.png`].sha256)).size).toBe(1);
    expect(new Set(ALL_KEYS.map((k) => MANIFEST[`dossierholostamp/${k}.png`].sha256)).size).toBe(1);
  });

  it("dossier: 1500 × 2100, the black border, the corners cut, the window clear, a pair's first colour left and second right", async () => {
    const read = async (k: string) => (await sharp(published(`dossier/${k}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
    const w = await read("w");
    expect([w.info.width, w.info.height]).toEqual([1500, 2100]);
    const px = (d: Buffer, x: number, y: number) => Array.from(d.subarray((y * 1500 + x) * 4, (y * 1500 + x) * 4 + 4));
    for (const [x, y] of [[750, 8], [1495, 1050], [750, 2090], [750, 2010]]) {
      const [r, g, b, a] = px(w.data, x, y);
      expect(a, `(${x}, ${y})`).toBe(255);
      expect(r + g + b, `(${x}, ${y})`).toBeLessThan(40);
    }
    expect([px(w.data, 0, 0)[3], px(w.data, 1499, 0)[3], px(w.data, 0, 2099)[3], px(w.data, 1499, 2099)[3]]).toEqual([0, 0, 0, 0]);
    expect(px(w.data, 750, 700)[3]).toBe(0);
    // The ur pair: its photo corners are u's on the left and r's on the right.
    const [u, r, ur] = await Promise.all([read("u"), read("r"), read("ur")]);
    expect(px(ur.data, 96, 270)).toEqual(px(u.data, 96, 270));
    expect(px(ur.data, 1378, 1105)).toEqual(px(r.data, 1378, 1105));
  });

  it("dossierholostamp: its oval cut and ringed, the rows above the arch clear", async () => {
    const notch = await sharp(published("dossierholostamp/w.png")!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([notch.info.width, notch.info.height]).toEqual([DOSSIER_NOTCH_BOX.width, DOSSIER_NOTCH_BOX.height]);
    expect(pieceNotchFindings(notch.data, DOSSIER_NOTCH.shape, DOSSIER_NOTCH.oval, 2, 2).failures).toEqual([]);
    const above = 1906 - DOSSIER_NOTCH_BOX.y;
    for (let i = 0; i < above * DOSSIER_NOTCH_BOX.width; i += 1) expect(notch.data[i * 4 + 3]).toBe(0);
  });

  it("dossiercrown: 1500 × 316, the green crown toned onto print", async () => {
    const g = await sharp(published("dossiercrown/g.png")!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([g.info.width, g.info.height]).toEqual([1500, 316]);
    const ch: number[][] = [[], [], []];
    for (let y = 76; y < 84; y += 1) for (let x = 300; x < 1000; x += 1) {
      const o = (y * 1500 + x) * 4;
      ch.forEach((c, i) => c.push(g.data[o + i]));
    }
    const med = ch.map((v) => v.sort((a, b) => a - b)[v.length >> 1]);
    med.forEach((v, i) => expect(Math.abs(v - DOSSIER_PRINT_TONES.crown.g.to[i]), `channel ${i}`).toBeLessThan(4));
  });
});
