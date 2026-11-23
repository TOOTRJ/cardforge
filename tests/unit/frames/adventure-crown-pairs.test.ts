import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ADVENTURE_CROWN, M15_CROWN, getFrameProfile } from "@/lib/cards/template-layout";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { ADVENTURE_CROWN_RECIPE as RECIPE, adventureCrownFade, fadeAdventureCrownBand } from "@/scripts/lib/adventure-crown.mjs";
import {
  ADVENTURE_HYBRID_PAPER_TONE,
  ADVENTURE_MASK,
  ADVENTURE_PAIR_PAGE_RAMPS,
  ADVENTURE_PAPER_REGION,
  CC_TEMPLATES,
  adventurePairLayers,
  sourceFilesFor,
  sourceTonesOf,
} from "@/scripts/lib/cc-frames.mjs";
import { PAIR_RAMPS, TWO_COLOR_PAIRS } from "@/scripts/lib/pair-ramp.mjs";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.6f (owner 2026-11-22): the legendary crown and the two-colour pair
// masters on the ADVENTURE frame.
//   • the crown: `adventurecrown/<key>` — the published m15crown band with
//     the Nyx Constellation crown's one cut (its arms' last rows faded onto
//     the masters' own pinline), keys w u b r g m, the artifact silver `a`
//     and the ten pairs (scripts/lib/adventure-crown.mjs);
//   • the pairs: `adventure/<pair>` (gold-split) and `<pair>-h` (hybrid) —
//     4.6b's recipe carried onto Card Conjurer's adventure masks, each
//     storybook page split about its own centre (adventurePairLayers);
//   • both published, their provenance recorded, and — where local copies
//     at the manifest's sha256 are on disk (FRAMES_BUILD_DIR, CI) — their
//     pixels what the recipes say.
// ---------------------------------------------------------------------------

type Entry = { hash: string; sha256: string; bytes: number; width: number; height: number };
const REAL = (manifestJson as { files: Record<string, Entry> }).files;
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
const ADV = "img/frames/adventure/regular";
const BAND_KEYS = ["w", "u", "b", "r", "g", "m", "a", ...TWO_COLOR_PAIRS];
const PAIR_KEYS = [...TWO_COLOR_PAIRS, ...TWO_COLOR_PAIRS.map((pair) => `${pair}-h`)];

function published(rel: string): Buffer | null {
  const file = path.join(BUILD, rel);
  if (!REAL[rel] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === REAL[rel].sha256 ? bytes : null;
}
const raw = async (bytes: Buffer) => (await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data;
const px = (buf: Buffer, width: number, x: number, y: number) => [...buf.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];

describe("the crown: recipe, slot and entry", () => {
  it("names the masters' keys, the artifact silver and the ten pairs — the slot's list", () => {
    expect([...RECIPE.keys]).toEqual(BAND_KEYS);
    expect([...ADVENTURE_CROWN.keys]).toEqual(BAND_KEYS);
    expect(RECIPE.folder).toBe("adventurecrown");
    expect(RECIPE.from).toBe("m15crown");
    // Every key is one the parent band publishes; never c or l.
    for (const key of BAND_KEYS) expect(M15_CROWN.keys, key).toContain(key);
    expect(ADVENTURE_CROWN.keys).not.toContain("c");
    expect(ADVENTURE_CROWN.keys).not.toContain("l");
  });

  it("is the M15 crown's slot (rows 0–409, full width) reading its own folder, the colourless key on the artifact silver", () => {
    expect(ADVENTURE_CROWN.rect).toEqual(M15_CROWN.rect);
    expect(ADVENTURE_CROWN.anatomy).toBe("crown");
    expect(ADVENTURE_CROWN.assetPathTemplate).toBe("/frames/adventurecrown/{key}.png");
    expect(ADVENTURE_CROWN.keyMap).toEqual({ c: "a" });
    expect([RECIPE.width, RECIPE.rows]).toEqual([1500, 410]);
  });

  it("is on the adventure entry only, before the spell's page", () => {
    expect(getFrameProfile("adventure").overlays?.map((slot) => slot.assetPathTemplate)).toEqual([
      "/frames/adventurecrown/{key}.png",
      "/frames/adventure/page/{key}.png",
    ]);
    expect(
      FRAME_TEMPLATE_VALUES.filter((t) => (getFrameProfile(t).overlays ?? []).some((o) => o.assetPathTemplate === ADVENTURE_CROWN.assetPathTemplate)),
    ).toEqual(["adventure"]);
    expect(getFrameProfile("adventure").twoColorMasters).toEqual(["split", "hybrid"]);
    expect(getFrameProfile("adventure").twoColorForLands).toBeUndefined();
    expect(getFrameProfile("adventure").crownMasters).toBeUndefined();
  });

  it("fades the arms over the Nyx Constellation crown's rows, alpha only, the arms only", () => {
    expect(RECIPE.fade).toEqual({ from: 372, to: 408 });
    expect(adventureCrownFade(0)).toBe(1);
    expect(adventureCrownFade(372)).toBe(1);
    expect(adventureCrownFade(390)).toBeCloseTo(0.5, 9);
    expect(adventureCrownFade(408)).toBe(0);
    const band = Buffer.alloc(1500 * 410 * 4, 0);
    band.set([10, 20, 30, 200], (390 * 1500 + 100) * 4);
    band.set([10, 20, 30, 255], (100 * 1500 + 750) * 4);
    expect(fadeAdventureCrownBand(band).changed).toBe(1);
    expect(px(band, 1500, 100, 390)).toEqual([10, 20, 30, 100]);
    expect(px(band, 1500, 750, 100)).toEqual([10, 20, 30, 255]);
    const stray = Buffer.alloc(1500 * 410 * 4, 0);
    stray.set([1, 2, 3, 9], (400 * 1500 + 750) * 4);
    expect(() => fadeAdventureCrownBand(stray)).toThrow(/outside the arms/);
  });
});

describe("the pairs: the importer's recipe", () => {
  it("builds both dresses of every pair beside the seven one-colour masters, which keep their one layer", () => {
    const colors = CC_TEMPLATES.adventure.colors as Record<string, unknown[]>;
    for (const key of PAIR_KEYS) {
      const [pair, hybrid] = key.split("-");
      expect(colors[key], key).toEqual(adventurePairLayers(pair, hybrid ? "hybrid" : "split"));
    }
    for (const key of ["w", "u", "b", "r", "g", "m"]) expect(colors[key], key).toEqual([{ src: `${ADV}/${key}.png` }]);
    expect(colors.c).toEqual([{ src: `${ADV}/a.png` }]);
  });

  it("gold-split: the gold file whole, each page split about its own centre, the pinline across 4.6b's ramp", () => {
    expect(adventurePairLayers("gu", "split")).toEqual([
      { src: `${ADV}/m.png` },
      { src: `${ADV}/g.png`, right: `${ADV}/u.png`, ramp: [20, 36], mask: `${ADV}/bookLeft.png` },
      { src: `${ADV}/g.png`, right: `${ADV}/u.png`, ramp: [66, 82], mask: `${ADV}/bookRight.png` },
      { src: `${ADV}/g.png`, right: `${ADV}/u.png`, ramp: [...PAIR_RAMPS.pinline], mask: `${ADV}/pinline.svg` },
    ]);
    // The pages' ramps (x 300 → 540 and 990 → 1230) sit inside their pages
    // (73–752, 752–1410), centred near each page's middle.
    const px = (pct: number) => (pct / 100) * 1500;
    const [l0, l1] = ADVENTURE_PAIR_PAGE_RAMPS.left.map(px);
    const [r0, r1] = ADVENTURE_PAIR_PAGE_RAMPS.right.map(px);
    expect([l0, l1]).toEqual([300, 540]);
    expect([r0, r1]).toEqual([990, 1230]);
    expect(Math.abs((l0 + l1) / 2 - (73 + 752) / 2)).toBeLessThan(15);
    expect(Math.abs((r0 + r1) / 2 - (752 + 1410) / 2)).toBeLessThan(35);
  });

  it("hybrid: the two frames across the frame ramp, grey bars and a grey spell page, the right page and pinline split", () => {
    expect(adventurePairLayers("wu", "hybrid")).toEqual([
      { src: `${ADV}/w.png`, right: `${ADV}/u.png`, ramp: [...PAIR_RAMPS.frame] },
      { src: `${ADV}/l.png`, mask: ADVENTURE_MASK.title },
      { src: `${ADV}/l.png`, mask: ADVENTURE_MASK.type },
      { src: `${ADV}/l.png`, mask: ADVENTURE_MASK.pageLeft },
      { src: `${ADV}/w.png`, right: `${ADV}/u.png`, ramp: [66, 82], mask: ADVENTURE_MASK.pageRight },
      { src: `${ADV}/w.png`, right: `${ADV}/u.png`, ramp: [...PAIR_RAMPS.pinline], mask: ADVENTURE_MASK.pinline },
    ]);
    expect(ADVENTURE_MASK.title).toBe("img/frames/m15/regular/m15MaskTitle.png");
    expect(() => adventurePairLayers("wu", "plain")).toThrow(/no plain dress/);
    expect(() => adventurePairLayers("uw", "split")).toThrow(/not a pair/);
  });

  it("tones the grey page's paper onto the hybrid prints as the colours' are toned (4.26a's region), and lists the masks as inputs", () => {
    const tone = sourceTonesOf(`${ADV}/l.png`);
    expect(tone?.tones.paper).toBe(ADVENTURE_HYBRID_PAPER_TONE);
    expect(tone?.masks.paper).toBe(`${ADV}/bookLeft.png`);
    expect(tone?.clip.paper.belowOutline).toBe(ADVENTURE_PAPER_REGION);
    expect(tone?.table).toBe("ADVENTURE_HYBRID_PAPER_TONE");
    expect(ADVENTURE_HYBRID_PAPER_TONE).toEqual({ from: [177, 174, 173], to: [216, 210, 212] });
    const files = sourceFilesFor(CC_TEMPLATES.adventure);
    for (const file of [`${ADV}/l.png`, `${ADV}/bookRight.png`, `${ADV}/pinline.svg`, ADVENTURE_MASK.title, ADVENTURE_MASK.type]) expect(files, file).toContain(file);
  });
});

describe("published to the frames bucket", () => {
  it("lists every band, PNG and WebP, at 1500 × 410 — and nothing else under the folder", () => {
    for (const key of BAND_KEYS) {
      for (const ext of ["png", "webp"]) {
        const entry = REAL[`adventurecrown/${key}.${ext}`];
        expect(entry, `adventurecrown/${key}.${ext}`).toBeDefined();
        expect([entry.width, entry.height], `adventurecrown/${key}.${ext}`).toEqual([1500, 410]);
      }
    }
    expect(Object.keys(REAL).filter((k) => k.startsWith("adventurecrown/")).length).toBe(BAND_KEYS.length * 2);
  });

  it("lists every pair master, PNG and WebP, at 1500 × 2100", () => {
    for (const key of PAIR_KEYS) {
      for (const ext of ["png", "webp"]) {
        const entry = REAL[`adventure/${key}.${ext}`];
        expect(entry, `adventure/${key}.${ext}`).toBeDefined();
        expect([entry.width, entry.height], `adventure/${key}.${ext}`).toEqual([1500, 2100]);
      }
    }
  });

  it("records both: the band as PipGlyph's own cut of the published m15crown, the pairs with the adventure's import", () => {
    const provenance = JSON.parse(fs.readFileSync("lib/cards/frame-sources.json", "utf8"));
    const band = provenance.adventurecrown;
    expect(band).toMatchObject({ source: "pipglyph", converter: "scripts/build-adventure-crown.mjs", kind: "overlay", sourceFiles: BAND_KEYS.map((k) => `m15crown/${k}.png`).sort() });
    expect(band.commit).toBeUndefined();
    expect(Object.keys(band.colors)).toEqual(BAND_KEYS);
    for (const key of BAND_KEYS) {
      expect(band.colors[key][0], key).toBe(`m15crown/${key}.png (published, sha256 ${REAL[`m15crown/${key}.png`].sha256.slice(0, 12)})`);
      expect(band.colors[key][1], key).toMatch(/^alpha × \(1 − t\) on rows 372–408/);
    }
    const adventure = provenance.adventure;
    for (const key of PAIR_KEYS) expect(adventure.colors[key], key).toBeDefined();
    expect(adventure.notes.join(" ")).toMatch(/two-colour pair masters \(TODO 4\.6f/);
    expect(adventure.sourceTones[`${ADV}/l.png`].table).toBe("ADVENTURE_HYBRID_PAPER_TONE");
  });
});

// ---- the pixels (local copies at the manifest's sha256) -----------------------
const bands = Object.fromEntries(BAND_KEYS.map((k) => [k, published(`adventurecrown/${k}.png`)]));
const parents = Object.fromEntries(BAND_KEYS.map((k) => [k, published(`m15crown/${k}.png`)]));
const haveBands = BAND_KEYS.every((k) => bands[k] !== null && parents[k] !== null);
const MONO = ["w", "u", "b", "r", "g", "m"];
const masters = Object.fromEntries([...MONO, ...PAIR_KEYS].map((k) => [k, published(`adventure/${k}.png`)]));
const haveMasters = Object.values(masters).every((b) => b !== null);

describe.skipIf(!haveBands)("the published bands (set FRAMES_BUILD_DIR if skipped)", () => {
  it("are their parent's pixels with the arms faded: byte for byte above the fade, colours untouched, clear from row 408", async () => {
    for (const key of BAND_KEYS) {
      const [band, parent] = [await raw(bands[key]!), await raw(parents[key]!)];
      const want = Buffer.from(parent);
      fadeAdventureCrownBand(want);
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

  it("gold-split: the gold body and bars; each page its first colour left of its ramp and its second right of it; the pinline's ends the colours'", async () => {
    for (const pair of TWO_COLOR_PAIRS) {
      const [a, b] = pair.split("");
      const [p, ma, mb, gold] = await Promise.all([at(pair), at(a!), at(b!), at("m")]);
      // The frame body beside the window and the title bar: gold.
      expect(p(30, 1000), `${pair} body`).toEqual(gold(30, 1000));
      expect(p(750, 160), `${pair} title bar`).toEqual(gold(750, 160));
      // The left page: its name bar and paper are the first colour's before
      // x 300, the second's after 540.
      for (const y of [1360, 1460, 1700]) {
        expect(p(200, y), `${pair} left page ${y}`).toEqual(ma(200, y));
        expect(p(640, y), `${pair} left page ${y}`).toEqual(mb(640, y));
      }
      // The right page: the first colour's before x 990, the second's after 1230.
      expect(p(900, 1700), `${pair} right page`).toEqual(ma(900, 1700));
      expect(p(1300, 1700), `${pair} right page`).toEqual(mb(1300, 1700));
      // The pinline beside the window: the first colour left, the second right.
      expect(p(104, 800), `${pair} pinline`).toEqual(ma(104, 800));
      expect(p(1396, 800), `${pair} pinline`).toEqual(mb(1396, 800));
    }
  }, 60_000);

  it("hybrid: the two frames split, grey bars and a grey neutral spell page, the right page and pinline split", async () => {
    for (const pair of TWO_COLOR_PAIRS) {
      const [a, b] = pair.split("");
      const [p, ma, mb] = await Promise.all([at(`${pair}-h`), at(a!), at(b!)]);
      expect(p(30, 1000), `${pair}-h left frame`).toEqual(ma(30, 1000));
      expect(p(1470, 1000), `${pair}-h right frame`).toEqual(mb(1470, 1000));
      expect(p(900, 1700), `${pair}-h right page`).toEqual(ma(900, 1700));
      expect(p(1300, 1700), `${pair}-h right page`).toEqual(mb(1300, 1700));
      expect(p(104, 800), `${pair}-h pinline`).toEqual(ma(104, 800));
      expect(p(1396, 800), `${pair}-h pinline`).toEqual(mb(1396, 800));
      // The spell's page and the bars are the same grey on every pair.
      const grey = await at("wu-h");
      for (const [x, y] of [[400, 1360], [400, 1460], [400, 1700], [750, 160], [750, 1250]] as const) {
        expect(p(x, y), `${pair}-h grey at ${x},${y}`).toEqual(grey(x, y));
      }
    }
    // …neutral, and its paper on the hybrid prints' (the tone's target,
    // within the paper's own mottling).
    const grey = await at("wu-h");
    const ch: number[][] = [[], [], []];
    for (let y = 1540; y < 1900; y += 4) for (let x = 120; x < 700; x += 4) for (let c = 0; c < 3; c++) ch[c]!.push(grey(x, y)[c]!);
    const median = ch.map((v) => v.sort((p, q) => p - q)[v.length >> 1]!);
    for (let c = 0; c < 3; c++) expect(Math.abs(median[c]! - ADVENTURE_HYBRID_PAPER_TONE.to[c]!), `channel ${c}`).toBeLessThanOrEqual(3);
  }, 60_000);
});
