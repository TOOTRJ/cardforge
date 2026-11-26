import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  CC_OVERLAY_BANDS,
  CC_TEMPLATES,
  DBL,
  DBL_ACCENT_DIFF,
  DBL_CROWN_BAND,
  DBL_FIELD_SPLIT,
  DBL_LAND_NOTCH,
  DBL_MASK,
  DBL_NOTCH,
  DBL_NOTCH_BOX,
  DBL_PRINT_TONES,
  HOLO_STAMP_NOTCHES,
  blackoutAndCut,
  blackoutStampShape,
  capturePlane,
  dblCrownFindings,
  dblCrownLayers,
  dblFrameFile,
  describeNotchPiece,
  notchCutOf,
  notchSourceFiles,
  pieceNotchFindings,
  rowsClipShare,
  sourceFilesFor,
  sourceTonesOf,
  stampShapeBlackFindings,
} from "../../../scripts/lib/cc-frames.mjs";
import { PAIR_RAMPS, TWO_COLOR_PAIRS } from "../../../scripts/lib/pair-ramp.mjs";
import { resolveFrameOverlays } from "@/lib/cards/anatomy";
import { COLLECTOR_TEMPLATES } from "@/lib/cards/collector-line";
import { M15_HOLO_STAMP_OVAL } from "@/lib/cards/holo-stamp";
import { M15_FAMILY_TEMPLATES } from "@/lib/cards/m15-family";
import { PLATE_INK } from "@/lib/cards/plate-ink";
import {
  DOUBLEFEATURE_COLLECTOR,
  DOUBLEFEATURE_CROWN,
  DOUBLEFEATURE_HOLO_STAMP,
  DOUBLEFEATURELAND_HOLO_STAMP,
  M15_COLLECTOR,
  getFrameProfile,
} from "@/lib/cards/template-layout";
import { frameMasterKey } from "@/components/cards/frame-layer";
import { EDGE_CONTRACTS, EDGE_CONTRACT_KNOWN_FAILURES } from "@/lib/frames/edge-contract";
import { ART_WINDOW_KNOWN_FAILURES } from "@/lib/frames/art-window";
import { SQUARE_CORNERS, squareCornerKind } from "@/lib/frames/square-corners";
import { BORDER_PENDING_TEMPLATES } from "@/lib/scryfall/frame-signatures";
import { FRAME_ERA_LABELS, FRAME_SET_ERA, FRAME_SET_LABELS, FRAME_TEMPLATE_LABELS, FRAME_TEMPLATE_SET } from "@/types/card";
import manifestJson from "@/lib/frames/frame-manifest.json";

// ---------------------------------------------------------------------------
// TODO 5.9 (its one-faced part): the Innistrad: Double Feature frame
// (`doublefeature`, `doublefeatureland`) from Card Conjurer's 'Double
// Feature (DBL)' pack (2010 × 2814, downscaled once) — two NEW templates,
// additions. The recipe (the pack's frames whole, `a` and `c` its artifact
// frame, the land's tints and its ten duals through the regular M15 masks),
// the tone rule's verdict (every coloured region toned: the field in two
// tones across the type bar, the stone, the pinlines, the rims, the crowns,
// the land stamps), the crown band, the two OVAL notches (the glow and the
// capture dropped, M15's oval cut; a dual's piece lerped), the edges, the
// profiles and, where the published objects are on disk at the manifest's
// sha256 (FRAMES_BUILD_DIR, else .frames-build; CI fetches them), their
// pixels.
// ---------------------------------------------------------------------------

type Layer = { src: string; mask?: string; right?: string; ramp?: number[] };
type Def = { colors: Record<string, Layer[]>; plates?: Record<string, string> };
const spell = (CC_TEMPLATES as unknown as Record<string, Def>).doublefeature;
const land = (CC_TEMPLATES as unknown as Record<string, Def>).doublefeatureland;
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
type Entry = { sha256: string; width: number; height: number };
const MANIFEST = (manifestJson as { files: Record<string, Entry> }).files;

function published(rel: string): Buffer | null {
  const file = path.join(BUILD, rel);
  if (!MANIFEST[rel] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === MANIFEST[rel].sha256 ? bytes : null;
}

const COLOUR_KEYS = ["w", "u", "b", "r", "g", "c", "m"];
const maxOff = ({ from, to }: { from: readonly number[]; to: readonly number[] }) => Math.max(...from.map((v, i) => Math.abs(v - to[i])));

describe("the Double Feature recipe", () => {
  it("is the pack's frames whole — `a` and `c` its artifact frame — with its plates per key", () => {
    expect(DBL).toBe("img/frames/doubleFeature");
    expect(Object.keys(spell.colors).sort()).toEqual([...COLOUR_KEYS, "a"].sort());
    for (const k of COLOUR_KEYS) expect(spell.colors[k], k).toEqual([{ src: `${DBL}/${k === "c" ? "a" : k}.png` }]);
    expect(spell.colors.a).toEqual([{ src: `${DBL}/a.png` }]);
    for (const k of COLOUR_KEYS) expect(spell.plates?.[k], k).toBe(`${DBL}/pt/${k === "c" ? "a" : k}.png`);
    // The pack's land plate and land crown 404: never read.
    const files = [...sourceFilesFor(spell as never), ...sourceFilesFor(land as never)];
    expect(files).not.toContain(`${DBL}/pt/l.png`);
    expect(files).not.toContain(`${DBL}/crowns/l.png`);
  });

  it("the land frame: the grey stone for c, the tints for the colours, gold for m, and the ten duals through the pack's own masks", () => {
    expect(Object.keys(land.colors).sort()).toEqual([...COLOUR_KEYS, ...TWO_COLOR_PAIRS].sort());
    expect(land.colors.c).toEqual([{ src: `${DBL}/l.png` }]);
    for (const k of ["w", "u", "b", "r", "g", "m"]) expect(land.colors[k], k).toEqual([{ src: `${DBL}/${k}l.png` }]);
    expect(land.plates).toBeUndefined();
    for (const pair of TWO_COLOR_PAIRS) {
      const [a, b] = pair.split("");
      // The stone whole, then the box and the pinline lerped between the two
      // tints (named colour first, `wl.png`), through the REGULAR M15 masks.
      expect(land.colors[pair], pair).toEqual([
        { src: `${DBL}/l.png` },
        { src: `${DBL}/${a}l.png`, right: `${DBL}/${b}l.png`, ramp: [...PAIR_RAMPS.rules], mask: DBL_MASK.rules },
        { src: `${DBL}/${a}l.png`, right: `${DBL}/${b}l.png`, ramp: [...PAIR_RAMPS.pinline], mask: DBL_MASK.pinline },
      ]);
    }
    expect(dblFrameFile("wl")).toBe(`${DBL}/wl.png`);
    expect(Object.values(DBL_MASK).every((m) => m.startsWith("img/frames/m15/regular/m15Mask"))).toBe(true);
  });

  it("tones every coloured region by the ring's rule — each ≥ 9 levels off — and leaves the red crown (unprinted) as drawn", () => {
    for (const table of [DBL_PRINT_TONES.field, DBL_PRINT_TONES.fieldLow, DBL_PRINT_TONES.pinline, DBL_PRINT_TONES.rim, DBL_PRINT_TONES.crown]) {
      for (const [k, tone] of Object.entries(table as Record<string, { from: number[]; to: number[] }>)) expect(maxOff(tone), k).toBeGreaterThanOrEqual(9);
    }
    expect(maxOff(DBL_PRINT_TONES.landField)).toBeGreaterThanOrEqual(9);
    expect(Object.keys(DBL_PRINT_TONES.crown).sort()).toEqual(["a", "b", "g", "m", "u", "w"]);
    expect(sourceTonesOf(`${DBL}/crowns/r.png`)).toBeNull();
    // The frame files: the field through the Frame mask, in two tones across
    // the type bar (the artifact's in one).
    for (const k of ["w", "u", "b", "r", "g", "m"]) {
      const t = sourceTonesOf(`${DBL}/${k}.png`);
      expect(t.masks, k).toEqual({ field: DBL_MASK.frame, fieldLow: DBL_MASK.frame });
      expect(t.clip, k).toEqual({ field: { rows: { ...DBL_FIELD_SPLIT, keep: "above" } }, fieldLow: { rows: { ...DBL_FIELD_SPLIT, keep: "below" } } });
    }
    expect(sourceTonesOf(`${DBL}/a.png`).masks).toEqual({ field: DBL_MASK.frame });
    expect(sourceTonesOf(`${DBL}/a.png`).clip).toBeUndefined();
    // The land files: the stone, and a tint's pinline.
    expect(Object.keys(sourceTonesOf(`${DBL}/l.png`).tones)).toEqual(["field"]);
    for (const k of ["w", "u", "b", "r", "g", "m"]) expect(sourceTonesOf(`${DBL}/${k}l.png`).masks, k).toEqual({ field: DBL_MASK.frame, pinline: DBL_MASK.pinline });
    // The plates, the crowns and the land stamps: their colour where they
    // differ from another key's.
    for (const k of ["w", "u", "b", "r", "g", "m", "a"]) {
      expect(sourceTonesOf(`${DBL}/pt/${k}.png`).diff.rim, k).toEqual({ file: `${DBL}/pt/${k === "w" || k === "a" ? "u" : "w"}.png`, ...DBL_ACCENT_DIFF });
    }
    for (const k of ["w", "u", "b", "r", "g", "m"]) expect(sourceTonesOf(`${DBL}/stamps/${k}.png`).diff.arch, k).toEqual({ file: `${DBL}/stamps/stamp.png`, ...DBL_ACCENT_DIFF });
    expect(sourceTonesOf(`${DBL}/stamps/stamp.png`)).toBeNull();
    // A thin flat line, a flat rim and a near-zero channel are toned by
    // their luminance (a per-channel gain drew the blue pinline's edge pink).
    for (const table of [DBL_PRINT_TONES.pinline, DBL_PRINT_TONES.rim, DBL_PRINT_TONES.stamp]) {
      for (const [k, tone] of Object.entries(table as Record<string, { mode?: string }>)) expect(tone.mode, k).toBe("luma");
    }
    expect(DBL_PRINT_TONES.crown.u.mode).toBe("luma");
    expect(DBL_PRINT_TONES.crown.m.mode).toBe("luma");
  });

  it("splits the field's two tones across the type bar: the shares sum to 1", () => {
    const above = rowsClipShare({ ...DBL_FIELD_SPLIT, keep: "above" }, 2100);
    const below = rowsClipShare({ ...DBL_FIELD_SPLIT, keep: "below" }, 2100);
    expect(above[1000]).toBe(1);
    expect(below[1000]).toBe(0);
    expect(above[1500]).toBe(0);
    expect(below[1500]).toBe(1);
    for (let y = 0; y < 2100; y += 50) expect(above[y] + below[y], `${y}`).toBeCloseTo(1, 12);
    expect(above[1240]).toBeGreaterThan(0);
    expect(above[1240]).toBeLessThan(1);
    expect(() => rowsClipShare({ fromPct: 60, toPct: 50, keep: "above" }, 10)).toThrow();
    expect(() => rowsClipShare({ fromPct: 50, toPct: 60, keep: "sideways" } as never, 10)).toThrow();
  });
});

describe("the Double Feature crown band", () => {
  it("is the pack's crown at its bounds (the card's whole top), seven keys, the profile's", () => {
    const band = CC_OVERLAY_BANDS.doublefeaturecrown as unknown as { band: typeof DBL_CROWN_BAND; keys: readonly string[] };
    expect(band.band).toBe(DBL_CROWN_BAND);
    expect([...DBL_CROWN_BAND.keys]).toEqual([...DOUBLEFEATURE_CROWN.keys]);
    expect(DBL_CROWN_BAND.crown).toEqual({ leftPct: 0, topPct: 0, widthPct: 100, heightPct: (341 / 2814) * 100 });
    expect(DOUBLEFEATURE_CROWN.rect).toEqual({ topPct: 0, leftPct: 0, widthPct: 100, heightPct: (DBL_CROWN_BAND.rows / 2100) * 100 });
    expect(dblCrownLayers("u")).toEqual([{ src: `${DBL}/crowns/u.png`, at: { ...DBL_CROWN_BAND.crown } }]);
    expect(() => dblCrownLayers("l")).toThrow();
  });

  it("its findings: nothing past the band, the top and the side opaque, the bar clear", () => {
    const W = 1500;
    const H = 400;
    const buf = Buffer.alloc(W * H * 4);
    const set = (x: number, y: number, a: number) => (buf[(y * W + x) * 4 + 3] = a);
    for (let y = 0; y < 250; y += 1) for (let x = 0; x < W; x += 1) set(x, y, 255);
    for (let y = 110; y < 215; y += 1) for (let x = 130; x < 1370; x += 1) set(x, y, 0);
    expect(dblCrownFindings(buf, W, H, 258).failures).toEqual([]);
    set(750, 160, 255);
    set(750, 300, 255);
    expect(dblCrownFindings(buf, W, H, 258).failures).toHaveLength(2);
  });
});

describe("the Double Feature notches", () => {
  it("publish the profiles' keys at the importer's box, M15's oval cut", () => {
    expect([...DBL_NOTCH.keys]).toEqual([...DOUBLEFEATURE_HOLO_STAMP.keys]);
    expect([...DBL_LAND_NOTCH.keys]).toEqual([...DOUBLEFEATURELAND_HOLO_STAMP.keys]);
    const rect = { leftPct: (DBL_NOTCH_BOX.x / 1500) * 100, topPct: (DBL_NOTCH_BOX.y / 2100) * 100, widthPct: (DBL_NOTCH_BOX.width / 1500) * 100, heightPct: (DBL_NOTCH_BOX.height / 2100) * 100 };
    expect(DOUBLEFEATURE_HOLO_STAMP.rect).toEqual(rect);
    expect(DOUBLEFEATURELAND_HOLO_STAMP.rect).toEqual(rect);
    // The piece (264 × 130 at 873 / 2539 of 2010 × 2814 → 651.5–848.3 ×
    // 1894.8–1991.8 px) inside the box, 1 px round it; the oval's cut and
    // ring inside it.
    const s = 1500 / 2010;
    expect(DBL_NOTCH_BOX.x).toBeLessThanOrEqual(Math.floor(873 * s) - 1);
    expect(DBL_NOTCH_BOX.x + DBL_NOTCH_BOX.width).toBeGreaterThanOrEqual(Math.ceil((873 + 264) * s) + 1);
    expect(DBL_NOTCH_BOX.y).toBeLessThanOrEqual(Math.floor(2539 * s) - 1);
    const ovalBottom = ((M15_HOLO_STAMP_OVAL.topPct + M15_HOLO_STAMP_OVAL.heightPct) / 100) * 2100;
    expect(DBL_NOTCH_BOX.y + DBL_NOTCH_BOX.height).toBeGreaterThanOrEqual(ovalBottom + 2);
    for (const def of [HOLO_STAMP_NOTCHES.doublefeatureholostamp, HOLO_STAMP_NOTCHES.doublefeaturelandholostamp] as unknown as { oval: unknown; clearAlphaBelow: number; blackoutCapturePx: number }[]) {
      expect(def.oval).toBe(M15_HOLO_STAMP_OVAL);
      expect(notchCutOf(def as never)).toBe(M15_HOLO_STAMP_OVAL);
      expect(def.clearAlphaBelow).toBe(50);
      expect(def.blackoutCapturePx).toBe(2);
    }
    for (const slot of [DOUBLEFEATURE_HOLO_STAMP, DOUBLEFEATURELAND_HOLO_STAMP]) {
      expect(slot.anatomy === "holoStamp" && slot.stamp.shape).toBe("oval");
      expect(slot.anatomy === "holoStamp" && slot.stamp.oval).toBe(M15_HOLO_STAMP_OVAL);
    }
  });

  it("the spell notch is the pack's one piece; the land's a tint's piece, the spell piece for the grey land, and a dual's two pieces lerped across the pinline's ramp", () => {
    for (const k of DBL_NOTCH.keys) expect(DBL_NOTCH.pieces[k], k).toBe(`${DBL}/stamps/stamp.png`);
    expect(notchSourceFiles(HOLO_STAMP_NOTCHES.doublefeatureholostamp)).toEqual([`${DBL}/stamps/stamp.png`]);
    expect(DBL_LAND_NOTCH.pieces.c).toBe(`${DBL}/stamps/stamp.png`);
    for (const k of ["w", "u", "b", "r", "g", "m"]) expect(DBL_LAND_NOTCH.pieces[k], k).toBe(`${DBL}/stamps/${k}.png`);
    for (const pair of TWO_COLOR_PAIRS) {
      expect(DBL_LAND_NOTCH.pieces[pair], pair).toEqual({ src: `${DBL}/stamps/${pair[0]}.png`, right: `${DBL}/stamps/${pair[1]}.png`, ramp: [...PAIR_RAMPS.pinline] });
    }
    expect(describeNotchPiece(DBL_LAND_NOTCH.pieces.rg)).toMatch(/stamps\/r\.png ⟷ .*stamps\/g\.png lerped/);
    // The land notch reads every piece once, and the spell piece its tones
    // are read against.
    expect(notchSourceFiles(HOLO_STAMP_NOTCHES.doublefeaturelandholostamp)).toEqual(
      [...["b", "g", "m", "r", "stamp", "u", "w"].map((k) => `${DBL}/stamps/${k}.png`)].sort(),
    );
  });

  it("the importer's piece: the capture blacked out, the oval cut and ringed — no lit pixel left", () => {
    const shape = DBL_NOTCH.shape;
    const { width, height } = shape.size;
    // A synthetic piece: a dark arch, black below it, a lit "hologram"
    // where the pack paints it (686–814 × 1928–1989 px).
    const buf = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const cx = x + DBL_NOTCH_BOX.x;
        const cy = y + DBL_NOTCH_BOX.y;
        if (cy > 1991 || cx < 657 || cx > 842) continue;
        const lit = ((cx - 750) / 64) ** 2 + ((cy - 1958.5) / 30.5) ** 2 <= 1;
        const v = lit ? 200 : cy < 1915 ? 31 : 0;
        buf.set([v, v, v, 255], (y * width + x) * 4);
      }
    }
    const captured = capturePlane(buf, width, height, DBL_NOTCH.capture);
    blackoutStampShape(buf, captured, width, height, 2);
    const out = blackoutAndCut(buf, shape, M15_HOLO_STAMP_OVAL, 2, 2);
    expect(pieceNotchFindings(out, shape, M15_HOLO_STAMP_OVAL, 2, 2).failures).toEqual([]);
    expect(stampShapeBlackFindings(out, captured, width, height).failures).toEqual([]);
    for (let i = 0; i < width * height; i += 1) {
      if (out[i * 4 + 3] === 0) continue;
      expect(Math.max(out[i * 4], out[i * 4 + 1], out[i * 4 + 2]), `${i}`).toBeLessThan(40);
    }
  });
});

describe("the edges and corners", () => {
  it("the regular M15 frame's black border all round — on no pending list", () => {
    for (const t of ["doublefeature", "doublefeatureland"] as const) {
      const border = { kind: "border" };
      expect(EDGE_CONTRACTS[t]).toEqual({ top: border, right: border, bottom: border, left: border });
      expect(EDGE_CONTRACT_KNOWN_FAILURES[t]).toBeUndefined();
      expect(ART_WINDOW_KNOWN_FAILURES[t]).toBeUndefined();
      expect(BORDER_PENDING_TEMPLATES.has(t)).toBe(false);
      expect(SQUARE_CORNERS[t]).toBeUndefined();
      expect(["tl", "tr", "bl", "br"].map((c) => squareCornerKind(t, "w", c as never))).toEqual(["border", "border", "border", "border"]);
    }
  });
});

describe("the profiles", () => {
  const p = getFrameProfile("doublefeature");
  const l = getFrameProfile("doublefeatureland");

  it("a showcase set of their own, Innistrad: Double Feature", () => {
    expect(FRAME_TEMPLATE_LABELS.doublefeature).toBe("Double Feature");
    expect(FRAME_TEMPLATE_LABELS.doublefeatureland).toBe("Double Feature Land");
    expect(FRAME_TEMPLATE_SET.doublefeature).toBe("doublefeatureset");
    expect(FRAME_TEMPLATE_SET.doublefeatureland).toBe("doublefeatureset");
    expect(FRAME_SET_LABELS.doublefeatureset).toBe("Innistrad: Double Feature");
    expect(FRAME_ERA_LABELS[FRAME_SET_ERA.doublefeatureset]).toBe("Showcase & Universes Beyond");
  });

  it("the Card Conjurer M15 frames' text layout in white ink and print's nudges, the pack's plate, the collector line", () => {
    const ub = getFrameProfile("m15ub");
    const m15 = getFrameProfile("m15");
    const m15land = getFrameProfile("m15land");
    for (const t of ["doublefeature", "doublefeatureland"] as const) {
      expect(M15_FAMILY_TEMPLATES).toContain(t);
      expect(COLLECTOR_TEMPLATES).toContain(t);
      expect(getFrameProfile(t).collector).toBe(DOUBLEFEATURE_COLLECTOR);
    }
    // M15's collector slot with its second row 4 px higher (print's 2027).
    expect({ ...DOUBLEFEATURE_COLLECTOR, line2BaselinePct: 0 }).toEqual({ ...M15_COLLECTOR, line2BaselinePct: 0 });
    expect((DOUBLEFEATURE_COLLECTOR.line2BaselinePct / 100) * 2100).toBeCloseTo((M15_COLLECTOR.line2BaselinePct / 100) * 2100 - 4, 9);
    // The name 2 px up, the type line 5 px down (print's 186 / 1264).
    expect(p.title.rect).toEqual(m15.title.rect);
    expect(p.title.dy).toBeCloseTo(m15.title.dy! - 2 / 1500, 12);
    expect(p.type.dy).toBeCloseTo(ub.type.dy! + 5 / 1500, 12);
    expect(l.title.rect).toEqual(m15land.title.rect);
    expect(l.title.dy).toBeCloseTo(m15land.title.dy! - 2 / 1500, 12);
    expect(l.type.dy).toBeCloseTo(m15land.type.dy! + 5 / 1500, 12);
    expect(p.rules.rect).toEqual(m15.rules.rect);
    expect(p.pt!.rect).toEqual(m15.pt!.rect);
    for (const slot of [p.title, p.type, p.rules, p.pt!, l.title, l.type, l.rules]) expect(slot.colorHex).toBe("#ffffff");
    // The CC M15 cost row, art window and type line (m15ub's: the same pack
    // geometry).
    expect([p.costSizePct, p.costDy, p.costDx]).toEqual([ub.costSizePct, ub.costDy, ub.costDx]);
    expect(p.artSlot).toEqual(ub.artSlot);
    expect(l.artSlot).toEqual(ub.artSlot);
    expect(p.underFrameArt).toBeUndefined();
    expect(l.hideCost).toBe(true);
    // The pack's plate at its bounds, its face the digits' span; the land
    // draws the spell frame's.
    const plate = { leftPct: (1555 / 2010) * 100, topPct: (2492 / 2814) * 100, widthPct: (353 / 2010) * 100, heightPct: (179 / 2814) * 100 };
    for (const prof of [p, l]) {
      expect(prof.pt?.plateRect).toEqual(plate);
      expect(prof.pt?.plateAssetPathTemplate).toBe("/frames/doublefeature/pt/{color}.png");
    }
    expect(PLATE_INK["/frames/doublefeature/pt/{color}.png"]).toBeDefined();
  });

  it("every artifact, any colour, paints the artifact master; the crown and stamp on the spell frame, the stamp and the duals on the land", () => {
    expect(p.artifactMasterKeys).toEqual({ w: "a", u: "a", b: "a", r: "a", g: "a", m: "a", c: "a" });
    expect(l.artifactMasterKeys).toBeUndefined();
    expect(frameMasterKey(p, ["white"], { cardType: "artifact" })).toBe("a");
    expect(frameMasterKey(p, ["black"], { cardType: "creature", supertype: "Artifact" })).toBe("a");
    expect(frameMasterKey(p, ["black"], { cardType: "creature" })).toBe("b");
    expect(frameMasterKey(p, ["white", "blue"], { cardType: "instant" })).toBe("m");
    expect(p.twoColorMasters).toBeUndefined();
    expect(l.twoColorMasters).toEqual(["split"]);
    expect(l.twoColorForLands).toBe(true);
    expect(p.overlays?.map((o) => o.anatomy)).toEqual(["crown", "holoStamp"]);
    expect(l.overlays?.map((o) => o.anatomy)).toEqual(["holoStamp"]);
    expect(p.overlays?.[1]).toBe(DOUBLEFEATURE_HOLO_STAMP);
    expect(l.overlays?.[0]).toBe(DOUBLEFEATURELAND_HOLO_STAMP);
  });

  it("keys the crown by the colour, gold for several, the artifact's for every artifact", () => {
    const keysOf = (style: Record<string, unknown>, facts: Record<string, unknown>) =>
      resolveFrameOverlays(p, { template: "doublefeature", crown: true, ...style } as never, { colors: [], rarity: "common", supertype: "Legendary", cardType: "creature", ...facts, colorKey: facts.colorKey as string } as never).map((o) => `${o.anatomy}:${o.key}`);
    expect(keysOf({}, { colorKey: "w", colors: ["white"] })).toEqual(["crown:w"]);
    expect(keysOf({}, { colorKey: "m", colors: ["black", "red"] })).toEqual(["crown:m"]);
    expect(keysOf({}, { colorKey: "b", colors: ["black"], cardType: "artifact" })).toEqual(["crown:a"]);
    expect(keysOf({}, { colorKey: "c", colors: [], cardType: "artifact" })).toEqual(["crown:a"]);
    expect(keysOf({}, { colorKey: "c", colors: [] })).toEqual(["crown:a"]);
    expect(keysOf({ crown: false }, { colorKey: "w", colors: ["white"] })).toEqual([]);
  });

  it("keys the land stamp by the colour or the dual, on a rare or mythic", () => {
    const keysOf = (style: Record<string, unknown>, facts: Record<string, unknown>) =>
      resolveFrameOverlays(l, { template: "doublefeatureland", stamp: "auto", ...style } as never, { colors: [], rarity: "rare", supertype: null, cardType: "land", ...facts, colorKey: facts.colorKey as string } as never).map((o) => `${o.anatomy}:${o.key}`);
    expect(keysOf({ twoColor: true }, { colorKey: "m", colors: ["red", "green"] })).toEqual(["holoStamp:rg"]);
    expect(keysOf({}, { colorKey: "m", colors: ["red", "green"] })).toEqual(["holoStamp:m"]);
    expect(keysOf({}, { colorKey: "c", colors: [] })).toEqual(["holoStamp:c"]);
    expect(keysOf({}, { colorKey: "c", colors: [], rarity: "uncommon" })).toEqual([]);
  });
});

const SPELL_KEYS = [...COLOUR_KEYS, "a"];
const LAND_KEYS = [...COLOUR_KEYS, ...TWO_COLOR_PAIRS];
const objects = [
  ...SPELL_KEYS.map((k) => `doublefeature/${k}.png`),
  ...COLOUR_KEYS.map((k) => `doublefeature/pt/${k}.png`),
  ...LAND_KEYS.map((k) => `doublefeatureland/${k}.png`),
  ...DBL_CROWN_BAND.keys.map((k) => `doublefeaturecrown/${k}.png`),
  ...DBL_NOTCH.keys.map((k) => `doublefeatureholostamp/${k}.png`),
  ...DBL_LAND_NOTCH.keys.map((k) => `doublefeaturelandholostamp/${k}.png`),
];
const available = objects.every((rel) => published(rel) !== null);

describe.skipIf(!available)("the published objects (set FRAMES_BUILD_DIR if skipped)", () => {
  const read = async (rel: string) => sharp(published(rel)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = (d: Buffer, w: number, x: number, y: number) => Array.from(d.subarray((y * w + x) * 4, (y * w + x) * 4 + 4));

  it("c and a are one artifact master; one notch piece under every spell key", () => {
    expect(MANIFEST["doublefeature/c.png"].sha256).toBe(MANIFEST["doublefeature/a.png"].sha256);
    expect(new Set(DBL_NOTCH.keys.map((k) => MANIFEST[`doublefeatureholostamp/${k}.png`].sha256)).size).toBe(1);
    expect(MANIFEST["doublefeaturelandholostamp/c.png"].sha256).toBe(MANIFEST["doublefeatureholostamp/w.png"].sha256);
  });

  it("doublefeature: 1500 × 2100, the black border, the corners cut, the window clear, the field toned onto print", async () => {
    const u = await read("doublefeature/u.png");
    expect([u.info.width, u.info.height]).toEqual([1500, 2100]);
    for (const [x, y] of [[750, 20], [750, 2085], [20, 1000]]) {
      const [r, g, b, a] = px(u.data, 1500, x, y);
      expect(a, `(${x}, ${y})`).toBe(255);
      expect(r + g + b, `(${x}, ${y})`).toBeLessThan(30);
    }
    expect([px(u.data, 1500, 0, 0)[3], px(u.data, 1500, 1499, 0)[3], px(u.data, 1500, 0, 2099)[3], px(u.data, 1500, 1499, 2099)[3]]).toEqual([0, 0, 0, 0]);
    expect(px(u.data, 1500, 750, 700)[3]).toBe(0);
    // The blue field reads print's royal blue, not the pack's cyan.
    const med: number[][] = [[], [], []];
    for (let y = 500; y < 1000; y += 2) for (let x = 70; x <= 95; x += 1) px(u.data, 1500, x, y).slice(0, 3).forEach((v, i) => med[i].push(v));
    const m = med.map((v) => v.sort((a, b) => a - b)[v.length >> 1]);
    expect(m[1]).toBeLessThan(120);
    expect(m[2]).toBeGreaterThan(m[0] + 60);
  });

  it("doublefeatureland: a dual's pinline is its first tint's on the left and its second's on the right", async () => {
    const [r, g, rg] = await Promise.all([read("doublefeatureland/r.png"), read("doublefeatureland/g.png"), read("doublefeatureland/rg.png")]);
    for (let y = 400; y < 1100; y += 50) {
      for (let x = 95; x < 140; x += 1) expect(px(rg.data, 1500, x, y), `(${x}, ${y})`).toEqual(px(r.data, 1500, x, y));
      for (let x = 1360; x < 1405; x += 1) expect(px(rg.data, 1500, x, y), `(${x}, ${y})`).toEqual(px(g.data, 1500, x, y));
    }
  });

  it("doublefeaturecrown: the card's top, opaque, the bar clear", async () => {
    const c = await read("doublefeaturecrown/w.png");
    expect([c.info.width, c.info.height]).toEqual([1500, DBL_CROWN_BAND.rows]);
    expect(dblCrownFindings(c.data, 1500, c.info.height, DBL_CROWN_BAND.rows).failures).toEqual([]);
    expect(px(c.data, 1500, 0, 0)[3]).toBe(0);
  });

  it("the notches: the oval cut and ringed, nothing lit in the well, no glow above the arch", async () => {
    for (const rel of ["doublefeatureholostamp/w.png", "doublefeaturelandholostamp/rg.png"]) {
      const n = await read(rel);
      expect([n.info.width, n.info.height]).toEqual([DBL_NOTCH_BOX.width, DBL_NOTCH_BOX.height]);
      expect(pieceNotchFindings(n.data, DBL_NOTCH.shape, M15_HOLO_STAMP_OVAL, 2, 2).failures, rel).toEqual([]);
      for (let i = 0; i < DBL_NOTCH_BOX.width * DBL_NOTCH_BOX.height; i += 1) {
        const a = n.data[i * 4 + 3];
        if (a === 0) continue;
        expect(a, `${rel} ${i}`).toBeGreaterThanOrEqual(50);
        const y = Math.floor(i / DBL_NOTCH_BOX.width) + DBL_NOTCH_BOX.y;
        // Below the arch (the well round the oval): black.
        if (y >= 1935 && y < 1990) {
          const x = (i % DBL_NOTCH_BOX.width) + DBL_NOTCH_BOX.x;
          if (x > 690 && x < 810) expect(Math.max(n.data[i * 4], n.data[i * 4 + 1], n.data[i * 4 + 2]), `${rel} (${x}, ${y})`).toBeLessThan(40);
        }
      }
    }
  });
});
