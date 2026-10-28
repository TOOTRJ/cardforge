import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  BREAKING_NEWS,
  BREAKING_NEWS_CAPTURE_PX,
  BREAKING_NEWS_CROWN_BAND,
  BREAKING_NEWS_KEEP_CORNERS,
  BREAKING_NEWS_NOTCH,
  BREAKING_NEWS_NOTCH_BOX,
  BREAKING_NEWS_PAIR_RAMP,
  BREAKING_NEWS_PRINT_TONES,
  BREAKING_NEWS_STAMP_OVAL_PX,
  BREAKING_NEWS_STRIP_RGB,
  CC_OVERLAY_BANDS,
  CC_TEMPLATES,
  HOLO_STAMP_NOTCHES,
  NOTCH_BLACK,
  blackoutAndCut,
  blackoutStampShape,
  breakingNewsCrownFindings,
  breakingNewsCrownLayers,
  capturePlane,
  cutInside,
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
import { BREAKING_NEWS_COLLECTOR, BREAKING_NEWS_CROWN, BREAKING_NEWS_HOLO_STAMP, BREAKING_NEWS_HOLO_STAMP_OVAL, M15_COLLECTOR, getFrameProfile } from "@/lib/cards/template-layout";
import { costRectSharesTitleRows, fitTitleBand, titleBandRoomPct } from "@/lib/cards/title-band";
import { EDGE_CONTRACTS, EDGE_CONTRACT_KNOWN_FAILURES } from "@/lib/frames/edge-contract";
import { ART_WINDOW_KNOWN_FAILURES } from "@/lib/frames/art-window";
import { SQUARE_CORNERS, squareCornerKind } from "@/lib/frames/square-corners";
import { BORDER_PENDING_TEMPLATES } from "@/lib/scryfall/frame-signatures";
import { NEVER_NORMALISE } from "../../../scripts/lib/frame-corners.mjs";
import { FRAME_ERA_LABELS, FRAME_SET_ERA, FRAME_SET_LABELS, FRAME_TEMPLATE_LABELS, FRAME_TEMPLATE_SET } from "@/types/card";
import manifestJson from "@/lib/frames/frame-manifest.json";

// ---------------------------------------------------------------------------
// TODO 4.11 wave 2: the Outlaws of Thunder Junction BREAKING NEWS showcase
// (`breakingnews`; OTJ's bonus sheet OTP #1–65) from Card Conjurer's
// 'Breaking News' pack (2010 × 2814, downscaled once) — a NEW template, an
// addition. The recipe (the pack's frames, `a` its artifact frame, `c` its
// land frame, and the ten two-colour pairs lerped across print's split), the
// tone rule's verdict (nothing toned), the crown band (its pairs lerped), the
// OVAL notch (the pack's capture painted the strip's charcoal, the prints'
// oval cut, the strip's flat edges cleared), the edges and square corners,
// the profile on the page's own bands (the cost in the masthead, off the
// name's rows) and, where the published objects are on disk at the
// manifest's sha256 (FRAMES_BUILD_DIR, else .frames-build; CI fetches them),
// their pixels.
// ---------------------------------------------------------------------------

type Layer = { src: string; right?: string; ramp?: number[] };
const def = (CC_TEMPLATES as unknown as Record<string, { colors: Record<string, Layer[]>; plates: Record<string, string>; keepCorners?: readonly string[] }>).breakingnews;
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
const PLATE_KEYS = ["w", "u", "b", "r", "g", "c", "m"];
const fileOf = (k: string) => `${BREAKING_NEWS}/${k === "c" ? "l" : k}.png`;

describe("the Breaking News recipe", () => {
  it("is the pack's frames whole (a = its artifact frame, c = its land frame) and the ten pairs lerped across print's split", () => {
    expect(BREAKING_NEWS).toBe("img/frames/breakingNews");
    expect(Object.keys(def.colors).sort()).toEqual([...MASTER_KEYS, ...TWO_COLOR_PAIRS].sort());
    for (const key of MASTER_KEYS) expect(def.colors[key], key).toEqual([{ src: fileOf(key) }]);
    for (const pair of TWO_COLOR_PAIRS) {
      expect(def.colors[pair], pair).toEqual([{ src: fileOf(pair[0]), right: fileOf(pair[1]), ramp: [...BREAKING_NEWS_PAIR_RAMP] }]);
    }
    // Print's split crosses 10 / 90 % at 46.7 / 54.6 %W on every pair.
    expect([...BREAKING_NEWS_PAIR_RAMP]).toEqual([45.7, 55.6]);
    const at = (pct: number) => (pct - BREAKING_NEWS_PAIR_RAMP[0]) / (BREAKING_NEWS_PAIR_RAMP[1] - BREAKING_NEWS_PAIR_RAMP[0]);
    expect(at(46.7)).toBeCloseTo(0.1, 2);
    expect(at(54.6)).toBeCloseTo(0.9, 1);
    // The pack's plate per key; the colourless card the artifact's (no land plate).
    for (const key of PLATE_KEYS) expect(def.plates[key], key).toBe(`${BREAKING_NEWS}/pt/${key === "c" ? "a" : key}.png`);
    expect(sourceFilesFor(def as never).sort()).toEqual(
      [...["a", "b", "g", "l", "m", "r", "u", "w"].map((f) => `${BREAKING_NEWS}/${f}.png`), ...["a", "b", "g", "m", "r", "u", "w"].map((f) => `${BREAKING_NEWS}/pt/${f}.png`)].sort(),
    );
    // Every corner kept square: the page and the strip run into them.
    expect(def.keepCorners).toBe(BREAKING_NEWS_KEEP_CORNERS);
    expect([...BREAKING_NEWS_KEEP_CORNERS]).toEqual(["tl", "tr", "bl", "br"]);
  });

  it("tones nothing — every region within 8 levels of print", () => {
    expect(BREAKING_NEWS_PRINT_TONES).toEqual({});
    for (const f of ["w", "u", "b", "r", "g", "m", "a", "l", "stamp", "pt/w", "pt/a", "crown/w", "crown/a", "crown/l"]) {
      expect(sourceTonesOf(`${BREAKING_NEWS}/${f}.png`), f).toBeNull();
    }
  });

  it("the crown band publishes the profile's keys at the pack's bounds, its pairs lerped", () => {
    expect([...BREAKING_NEWS_CROWN_BAND.keys]).toEqual(BREAKING_NEWS_CROWN.keys);
    expect(BREAKING_NEWS_CROWN.rect.heightPct).toBeCloseTo((BREAKING_NEWS_CROWN_BAND.rows / 2100) * 100, 12);
    expect(BREAKING_NEWS_CROWN.keyMap).toEqual({ c: "l" });
    expect(BREAKING_NEWS_CROWN.artifactKeyMap).toEqual({ c: "a" });
    expect(CC_OVERLAY_BANDS.breakingnewscrown.band).toBe(BREAKING_NEWS_CROWN_BAND);
    expect((CC_OVERLAY_BANDS.breakingnewscrown as unknown as { keepCorners: string[] }).keepCorners).toEqual(["tl", "tr"]);
    expect(breakingNewsCrownLayers("l")).toEqual([{ src: `${BREAKING_NEWS}/crown/l.png`, at: { ...BREAKING_NEWS_CROWN_BAND.crown } }]);
    expect(breakingNewsCrownLayers("bg")).toEqual([
      { src: `${BREAKING_NEWS}/crown/b.png`, at: { ...BREAKING_NEWS_CROWN_BAND.crown }, right: `${BREAKING_NEWS}/crown/g.png`, ramp: [...BREAKING_NEWS_PAIR_RAMP] },
    ]);
    expect(() => breakingNewsCrownLayers("c")).toThrow();
    // The crown ends 55.2 px down (74 / 2814 × 2100); the band's rows hold it and its ringing.
    expect(BREAKING_NEWS_CROWN_BAND.rows).toBe(60);
  });

  it("the crown's findings: opaque on its rule, clear at the side edges, nothing past the band", () => {
    const W = 1500;
    const H = 2100;
    const buf = Buffer.alloc(W * H * 4);
    for (let y = 2; y < 56; y += 1) for (let x = 4; x < 1470; x += 1) buf[(y * W + x) * 4 + 3] = 255;
    expect(breakingNewsCrownFindings(buf, W, H, 60).failures).toEqual([]);
    buf[(10 * W) * 4 + 3] = 40;
    expect(breakingNewsCrownFindings(buf, W, H, 60).failures.join(" ")).toMatch(/side edges/);
    buf[(10 * W) * 4 + 3] = 0;
    buf[(90 * W + 700) * 4 + 3] = 9;
    expect(breakingNewsCrownFindings(buf, W, H, 60).failures.join(" ")).toMatch(/past the band/);
  });

  it("the notch publishes the profile's keys at the importer's box, its oval the prints', painted the strip's charcoal", () => {
    expect([...BREAKING_NEWS_NOTCH.keys]).toEqual(BREAKING_NEWS_HOLO_STAMP.keys);
    expect(BREAKING_NEWS_HOLO_STAMP.rect).toEqual({
      leftPct: (BREAKING_NEWS_NOTCH_BOX.x / 1500) * 100,
      topPct: (BREAKING_NEWS_NOTCH_BOX.y / 2100) * 100,
      widthPct: (BREAKING_NEWS_NOTCH_BOX.width / 1500) * 100,
      heightPct: (BREAKING_NEWS_NOTCH_BOX.height / 2100) * 100,
    });
    // The piece (447 × 116 at 781 / 2555 of 2010 × 2814 → 582.8–916.4 ×
    // 1906.9–1993.4 px) inside the box.
    const { x, y, width, height } = BREAKING_NEWS_NOTCH.placeAt;
    expect([x, y, width, height]).toEqual([781, 2555, 447, 116]);
    expect(BREAKING_NEWS_NOTCH_BOX.x).toBeLessThan((x / 2010) * 1500);
    expect(BREAKING_NEWS_NOTCH_BOX.y).toBeLessThan((y / 2814) * 2100);
    expect(BREAKING_NEWS_NOTCH_BOX.x + BREAKING_NEWS_NOTCH_BOX.width).toBeGreaterThan(((x + width) / 2010) * 1500);
    expect(BREAKING_NEWS_NOTCH_BOX.y + BREAKING_NEWS_NOTCH_BOX.height).toBeGreaterThan(((y + height) / 2814) * 2100);
    // The prints' oval (132 × 67), its cut and ring inside the box.
    expect(BREAKING_NEWS_STAMP_OVAL_PX).toEqual({ x: 685, y: 1921, width: 132, height: 67 });
    // The pack paints its capture lower than print sets the hologram's top:
    // it is painted out, not cut (the cut is the prints').
    expect(BREAKING_NEWS_CAPTURE_PX.y).toBeGreaterThan(BREAKING_NEWS_STAMP_OVAL_PX.y);
    const n = HOLO_STAMP_NOTCHES.breakingnewsholostamp as unknown as {
      blackoutCapturePx: number;
      fillRgb: readonly number[];
      clearOutside: { x0: number; x1: number; y1: number };
      capture: { oval: boolean };
    };
    expect(n.blackoutCapturePx).toBe(2);
    expect(n.fillRgb).toBe(BREAKING_NEWS_STRIP_RGB);
    expect([...BREAKING_NEWS_STRIP_RGB]).toEqual([64, 58, 60]);
    expect(n.clearOutside).toEqual({ x0: 590, x1: 909, y1: 1989 });
    expect(n.capture.oval).toBe(true);
    expect(notchCutOf(HOLO_STAMP_NOTCHES.breakingnewsholostamp)).toBe(BREAKING_NEWS_NOTCH.oval);
    expect(BREAKING_NEWS_HOLO_STAMP.anatomy === "holoStamp" && BREAKING_NEWS_HOLO_STAMP.stamp.shape).toBe("oval");
    for (const k of ["leftPct", "topPct", "widthPct", "heightPct"] as const) expect(BREAKING_NEWS_HOLO_STAMP_OVAL[k]).toBeCloseTo(BREAKING_NEWS_NOTCH.oval[k], 9);
    expect(notchSourceFiles(HOLO_STAMP_NOTCHES.breakingnewsholostamp)).toEqual([`${BREAKING_NEWS}/stamp.png`]);
  });
});

describe("the importer's notch piece, in the strip's charcoal", () => {
  const shape = BREAKING_NEWS_NOTCH.shape;
  const { width, height } = shape.size;
  const box = BREAKING_NEWS_NOTCH_BOX;
  const [cr, cg, cb] = BREAKING_NEWS_STRIP_RGB;
  /** A synthetic piece: the charcoal tab, a bright "hologram" where the
   *  PACK paints it (BREAKING_NEWS_CAPTURE_PX, lower than the prints' oval),
   *  and the page's light foot in the capture box's top corners. */
  function piece(): Buffer {
    const buf = Buffer.alloc(width * height * 4);
    const cx = BREAKING_NEWS_CAPTURE_PX.x + BREAKING_NEWS_CAPTURE_PX.width / 2 - box.x;
    const cy = BREAKING_NEWS_CAPTURE_PX.y + BREAKING_NEWS_CAPTURE_PX.height / 2 - box.y;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const o = (y * width + x) * 4;
        if ((x < 3 || x > width - 4) && (y < 3 || y > height - 4)) continue;
        const inHolo = ((x - cx) / (BREAKING_NEWS_CAPTURE_PX.width / 2)) ** 2 + ((y - cy) / (BREAKING_NEWS_CAPTURE_PX.height / 2)) ** 2 <= 1;
        const foot = y < 24 && (x < 110 || x > width - 110);
        buf.set(inHolo ? [200, 200, 200, 255] : foot ? [150, 120, 90, 255] : [cr, cg, cb, 255], o);
      }
    }
    return buf;
  }

  it("paints the capture the strip's charcoal (never the page's foot), cuts the prints' oval and rings it in charcoal", () => {
    const placed = piece();
    const captured = capturePlane(placed, width, height, BREAKING_NEWS_NOTCH.capture);
    // The foot is lit but outside the capture's ellipse.
    expect(captured[20 * width + 100]).toBe(0);
    blackoutStampShape(placed, captured, width, height, 2, BREAKING_NEWS_STRIP_RGB);
    const out = blackoutAndCut(placed, shape, BREAKING_NEWS_NOTCH.oval, 2, 2, BREAKING_NEWS_STRIP_RGB);
    expect(pieceNotchFindings(out, shape, BREAKING_NEWS_NOTCH.oval, 2, 2, null, BREAKING_NEWS_STRIP_RGB).failures).toEqual([]);
    expect(stampShapeBlackFindings(out, captured, width, height, BREAKING_NEWS_STRIP_RGB).failures).toEqual([]);
    // Black would be refused on this piece: its ring is the strip's colour.
    expect(pieceNotchFindings(out, shape, BREAKING_NEWS_NOTCH.oval, 2, 2).failures.join(" ")).toMatch(/opaque black/);
    // Nothing of the capture is left lit; the foot keeps its colour.
    const inCut = cutInside(shape, BREAKING_NEWS_NOTCH.oval, 2);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!captured[y * width + x] || inCut(x, y, 0)) continue;
        expect([out[(y * width + x) * 4], out[(y * width + x) * 4 + 1], out[(y * width + x) * 4 + 2]], `(${x}, ${y})`).toEqual([cr, cg, cb]);
      }
    }
    expect(out[(20 * width + 100) * 4]).toBe(150);
  });

  it("a notch with no fill of its own keeps the black ring (NOTCH_BLACK)", () => {
    expect([...NOTCH_BLACK]).toEqual([0, 0, 0]);
    const placed = piece();
    const out = blackoutAndCut(placed, shape, BREAKING_NEWS_NOTCH.oval, 2, 2);
    expect(pieceNotchFindings(out, shape, BREAKING_NEWS_NOTCH.oval, 2, 2).ringBlack).toBe(true);
  });

  it("the pack's capture lies inside the prints' cut and its ring; one painted lower would show — refused without the paint-out", () => {
    const placed = piece();
    const inRing = cutInside(shape, BREAKING_NEWS_NOTCH.oval, 2);
    const own = capturePlane(placed, width, height, BREAKING_NEWS_NOTCH.capture);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (own[y * width + x]) expect(inRing(x, y, 2), `(${x}, ${y})`).toBe(true);
    // The same capture 8 px lower (as the pack paints the dossier's).
    const low = Buffer.from(placed);
    for (let y = height - 1; y >= 8; y -= 1) for (let x = 0; x < width; x += 1) if (own[(y - 8) * width + x]) low.set([200, 200, 200, 255], (y * width + x) * 4);
    const captured = capturePlane(low, width, height, { ...BREAKING_NEWS_NOTCH.capture, y1: BREAKING_NEWS_NOTCH.capture.y1 + 8 });
    const out = blackoutAndCut(low, shape, BREAKING_NEWS_NOTCH.oval, 2, 2, BREAKING_NEWS_STRIP_RGB);
    expect(pieceNotchFindings(out, shape, BREAKING_NEWS_NOTCH.oval, 2, 2, captured, BREAKING_NEWS_STRIP_RGB).failures.join(" ")).toMatch(/stamp shape/);
  });
});

describe("the edges and corners", () => {
  it("the page to the top and sides, the charcoal strip to the bottom — design all round, kept square — on no pending list", () => {
    const design = { kind: "design" };
    expect(EDGE_CONTRACTS.breakingnews).toEqual({ top: design, right: design, bottom: design, left: design });
    expect(EDGE_CONTRACT_KNOWN_FAILURES.breakingnews).toBeUndefined();
    expect(ART_WINDOW_KNOWN_FAILURES.breakingnews).toBeUndefined();
    expect(BORDER_PENDING_TEMPLATES.has("breakingnews")).toBe(false);
    expect(NEVER_NORMALISE.test("breakingnews")).toBe(false);
    expect(SQUARE_CORNERS.breakingnews).toEqual({ kinds: "frame" });
    expect(["tl", "tr", "bl", "br"].map((c) => squareCornerKind("breakingnews", "w", c as never))).toEqual(["frame", "frame", "frame", "frame"]);
  });
});

describe("the profile rides the page's own bands", () => {
  const p = getFrameProfile("breakingnews");
  const row = (pct: number) => (pct / 100) * 2100;
  const col = (pct: number) => (pct / 100) * 1500;

  it("is a new showcase set of its own, Outlaws of Thunder Junction — Breaking News", () => {
    expect(FRAME_TEMPLATE_LABELS.breakingnews).toBe("Breaking News");
    expect(FRAME_TEMPLATE_SET.breakingnews).toBe("thunderjunction");
    expect(FRAME_SET_LABELS.thunderjunction).toBe("Outlaws of Thunder Junction");
    expect(FRAME_ERA_LABELS[FRAME_SET_ERA.thunderjunction]).toBe("Showcase & Universes Beyond");
  });

  it("is an M15-era family member: the name centred in capitals on its band, the cost in the masthead, the type line, the symbol's box, the rules box, the P/T box and the collector line", () => {
    const m15 = getFrameProfile("m15");
    expect(M15_FAMILY_TEMPLATES).toContain("breakingnews");
    expect(COLLECTOR_TEMPLATES).toContain("breakingnews");
    expect(p.title.fit).toBe("measured");
    expect(p.type.fit).toBe("measured");
    expect(p.symbolStyle).toBeUndefined();
    expect(p.artifactMasterKeys).toEqual({ c: "a" });
    // The name: centred, capitals, between the masthead's boxes (175–1325),
    // its rect centred 24 px over print's 298 × 0.9978.
    expect([p.title.align, p.title.uppercase, p.title.colorHex, p.title.sizePct, p.title.dy]).toEqual(["center", true, "#332e30", m15.title.sizePct, m15.title.dy]);
    expect([col(p.title.rect.leftPct), col(p.title.rect.leftPct + p.title.rect.widthPct)].map((v) => Math.round(v * 1000) / 1000)).toEqual([175, 1325]);
    expect(row(p.title.rect.topPct + p.title.rect.heightPct / 2)).toBeCloseTo(298 * 0.9978 - 24, 6);
    // The cost: the family's 70 px disc in a box of its own, centred on 112,
    // ending on 1411 — off the name's rows, so the name keeps its band.
    expect(p.costSizePct).toBeCloseTo(70 / 1500, 12);
    expect([p.costDy ?? 0, p.costDx ?? 0]).toEqual([0, 0]);
    const c = p.costRect!;
    expect([row(c.topPct), row(c.topPct + c.heightPct), col(c.leftPct + c.widthPct)].map((v) => Math.round(v * 1000) / 1000)).toEqual([77, 147, 1411]);
    expect(costRectSharesTitleRows(p)).toBe(false);
    expect(titleBandRoomPct(p, "{U}{U}{B}{B}{B}{R}{R}")).toBe(p.title.rect.widthPct / 100);
    expect(titleBandRoomPct(p, "{U}{U}{B}{B}{B}{R}{R}")).toBe(titleBandRoomPct(p, null));
    expect(fitTitleBand(p, "Indomitable Creativity", "{X}{R}{R}{R}")).toEqual(fitTitleBand(p, "Indomitable Creativity", null));
    // …and the planeswalkers' / the 2003 frame's boxes still share their names' rows.
    for (const t of ["m15pw", "m15borderlesspw", "m15borderlesspwtall", "modern"] as const) expect(costRectSharesTitleRows(getFrameProfile(t)), t).toBe(true);
    // The type line: capitals, M15's pen, the CC M15 dy, its band 1380 px.
    expect([p.type.uppercase, p.type.colorHex, p.type.dy, p.type.rect.leftPct]).toEqual([true, "#332e30", getFrameProfile("m15artifact").type.dy, m15.type.rect.leftPct]);
    expect(col(p.type.rect.leftPct + p.type.rect.widthPct)).toBeCloseTo(1380, 6);
    expect(row(p.type.rect.topPct + p.type.rect.heightPct / 2)).toBeCloseTo(1324 * 0.9978 - 17.8, 6);
    // The set symbol's box at the band's right end, on print's vault.
    const s = p.symbolRect!;
    expect(col(s.leftPct + s.widthPct)).toBeCloseTo(1382, 6);
    expect(row(s.topPct + s.heightPct / 2)).toBeCloseTo(1297 * 0.9978 + 1.4, 6);
    // The rules box between the page's two rules.
    expect([row(p.rules.rect.topPct), row(p.rules.rect.topPct + p.rules.rect.heightPct)].map((v) => Math.round(v))).toEqual([1371, 1895]);
    expect(p.rules.padPx).toEqual(m15.rules.padPx);
    // The window's round-cornered see-through (79.1–1423.1 × 357.5–1203.8)
    // inside the slot with the art-window check's 0.05 % to spare.
    const a = p.artSlot;
    expect([col(a.leftPct), col(a.leftPct + a.widthPct), row(a.topPct), row(a.topPct + a.heightPct)].map((v) => Math.round(v * 1000) / 1000)).toEqual([78, 1425, 356, 1206]);
    expect(p.underFrameArt).toBeUndefined();
    // The pack's box at its ptBounds, the digits in Card Conjurer's text box.
    expect(p.pt?.plateAssetPathTemplate).toBe("/frames/breakingnews/pt/{color}.png");
    expect(p.pt?.plateRect).toEqual({ topPct: (2464 / 2814) * 100, leftPct: (1507 / 2010) * 100, widthPct: (406 / 2010) * 100, heightPct: (200 / 2814) * 100 });
    expect([p.pt!.rect.topPct, p.pt!.rect.leftPct]).toEqual([(2529 / 2814) * 100 + (8 / 2100) * 100, (1599 / 2010) * 100]);
    expect(p.pt?.colorHex).toBe("#332e30");
    expect(PLATE_INK["/frames/breakingnews/pt/{color}.png"]).toBeDefined();
    // The collector line where the run sets it in the strip.
    expect(p.collector).toBe(BREAKING_NEWS_COLLECTOR);
    expect({ ...BREAKING_NEWS_COLLECTOR, line1BaselinePct: 0, line2BaselinePct: 0 }).toEqual({ ...M15_COLLECTOR, line1BaselinePct: 0, line2BaselinePct: 0 });
    expect(row(BREAKING_NEWS_COLLECTOR.line1BaselinePct)).toBeCloseTo(1988 * 0.9978 + 1.7, 9);
    expect(row(BREAKING_NEWS_COLLECTOR.line2BaselinePct)).toBeCloseTo(2027 * 0.9978 + 1.8, 9);
    // The two-colour dress is the pair masters, a land's too (one page for
    // spells and lands); never a hard seam.
    expect(p.twoColorMasters).toEqual(["split"]);
    expect(p.twoColorForLands).toBe(true);
    expect(p.twoColorSplit).toBeUndefined();
    expect(p.overlays?.map((o) => o.anatomy)).toEqual(["crown", "holoStamp"]);
  });

  it("keys the crown and the stamp by the colour, the pair, the artifact or the land", () => {
    const keysOf = (style: Record<string, unknown>, facts: Record<string, unknown>) =>
      resolveFrameOverlays(p, { template: "breakingnews", crown: true, stamp: "auto", ...style } as never, { colors: [], rarity: "rare", supertype: "Legendary", cardType: "instant", ...facts, colorKey: facts.colorKey as string } as never).map(
        (o) => `${o.anatomy}:${o.key}`,
      );
    expect(keysOf({}, { colorKey: "w", colors: ["white"] })).toEqual(["crown:w", "holoStamp:w"]);
    expect(keysOf({ twoColor: true }, { colorKey: "m", colors: ["black", "green"] })).toEqual(["crown:bg", "holoStamp:bg"]);
    expect(keysOf({}, { colorKey: "m", colors: ["black", "green"] })).toEqual(["crown:m", "holoStamp:m"]);
    // OTP #63 Mindslaver: a colourless legendary artifact — the slate crown.
    expect(keysOf({}, { colorKey: "c", colors: [], cardType: "artifact" })).toEqual(["crown:a", "holoStamp:a"]);
    // OTP #65 Dust Bowl: a colourless land — the land's.
    expect(keysOf({}, { colorKey: "c", colors: [], cardType: "land", supertype: null })).toEqual(["holoStamp:l"]);
    // "auto" is a rare or mythic on an oval frame, as the run prints it.
    expect(keysOf({}, { colorKey: "u", colors: ["blue"], supertype: null, rarity: "uncommon" })).toEqual([]);
  });
});

const ALL_KEYS = [...MASTER_KEYS, ...TWO_COLOR_PAIRS];
const OVERLAY_KEYS = ["w", "u", "b", "r", "g", "m", "a", "l", ...TWO_COLOR_PAIRS];
const masters = ALL_KEYS.map((k) => [k, published(`breakingnews/${k}.png`)] as const);
const plates = PLATE_KEYS.map((k) => [k, published(`breakingnews/pt/${k}.png`)] as const);
const crowns = OVERLAY_KEYS.map((k) => [k, published(`breakingnewscrown/${k}.png`)] as const);
const notches = OVERLAY_KEYS.map((k) => [k, published(`breakingnewsholostamp/${k}.png`)] as const);
const available = [...masters, ...plates, ...crowns, ...notches].every(([, b]) => b !== null);

describe.skipIf(!available)("the published objects (set FRAMES_BUILD_DIR if skipped)", () => {
  it("one notch piece under every key and pair; the colourless plate is the artifact's", () => {
    expect(new Set(OVERLAY_KEYS.map((k) => MANIFEST[`breakingnewsholostamp/${k}.png`].sha256)).size).toBe(1);
    expect(MANIFEST["breakingnews/pt/c.png"].sha256).not.toBe(MANIFEST["breakingnews/pt/w.png"].sha256);
  });

  it("breakingnews: 1500 × 2100, the corners kept, the charcoal strip, the window clear, a pair's first colour left and second right", async () => {
    const read = async (k: string) => await sharp(published(`breakingnews/${k}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = await read("w");
    expect([w.info.width, w.info.height]).toEqual([1500, 2100]);
    const px = (d: Buffer, x: number, y: number) => Array.from(d.subarray((y * 1500 + x) * 4, (y * 1500 + x) * 4 + 4));
    // The strip: print's charcoal, opaque to the bottom edge and its corners.
    for (const [x, y] of [[300, 2060], [1200, 2090], [0, 2099], [1499, 2099]]) expect(px(w.data, x, y), `(${x}, ${y})`).toEqual([...BREAKING_NEWS_STRIP_RGB, 255]);
    // Every corner kept square (opaque); the window clear.
    expect([px(w.data, 0, 0)[3], px(w.data, 1499, 0)[3], px(w.data, 0, 2099)[3], px(w.data, 1499, 2099)[3]]).toEqual([255, 255, 255, 255]);
    expect(px(w.data, 750, 780)[3]).toBe(0);
    // The bg pair: the masthead's rules b's on the left and g's on the right.
    const [b, g, bg] = await Promise.all([read("b"), read("g"), read("bg")]);
    expect(px(bg.data, 300, 189)).toEqual(px(b.data, 300, 189));
    expect(px(bg.data, 1200, 189)).toEqual(px(g.data, 1200, 189));
  });

  it("breakingnewsholostamp: its oval cut and ringed in charcoal, its flat edges cleared", async () => {
    const notch = await sharp(published("breakingnewsholostamp/w.png")!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([notch.info.width, notch.info.height]).toEqual([BREAKING_NEWS_NOTCH_BOX.width, BREAKING_NEWS_NOTCH_BOX.height]);
    expect(pieceNotchFindings(notch.data, BREAKING_NEWS_NOTCH.shape, BREAKING_NEWS_NOTCH.oval, 2, 2, null, BREAKING_NEWS_STRIP_RGB).failures).toEqual([]);
    const W = BREAKING_NEWS_NOTCH_BOX.width;
    const inRing = cutInside(BREAKING_NEWS_NOTCH.shape, BREAKING_NEWS_NOTCH.oval, 2);
    for (let y = 0; y < BREAKING_NEWS_NOTCH_BOX.height; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const cx = BREAKING_NEWS_NOTCH_BOX.x + x;
        const cy = BREAKING_NEWS_NOTCH_BOX.y + y;
        if (cx >= 590 && cx <= 909 && cy <= 1989) continue;
        // The ring round the prints' oval and the capture's paint-out are
        // painted after the clearing, in the strip's own charcoal.
        const o = (y * W + x) * 4;
        if (inRing(x, y, 2) || (cy > 1989 && notch.data[o] === 64 && notch.data[o + 1] === 58 && notch.data[o + 2] === 60)) continue;
        expect(notch.data[(y * W + x) * 4 + 3], `(${cx}, ${cy})`).toBe(0);
      }
    }
  });

  it("breakingnewscrown: 1500 × 60, the coloured rule across the top", async () => {
    const a = await sharp(published("breakingnewscrown/a.png")!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([a.info.width, a.info.height]).toEqual([1500, 60]);
    expect(breakingNewsCrownFindings(Buffer.concat([a.data, Buffer.alloc(1500 * 2040 * 4)]), 1500, 2100, 60).failures).toEqual([]);
  });
});
