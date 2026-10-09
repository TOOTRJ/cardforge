import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { CC_TEMPLATES, describeLayer, isBuiltRecipe, oldFramePairLayers, seventhPrintRecipe, sourceFilesFor } from "@/scripts/lib/cc-frames.mjs";
import { GOLD_2003_NARROW_PAIRS, PAIR_RAMPS, TWO_COLOR_PAIRS, lerpLayers, rampMask, rampName, rampShare } from "@/scripts/lib/pair-ramp.mjs";
import { cutMaps } from "@/scripts/lib/print-cut.mjs";
import { EIGHTH_REGION_MASKS, eighthCut, eighthRegions } from "@/scripts/lib/eighth-2003.mjs";
import { seventhCut, seventhRegions } from "@/scripts/lib/seventh-1997.mjs";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { TWO_COLOR_PAIRS as REGISTRY_PAIRS } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// TODO 4.6h — two colours on the old frames: `modern` (the 2003 gold card of
// Ravnica 2005 on), `modernland` (the 2003 frame's two-colour lands) and
// `retroland` (the 1997 frame's, Sixth Edition 1999 on). Card Conjurer's two
// packs hold no two-colour master for either era, so each pair master is
// SYNTHESISED from the template's own finished masters: the base whole (the
// gold frame; the plain land), and inside the split regions the pair's two
// colour masters blended left to right across the ramp measured on the
// prints. This holds the recipe, the ramps, the declared keys, the manifest
// and provenance, and — with a local copy of the published masters at the
// manifest's sha256 (FRAMES_BUILD_DIR, else .frames-build; CI fetches them)
// and the pack's masks in the importer's cache — the pixels:
//   • a 2003 pair master IS its base and its two colour masters, recombined
//     from the PUBLISHED files through the pack's masks, to the byte;
//   • a 1997 pair master is the plain land to the byte everywhere outside
//     its text box and the box's ring, and splits across 40→60 %W inside.
// ---------------------------------------------------------------------------

type Entry = { hash: string; sha256: string; bytes: number; width: number; height: number };
const files = (manifestJson as { files: Record<string, Entry> }).files;
const provenance = JSON.parse(fs.readFileSync("lib/cards/frame-sources.json", "utf8")) as Record<
  string,
  { colors: Record<string, string[]>; notes: string[]; printRecipe?: Record<string, unknown>; sourceFiles: string[] }
>;
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
const CC = path.join(process.env.CC_CACHE ?? path.join(process.env.HOME ?? "", ".cache", "pipglyph-cc"), "2fcddba8966156d484cedf54d8214996748dd5e1");
const W = 1500;
const H = 2100;
const TEMPLATES = ["modern", "modernland", "retroland"] as const;
const MONO = ["w", "u", "b", "r", "g", "c", "m"];

type Layer = { built: string; right?: string; ramp?: (number | string)[]; regions?: string[]; cutOf?: string };
const defs = CC_TEMPLATES as unknown as Record<string, { colors: Record<string, Layer[]>; notes: string[]; builtSideRecipe?: (k: string, cutOf: string) => unknown }>;

describe("the ramps (measured on the prints, 2026-10-08)", () => {
  it("the 2003 gold card: a wide smoothstep in the box on every pair and in the pinline on seven; a narrow straight pinline on bg, gw and rw", () => {
    expect(PAIR_RAMPS.gold2003Rules).toEqual([25, 73, "smooth"]);
    expect(PAIR_RAMPS.gold2003Pinline).toEqual([25, 71, "smooth"]);
    expect(PAIR_RAMPS.gold2003PinlineNarrow).toEqual([42, 59]);
    expect([...GOLD_2003_NARROW_PAIRS]).toEqual(["bg", "rw", "gw"]);
    for (const pair of GOLD_2003_NARROW_PAIRS) expect(TWO_COLOR_PAIRS).toContain(pair);
  });

  it("the lands: one straight ramp each for the pinline (or the box's ring) and the box", () => {
    expect(PAIR_RAMPS.land2003).toEqual([42, 59]);
    expect(PAIR_RAMPS.land1997).toEqual([40, 60]);
  });

  it("a smooth ramp is a smoothstep between its ends — the same centre, soft shoulders — and is named as one", () => {
    const smooth = [20, 80, "smooth"];
    expect(rampShare(10, smooth)).toBe(0);
    expect(rampShare(90, smooth)).toBe(1);
    expect(rampShare(50, smooth)).toBe(0.5);
    // t = 0.25 → 3t² − 2t³ = 0.15625: under the straight ramp's 0.25.
    expect(rampShare(35, smooth)).toBeCloseTo(0.15625, 10);
    expect(rampShare(65, smooth)).toBeCloseTo(0.84375, 10);
    expect(rampShare(35, [20, 80])).toBeCloseTo(0.25, 10);
    expect(rampName(smooth)).toBe("procedural:smoothstep(20→80 %W)");
    expect(rampName([42, 59])).toBe("procedural:ramp(42→59 %W)");
    expect(() => rampShare(50, [20, 80, "cubic"])).toThrow(/unknown ramp shape/);
    // The mask rows are the share, every row the same.
    const mask = rampMask(200, 2, smooth);
    expect(mask[(100 + 0) * 4 + 3]).toBe(Math.round(rampShare(50.25, smooth) * 255));
    expect(mask.subarray(0, 800).equals(mask.subarray(800, 1600))).toBe(true);
    // The prints' medians, by the fit that read them (10 / 50 / 90 % of a
    // smoothstep 25→71 are 34.0 / 48.0 / 62.0 %W; the prints' wide pinline
    // crossings read 33–37 / 47–49 / 60–64).
    const crossing = (level: number) => {
      for (let x = 0; x <= 100; x += 0.01) if (rampShare(x, PAIR_RAMPS.gold2003Pinline) >= level) return x;
      return NaN;
    };
    expect(crossing(0.1)).toBeCloseTo(34.0, 1);
    expect(crossing(0.5)).toBeCloseTo(48.0, 1);
    expect(crossing(0.9)).toBeCloseTo(62.0, 1);
  });
});

describe("the recipe (oldFramePairLayers): the template's own finished masters", () => {
  it("modern: the gold master whole; the box across the wide smoothstep; the pinline wide, or narrow on bg / gw / rw", () => {
    expect(oldFramePairLayers("modern", "ur")).toEqual([
      { built: "m" },
      { built: "u", right: "r", ramp: [25, 73, "smooth"], regions: ["text"] },
      { built: "u", right: "r", ramp: [25, 71, "smooth"], regions: ["pin"] },
    ]);
    for (const pair of TWO_COLOR_PAIRS) {
      const [, box, pin] = oldFramePairLayers("modern", pair) as Layer[];
      expect(box.ramp, pair).toEqual([25, 73, "smooth"]);
      expect(pin.ramp, pair).toEqual((GOLD_2003_NARROW_PAIRS as readonly string[]).includes(pair) ? [42, 59] : [25, 71, "smooth"]);
    }
  });

  it("modernland: the plain land whole (its body and grey bars); the box and the pinline across one ramp", () => {
    expect(oldFramePairLayers("modernland", "gw")).toEqual([{ built: "c" }, { built: "g", right: "w", ramp: [42, 59], regions: ["text", "pin"] }]);
  });

  it("retroland: the plain land whole (its gold rings too); the box and the box's ring across one ramp, both sides on the plain land's cut", () => {
    expect(oldFramePairLayers("retroland", "wu")).toEqual([
      { built: "c" },
      { built: "w", right: "u", ramp: [40, 60], regions: ["text", "trimL", "trimT", "trimR", "trimB"], cutOf: "c" },
    ]);
    // The side's recipe: the coloured land's own drawing and tones, the
    // plain land's cut (the basics' boxes sit up to 2.5 px off it).
    type Recipe = { cut: unknown; tones?: unknown };
    const side = seventhPrintRecipe("retroland", "w", { cutOf: "c" }) as Recipe;
    expect(side.tones).toEqual((seventhPrintRecipe("retroland", "w") as Recipe).tones);
    expect(side.cut).toEqual(seventhPrintRecipe("retroland", "c").cut);
    expect(side.cut).not.toEqual(seventhPrintRecipe("retroland", "w").cut);
    expect(defs.retroland.builtSideRecipe!("w", "c")).toEqual(side);
    // The MSE gold has no Seventh cut to lend or take.
    expect(() => seventhPrintRecipe("retro", "w", { cutOf: "m" })).toThrow(/can't take the cut/);
  });

  it("the first canonical colour is on the left on every pair; `retro` and every other template draw none", () => {
    expect([...TWO_COLOR_PAIRS]).toEqual([...REGISTRY_PAIRS]);
    for (const template of TEMPLATES) {
      for (const pair of TWO_COLOR_PAIRS) {
        const layers = oldFramePairLayers(template, pair) as Layer[];
        expect(isBuiltRecipe(layers)).toBe(true);
        for (const l of layers.slice(1)) expect([l.built, l.right], `${template}/${pair}`).toEqual([pair[0], pair[1]]);
      }
    }
    expect(() => oldFramePairLayers("retro", "wu")).toThrow(/draws no old-frame pairs/);
    expect(() => oldFramePairLayers("modern", "uw")).toThrow(/printed order/);
    expect(isBuiltRecipe([{ src: "x.png" }])).toBe(false);
  });

  it("CC_TEMPLATES builds the ten pairs of each beside its seven masters; provenance records them and says they are synthesised", () => {
    for (const template of TEMPLATES) {
      expect(Object.keys(defs[template].colors).sort()).toEqual([...MONO, ...TWO_COLOR_PAIRS].sort());
      for (const pair of TWO_COLOR_PAIRS) {
        const layers = oldFramePairLayers(template, pair);
        expect(defs[template].colors[pair]).toEqual(layers);
        expect(provenance[template].colors[pair], `${template}/${pair}`).toEqual(layers.map(describeLayer));
        // A pair has no print recipe of its own: its masters carry theirs.
        expect(provenance[template].printRecipe![pair], `${template}/${pair}`).toBeUndefined();
      }
      expect(Object.keys(provenance[template].printRecipe!).sort()).toEqual([...MONO].sort());
      expect(provenance[template].notes.join(" ")).toMatch(/SYNTHESISED/);
      expect(provenance[template].notes.join(" ")).toMatch(/TODO 4\.6h/);
      // No finished master is listed as a pack file.
      expect(sourceFilesFor(defs[template] as never).every((f: unknown) => typeof f === "string" && f.length > 0)).toBe(true);
      expect(provenance[template].sourceFiles).toEqual(sourceFilesFor(defs[template] as never));
    }
    expect(Object.keys(defs.retro.colors).sort()).toEqual([...MONO].sort());
    expect(describeLayer(oldFramePairLayers("modern", "bg")[2])).toBe("(built:b | built:g across procedural:ramp(42→59 %W)) through the regions pin");
    expect(describeLayer(oldFramePairLayers("retroland", "wu")[1])).toBe(
      "(built:w | built:u across procedural:ramp(40→60 %W)) (each on the cut of c) through the regions text + trimL + trimT + trimR + trimB",
    );
  });
});

describe("declared and published", () => {
  it("the three PROFILES entries declare the split dress; a land wears it on the two land frames; `retro` declares none", () => {
    expect(getFrameProfile("modern").twoColorMasters).toEqual(["split"]);
    expect(getFrameProfile("modern").twoColorForLands).toBeUndefined();
    for (const land of ["modernland", "retroland"]) {
      expect(getFrameProfile(land).twoColorMasters).toEqual(["split"]);
      expect(getFrameProfile(land).twoColorForLands).toBe(true);
    }
    expect(getFrameProfile("retro").twoColorMasters).toBeUndefined();
    // No crown, no stamp, no collector line came with it.
    for (const t of TEMPLATES) {
      const profile = getFrameProfile(t);
      expect(profile.overlays, t).toBeUndefined();
      expect(profile.collector, t).toBeUndefined();
      expect(profile.crownMasters, t).toBeUndefined();
    }
  });

  it.each(TEMPLATES)("%s: every pair master is in the frames bucket, PNG + WebP, 1500 × 2100; the seven masters are the objects they were", (template) => {
    for (const pair of TWO_COLOR_PAIRS) {
      for (const ext of ["png", "webp"]) {
        const entry = files[`${template}/${pair}.${ext}`];
        expect(entry, `${template}/${pair}.${ext}`).toBeDefined();
        expect([entry.width, entry.height]).toEqual([W, H]);
      }
    }
    // The importer run that built the pairs rebuilt the seven byte-identical
    // (the manifest keeps the hashes #484 / #490 published).
    const kept: Record<string, string> = { modern: "45e415c89350", modernland: files["modernland/m.png"].hash, retroland: files["retroland/m.png"].hash };
    expect(files[`${template}/m.png`].hash).toBe(kept[template]);
  });
});

// --- the pixels (local build at the manifest's sha) ------------------------

function local(rel: string): Buffer | null {
  const file = path.join(BUILD, rel);
  if (!files[rel] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === files[rel].sha256 ? bytes : null;
}
async function raw(rel: string): Promise<Buffer> {
  const { data, info } = await sharp(local(rel)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect([info.width, info.height]).toEqual([W, H]);
  return data;
}
async function alphaPlane(rel: string): Promise<Float32Array> {
  const { data } = await sharp(path.join(CC, rel), { density: 300 }).resize(W, H, { fit: "fill", kernel: "lanczos3" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const plane = new Float32Array(W * H);
  for (let p = 0; p < W * H; p += 1) plane[p] = data[p * 4 + 3] / 255;
  return plane;
}

const NEEDED = TEMPLATES.flatMap((t) => [...MONO, ...TWO_COLOR_PAIRS].map((k) => `${t}/${k}.png`));
const CC_NEEDED = [...Object.values(EIGHTH_REGION_MASKS), "img/frames/seventh/regular/pinline.svg"];
const available = NEEDED.every((rel) => local(rel) !== null) && CC_NEEDED.every((rel) => fs.existsSync(path.join(CC, rel)));

/** The base with each split layer laid in through its regions' coverage —
 *  the importer's own arithmetic (scripts/import-cc-frames.mjs
 *  pairOfFinishedMasters), over the given finished masters. */
function recombine(base: Buffer, layers: Layer[], masters: Record<string, Buffer>, regions: Record<string, Uint8Array>): Buffer {
  const out = Buffer.from(base);
  for (const l of layers.slice(1)) {
    const blend = lerpLayers(masters[l.built], masters[l.right!], rampMask(W, H, l.ramp!));
    for (const name of l.regions!) {
      const cover = regions[name];
      for (let p = 0; p < W * H; p += 1) {
        const c = cover[p];
        if (c === 0) continue;
        for (let ch = 0; ch < 4; ch += 1) out[p * 4 + ch] = Math.round(out[p * 4 + ch] + ((blend[p * 4 + ch] - out[p * 4 + ch]) * c) / 255);
      }
    }
  }
  return out;
}

/** The first x (% of the width) where the share between the row's own two
 *  ends reaches each level — columns' means over rows [y0, y1). */
function crossings(img: Buffer, y0: number, y1: number, x0: number, x1: number, levels = [0.1, 0.5, 0.9]): number[] {
  const col = (x: number) => {
    const sum = [0, 0, 0];
    for (let y = y0; y < y1; y += 1) for (let c = 0; c < 3; c += 1) sum[c] += img[(y * W + x) * 4 + c];
    return sum.map((v) => v / (y1 - y0));
  };
  const mean = (from: number, to: number) => {
    const sum = [0, 0, 0];
    for (let x = from; x < to; x += 1) col(x).forEach((v, c) => (sum[c] += v));
    return sum.map((v) => v / (to - from));
  };
  const a = mean(x0, x0 + 60);
  const b = mean(x1 - 60, x1);
  const d = b.map((v, c) => v - a[c]);
  const den = d.reduce((s, v) => s + v * v, 0);
  const share: number[] = [];
  for (let x = x0; x < x1; x += 1) {
    const v = col(x);
    // A 9-column mean smooths the box's own texture.
    share.push(v.reduce((s, value, c) => s + (value - a[c]) * d[c], 0) / den);
  }
  const smooth = share.map((_, i) => {
    const from = Math.max(0, i - 12);
    const to = Math.min(share.length, i + 13);
    return share.slice(from, to).reduce((s, v) => s + v, 0) / (to - from);
  });
  return levels.map((level) => ((x0 + smooth.findIndex((v) => v >= level) + 0.5) / W) * 100);
}

describe.skipIf(!available)("the published old-frame pair masters' pixels (set FRAMES_BUILD_DIR if skipped)", { timeout: 180_000 }, () => {
  it.each(["modern", "modernland"] as const)("%s: every pair IS its base and its two colour masters recombined through the pack's masks, to the byte", async (template) => {
    const planes: Record<string, Float32Array> = {};
    for (const [name, rel] of Object.entries(EIGHTH_REGION_MASKS)) planes[name] = await alphaPlane(rel);
    const regions = eighthRegions(planes, cutMaps(eighthCut(), W, H)) as Record<string, Uint8Array>;
    const masters: Record<string, Buffer> = {};
    for (const key of MONO) masters[key] = await raw(`${template}/${key}.png`);
    for (const pair of TWO_COLOR_PAIRS) {
      const layers = oldFramePairLayers(template, pair) as Layer[];
      const expected = recombine(masters[layers[0].built], layers, masters, regions);
      const got = await raw(`${template}/${pair}.png`);
      let worst = 0;
      let differing = 0;
      for (let o = 0; o < got.length; o += 1) {
        const diff = Math.abs(got[o] - expected[o]);
        if (diff > 0) differing += 1;
        if (diff > worst) worst = diff;
      }
      expect([pair, worst, differing]).toEqual([pair, 0, 0]);
      // Not vacuous: the pair is neither its base nor either colour master.
      expect(got.equals(masters[layers[0].built]), pair).toBe(false);
    }
  });

  it("modern: the gold bars and body are the gold master's; the pinline row and the box split where their ramps say", async () => {
    const gold = await raw("modern/m.png");
    const wide = await raw("modern/ur.png");
    const narrow = await raw("modern/gw.png");
    // The title bar's face (rows 130–205) and the frame body beside the art
    // (columns 80–104, rows 400–1000): gold, to the byte.
    for (const pair of [wide, narrow]) {
      for (let y = 130; y < 205; y += 5) for (let x = 200; x < 1300; x += 7) expect(pair.subarray((y * W + x) * 4, (y * W + x) * 4 + 4).equals(gold.subarray((y * W + x) * 4, (y * W + x) * 4 + 4))).toBe(true);
      for (let y = 400; y < 1000; y += 9) for (let x = 80; x < 105; x += 3) expect(pair.subarray((y * W + x) * 4, (y * W + x) * 4 + 4).equals(gold.subarray((y * W + x) * 4, (y * W + x) * 4 + 4))).toBe(true);
    }
    // The box's face, rows 1500–1700: a smoothstep 25→73 crosses 10 / 50 /
    // 90 % at 34.4 / 49.0 / 63.6 %W.
    const box = crossings(wide, 1500, 1700, 150, 1350);
    expect(box[0]).toBeGreaterThan(32.4);
    expect(box[0]).toBeLessThan(36.4);
    expect(Math.abs(box[1] - 49)).toBeLessThan(1.5);
    expect(box[2]).toBeGreaterThan(61.6);
    expect(box[2]).toBeLessThan(65.6);
  });

  it("retroland: a pair is the plain land to the byte outside its text box and ring — the gold outer and art rings included — and splits across 40→60 %W inside", async () => {
    const maps = cutMaps(seventhCut("l"), W, H);
    const rings = await alphaPlane("img/frames/seventh/regular/pinline.svg");
    const regions = (seventhRegions as unknown as (recut: null, maps: unknown, opts: { rings: Float32Array }) => Record<string, Uint8Array>)(null, maps, { rings });
    const split = ["text", "trimL", "trimT", "trimR", "trimB"];
    const plain = await raw("retroland/c.png");
    for (const pair of TWO_COLOR_PAIRS) {
      const got = await raw(`retroland/${pair}.png`);
      let outside = 0;
      let inside = 0;
      for (let p = 0; p < W * H; p += 1) {
        const covered = split.some((name) => regions[name][p] > 0);
        const same = got.subarray(p * 4, p * 4 + 4).equals(plain.subarray(p * 4, p * 4 + 4));
        if (!covered && !same) outside += 1;
        if (covered && !same) inside += 1;
      }
      expect([pair, outside]).toEqual([pair, 0]);
      // Not vacuous: the box is not the plain land's orange.
      expect(inside, pair).toBeGreaterThan(400_000);
    }
    // The rings the pack's Pinline mask names (the outer and art rings) are
    // the plain land's gold on a pair — a basic's are its colour.
    const wu = await raw("retroland/wu.png");
    const blue = await raw("retroland/u.png");
    let ringPx = 0;
    let blueDiffers = 0;
    for (let p = 0; p < W * H; p += 1) {
      if (regions.pin[p] < 250) continue;
      ringPx += 1;
      expect(wu[p * 4]).toBe(plain[p * 4]);
      if (Math.abs(blue[p * 4] - plain[p * 4]) > 40) blueDiffers += 1;
    }
    expect(ringPx).toBeGreaterThan(5000);
    expect(blueDiffers / ringPx).toBeGreaterThan(0.5);
    // The box's face, rows 1500–1700: 40→60 crosses at 42 / 50 / 58 %W.
    // (±3: the box's own cloud texture differs between the two colours.)
    const box = crossings(wu, 1500, 1700, 200, 1300);
    expect(Math.abs(box[0] - 42)).toBeLessThan(3);
    expect(Math.abs(box[1] - 50)).toBeLessThan(3);
    expect(Math.abs(box[2] - 58)).toBeLessThan(3);
  });
});
