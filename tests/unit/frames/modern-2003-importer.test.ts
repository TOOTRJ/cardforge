import fs from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { frameManifestEntry } from "@/lib/frames/frame-url";
import { CC_TEMPLATES, builtColors, describePrintRecipe, sourceFilesFor } from "@/scripts/lib/cc-frames.mjs";
import { cutMaps, rectPlane, regionGain, stretchRange } from "@/scripts/lib/print-cut.mjs";
import {
  EIGHTH_CUT,
  EIGHTH_MASTER_OF,
  EIGHTH_PLATE_TONES,
  EIGHTH_REGION_MASKS,
  EIGHTH_TONES,
  eighthCut,
  eighthMaps,
  eighthPrintRecipe,
  eighthRegions,
} from "@/scripts/lib/eighth-2003.mjs";
import { bucketMaster, haveBucketMasters } from "@/tests/stubs/bucket-masters";

// ---------------------------------------------------------------------------
// The 2003 frame's recipes (TODO 4.10b, layout v47; scripts/lib/eighth-2003
// .mjs, built by scripts/import-cc-frames.mjs): Card Conjurer's 8th drawing
// re-cut with ONE piecewise-linear map per axis and toned through the
// pack's own five masks onto the prints of the frame's later drawing (CHK
// 2004 → JOU 2014). The recipe half runs everywhere; the master half reads
// the published masters (FRAMES_BUILD_DIR, else .frames-build; CI fetches
// them) and skips without them.
// ---------------------------------------------------------------------------

const KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;
const TEMPLATES = ["modern", "modernland"] as const;
const MASTERS = ["w", "u", "b", "r", "g", "m", "a", "l", "wl", "ul", "bl", "rl", "gl", "ml"];
const REGIONS = ["body", "title", "type", "text", "pin"];
const W = 1500;
const H = 2100;
type Tone = { from: number[]; to: number[]; k?: number };
const tones = EIGHTH_TONES as Record<string, Record<string, Tone>>;
const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
type Def = { colors: Record<string, { src: string }[]>; printRecipe: (k: string) => unknown; plates?: Record<string, string>; plateGains?: Record<string, number[]>; notes: string[] };
const defs = CC_TEMPLATES as unknown as Record<string, Def>;

describe("the 2003 recipes", { timeout: 30_000 }, () => {
  it("builds seven keys per template from the pack's fourteen masters: `c` = the artifact frame / the plain land, `m` = the gold frame / the gold land", () => {
    expect(EIGHTH_MASTER_OF.modern).toEqual({ w: "w", u: "u", b: "b", r: "r", g: "g", c: "a", m: "m" });
    expect(EIGHTH_MASTER_OF.modernland).toEqual({ w: "wl", u: "ul", b: "bl", r: "rl", g: "gl", c: "l", m: "ml" });
    for (const template of TEMPLATES) {
      const def = defs[template];
      expect(builtColors(def as never).sort()).toEqual([...KEYS].sort());
      for (const key of KEYS) {
        expect(def.colors[key].map((l) => l.src), `${template}/${key}`).toEqual([`img/frames/8th/${EIGHTH_MASTER_OF[template][key]}.png`]);
        expect(def.printRecipe(key), `${template}/${key}`).toEqual(eighthPrintRecipe(template, key));
      }
      // The masks the tone reads are importer inputs: checked and recorded.
      for (const mask of Object.values(EIGHTH_REGION_MASKS)) expect(sourceFilesFor(def as never)).toContain(mask);
    }
    // The pack's own c.png — the translucent Eldrazi frame — is not built.
    expect(JSON.stringify(defs.modern.colors)).not.toContain("8th/c.png");
    expect(() => eighthPrintRecipe("modern", "x")).toThrow(/no 2003 master/);
    expect(() => eighthPrintRecipe("retro", "w")).toThrow(/no 2003 master/);
  });

  it("re-cuts with ONE cut for every key: the outer frame scaled × 1.0098 / × 1.0061 onto the prints', the type bar's top line lowered 3.5 px more, the text box's lines moved 2 px", () => {
    const cut = eighthCut();
    for (const template of TEMPLATES) for (const key of KEYS) expect((eighthPrintRecipe(template, key) as { cut: unknown }).cut).toEqual(cut);
    // The outer frame: 77.1–1421.9 × 77–2023 in the drawing, 70.6–1428.5 ×
    // 70.6–2028.4 on the prints (34 white prints; the research's 70.1–1429.0
    // × 70.2–2028.8 within half a pixel).
    const [left, right] = [cut.xUpper[0], cut.xUpper[cut.xUpper.length - 1]];
    const [top, bottom] = [cut.y[0], cut.y[cut.y.length - 1]];
    expect((right[1] - left[1]) / (right[0] - left[0])).toBeCloseTo(1.0098, 3);
    expect((bottom[1] - top[1]) / (bottom[0] - top[0])).toBeCloseTo(1.0061, 3);
    // The type bar's top line: where the scale alone puts it, and where the
    // prints have it — 3 to 4 px lower.
    const scaled = top[1] + ((1180.8 - top[0]) * (bottom[1] - top[1])) / (bottom[0] - top[0]);
    const anchored = cut.y.find(([from]) => from === 1180.8)![1];
    expect(anchored - scaled).toBeGreaterThan(3);
    expect(anchored - scaled).toBeLessThan(4.5);
    // The local stretch stays modest (the 13 px strip between the art and
    // the type bar grows to 17: flat colour).
    const y = stretchRange(cut.y);
    expect(y.min).toBeGreaterThan(0.95);
    expect(y.max).toBeLessThan(1.4);
    for (const anchors of [cut.xUpper, cut.xLower]) {
      const s = stretchRange(anchors);
      expect(s.min).toBeGreaterThan(0.99);
      expect(s.max).toBeLessThan(1.09);
    }
    // The maps: the border outside the frame is never stretched (slope 1).
    const maps = eighthMaps();
    expect(maps.srcY[10] - maps.srcY[0]).toBeCloseTo(10, 9);
    expect(maps.upper[1499] - maps.upper[1489]).toBeCloseTo(10, 9);
    // The art rows read the scale alone; the text-box rows bend at the
    // box's right line.
    expect(maps.upper[1372]).not.toBeCloseTo(maps.lower[1372], 1);
    expect(maps.share[1194]).toBe(0);
    expect(maps.share[1286]).toBe(1);
    // The constant is frozen; the cut handed out is a copy.
    expect(Object.isFrozen(EIGHTH_CUT)).toBe(true);
    expect(cutMaps(cut, W, H).srcY).toEqual(maps.srcY);
  });

  it("the regions are the pack's five masks moved with the same map, the pinline taken out of the other four", () => {
    // Synthetic planes: a body ring, three bars and a pinline strip that
    // overlaps the title bar's bottom rows.
    const planes = {
      body: rectPlane([78, 78, 1422, 110], W, H),
      title: rectPlane([110, 120, 1390, 236], W, H),
      type: rectPlane([114, 1181, 1384, 1291], W, H),
      text: rectPlane([128, 1310, 1370, 1903], W, H),
      pin: rectPlane([100, 230, 1400, 244], W, H),
    };
    const regions = eighthRegions(planes, eighthMaps()) as Record<string, Uint8Array>;
    expect(Object.keys(regions)).toEqual(REGIONS);
    const at = (name: string, x: number, y: number) => regions[name][y * W + x];
    // The type bar's top line: 1181 in the drawing, 1185.5 on the prints.
    expect(at("type", 700, 1183)).toBe(0);
    expect(at("type", 700, 1187)).toBe(255);
    // The text box's bottom line: 1903 → 1906.
    expect(at("text", 700, 1904)).toBe(255);
    expect(at("text", 700, 1908)).toBe(0);
    // Where the pinline covers the title bar, the bar's coverage is gone.
    expect(at("pin", 700, 236)).toBe(255);
    expect(at("title", 700, 236)).toBe(0);
    expect(at("title", 700, 200)).toBe(255);
    expect(() => eighthRegions({ ...planes, pin: undefined } as never, eighthMaps())).toThrow(/no 1500x2100 plane for pin/);
    // (Five 1500 × 2100 planes through the resample: generous for CI's V8 coverage.)
  }, 60_000);

  it("tones every region of every master by the rule: prints darker → offset with the texture's contrast (0.7–1.2); prints lighter → the gain while under × 1.35, else the offset", () => {
    expect(Object.keys(tones).sort()).toEqual([...MASTERS].sort());
    for (const master of MASTERS) {
      expect(Object.keys(tones[master]), master).toEqual(REGIONS);
      for (const region of REGIONS) {
        const t = tones[master][region];
        const lighter = luma(t.to) > luma(t.from);
        const gain = Math.max(...regionGain(t));
        if (t.k !== undefined) {
          expect(t.k, `${master} ${region}`).toBeGreaterThanOrEqual(0.7);
          expect(t.k, `${master} ${region}`).toBeLessThanOrEqual(1.2);
          // An offset on a region the prints set LIGHTER only where a gain
          // would be too strong.
          if (lighter) expect(gain, `${master} ${region}`).toBeGreaterThanOrEqual(1.35);
        } else {
          expect(lighter, `${master} ${region}`).toBe(true);
          expect(gain, `${master} ${region}`).toBeLessThan(1.35);
        }
      }
    }
    // What the proof found: the pack's white frame is light (its body 232
    // luma against the prints' 207), its keyline pure white.
    expect(luma(tones.w.body.from) - luma(tones.w.body.to)).toBeGreaterThan(20);
    expect(tones.w.pin.from).toEqual([255, 255, 255]);
    // The black frame's body is left as drawn: its mean is the prints', and
    // its contrast is kept.
    expect(Math.abs(luma(tones.b.body.from) - luma(tones.b.body.to))).toBeLessThan(5);
    expect(tones.b.body.k).toBe(1);
  });

  it("the P/T plates are the pack's own, each on a per-channel gain onto its prints' plate face — gold, blue and red most", () => {
    const def = defs.modern;
    expect(def.plates).toEqual(Object.fromEntries(KEYS.map((k) => [k, `img/frames/8th/pt/${EIGHTH_MASTER_OF.modern[k]}.png`])));
    expect(defs.modernland.plates).toBeUndefined();
    const plateTones = EIGHTH_PLATE_TONES as Record<string, Tone>;
    for (const key of KEYS) {
      const want = regionGain(plateTones[EIGHTH_MASTER_OF.modern[key]]).map((g: number) => Math.round(g * 1000) / 1000);
      expect(def.plateGains![key], key).toEqual(want);
      for (const g of want) {
        expect(g).toBeGreaterThan(0.6);
        expect(g).toBeLessThan(1.2);
      }
    }
    // Gold read 30 luma light as drawn; white within a level.
    expect(luma(plateTones.m.from) - luma(plateTones.m.to)).toBeGreaterThan(25);
    expect(Math.abs(luma(plateTones.w.from) - luma(plateTones.w.to))).toBeLessThan(2);
    // The profile draws them at the printed box.
    expect(getFrameProfile("modern").pt!.plateAssetPathTemplate).toBe("/frames/modern/pt/{color}.png");
    expect(getFrameProfile("modernland").pt!.plateAssetPathTemplate).toBe("/frames/modern/pt/{color}.png");
  });

  it("records every recipe in lib/cards/frame-sources.json: the anchors, the local stretch, the region masks, each region's tone and the plates' gains", () => {
    const sources = JSON.parse(fs.readFileSync("lib/cards/frame-sources.json", "utf8")) as Record<
      string,
      { printRecipe: Record<string, unknown>; sourceFiles: string[]; pack: string; notes: string[]; plateGains?: unknown; transforms: string }
    >;
    for (const template of TEMPLATES) {
      const entry = sources[template];
      expect(Object.keys(entry.printRecipe).sort(), template).toEqual([...KEYS].sort());
      for (const key of KEYS) {
        expect(entry.printRecipe[key], `${template}/${key}`).toEqual(JSON.parse(JSON.stringify(describePrintRecipe(eighthPrintRecipe(template, key) as never))));
        expect(entry.printRecipe[key]).toHaveProperty("regions");
        expect(entry.printRecipe[key]).toHaveProperty("tones");
      }
      expect(entry.pack).toMatch(/pack8th\.js/);
      expect(entry.notes.join(" ")).toMatch(/LATER drawing \(CHK 2004 → JOU 2014/);
      expect(entry.notes.join(" ")).toMatch(/white body is a blocky mottling/);
      expect(entry.transforms).toMatch(/one resample/);
    }
    expect(sources.modern.plateGains).toEqual(JSON.parse(JSON.stringify(defs.modern.plateGains)));
  });

  it("lives in the frames bucket and nowhere in git: no public/frames copy, off the MSE builder and Phase B's list", () => {
    for (const template of TEMPLATES) {
      expect(fs.existsSync(`public/frames/${template}`), template).toBe(false);
      for (const key of KEYS) {
        for (const ext of ["png", "webp"]) {
          const entry = frameManifestEntry(`/frames/${template}/${key}.${ext}`);
          expect(entry, `${template}/${key}.${ext}`).not.toBeNull();
          expect([entry!.width, entry!.height]).toEqual([W, H]);
          if (template === "modern") expect(frameManifestEntry(`/frames/modern/pt/${key}.${ext}`), `pt/${key}.${ext}`).not.toBeNull();
        }
      }
    }
    const builder = fs.readFileSync("scripts/build-era-frames.mjs", "utf8");
    expect(builder).not.toMatch(/out: "public\/frames\/modern/);
    const corners = fs.readFileSync("scripts/lib/frame-corners.mjs", "utf8");
    expect(corners).not.toMatch(/^\s+modern(land)?: "all",$/m);
  });
});

// The published masters themselves.
const MASTER_KEYS = TEMPLATES.flatMap((t) => KEYS.map((k) => `${t}/${k}.png`));
const have = haveBucketMasters(MASTER_KEYS);
describe.skipIf(!have)("the published 2003 masters (frames bucket)", () => {
  const load = async (key: string) => {
    const { data } = await sharp(bucketMaster(key)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return data;
  };
  const at = (data: Buffer, x: number, y: number) => [...data.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)];

  it("every key of both templates has ONE art window — 130–1370 × 252–1161 px within 3 px (the artifact frame's and the gold land's are a hair larger) — which the slot covers", async () => {
    for (const key of MASTER_KEYS) {
      const data = await load(key);
      const clearRow = Array.from({ length: W }, (_, x) => at(data, x, 700)[3] < 128);
      const clearCol = Array.from({ length: H }, (_, y) => at(data, 750, y)[3] < 128);
      const box = [clearRow.indexOf(true), clearRow.lastIndexOf(true) + 1, clearCol.indexOf(true), clearCol.lastIndexOf(true) + 1];
      [130, 1370, 252, 1161].forEach((want, i) => expect(Math.abs(box[i] - want), `${key} window ${box}`).toBeLessThanOrEqual(3));
      const slot = getFrameProfile(key.split("/")[0] as "modern").artSlot;
      expect((slot.leftPct / 100) * W).toBeLessThan(box[0]);
      expect(((slot.leftPct + slot.widthPct) / 100) * W).toBeGreaterThan(box[1]);
      expect((slot.topPct / 100) * H).toBeLessThan(box[2]);
      expect(((slot.topPct + slot.heightPct) / 100) * H).toBeGreaterThan(box[3]);
    }
  }, 120_000);

  it("is on the prints' frame box and sharp: the outer edge at 70–71 px, one or two pixels wide (the MSE conversion's was 6–7)", async () => {
    for (const key of ["modern/w.png", "modern/r.png", "modern/c.png", "modernland/c.png"]) {
      const data = await load(key);
      const lum = (x: number) => luma(at(data, x, 700));
      let first = 55;
      while (lum(first) < 12) first += 1;
      expect(Math.abs(first - 70.6), key).toBeLessThanOrEqual(1.5);
      // 10 → 90 % of the step within three columns.
      const inside = lum(first + 6);
      let last = first;
      while (lum(last) < 0.9 * inside) last += 1;
      expect(last - first, key).toBeLessThanOrEqual(3);
    }
  }, 60_000);

  it("is toned onto the prints: each master's title bar, type bar and text box sit on the table's print means", async () => {
    /** The per-channel MEDIAN over rectangles (every other pixel). */
    const median = (data: Buffer, rects: number[][]) => {
      const channels: number[][] = [[], [], []];
      for (const [x0, y0, x1, y1] of rects) {
        for (let y = y0; y < y1; y += 2) {
          for (let x = x0; x < x1; x += 2) {
            const p = at(data, x, y);
            for (let c = 0; c < 3; c += 1) channels[c].push(p[c]);
          }
        }
      }
      return channels.map((v) => v.sort((m, n) => m - n)[v.length >> 1]);
    };
    for (const template of TEMPLATES) {
      for (const key of KEYS) {
        const master = EIGHTH_MASTER_OF[template][key];
        const data = await load(`${template}/${key}.png`);
        const title = median(data, [[520, 130, 1050, 205]]);
        const type = median(data, [[620, 1200, 1100, 1275]]);
        // The text box's lower-left quarter: clear of a basic land's symbol.
        const text = median(data, [[160, 1640, 460, 1880]]);
        for (const [name, got] of [["title", title], ["type", type], ["text", text]] as const) {
          // (The table's means are the regions' inter-quartile cores; the
          // median of one strip of a shaded bar sits within 14 levels of it.
          // Untoned, the white bars are 21–27 levels off, the gold ones 15–55.)
          got.forEach((v, c) => expect(Math.abs(v - tones[master][name].to[c]), `${template}/${key} ${name} ${got.map(Math.round)} vs ${tones[master][name].to}`).toBeLessThanOrEqual(14));
        }
      }
    }
    // The white frame is the prints' — its title bar ≈ 224 luma — not the
    // pack's 249.
    expect(luma(median(await load("modern/w.png"), [[520, 130, 1050, 205]]))).toBeLessThan(232);
  }, 120_000);

  it("the plates are toned: gold's face is the prints' ochre, not the pack's pale yellow", async () => {
    const { data, info } = await sharp(bucketMaster("modern/pt/m.png")!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([322, 176]);
    const i = (88 * info.width + 70) * 4;
    const face = [data[i], data[i + 1], data[i + 2]];
    const want = (EIGHTH_PLATE_TONES as Record<string, Tone>).m.to;
    face.forEach((v, c) => expect(Math.abs(v - want[c]), `gold plate ${face}`).toBeLessThanOrEqual(14));
  }, 60_000);
});
