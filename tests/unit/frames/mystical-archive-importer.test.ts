import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  CC_TEMPLATES,
  HOLO_STAMP_NOTCHES,
  MA,
  MA_NOTCH,
  MA_NOTCH_BOX,
  MA_PINLINE,
  MA_PINLINE_RIGHT,
  MA_PRINT_TONES,
  MA_STAMP_ARCH,
  MA_STAMP_OVAL_PX,
  blackoutAndCut,
  cutInside,
  nearestRegionPlane,
  toneSourceRegions,
  notchCutOf,
  notchSourceFiles,
  pieceNotchFindings,
  sourceFilesFor,
  sourceTonesOf,
} from "../../../scripts/lib/cc-frames.mjs";
import { TWO_COLOR_PAIRS } from "../../../scripts/lib/pair-ramp.mjs";
import { resolveFrameOverlays } from "@/lib/cards/anatomy";
import { COLLECTOR_TEMPLATES } from "@/lib/cards/collector-line";
import { M15_FAMILY_TEMPLATES } from "@/lib/cards/m15-family";
import { PLATE_INK } from "@/lib/cards/plate-ink";
import {
  M15_COLLECTOR,
  MYSTICALARCHIVE_ART_SLOT,
  MYSTICALARCHIVE_HOLO_STAMP,
  MYSTICALARCHIVE_HOLO_STAMP_OVAL,
  getFrameProfile,
} from "@/lib/cards/template-layout";
import { EDGE_CONTRACTS, EDGE_CONTRACT_KNOWN_FAILURES } from "@/lib/frames/edge-contract";
import { ART_WINDOW_KNOWN_FAILURES } from "@/lib/frames/art-window";
import { SQUARE_CORNERS, squareCornerKind } from "@/lib/frames/square-corners";
import { BORDER_PENDING_TEMPLATES } from "@/lib/scryfall/frame-signatures";
import { FRAME_ERA_LABELS, FRAME_SET_ERA, FRAME_SET_LABELS, FRAME_TEMPLATE_LABELS, FRAME_TEMPLATE_SET } from "@/types/card";
import manifestJson from "@/lib/frames/frame-manifest.json";

// ---------------------------------------------------------------------------
// TODO 4.11 wave 2 item 2: the Strixhaven MYSTICAL ARCHIVE showcase
// (`mysticalarchive`; STA #1–63) from Card Conjurer's 'Mystical Archive
// (STA)' pack (2010 × 2814, downscaled once) — a NEW template, an addition.
// The recipe (the pack's frames whole; a pair = the gold frame with the two
// colours' lines through the pack's Pinline masks, as the five two-colour
// prints split them), the tones (the ring's rule: the paper, the gold and
// each colour's lines and bands toned onto print, the footer as drawn), its
// OVAL notch (PipGlyph's own black arch, measured on print), no crown (none
// prints), the borderless edges, the profile on print's lines and, where
// the published objects are on disk at the manifest's sha256
// (FRAMES_BUILD_DIR, else .frames-build; CI fetches them), their pixels.
// ---------------------------------------------------------------------------

type Layer = { src: string; mask?: string };
const def = (CC_TEMPLATES as unknown as Record<string, { colors: Record<string, Layer[]>; plates: Record<string, string>; keepCorners?: readonly string[] }>).mysticalarchive;
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

describe("the Mystical Archive recipe", () => {
  it("is the pack's frames whole — w u b r g m, a the artifact frame, c the land frame — and ten pair masters", () => {
    expect(MA).toBe("img/frames/mysticalArchive");
    expect(Object.keys(def.colors).sort()).toEqual([...MASTER_KEYS, "a", ...TWO_COLOR_PAIRS].sort());
    for (const key of [...MASTER_KEYS, "a"]) expect(def.colors[key], key).toEqual([{ src: `${MA}/${key}.png` }]);
    // A pair: the GOLD frame, the first colour's lines through the Pinline
    // mask, the second's through the Pinline (Right) mask.
    for (const pair of TWO_COLOR_PAIRS) {
      expect(def.colors[pair], pair).toEqual([{ src: `${MA}/m.png` }, { src: `${MA}/${pair[0]}.png`, mask: MA_PINLINE }, { src: `${MA}/${pair[1]}.png`, mask: MA_PINLINE_RIGHT }]);
    }
    for (const key of MASTER_KEYS) expect(def.plates[key], key).toBe(`${MA}/pt/${key === "c" ? "a" : key}.png`);
    // The ornament runs into the top corners: kept square, as the ring's.
    expect(def.keepCorners).toEqual(["tl", "tr"]);
    expect(sourceFilesFor(def as never)).toEqual(expect.arrayContaining([MA_PINLINE, MA_PINLINE_RIGHT, `${MA}/m.png`, `${MA}/pt/a.png`]));
  });

  it("tones by the ring's rule: every toned shade ≥ 9 levels off print, b's darkest and the footer as drawn", () => {
    const off = (from: readonly number[], to: readonly number[]) => Math.max(...from.map((v, i) => Math.abs(v - to[i])));
    expect(off(MA_PRINT_TONES.paper.from, MA_PRINT_TONES.paper.to)).toBeGreaterThanOrEqual(9);
    expect(off(MA_PRINT_TONES.gold.from, MA_PRINT_TONES.gold.to)).toBeGreaterThanOrEqual(9);
    const shades = MA_PRINT_TONES.colour as Record<string, readonly { from: readonly number[]; line?: readonly number[]; band?: readonly number[] }[]>;
    expect(Object.keys(shades).sort()).toEqual(["b", "g", "m", "r", "u", "w"]);
    for (const [k, list] of Object.entries(shades)) {
      for (const s of list) {
        for (const to of [s.line, s.band]) if (to) expect(off(s.from, to), `${k} ${s.from}`).toBeGreaterThanOrEqual(9);
      }
    }
    // b's darkest shade is within 4 of print: as drawn (no tone).
    expect(shades.b[2]).toEqual({ from: [72, 71, 73] });
    // The review's numbers (#619): r's light band, u's, g's, w's.
    expect(shades.r[0].band).toEqual([202, 64, 40]);
    expect(shades.u[0].band).toEqual([30, 91, 181]);
    expect(shades.g[0].band).toEqual([53, 106, 79]);
    expect(shades.w[0].band).toEqual([241, 237, 245]);
    // Every master: paper (where it is the same as another colour's file) and
    // gold; a colour master each shade × place by luminance, the shade
    // nearest, where the file differs, inside / outside the Pinline mask.
    for (const k of ["w", "u", "b", "r", "g", "m", "a", "c"]) {
      type Tone = { tones: Record<string, { mode?: string; from: number[]; to: number[] }>; clip?: Record<string, Record<string, unknown>>; nearest?: Record<string, { among: number[][]; index: number }> };
      const master = sourceTonesOf(`${MA}/${k}.png`) as Tone;
      expect(master.clip?.paper?.notDiff, k).toBeDefined();
      const names = Object.keys(master.tones).filter((n) => n !== "paper" && n !== "gold");
      if (k === "a" || k === "c") {
        expect(names, k).toEqual([]);
        continue;
      }
      expect(names.length, k).toBeGreaterThanOrEqual(4);
      for (const n of names) {
        expect(master.tones[n].mode, `${k} ${n}`).toBe("luma");
        expect(master.clip?.[n]?.diff, `${k} ${n}`).toBeDefined();
        expect(master.clip?.[n]?.[n.startsWith("line") ? "mask" : "notMask"], `${k} ${n}`).toBe(MA_PINLINE);
        const near = master.nearest![n];
        expect(near.among[near.index], `${k} ${n}`).toEqual(master.tones[n].from);
      }
      // A plate: its shades with the band tones where it differs from
      // another colour's plate; its paper where it is the same.
      const plate = sourceTonesOf(`${MA}/pt/${k}.png`) as Tone;
      expect(plate.clip?.paper?.notDiff, k).toBeDefined();
      const plateShades = Object.keys(plate.tones).filter((n) => n !== "paper" && n !== "gold");
      expect(plateShades.every((n) => n.startsWith("band")), k).toBe(true);
      for (const n of plateShades) expect(plate.tones[n].to, `${k} ${n}`).toEqual(master.tones[n].to);
    }
    // The stamp's arch is our own drawing: nothing to tone.
    expect(sourceTonesOf(MA_STAMP_ARCH)).toBeNull();
  });

  it("splits a file by its nearest shade, and tones a shade by luminance (a 0 channel lifted)", () => {
    // Two pixels: a flat shade with a 0 channel, its edge half into black.
    const buf = Buffer.from([0, 96, 144, 255, 0, 48, 72, 255, 240, 224, 182, 255]);
    const among = [[4, 119, 192], [0, 96, 144], [0, 0, 0], [238, 220, 157]];
    expect([...nearestRegionPlane(buf, 3, 1, { among, index: 1 })]).toEqual([255, 255, 0]);
    expect([...nearestRegionPlane(buf, 3, 1, { among, index: 3 })]).toEqual([0, 0, 255]);
    const out = toneSourceRegions(buf, 3, 1, { s: Uint8Array.from([255, 255, 0]) }, { s: { from: [0, 96, 144], to: [22, 68, 144], mode: "luma" } });
    expect([...out.subarray(0, 3)]).toEqual([22, 68, 144]);
    expect([...out.subarray(4, 7)]).toEqual([11, 34, 72]);
    expect([...out.subarray(8, 11)]).toEqual([240, 224, 182]);
  });

  it("builds no crown band: the run has no legendary card", () => {
    expect(getFrameProfile("mysticalarchive").overlays?.map((o) => o.anatomy)).toEqual(["holoStamp"]);
  });

  it("the notch publishes the keys the profile's slot asks for, at its box, its oval the prints'", () => {
    expect([...MA_NOTCH.keys]).toEqual(MYSTICALARCHIVE_HOLO_STAMP.keys);
    expect(MYSTICALARCHIVE_HOLO_STAMP.rect).toEqual({
      leftPct: (MA_NOTCH_BOX.x / 1500) * 100,
      topPct: (MA_NOTCH_BOX.y / 2100) * 100,
      widthPct: (MA_NOTCH_BOX.width / 1500) * 100,
      heightPct: (MA_NOTCH_BOX.height / 2100) * 100,
    });
    // Drawn 1:1 at its box on the card.
    expect(MA_NOTCH.placeAt).toEqual({ x: MA_NOTCH_BOX.x, y: MA_NOTCH_BOX.y, width: MA_NOTCH_BOX.width, height: MA_NOTCH_BOX.height });
    expect(MA_NOTCH.compositeSize).toEqual({ width: 1500, height: 2100 });
    // The oval's cut and its black ring fit inside the box.
    expect(MA_NOTCH_BOX.y + MA_NOTCH_BOX.height).toBeGreaterThanOrEqual(MA_STAMP_OVAL_PX.y + MA_STAMP_OVAL_PX.height + 2 + 2);
    expect(MA_NOTCH_BOX.x).toBeLessThan(MA_STAMP_OVAL_PX.x - 4);
    expect(notchCutOf(HOLO_STAMP_NOTCHES.mysticalarchiveholostamp)).toBe(MA_NOTCH.oval);
    // The prints' oval: 134 × 64, centred on 750 / 1964.
    expect(MA_STAMP_OVAL_PX).toEqual({ x: 683, y: 1932, width: 134, height: 64 });
    expect(MYSTICALARCHIVE_HOLO_STAMP.anatomy === "holoStamp" && MYSTICALARCHIVE_HOLO_STAMP.stamp.shape).toBe("oval");
    for (const k of ["leftPct", "topPct", "widthPct", "heightPct"] as const) expect(MYSTICALARCHIVE_HOLO_STAMP_OVAL[k]).toBeCloseTo(MA_NOTCH.oval[k], 9);
    // Its one source is our own SVG in the repo — no Card Conjurer piece.
    expect(notchSourceFiles(HOLO_STAMP_NOTCHES.mysticalarchiveholostamp)).toEqual([MA_STAMP_ARCH]);
    expect(MA_STAMP_ARCH).toBe("repo:scripts/frame-inputs/mystical-archive-stamp-arch.svg");
    const svg = fs.readFileSync(path.join(process.cwd(), "scripts/frame-inputs/mystical-archive-stamp-arch.svg"), "utf8");
    expect(svg).toContain(`width="${MA_NOTCH_BOX.width}" height="${MA_NOTCH_BOX.height}"`);
    expect(svg).toMatch(/No Card Conjurer pixel/);
  });
});

describe("the importer's notch piece", () => {
  const shape = MA_NOTCH.shape;
  const { width, height } = shape.size;
  /** A synthetic piece: a black arch over the box's top two thirds, clear
   *  corners. */
  function piece(): Buffer {
    const buf = Buffer.alloc(width * height * 4);
    for (let y = 4; y < 48; y += 1) for (let x = 6; x < width - 6; x += 1) buf.set([0, 0, 0, 255], (y * width + x) * 4);
    return buf;
  }

  it("cuts the oval clear and blacks its ring", () => {
    const out = blackoutAndCut(piece(), shape, MA_NOTCH.oval, 2, 2);
    expect(pieceNotchFindings(out, shape, MA_NOTCH.oval, 2, 2).failures).toEqual([]);
    const inside = cutInside(shape, MA_NOTCH.oval, 0);
    const cx = MA_STAMP_OVAL_PX.x + MA_STAMP_OVAL_PX.width / 2 - MA_NOTCH_BOX.x;
    const cy = MA_STAMP_OVAL_PX.y + MA_STAMP_OVAL_PX.height / 2 - MA_NOTCH_BOX.y;
    expect(inside(Math.floor(cx), Math.floor(cy), 0)).toBe(true);
  });
});

describe("the edges and corners", () => {
  it("borderless: the ornament to the top edge, the art to the sides between its pieces, the black footer", () => {
    const sides = { kind: "art", except: [[0, 14.3], [54.1, 62.8], [68.1, 72.1], [81.2, 100]] };
    expect(EDGE_CONTRACTS.mysticalarchive).toEqual({ top: { kind: "design" }, right: sides, bottom: { kind: "border" }, left: sides });
    expect(EDGE_CONTRACT_KNOWN_FAILURES.mysticalarchive).toBeUndefined();
    expect(ART_WINDOW_KNOWN_FAILURES.mysticalarchive).toBeUndefined();
    expect(BORDER_PENDING_TEMPLATES.has("mysticalarchive")).toBe(false);
    expect(SQUARE_CORNERS.mysticalarchive).toEqual({ kinds: { tl: "frame", tr: "frame" } });
    expect(["tl", "tr", "bl", "br"].map((c) => squareCornerKind("mysticalarchive", "w", c as never))).toEqual(["frame", "frame", "border", "border"]);
  });
});

describe("the profile rides print's lines", () => {
  const p = getFrameProfile("mysticalarchive");

  it("is a new showcase set of its own, Strixhaven — Mystical Archive", () => {
    expect(FRAME_TEMPLATE_LABELS.mysticalarchive).toBe("Mystical Archive");
    expect(FRAME_TEMPLATE_SET.mysticalarchive).toBe("strixhaven");
    expect(FRAME_SET_LABELS.strixhaven).toBe("Strixhaven");
    expect(FRAME_ERA_LABELS[FRAME_SET_ERA.strixhaven]).toBe("Showcase & Universes Beyond");
  });

  it("is an M15-era family member on the run's cost row, name, type line and rules box", () => {
    expect(M15_FAMILY_TEMPLATES).toContain("mysticalarchive");
    expect(COLLECTOR_TEMPLATES).toContain("mysticalarchive");
    expect(p.title.fit).toBe("measured");
    expect(p.type.fit).toBe("measured");
    // The CC M15 disc (70 px) 6 px higher and 4 px further right than the
    // CC-framed M15 row: on the prints' symbols' centre (1352.5 / 151.5).
    expect(p.costSizePct).toBeCloseTo(70 / 1500, 12);
    expect(p.costDy).toBeCloseTo(-12.6 / 1500, 12);
    expect(p.costDx).toBeCloseTo(6 / 1500, 12);
    // The art under the frame edge to edge: the masters' see-through 0–1500
    // × 253–1822 inside the slot with the art-window check's 0.05 % to spare.
    const a = p.artSlot;
    expect(a).toBe(MYSTICALARCHIVE_ART_SLOT);
    expect([a.leftPct, a.widthPct]).toEqual([0, 100]);
    expect((a.topPct / 100) * 2100).toBeCloseTo(251, 9);
    expect(((a.topPct + a.heightPct) / 100) * 2100).toBeCloseTo(1838, 9);
    expect(p.underFrameArt).toBeUndefined();
    expect(p.artifactMasterKeys).toEqual({ c: "a" });
    expect(p.pt?.plateAssetPathTemplate).toBe("/frames/mysticalarchive/pt/{color}.png");
    expect(p.pt?.plateRect).toEqual({ topPct: (1848 / 2100) * 100, leftPct: (1135 / 1500) * 100, widthPct: (317 / 1500) * 100, heightPct: (159 / 2100) * 100 });
    expect(PLATE_INK["/frames/mysticalarchive/pt/{color}.png"]).toBeDefined();
    // M15's collector slot: print sets both lines on M15's rows.
    expect(p.collector).toBe(M15_COLLECTOR);
    // The two-colour dress: the split pair masters.
    expect(p.twoColorMasters).toEqual(["split"]);
  });

  it("keys the stamp by the colour key, a pair by its own; no crown", () => {
    const style = { template: "mysticalarchive", crown: true, twoColor: true, stamp: "auto" } as never;
    const keysOf = (facts: Record<string, unknown>) =>
      resolveFrameOverlays(p, style, { colors: [], rarity: "rare", supertype: "Legendary", cardType: "instant", ...facts, colorKey: facts.colorKey as string } as never).map((o) => `${o.anatomy}:${o.key}`);
    expect(keysOf({ colorKey: "w", colors: ["white"] })).toEqual(["holoStamp:w"]);
    expect(keysOf({ colorKey: "m", colors: ["red", "white"] })).toEqual(["holoStamp:rw"]);
    expect(keysOf({ colorKey: "m", colors: ["white", "blue", "black"] })).toEqual(["holoStamp:m"]);
    expect(keysOf({ colorKey: "c", colors: [], cardType: "artifact" })).toEqual(["holoStamp:c"]);
    // "auto" is a rare or mythic on an oval frame, as the run prints it.
    expect(keysOf({ colorKey: "g", colors: ["green"], supertype: null, rarity: "uncommon" })).toEqual([]);
  });
});

const masterRels = [...MASTER_KEYS, "a", ...TWO_COLOR_PAIRS].map((k) => `mysticalarchive/${k}.png`);
const plateRels = MASTER_KEYS.map((k) => `mysticalarchive/pt/${k}.png`);
const notchRels = [...MASTER_KEYS, ...TWO_COLOR_PAIRS].map((k) => `mysticalarchiveholostamp/${k}.png`);
const available = [...masterRels, ...plateRels, ...notchRels].every((rel) => published(rel) !== null);

async function raw(rel: string) {
  const { data, info } = await sharp(published(rel)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { info, px: (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)) };
}

describe.skipIf(!available)("the published objects (set FRAMES_BUILD_DIR if skipped)", () => {
  it("one notch piece under every key; a plate per colour", () => {
    expect(new Set(notchRels.map((rel) => MANIFEST[rel].sha256)).size).toBe(1);
    expect(new Set(plateRels.map((rel) => MANIFEST[rel].sha256)).size).toBe(plateRels.length);
  });

  it("every master: 1500 × 2100, the ornament to the top corners, the bottom corners cut, the art clear to the sides, the footer black", async () => {
    for (const rel of masterRels) {
      const { info, px } = await raw(rel);
      expect([info.width, info.height], rel).toEqual([1500, 2100]);
      expect([px(0, 0)[3], px(1499, 0)[3]], rel).toEqual([255, 255]);
      expect([px(0, 2099)[3], px(1499, 2099)[3]], rel).toEqual([0, 0]);
      for (const [x, y] of [[750, 700], [4, 700], [1495, 700], [4, 1470], [1495, 1470]]) expect(px(x, y)[3], `${rel} (${x}, ${y})`).toBe(0);
      const [r, g, b, a] = px(750, 2090);
      expect([a, r + g + b], rel).toEqual([255, 0]);
    }
  });

  it("the paper and the gold sit on print's tone", async () => {
    const { px } = await raw("mysticalarchive/u.png");
    const ch: number[][] = [[], [], []];
    for (let y = 1400; y < 1900; y += 3) for (let x = 200; x < 1300; x += 3) {
      const [r, g, b] = px(x, y);
      // the paper, not its ornament lines
      if (Math.abs(r - 240) > 30 || Math.abs(g - 224) > 30 || Math.abs(b - 183) > 30) continue;
      ch[0].push(r); ch[1].push(g); ch[2].push(b);
    }
    const med = ch.map((v) => v.sort((p, q) => p - q)[v.length >> 1]);
    med.forEach((v, i) => expect(Math.abs(v - MA_PRINT_TONES.paper.to[i]), `channel ${i}`).toBeLessThan(9));
  });

  it("a pair master: the gold master's bands, the first colour's lines left, the second's right", async () => {
    const pair = await raw("mysticalarchive/ur.png");
    const u = await raw("mysticalarchive/u.png");
    const r = await raw("mysticalarchive/r.png");
    const m = await raw("mysticalarchive/m.png");
    // The line under the title bar (the Pinline mask): blue left, red right.
    expect(pair.px(300, 238)).toEqual(u.px(300, 238));
    expect(pair.px(1200, 238)).toEqual(r.px(1200, 238));
    // The band above the title bar (outside the mask): the gold master's.
    expect(pair.px(750, 82)).toEqual(m.px(750, 82));
    expect(pair.px(400, 1170)).toEqual(m.px(400, 1170));
  });

  it("mysticalarchiveholostamp: its oval cut and ringed, its corners clear", async () => {
    const notch = await sharp(published("mysticalarchiveholostamp/w.png")!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([notch.info.width, notch.info.height]).toEqual([MA_NOTCH_BOX.width, MA_NOTCH_BOX.height]);
    expect(pieceNotchFindings(notch.data, MA_NOTCH.shape, MA_NOTCH.oval, 2, 2).failures).toEqual([]);
  });
});
