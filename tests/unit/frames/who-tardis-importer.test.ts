import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  CC_TEMPLATES,
  HOLO_STAMP_NOTCHES,
  TARDIS,
  TARDIS_ACCENT_DIFF,
  TARDIS_CROWN_AT,
  TARDIS_NOTCH,
  TARDIS_NOTCH_BOX,
  TARDIS_PAIR_RAMP,
  TARDIS_PRINT_TONES,
  TARDIS_STRIPE_SPLIT,
  TARDIS_STRIPE_SPLIT_HALF,
  blackoutAndCut,
  blackoutStampShape,
  capturePlane,
  cutInside,
  diffRegionPlane,
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
import { M15UB_HOLO_STAMP_BOX, UB_STAMP_HOLE } from "@/lib/cards/holo-stamp";
import { SET_SYMBOL_BOX_PCT } from "@/lib/cards/typography";
import { M15_FAMILY_TEMPLATES } from "@/lib/cards/m15-family";
import { PLATE_INK } from "@/lib/cards/plate-ink";
import { M15_COLLECTOR, TARDIS_ART_SLOT, TARDIS_COLLECTOR, TARDIS_HOLO_STAMP, TARDIS_SYMBOL_RECT, getFrameProfile } from "@/lib/cards/template-layout";
import { EDGE_CONTRACTS, EDGE_CONTRACT_KNOWN_FAILURES } from "@/lib/frames/edge-contract";
import { ART_WINDOW_KNOWN_FAILURES } from "@/lib/frames/art-window";
import { SQUARE_CORNERS, squareCornerKind } from "@/lib/frames/square-corners";
import { BORDER_PENDING_TEMPLATES } from "@/lib/scryfall/frame-signatures";
import { NEVER_NORMALISE } from "../../../scripts/lib/frame-corners.mjs";
import { FRAME_ERA_LABELS, FRAME_SET_ERA, FRAME_SET_LABELS, FRAME_TEMPLATE_LABELS, FRAME_TEMPLATE_SET } from "@/types/card";
import manifestJson from "@/lib/frames/frame-manifest.json";

// ---------------------------------------------------------------------------
// TODO 4.11 wave 2: the Doctor Who TARDIS showcase (`tardis`; WHO #535–564,
// #552z–564z and #1126–1155) from Card Conjurer's 'TARDIS' pack (1500 × 2100
// native) — a NEW template, an addition. The recipe (each of the pack's
// seven frames with its brace — the pack's 'Legendary Crown', on every print
// of the run — `c` its artifact frame, and the ten pairs lerped), the tone
// rule's verdict (the stripes' body and light strip, the wedges), the
// TRIANGLE notch (the pack's capture blacked out, the Universes Beyond hole
// cut), the edges, the profile on the police box's bars and, where the
// published objects are on disk at the manifest's sha256 (FRAMES_BUILD_DIR,
// else .frames-build; CI fetches them), their pixels.
// ---------------------------------------------------------------------------

type Layer = { src: string; at?: object; right?: string; ramp?: number[] };
const def = (CC_TEMPLATES as unknown as Record<string, { colors: Record<string, Layer[]>; plates: Record<string, string> }>).tardis;
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
const fileOf = (dir: string, k: string) => `${TARDIS}/${dir}${k === "c" ? "a" : k}.png`;

describe("the TARDIS recipe", () => {
  it("is each of the pack's seven frames with its brace (c = its artifact frame) and the ten pairs lerped", () => {
    expect(TARDIS).toBe("img/frames/tardis");
    expect(Object.keys(def.colors).sort()).toEqual([...MASTER_KEYS, ...TWO_COLOR_PAIRS].sort());
    for (const key of MASTER_KEYS) {
      expect(def.colors[key], key).toEqual([{ src: fileOf("", key) }, { src: fileOf("crowns/", key), at: { ...TARDIS_CROWN_AT } }]);
    }
    for (const pair of TWO_COLOR_PAIRS) {
      expect(def.colors[pair], pair).toEqual([
        { src: fileOf("", pair[0]), right: fileOf("", pair[1]), ramp: [...TARDIS_PAIR_RAMP] },
        { src: fileOf("crowns/", pair[0]), at: { ...TARDIS_CROWN_AT }, right: fileOf("crowns/", pair[1]), ramp: [...TARDIS_PAIR_RAMP] },
      ]);
    }
    // The crown at its bounds, 1:1: 115 / 45, 1270 × 450 of the 1500 × 2100 card.
    expect([(TARDIS_CROWN_AT.leftPct / 100) * 1500, (TARDIS_CROWN_AT.topPct / 100) * 2100, (TARDIS_CROWN_AT.widthPct / 100) * 1500, (TARDIS_CROWN_AT.heightPct / 100) * 2100].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([115, 45, 1270, 450]);
    // The ramp crosses identical pixels: the masters differ only on x 61–346
    // and 1156–1439.
    expect([...TARDIS_PAIR_RAMP]).toEqual([45, 55]);
    expect((TARDIS_PAIR_RAMP[0] / 100) * 1500).toBeGreaterThan(346);
    expect((TARDIS_PAIR_RAMP[1] / 100) * 1500).toBeLessThan(1156);
    for (const key of MASTER_KEYS) expect(def.plates[key], key).toBe(`${TARDIS}/pt.png`);
    // The pack's Land frame and crown 404: never read.
    const files = sourceFilesFor(def as never);
    expect(files.filter((f: string) => /\/l\.png$/.test(f))).toEqual([]);
    expect(files).toContain(`${TARDIS}/crowns/a.png`);
  });

  it("tones each stripe's body and light strip and every wedge by the ring's rule, the steel body and wedge and the plate as drawn", () => {
    for (const k of ["w", "u", "b", "r", "g", "m", "a"]) {
      const tone = sourceTonesOf(`${TARDIS}/${k}.png`);
      const regions = Object.keys(tone?.tones ?? {}).sort();
      expect(regions, k).toEqual(k === "a" ? ["stripeLight"] : ["stripe", "stripeLight"]);
      for (const region of regions) {
        const d = tone.diff[region];
        expect(d.file, `${k} ${region}`).toBe(`${TARDIS}/${k === "u" || k === "a" ? "w" : "u"}.png`);
        expect([d.full, d.none], `${k} ${region}`).toEqual([TARDIS_ACCENT_DIFF.full, TARDIS_ACCENT_DIFF.none]);
        expect(d.lumaSplit, `${k} ${region}`).toEqual({ split: TARDIS_STRIPE_SPLIT[k as keyof typeof TARDIS_STRIPE_SPLIT], half: TARDIS_STRIPE_SPLIT_HALF, side: region === "stripe" ? "below" : "above" });
      }
    }
    for (const k of ["w", "u", "b", "r", "g", "m"]) {
      const tone = sourceTonesOf(`${TARDIS}/crowns/${k}.png`);
      expect(tone?.tones.wedge, k).toBe(TARDIS_PRINT_TONES.wedge[k as keyof typeof TARDIS_PRINT_TONES.wedge]);
      expect(tone?.diff.wedge.file, k).toBe(`${TARDIS}/crowns/${k === "u" ? "w" : "u"}.png`);
    }
    for (const f of ["crowns/a", "pt", "stamp", "grayStamp"]) expect(sourceTonesOf(`${TARDIS}/${f}.png`), f).toBeNull();
    // Every toned region is ≥ 9 levels off on some channel; the ones left as
    // drawn are documented (TARDIS_PRINT_TONES).
    for (const table of [TARDIS_PRINT_TONES.stripe, TARDIS_PRINT_TONES.stripeLight, TARDIS_PRINT_TONES.wedge]) {
      for (const [k, { from, to }] of Object.entries(table as Record<string, { from: number[]; to: number[] }>)) {
        expect(Math.max(...from.map((v, i) => Math.abs(v - to[i]))), k).toBeGreaterThanOrEqual(9);
      }
    }
  });

  it("splits one difference into the stripe's body and light strip by luma — the two shares sum to the plain region", () => {
    const W = 4;
    const H = 1;
    // Lumas 40, 85, 100, 200 against a blue reference that differs on every pixel.
    const buf = Buffer.from([40, 40, 40, 255, 85, 85, 85, 255, 100, 100, 100, 255, 200, 200, 200, 255]);
    const ref = Buffer.from([0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255]);
    const plain = diffRegionPlane(buf, ref, W, H, TARDIS_ACCENT_DIFF);
    const below = diffRegionPlane(buf, ref, W, H, { ...TARDIS_ACCENT_DIFF, lumaSplit: { split: 85, half: 15, side: "below" } });
    const above = diffRegionPlane(buf, ref, W, H, { ...TARDIS_ACCENT_DIFF, lumaSplit: { split: 85, half: 15, side: "above" } });
    expect(Array.from(plain)).toEqual([255, 255, 255, 255]);
    expect(Array.from(below)).toEqual([255, 128, 0, 0]);
    expect(Array.from(above)).toEqual([0, 128, 255, 255]);
    for (let p = 0; p < W; p += 1) expect(Math.abs(below[p] + above[p] - plain[p]), `${p}`).toBeLessThanOrEqual(1);
    expect(() => diffRegionPlane(buf, ref, W, H, { ...TARDIS_ACCENT_DIFF, lumaSplit: { split: 85, half: 0, side: "below" } })).toThrow();
  });

  it("the notch publishes the profile's keys at the importer's box, its cut the Universes Beyond hole", () => {
    expect([...TARDIS_NOTCH.keys]).toEqual([...TARDIS_HOLO_STAMP.keys]);
    expect(TARDIS_HOLO_STAMP.rect).toEqual({
      leftPct: (TARDIS_NOTCH_BOX.x / 1500) * 100,
      topPct: (TARDIS_NOTCH_BOX.y / 2100) * 100,
      widthPct: (TARDIS_NOTCH_BOX.width / 1500) * 100,
      heightPct: (TARDIS_NOTCH_BOX.height / 2100) * 100,
    });
    // The piece (176 × 80 at 662 / 1909, 1:1) inside the box, 1 px round it.
    const { x, y, width, height } = TARDIS_NOTCH.placeAt;
    expect([x, y, width, height]).toEqual([662, 1909, 176, 80]);
    expect([TARDIS_NOTCH_BOX.x, TARDIS_NOTCH_BOX.y]).toEqual([x - 1, y - 1]);
    expect(TARDIS_NOTCH_BOX.x + TARDIS_NOTCH_BOX.width).toBe(x + width + 1);
    // The hole's apex (1992.5) + its cut margin and ring inside the box.
    expect(TARDIS_NOTCH_BOX.y + TARDIS_NOTCH_BOX.height).toBeGreaterThanOrEqual(1992.5 + 2 + 2);
    const n = HOLO_STAMP_NOTCHES.tardisholostamp as unknown as { blackoutCapturePx: number; triangle: unknown; capture: object };
    expect(n.blackoutCapturePx).toBe(1);
    expect(n.triangle).toBe(UB_STAMP_HOLE);
    expect(notchCutOf(HOLO_STAMP_NOTCHES.tardisholostamp)).toBe(UB_STAMP_HOLE);
    expect(TARDIS_HOLO_STAMP.anatomy === "holoStamp" && TARDIS_HOLO_STAMP.stamp).toEqual({ shape: "triangle", oval: M15UB_HOLO_STAMP_BOX, keepOut: expect.any(Object) });
    expect(notchSourceFiles(HOLO_STAMP_NOTCHES.tardisholostamp)).toEqual([`${TARDIS}/stamp.png`]);
  });
});

describe("the importer's notch piece", () => {
  const shape = TARDIS_NOTCH.shape;
  const { width, height } = shape.size;
  const box = TARDIS_NOTCH_BOX;
  /** A synthetic piece: a black trapezoid with a bright "hologram" where the
   *  PACK paints it (693–806 × 1922–1985 px, its top rows above the hole). */
  function piece(): Buffer {
    const buf = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const o = (y * width + x) * 4;
        const cy = y + box.y;
        const cx = x + box.x;
        if (cy > 1988 || cx < 662 || cx > 837) continue;
        const t = (cy - 1922) / (1985 - 1922);
        const half = ((806 - 693) / 2) * (1 - t);
        const lit = cy >= 1922 && cy <= 1985 && Math.abs(cx - 749.5) <= half;
        const v = lit ? 200 : 2;
        buf.set([v, v, v, 255], o);
      }
    }
    return buf;
  }

  it("blacks the capture out, cuts the hole and rings it — no lit pixel is left", () => {
    const placed = piece();
    const captured = capturePlane(placed, width, height, TARDIS_NOTCH.capture);
    blackoutStampShape(placed, captured, width, height, 1);
    const out = blackoutAndCut(placed, shape, UB_STAMP_HOLE, 2, 2);
    expect(pieceNotchFindings(out, shape, UB_STAMP_HOLE, 2, 2).failures).toEqual([]);
    expect(stampShapeBlackFindings(out, captured, width, height).failures).toEqual([]);
    const inCut = cutInside(shape, UB_STAMP_HOLE, 2);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (inCut(x, y, 0)) continue;
        expect(out[(y * width + x) * 4], `(${x}, ${y})`).toBeLessThan(50);
      }
    }
  });

  it("the pack's triangle lies inside the hole's cut and ring (the blackout is belt and braces); a capture past them is refused", () => {
    const placed = piece();
    const captured = capturePlane(placed, width, height, TARDIS_NOTCH.capture);
    expect(pieceNotchFindings(blackoutAndCut(Buffer.from(placed), shape, UB_STAMP_HOLE, 2, 2), shape, UB_STAMP_HOLE, 2, 2, captured).failures).toEqual([]);
    // A lit pixel beside the hole's lower half (691, 1968 px) is outside the cut and its ring.
    const o = ((1968 - box.y) * width + (691 - box.x)) * 4;
    placed.set([200, 200, 200, 255], o);
    const lit = capturePlane(placed, width, height, TARDIS_NOTCH.capture);
    expect(pieceNotchFindings(blackoutAndCut(placed, shape, UB_STAMP_HOLE, 2, 2), shape, UB_STAMP_HOLE, 2, 2, lit).failures.join(" ")).toMatch(/stamp shape/);
  });
});

describe("the edges and corners", () => {
  it("the printed black border top and bottom; the police box's blue sides (design) — on no pending list", () => {
    const border = { kind: "border" };
    expect(EDGE_CONTRACTS.tardis).toEqual({ top: border, right: { kind: "design" }, bottom: border, left: { kind: "design" } });
    expect(EDGE_CONTRACT_KNOWN_FAILURES.tardis).toBeUndefined();
    expect(ART_WINDOW_KNOWN_FAILURES.tardis).toBeUndefined();
    expect(BORDER_PENDING_TEMPLATES.has("tardis")).toBe(false);
    expect(NEVER_NORMALISE.test("tardis")).toBe(false);
    // Every corner is the border's black (the roof starts inside the top
    // corners; the bottom border is black).
    expect(SQUARE_CORNERS.tardis).toBeUndefined();
    expect(["tl", "tr", "bl", "br"].map((c) => squareCornerKind("tardis", "w", c as never))).toEqual(["border", "border", "border", "border"]);
  });
});

describe("the profile rides the police box's bars", () => {
  const p = getFrameProfile("tardis");

  it("is a new showcase set of its own, Doctor Who — TARDIS", () => {
    expect(FRAME_TEMPLATE_LABELS.tardis).toBe("TARDIS");
    expect(FRAME_TEMPLATE_SET.tardis).toBe("doctorwho");
    expect(FRAME_SET_LABELS.doctorwho).toBe("Doctor Who");
    expect(FRAME_ERA_LABELS[FRAME_SET_ERA.doctorwho]).toBe("Showcase & Universes Beyond");
  });

  it("is an M15-era family member on the run's cost row, name, type line, set symbol, rules, P/T and collector line", () => {
    const m15 = getFrameProfile("m15");
    expect(M15_FAMILY_TEMPLATES).toContain("tardis");
    expect(COLLECTOR_TEMPLATES).toContain("tardis");
    expect(p.title.fit).toBe("measured");
    expect(p.type.fit).toBe("measured");
    // White ink everywhere (the bars are black, the box dark blue).
    for (const slot of [p.title, p.type, p.rules, p.pt!]) expect(slot.colorHex).toBe("#ffffff");
    // The CC M15 disc (70 px) 4 px lower than the CC-framed M15 row.
    expect(p.costSizePct).toBeCloseTo(70 / 1500, 12);
    expect(p.costDy).toBeCloseTo(-6.6 / 1500 + 4 / 1500, 12);
    expect(p.costDx).toBeCloseTo(2 / 1500, 12);
    expect(p.title.rect).toEqual(m15.title.rect);
    expect(p.title.dy).toBeCloseTo(m15.title.dy! - 3 / 1500, 12);
    // The type line ends 9 px short of the set symbol's ring (1271 px).
    expect(((p.type.rect.leftPct + p.type.rect.widthPct) / 100) * 1500).toBeCloseTo(1262, 9);
    // The set symbol's box centred on the ring (1335.5, 1241).
    const s = TARDIS_SYMBOL_RECT;
    const box = SET_SYMBOL_BOX_PCT * 1500;
    expect(((s.leftPct + s.widthPct) / 100) * 1500 - box / 2).toBeCloseTo(1335.5, 9);
    expect(((s.topPct + s.heightPct / 2) / 100) * 2100).toBeCloseTo(1241, 9);
    expect(p.symbolRect).toBe(TARDIS_SYMBOL_RECT);
    // The window (α < 250 on 115–1385 × 264–1161) inside the slot with the
    // art-window check's 0.05 % to spare.
    const a = TARDIS_ART_SLOT;
    expect(p.artSlot).toBe(a);
    expect([(a.leftPct / 100) * 1500, ((a.leftPct + a.widthPct) / 100) * 1500, (a.topPct / 100) * 2100, ((a.topPct + a.heightPct) / 100) * 2100].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([114, 1387, 262, 1164]);
    expect(p.underFrameArt).toBeUndefined();
    // M15's margins on print's rows: 1350–1902.
    expect(p.rules.padPx).toEqual(m15.rules.padPx);
    expect([(p.rules.rect.topPct / 100) * 2100, ((p.rules.rect.topPct + p.rules.rect.heightPct) / 100) * 2100].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1350, 1902]);
    // The pack's box at its ptBounds; the digits on print's centre.
    expect(p.pt?.plateAssetPathTemplate).toBe("/frames/tardis/pt/{color}.png");
    expect(p.pt?.plateRect).toEqual({ topPct: (1850 / 2100) * 100, leftPct: (1133 / 1500) * 100, widthPct: (299 / 1500) * 100, heightPct: (173 / 2100) * 100 });
    expect([(p.pt!.rect.leftPct / 100) * 1500, (p.pt!.rect.topPct / 100) * 2100].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1191, 1890]);
    expect(PLATE_INK["/frames/tardis/pt/{color}.png"]).toBeDefined();
    // The collector line where the run sets it.
    expect(p.collector).toBe(TARDIS_COLLECTOR);
    expect({ ...TARDIS_COLLECTOR, line1BaselinePct: 0, line2BaselinePct: 0 }).toEqual({ ...M15_COLLECTOR, line1BaselinePct: 0, line2BaselinePct: 0 });
    expect((TARDIS_COLLECTOR.line1BaselinePct / 100) * 2100).toBeCloseTo((M15_COLLECTOR.line1BaselinePct / 100) * 2100 - 6, 9);
    expect((TARDIS_COLLECTOR.line2BaselinePct / 100) * 2100).toBeCloseTo((M15_COLLECTOR.line2BaselinePct / 100) * 2100 - 5, 9);
    // The two-colour dress is the pair masters; no crown (the brace is in
    // the masters); the triangle stamp.
    expect(p.twoColorMasters).toEqual(["split"]);
    expect(p.twoColorSplit).toBeUndefined();
    expect(p.crownMasters).toBeUndefined();
    expect(p.overlays?.map((o) => o.anatomy)).toEqual(["holoStamp"]);
  });

  it("keys the stamp by the colour or the pair, on every rarity (a triangle frame)", () => {
    const keysOf = (style: Record<string, unknown>, facts: Record<string, unknown>) =>
      resolveFrameOverlays(p, { template: "tardis", stamp: "auto", ...style } as never, { colors: [], rarity: "rare", supertype: null, cardType: "creature", ...facts, colorKey: facts.colorKey as string } as never).map((o) => `${o.anatomy}:${o.key}`);
    expect(keysOf({}, { colorKey: "w", colors: ["white"] })).toEqual(["holoStamp:w"]);
    expect(keysOf({ twoColor: true }, { colorKey: "m", colors: ["red", "white"] })).toEqual(["holoStamp:rw"]);
    expect(keysOf({}, { colorKey: "m", colors: ["red", "white"] })).toEqual(["holoStamp:m"]);
    expect(keysOf({}, { colorKey: "c", colors: [], cardType: "artifact" })).toEqual(["holoStamp:c"]);
    expect(keysOf({}, { colorKey: "b", colors: ["black"], rarity: "uncommon" })).toEqual(["holoStamp:b"]);
    expect(keysOf({ stamp: "none" }, { colorKey: "b", colors: ["black"] })).toEqual([]);
  });
});

const ALL_KEYS = [...MASTER_KEYS, ...TWO_COLOR_PAIRS];
const masters = ALL_KEYS.map((k) => [k, published(`tardis/${k}.png`)] as const);
const plates = MASTER_KEYS.map((k) => [k, published(`tardis/pt/${k}.png`)] as const);
const notches = ALL_KEYS.map((k) => [k, published(`tardisholostamp/${k}.png`)] as const);
const available = [...masters, ...plates, ...notches].every(([, b]) => b !== null);

describe.skipIf(!available)("the published objects (set FRAMES_BUILD_DIR if skipped)", () => {
  const read = async (rel: string) => sharp(published(rel)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = (d: Buffer, x: number, y: number) => Array.from(d.subarray((y * 1500 + x) * 4, (y * 1500 + x) * 4 + 4));

  it("one plate under every key, one notch piece under every key and pair", () => {
    expect(new Set(MASTER_KEYS.map((k) => MANIFEST[`tardis/pt/${k}.png`].sha256)).size).toBe(1);
    expect(new Set(ALL_KEYS.map((k) => MANIFEST[`tardisholostamp/${k}.png`].sha256)).size).toBe(1);
  });

  it("tardis: 1500 × 2100, the black border, the corners cut, the window clear, the brace drawn, a pair's first colour left and second right", async () => {
    const w = await read("tardis/w.png");
    expect([w.info.width, w.info.height]).toEqual([1500, 2100]);
    for (const [x, y] of [[750, 8], [750, 2090], [300, 2060]]) {
      const [r, g, b, a] = px(w.data, x, y);
      expect(a, `(${x}, ${y})`).toBe(255);
      expect(r + g + b, `(${x}, ${y})`).toBeLessThan(10);
    }
    expect([px(w.data, 0, 0)[3], px(w.data, 1499, 0)[3], px(w.data, 0, 2099)[3], px(w.data, 1499, 2099)[3]]).toEqual([0, 0, 0, 0]);
    expect(px(w.data, 750, 700)[3]).toBe(0);
    // The brace's wedge (the pack's crown) over the window's top-left corner.
    expect(px(w.data, 150, 278)[3]).toBe(255);
    // The rw pair: its left stripe and wedge are r's, its right ones w's.
    const [r, wm, rw] = await Promise.all([read("tardis/r.png"), read("tardis/w.png"), read("tardis/rw.png")]);
    expect(px(rw.data, 72, 700)).toEqual(px(r.data, 72, 700));
    expect(px(rw.data, 150, 278)).toEqual(px(r.data, 150, 278));
    expect(px(rw.data, 1425, 700)).toEqual(px(wm.data, 1425, 700));
    expect(px(rw.data, 1350, 278)).toEqual(px(wm.data, 1350, 278));
    expect(px(rw.data, 750, 1600)).toEqual(px(r.data, 750, 1600));
  });

  it("tardis: the stripes toned onto print — the red body and light strip, not the pack's pale strip", async () => {
    const r = await read("tardis/r.png");
    const med = (x0: number, x1: number) => {
      const ch: number[][] = [[], [], []];
      for (let y = 500; y < 1100; y += 1) for (let x = x0; x <= x1; x += 1) ch.forEach((c, i) => c.push(r.data[(y * 1500 + x) * 4 + i]));
      return ch.map((v) => v.sort((a, b) => a - b)[v.length >> 1]);
    };
    // The body's flat interior (its region's median, `to`, takes in the
    // stripe's shaded edge too: print's flat body reads 139–140 in red).
    med(68, 76).forEach((v, i) => expect(Math.abs(v - TARDIS_PRINT_TONES.stripe.r.to[i]), `body ${i}`).toBeLessThan(12));
    expect(med(68, 76)[2]).toBeGreaterThan(20);
    med(81, 83).forEach((v, i) => expect(Math.abs(v - TARDIS_PRINT_TONES.stripeLight.r.to[i]), `light ${i}`).toBeLessThan(6));
  });

  it("tardisholostamp: its hole cut and ringed, nothing lit outside it", async () => {
    const notch = await sharp(published("tardisholostamp/w.png")!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([notch.info.width, notch.info.height]).toEqual([TARDIS_NOTCH_BOX.width, TARDIS_NOTCH_BOX.height]);
    expect(pieceNotchFindings(notch.data, TARDIS_NOTCH.shape, UB_STAMP_HOLE, 2, 2).failures).toEqual([]);
    for (let i = 0; i < TARDIS_NOTCH_BOX.width * TARDIS_NOTCH_BOX.height; i += 1) {
      if (notch.data[i * 4 + 3] === 0) continue;
      expect(Math.max(notch.data[i * 4], notch.data[i * 4 + 1], notch.data[i * 4 + 2]), `${i}`).toBeLessThan(40);
    }
  });
});
