import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { DFC_CROWN_WELLS, checkSourceTone, toneSourceRegions } from "@/scripts/lib/cc-frames.mjs";
import { SAGA_BACK_TONES, SAGA_TYPE_DY, readTone } from "@/scripts/lib/saga-back.mjs";
import { BAND_CUT, BAND_FILL, LOWER_FROM, RAIL_CUT, ROWS_CUT } from "@/scripts/lib/saga-creature.mjs";
import {
  CROWN_FOLDER,
  CROWN_KEYS,
  PLATE_KEYS,
  PLATE_PLACEMENT,
  PLATE_TONES,
  SAGA_CREATURE_BACK_KEYS,
  SAGA_CREATURE_BACK_READ_REGIONS,
  SAGA_CREATURE_BACK_TONES,
  TEMPLATE,
  TITLE_TONE_FADE_PX,
  TYPE_DY,
  cutPlaneRows,
  paperPlane,
  squeezeFoldPlane,
} from "@/scripts/lib/saga-creature-back.mjs";
import { M15_NYX_DFC_CROWN_RIGHT, SAGA_CREATURE_RAISE_PX, getFrameProfile } from "@/lib/cards/template-layout";
import manifest from "@/lib/frames/frame-manifest.json";
import provenance from "@/lib/cards/frame-sources.json";

// ---------------------------------------------------------------------------
// TODO 4.5d, part B — the saga creature's back's recipe
// (scripts/lib/saga-creature-back.mjs, scripts/build-saga-creature-back-
// frames.mjs): the tone tables, the move and the pure pixel helpers; the
// published masters, plates and crown pieces and their provenance agree with
// it; and, where the real masters are on disk (FRAMES_BUILD_DIR), the
// composite keeps the part A master's shape and the crown piece is the Nyx
// band byte for byte outside the well.
// ---------------------------------------------------------------------------

type Entry = { sha256: string; width: number; height: number };
const FILES = (manifest as { files: Record<string, Entry> }).files;
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
/** A published object's bytes on disk at the manifest's sha256, or null. */
function onDisk(key: string): Buffer | null {
  const file = path.join(BUILD, key);
  if (!FILES[key] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === FILES[key].sha256 ? bytes : null;
}

describe("the recipe's data", () => {
  it("tones every coloured key's paper and both bars onto FIN's prints, each a valid source tone; the colourless key untoned (no print)", () => {
    expect(Object.keys(SAGA_CREATURE_BACK_TONES).sort()).toEqual(["b", "g", "m", "r", "u", "w"]);
    for (const [key, tones] of Object.entries(SAGA_CREATURE_BACK_TONES)) {
      expect(Object.keys(tones).sort(), key).toEqual(["paper", "title", "type"]);
      for (const [region, tone] of Object.entries(tones)) {
        expect(() => checkSourceTone(`${key}.${region}`, tone)).not.toThrow();
        expect(SAGA_CREATURE_BACK_READ_REGIONS[region as keyof typeof SAGA_CREATURE_BACK_READ_REGIONS], region).toBeDefined();
      }
      // The paper greys toward the printed back box: darker on every channel.
      tones.paper.to.forEach((v: number, c: number) => expect(v, `${key} paper ${c}`).toBeLessThan(tones.paper.from[c]));
    }
    // No gold summon back: `m`'s paper is the printed gold saga back's.
    expect(SAGA_CREATURE_BACK_TONES.m.paper.to).toEqual(SAGA_BACK_TONES.m.paper.to);
    expect(SAGA_CREATURE_BACK_KEYS).toEqual(["w", "u", "b", "r", "g", "m", "c"]);
    expect(TITLE_TONE_FADE_PX.to).toBeLessThan(1271);
    // The plates: every coloured key toned, `c` as published.
    expect(PLATE_KEYS).toEqual(SAGA_CREATURE_BACK_KEYS);
    expect(Object.keys(PLATE_TONES).sort()).toEqual(["b", "g", "m", "r", "u", "w"]);
    for (const [key, tones] of Object.entries(PLATE_TONES)) expect(() => checkSourceTone(`${key}.plate`, tones.plate)).not.toThrow();
    // …where the profile draws the plate (M15.pt.plateRect at HD).
    const plate = getFrameProfile(TEMPLATE).pt!.plateRect!;
    expect(PLATE_PLACEMENT).toEqual({
      left: Math.round((plate.leftPct / 100) * 1500),
      top: Math.round((plate.topPct / 100) * 2100),
      width: Math.round((plate.widthPct / 100) * 1500),
      height: Math.round((plate.heightPct / 100) * 2100),
    });
  });

  it("moves the type bar onto the saga creature's raised row, as the profile moves the dot", () => {
    expect(ROWS_CUT).toBe(SAGA_CREATURE_RAISE_PX);
    expect(TYPE_DY).toBe(SAGA_TYPE_DY - SAGA_CREATURE_RAISE_PX);
    expect(TYPE_DY).toBe(420);
    expect(getFrameProfile(TEMPLATE).indicatorDyPct).toBeCloseTo(TYPE_DY / 21, 9);
  });

  it("cuts the crown round the ▼ back's right well, in the Nyx band's keys the profile reads", () => {
    expect(CROWN_FOLDER).toBe("m15nyxdfccrownright");
    expect([...CROWN_KEYS]).toEqual([...M15_NYX_DFC_CROWN_RIGHT.keys]);
    expect(M15_NYX_DFC_CROWN_RIGHT.assetPathTemplate).toBe(`/frames/${CROWN_FOLDER}/{key}.png`);
    expect(DFC_CROWN_WELLS.right.side).toBe("right");
  });

  it("is published — 7 masters, 7 plates and 7 crown pieces, PNG + WebP — with its provenance", () => {
    for (const key of SAGA_CREATURE_BACK_KEYS) {
      for (const ext of ["png", "webp"]) {
        expect([FILES[`${TEMPLATE}/${key}.${ext}`]?.width, FILES[`${TEMPLATE}/${key}.${ext}`]?.height], `${key}.${ext}`).toEqual([1500, 2100]);
        expect(FILES[`${TEMPLATE}/pt/${key}.${ext}`], `pt/${key}.${ext}`).toBeDefined();
      }
    }
    for (const key of CROWN_KEYS) for (const ext of ["png", "webp"]) expect([FILES[`${CROWN_FOLDER}/${key}.${ext}`]?.width, FILES[`${CROWN_FOLDER}/${key}.${ext}`]?.height]).toEqual([1500, 410]);
    const ours = Object.keys(FILES).filter((k) => k.startsWith(`${TEMPLATE}/`) || k.startsWith(`${CROWN_FOLDER}/`));
    expect(ours).toHaveLength(42);
    // The colourless plate is m15dfcback's, byte for byte.
    expect(FILES[`${TEMPLATE}/pt/c.png`].sha256).toBe(FILES["m15dfcback/pt/c.png"].sha256);
    const records = provenance as Record<string, { source: string; converter: string; colors: Record<string, string[]>; plates?: Record<string, string> }>;
    for (const folder of [TEMPLATE, CROWN_FOLDER]) {
      expect(records[folder].source, folder).toBe("pipglyph");
      expect(records[folder].converter, folder).toBe("scripts/build-saga-creature-back-frames.mjs");
    }
    expect(Object.keys(records[TEMPLATE].colors).sort()).toEqual([...SAGA_CREATURE_BACK_KEYS].sort());
    expect(Object.keys(records[TEMPLATE].plates ?? {}).sort()).toEqual([...PLATE_KEYS].sort());
    expect(Object.keys(records[CROWN_FOLDER].colors).sort()).toEqual([...CROWN_KEYS].sort());
  });
});

describe("the pixel helpers", () => {
  it("cut rows out of a plane as part A cut the master", () => {
    const W = 2;
    const plane = Uint8Array.from({ length: W * 6 }, (_, i) => Math.floor(i / W) + 1);
    const cut = cutPlaneRows(plane, W, 6, [[1, 2]]);
    expect([...cut]).toEqual([1, 1, 4, 4, 5, 5, 6, 6, 0, 0, 0, 0]);
  });

  it("squeeze the fold's columns into the band's rows", () => {
    const W = 200;
    const H = 700;
    const original = new Uint8Array(W * H).fill(255);
    const cut = new Uint8Array(W * H);
    squeezeFoldPlane(original, cut, W);
    // Left of the fold's edge, every band row is the squeezed (full) mask;
    // right of it, untouched.
    expect(cut[(240 * W) + 10]).toBe(255);
    expect(cut[(240 * W) + 190]).toBe(0);
  });

  it("covers the band, the chapter column and the second box as paper — never the type bar or the border", () => {
    const W = 1500;
    const H = 2100;
    const full = new Uint8Array(W * H).fill(255);
    const empty = new Uint8Array(W * H);
    const paper = paperPlane({ sagaText: full, sagaBanner: empty, rules: full });
    expect(paper[300 * W + 1000]).toBe(255); // the band over the window's columns
    expect(paper[(LOWER_FROM + 100) * W + 700]).toBe(255); // the second box
    // The band fill is whole; the rows above the cut stay the text mask's.
    expect(paper[(BAND_FILL.y0) * W + BAND_FILL.x0]).toBe(255);
    expect(BAND_CUT[1] + RAIL_CUT[1]).toBe(ROWS_CUT);
    // No ribbon on the paper: a banner pixel is taken out.
    const banner = new Uint8Array(W * H);
    banner[1000 * W + 300] = 255;
    // (Row 1000 is above the rail cut: it moves up by the band cut alone.)
    expect(paperPlane({ sagaText: full, sagaBanner: banner, rules: empty })[(1000 - BAND_CUT[1]) * W + 300]).toBe(0);
  });

  it("tones `from` onto `to`", () => {
    const width = 20;
    const height = 20;
    const buf = Buffer.alloc(width * height * 4);
    const tone = SAGA_CREATURE_BACK_TONES.r.title;
    for (let p = 0; p < width * height; p += 1) buf.set([...tone.from, 255], p * 4);
    const region = new Uint8Array(width * height).fill(255);
    const toned = toneSourceRegions(buf, width, height, { title: region }, { title: tone });
    expect(readTone(toned, [[0, 0, width, height]], width)).toEqual(tone.to);
  });
});

const MASTERS = SAGA_CREATURE_BACK_KEYS.map((k) => [k, onDisk(`${TEMPLATE}/${k}.png`), onDisk(`sagacreature/${k}.png`)] as const);
describe.skipIf(MASTERS.some(([, a, b]) => !a || !b))("the published masters (FRAMES_BUILD_DIR)", () => {
  it.each(MASTERS)("%s: the part A master's alpha, its pixels but for the two bars and the toned paper", async (key, mine, base) => {
    const a = await sharp(mine!).ensureAlpha().raw().toBuffer();
    const b = await sharp(base!).ensureAlpha().raw().toBuffer();
    let alphaDiff = 0;
    let changedOutside = 0;
    for (let p = 0; p < 1500 * 2100; p += 1) {
      const o = p * 4;
      if (a[o + 3] !== b[o + 3]) alphaDiff += 1;
      const y = Math.floor(p / 1500);
      // Outside the title row, the type row and the paper's rows, the frame
      // field, the ribbon and the border are part A's.
      const x = p % 1500;
      const bars = (y >= 85 && y < 235) || (y >= 1580 && y < 1730);
      const paperish = x > 100 && x < 1420 && y >= 235 && y < 1950;
      if (!bars && !paperish && (a[o] !== b[o] || a[o + 1] !== b[o + 1] || a[o + 2] !== b[o + 2])) changedOutside += 1;
    }
    expect(alphaDiff, key).toBe(0);
    expect(changedOutside, key).toBe(0);
  });
});

const CROWNS = CROWN_KEYS.map((k) => [k, onDisk(`${CROWN_FOLDER}/${k}.png`), onDisk(`m15nyxcrown/${k}.png`)] as const);
describe.skipIf(CROWNS.some(([, a, b]) => !a || !b))("the published crown pieces (FRAMES_BUILD_DIR)", () => {
  it.each(CROWNS)("%s: the Nyx band byte for byte outside the well region", async (key, piece, band) => {
    const a = await sharp(piece!).ensureAlpha().raw().toBuffer();
    const b = await sharp(band!).ensureAlpha().raw().toBuffer();
    const { region } = DFC_CROWN_WELLS.right;
    let outside = 0;
    let inside = 0;
    for (let p = 0; p < 1500 * 410; p += 1) {
      const x = p % 1500;
      const y = Math.floor(p / 1500);
      const o = p * 4;
      const same = a[o] === b[o] && a[o + 1] === b[o + 1] && a[o + 2] === b[o + 2] && a[o + 3] === b[o + 3];
      const inRegion = x >= region.x0 && x < region.x1 && y >= region.y0 && y <= region.y1;
      if (!inRegion && !same) outside += 1;
      if (inRegion && !same) inside += 1;
    }
    expect(outside, key).toBe(0);
    expect(inside, key).toBeGreaterThan(0);
  });
});
