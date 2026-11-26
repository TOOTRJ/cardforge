import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { M15_CROWN, SAGA_CROWN, getFrameProfile } from "@/lib/cards/template-layout";
import { CROWN_REFERENCES } from "@/lib/cards/crown";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { SAGA_CROWN_RECIPE as RECIPE, fadeSagaCrownBand, sagaCrownFade } from "@/scripts/lib/saga-crown.mjs";
import {
  CC_TEMPLATES,
  SAGA_MASK_INPUTS,
  SAGA_PAIR_MASK,
  SAGA_PAIR_PINSTRIPE_AT,
  SAGA_PAIR_TEXT_RAMP,
  rectPx,
  sagaPairLayers,
  sourceFilesFor,
} from "@/scripts/lib/cc-frames.mjs";
import { PAIR_RAMPS, TWO_COLOR_PAIRS } from "@/scripts/lib/pair-ramp.mjs";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.6f (owner 2026-11-25): the legendary crown and the two-colour pair
// masters on the SAGA frame.
//   • the crown: `sagacrown/<key>` — the published m15crown band with the
//     Nyx Constellation crown's one cut (its arms' last rows faded onto the
//     masters' own pinline), keys w u b r g m, the land crown `l` (the
//     colourless key's) and the ten pairs (scripts/lib/saga-crown.mjs);
//   • the pairs: `saga/<pair>` (gold-split only: no hybrid saga was printed)
//     — 4.6b's recipe carried onto Card Conjurer's saga masks, the ribbon in
//     its two colours with the pack's pinstripe on the seam
//     (sagaPairLayers);
//   • both published, their provenance recorded, and — where local copies
//     at the manifest's sha256 are on disk (FRAMES_BUILD_DIR, CI) — their
//     pixels what the recipes say.
// ---------------------------------------------------------------------------

type Entry = { hash: string; sha256: string; bytes: number; width: number; height: number };
const REAL = (manifestJson as { files: Record<string, Entry> }).files;
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
const SAGA = "img/frames/saga";
const FILE = (k: string) => `${SAGA}/regular/sagaFrame${k.toUpperCase()}.png`;
const BAND_KEYS = ["w", "u", "b", "r", "g", "m", "l", ...TWO_COLOR_PAIRS];

function published(rel: string): Buffer | null {
  const file = path.join(BUILD, rel);
  if (!REAL[rel] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === REAL[rel].sha256 ? bytes : null;
}
const raw = async (bytes: Buffer) => (await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data;
const px = (buf: Buffer, width: number, x: number, y: number) => [...buf.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];

describe("the crown: recipe, slot and entry", () => {
  it("names the masters' keys, the land crown and the ten pairs — the slot's list", () => {
    expect([...RECIPE.keys]).toEqual(BAND_KEYS);
    expect([...SAGA_CROWN.keys]).toEqual(BAND_KEYS);
    expect(RECIPE.folder).toBe("sagacrown");
    expect(RECIPE.from).toBe("m15crown");
    // Every key is one the parent band publishes; never c or a.
    for (const key of BAND_KEYS) expect(M15_CROWN.keys, key).toContain(key);
    expect(SAGA_CROWN.keys).not.toContain("c");
    expect(SAGA_CROWN.keys).not.toContain("a");
  });

  it("is the M15 crown's slot (rows 0–409, full width) reading its own folder, the colourless key on the land crown", () => {
    expect(SAGA_CROWN.rect).toEqual(M15_CROWN.rect);
    expect(SAGA_CROWN.anatomy).toBe("crown");
    expect(SAGA_CROWN.assetPathTemplate).toBe("/frames/sagacrown/{key}.png");
    // The saga's `c` master is the pack's 'Land Frame', as m15land's is.
    expect(SAGA_CROWN.keyMap).toEqual({ c: "l" });
    expect(getFrameProfile("m15land").overlays?.find((slot) => slot.anatomy === "crown")?.keyMap).toEqual({ c: "l" });
    expect([RECIPE.width, RECIPE.rows]).toEqual([1500, 410]);
  });

  it("is on the saga entry only, with the gold-split pairs — never on the double-faced sagas or the saga creature", () => {
    expect(getFrameProfile("saga").overlays).toEqual([SAGA_CROWN]);
    expect(
      FRAME_TEMPLATE_VALUES.filter((t) => (getFrameProfile(t).overlays ?? []).some((o) => o.assetPathTemplate === SAGA_CROWN.assetPathTemplate)),
    ).toEqual(["saga"]);
    expect(getFrameProfile("saga").twoColorMasters).toEqual(["split"]);
    expect(getFrameProfile("saga").twoColorForLands).toBeUndefined();
    expect(getFrameProfile("saga").crownMasters).toBeUndefined();
    for (const t of ["sagadfcfront", "sagadfcback", "sagacreature"] as const) {
      expect(getFrameProfile(t).twoColorMasters, t).toBeUndefined();
      expect((getFrameProfile(t).overlays ?? []).some((o) => o.anatomy === "crown"), t).toBe(false);
    }
  });

  it("is judged against the two crowned plain sagas: DSK #75 (blue) and PH18 #4 (gold)", () => {
    expect(Object.keys(CROWN_REFERENCES.saga ?? {}).sort()).toEqual(["m", "u"]);
    expect(CROWN_REFERENCES.saga?.u).toMatchObject({ set: "dsk", collectorNumber: "75" });
    expect(CROWN_REFERENCES.saga?.m).toMatchObject({ set: "ph18", collectorNumber: "4" });
  });

  it("fades the arms over the Nyx Constellation crown's rows, alpha only, the arms only", () => {
    expect(RECIPE.fade).toEqual({ from: 372, to: 408 });
    expect(sagaCrownFade(0)).toBe(1);
    expect(sagaCrownFade(372)).toBe(1);
    expect(sagaCrownFade(390)).toBeCloseTo(0.5, 9);
    expect(sagaCrownFade(408)).toBe(0);
    const band = Buffer.alloc(1500 * 410 * 4, 0);
    band.set([10, 20, 30, 200], (390 * 1500 + 100) * 4);
    band.set([10, 20, 30, 255], (100 * 1500 + 750) * 4);
    expect(fadeSagaCrownBand(band).changed).toBe(1);
    expect(px(band, 1500, 100, 390)).toEqual([10, 20, 30, 100]);
    expect(px(band, 1500, 750, 100)).toEqual([10, 20, 30, 255]);
    const stray = Buffer.alloc(1500 * 410 * 4, 0);
    stray.set([1, 2, 3, 9], (400 * 1500 + 750) * 4);
    expect(() => fadeSagaCrownBand(stray)).toThrow(/outside the arms/);
  });
});

describe("the pairs: the importer's recipe", () => {
  it("builds the gold-split dress of every pair beside the seven one-colour masters, which keep their one layer", () => {
    const colors = CC_TEMPLATES.saga.colors as Record<string, unknown[]>;
    expect(Object.keys(colors)).toEqual(["w", "u", "b", "r", "g", "m", "c", ...TWO_COLOR_PAIRS]);
    for (const pair of TWO_COLOR_PAIRS) expect(colors[pair], pair).toEqual(sagaPairLayers(pair, "split"));
    for (const key of ["w", "u", "b", "r", "g", "m"]) expect(colors[key], key).toEqual([{ src: FILE(key) }]);
    expect(colors.c).toEqual([{ src: `${SAGA}/regular/l.png` }]);
    // No hybrid dress: none was printed.
    expect(Object.keys(colors).some((key) => key.endsWith("-h"))).toBe(false);
    expect(() => sagaPairLayers("wu", "hybrid")).toThrow(/no hybrid dress/);
    expect(() => sagaPairLayers("uw", "split")).toThrow(/not a pair/);
  });

  it("gold-split: the gold file whole, the paper split, the ribbon's two halves through the pack's banner masks, the pinstripe, the pinline across 4.6b's ramp", () => {
    expect(sagaPairLayers("ur", "split")).toEqual([
      { src: FILE("m") },
      { src: FILE("u"), right: FILE("r"), ramp: [15, 43], mask: SAGA_MASK_INPUTS.Text },
      { src: FILE("u"), mask: SAGA_MASK_INPUTS.Banner },
      { src: FILE("r"), mask: SAGA_MASK_INPUTS["Banner (Right)"] },
      { src: `${SAGA}/sagaMidStripe.png`, at: { leftPct: 7.27, topPct: 30.58, widthPct: 0.87, heightPct: 47.62 } },
      { src: FILE("u"), right: FILE("r"), ramp: [...PAIR_RAMPS.pinline], mask: SAGA_MASK_INPUTS.Pinline },
    ]);
    expect(SAGA_PAIR_MASK.pinstripe).toBe(`${SAGA}/sagaMidStripe.png`);
    // The paper's ramp sits inside the text box (x 115–747), centred on
    // print's 435 px (the 50 % crossing of 17 prints, median).
    const [from, to] = SAGA_PAIR_TEXT_RAMP.map((pct) => (pct / 100) * 1500);
    expect([from, to]).toEqual([225, 645]);
    expect(Math.abs((from + to) / 2 - 435)).toBeLessThan(1);
    // The pinstripe lands on the pack's bounds at its native 13 × 1000 px.
    expect(rectPx(SAGA_PAIR_PINSTRIPE_AT, 1500, 2100)).toEqual({ x: 109, y: 642, width: 13, height: 1000 });
  });

  it("lists the masks and the pinstripe as source files", () => {
    const files = sourceFilesFor(CC_TEMPLATES.saga);
    for (const file of [SAGA_MASK_INPUTS.Text, SAGA_MASK_INPUTS.Banner, SAGA_MASK_INPUTS["Banner (Right)"], SAGA_MASK_INPUTS.Pinline, SAGA_PAIR_MASK.pinstripe]) {
      expect(files, file).toContain(file);
    }
  });
});

describe("published to the frames bucket", () => {
  it("lists every band, PNG and WebP, at 1500 × 410 — and nothing else under the folder", () => {
    for (const key of BAND_KEYS) {
      for (const ext of ["png", "webp"]) {
        const entry = REAL[`sagacrown/${key}.${ext}`];
        expect(entry, `sagacrown/${key}.${ext}`).toBeDefined();
        expect([entry.width, entry.height], `sagacrown/${key}.${ext}`).toEqual([1500, 410]);
      }
    }
    expect(Object.keys(REAL).filter((k) => k.startsWith("sagacrown/")).length).toBe(BAND_KEYS.length * 2);
  });

  it("lists every pair master, PNG and WebP, at 1500 × 2100 — and no hybrid one", () => {
    for (const pair of TWO_COLOR_PAIRS) {
      for (const ext of ["png", "webp"]) {
        const entry = REAL[`saga/${pair}.${ext}`];
        expect(entry, `saga/${pair}.${ext}`).toBeDefined();
        expect([entry.width, entry.height], `saga/${pair}.${ext}`).toEqual([1500, 2100]);
      }
    }
    expect(Object.keys(REAL).filter((k) => /^saga\/[a-z]+-h\./.test(k))).toEqual([]);
  });

  it("records both: the band as PipGlyph's own cut of the published m15crown, the pairs with the saga's import", () => {
    const provenance = JSON.parse(fs.readFileSync("lib/cards/frame-sources.json", "utf8"));
    const band = provenance.sagacrown;
    expect(band).toMatchObject({ source: "pipglyph", converter: "scripts/build-saga-crown.mjs", kind: "overlay", sourceFiles: BAND_KEYS.map((k) => `m15crown/${k}.png`).sort() });
    expect(band.commit).toBeUndefined();
    expect(Object.keys(band.colors)).toEqual(BAND_KEYS);
    for (const key of BAND_KEYS) {
      expect(band.colors[key][0], key).toBe(`m15crown/${key}.png (published, sha256 ${REAL[`m15crown/${key}.png`].sha256.slice(0, 12)})`);
      expect(band.colors[key][1], key).toMatch(/^alpha × \(1 − t\) on rows 372–408/);
    }
    const saga = provenance.saga;
    for (const pair of TWO_COLOR_PAIRS) expect(saga.colors[pair], pair).toBeDefined();
    expect(saga.notes.join(" ")).toMatch(/two-colour pair masters \(TODO 4\.6f/);
    expect(saga.sourceFiles).toContain(`${SAGA}/sagaMidStripe.png`);
  });
});

// ---- the pixels (local copies at the manifest's sha256) -----------------------
const bands = Object.fromEntries(BAND_KEYS.map((k) => [k, published(`sagacrown/${k}.png`)]));
const parents = Object.fromEntries(BAND_KEYS.map((k) => [k, published(`m15crown/${k}.png`)]));
const haveBands = BAND_KEYS.every((k) => bands[k] !== null && parents[k] !== null);
const MONO = ["w", "u", "b", "r", "g", "m"];
const masters = Object.fromEntries([...MONO, ...TWO_COLOR_PAIRS].map((k) => [k, published(`saga/${k}.png`)]));
const haveMasters = Object.values(masters).every((b) => b !== null);

describe.skipIf(!haveBands)("the published bands (set FRAMES_BUILD_DIR if skipped)", () => {
  it("are their parent's pixels with the arms faded: byte for byte above the fade, colours untouched, clear from row 408", async () => {
    for (const key of BAND_KEYS) {
      const [band, parent] = [await raw(bands[key]!), await raw(parents[key]!)];
      const want = Buffer.from(parent);
      fadeSagaCrownBand(want);
      expect(band.equals(want), key).toBe(true);
      const head = (RECIPE.fade.from + 1) * 1500 * 4;
      expect(band.subarray(0, head).equals(parent.subarray(0, head)), key).toBe(true);
      for (let i = RECIPE.fade.to * 1500 * 4 + 3; i < band.length; i += 4) expect(band[i]).toBe(0);
    }
  }, 60_000);
});

describe.skipIf(!haveMasters)("the published pair masters (set FRAMES_BUILD_DIR if skipped)", () => {
  /** A pixel of a master, at 1500 × 2100. */
  const at = async (key: string) => {
    const data = await raw(masters[key]!);
    return (x: number, y: number) => px(data, 1500, x, y);
  };

  it("gold: the frame body, both bars and the ribbon's outlines are the gold master's", async () => {
    const gold = await at("m");
    for (const pair of TWO_COLOR_PAIRS) {
      const p = await at(pair);
      for (const [x, y, where] of [
        [62, 1000, "body left of the ribbon"],
        [1420, 1000, "body right of the window"],
        [750, 160, "title bar"],
        [750, 1860, "type bar"],
        [68, 1000, "ribbon's left outline"],
        [160, 1000, "ribbon's right outline"],
      ] as const) {
        expect(p(x, y), `${pair} ${where}`).toEqual(gold(x, y));
      }
    }
  }, 60_000);

  it("the ribbon: the first colour's left half, the dark pinstripe on the seam, the second colour's right half", async () => {
    for (const pair of TWO_COLOR_PAIRS) {
      const [a, b] = pair.split("");
      const [p, ma, mb] = await Promise.all([at(pair), at(a!), at(b!)]);
      for (const y of [700, 1000, 1500]) {
        expect(p(90, y), `${pair} left half ${y}`).toEqual(ma(90, y));
        expect(p(140, y), `${pair} right half ${y}`).toEqual(mb(140, y));
        // The seam: the pinstripe's black (α 233) over the two halves.
        const seam = p(115, y);
        expect(Math.max(seam[0]!, seam[1]!, seam[2]!), `${pair} seam ${y}`).toBeLessThan(40);
      }
      // Above the pinstripe and Banner (Right): the first colour alone.
      expect(p(90, 500), `${pair} ribbon top`).toEqual(ma(90, 500));
    }
  }, 60_000);

  it("the ribbon's fold above chapter I is the gold master's (the Banner mask covers the front only) — tan-brown, as print's on every saga", async () => {
    const gold = await at("m");
    for (const pair of TWO_COLOR_PAIRS) {
      const p = await at(pair);
      for (const [x, y] of [[80, 350], [85, 400], [90, 450]] as const) expect(p(x, y), `${pair} fold ${x},${y}`).toEqual(gold(x, y));
    }
    expect(gold(80, 350)).toEqual([128, 101, 72, 255]);
    // …where a one-colour master paints the fold in its own colour.
    expect((await at("u"))(80, 350)).toEqual([0, 92, 149, 255]);
  }, 60_000);

  it("the pinline: the first colour's left end, the second's right end; the paper: the first colour's left of the ramp, the second's right of it", async () => {
    for (const pair of TWO_COLOR_PAIRS) {
      const [a, b] = pair.split("");
      const [p, ma, mb] = await Promise.all([at(pair), at(a!), at(b!)]);
      // The rail's left line beside the reminder and the window's right line.
      expect(p(104, 300), `${pair} left pinline`).toEqual(ma(104, 300));
      expect(p(1392, 1000), `${pair} right pinline`).toEqual(mb(1392, 1000));
      // The rail-top ring: the first colour before 40 %W, the second after 60 %W.
      expect(p(300, 232), `${pair} ring left`).toEqual(ma(300, 232));
      expect(p(1200, 232), `${pair} ring right`).toEqual(mb(1200, 232));
      // The paper: x 200 (before 15 %W) and 700 (after 43 %W).
      expect(p(200, 1200), `${pair} paper left`).toEqual(ma(200, 1200));
      expect(p(700, 1200), `${pair} paper right`).toEqual(mb(700, 1200));
    }
  }, 60_000);
});
