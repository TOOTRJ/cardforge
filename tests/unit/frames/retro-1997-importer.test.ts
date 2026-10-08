import fs from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { frameManifestEntry } from "@/lib/frames/frame-url";
import { CC_TEMPLATES, RETRO_GOLD_MSE, SEVENTH_RECIPE_OF, builtColors, describePrintRecipe, seventhPrintRecipe, sourceFilesFor } from "@/scripts/lib/cc-frames.mjs";
import { cutMaps, stretchRange } from "@/scripts/lib/print-cut.mjs";
import {
  GOLD_TEXT_BOX,
  MSE_GOLD_EDGES,
  PRINT_EDGES_1997,
  SEVENTH_BOX_BY_COLOUR,
  SEVENTH_EDGES,
  SEVENTH_TEXT_BOX,
  SEVENTH_TONES,
  printEdgesFor,
  retroGoldCut,
  seventhCut,
  seventhDrawnRegions,
} from "@/scripts/lib/seventh-1997.mjs";
import { bucketMaster, haveBucketMasters } from "@/tests/stubs/bucket-masters";

// ---------------------------------------------------------------------------
// The 1997 frame's recipes (TODO 4.10a, layout v46; scripts/lib/seventh-1997
// .mjs, built by scripts/import-cc-frames.mjs): Card Conjurer's Seventh
// drawing re-cut edge by edge and toned region by region onto the ORIGINAL
// cards of 1996–2003; gold from the MSE artwork, cut with the same edge map.
// The recipe half runs everywhere; the master half reads the published
// masters (FRAMES_BUILD_DIR, else .frames-build; CI fetches them) and skips
// without them.
// ---------------------------------------------------------------------------

const KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;
const TEMPLATES = ["retro", "retroland"] as const;
const W = 1500;
const H = 2100;
type Tone = { from: number[]; to: number[]; k?: number };
const tones = SEVENTH_TONES as Record<string, Record<string, Tone>>;
const boxes = SEVENTH_TEXT_BOX as Record<string, number[]>;
const SIDES = ["L", "T", "R", "B"];
const BEVELS = [...SIDES.map((s) => `obevel${s}`), ...SIDES.map((s) => `abevel${s}`)];
const TRIMS = SIDES.map((s) => `trim${s}`);

describe("the 1997 recipes", () => {
  it("builds seven keys per template: Seventh's drawing for thirteen, the MSE gold for retro/m", () => {
    for (const template of TEMPLATES) {
      const def = (CC_TEMPLATES as unknown as Record<string, { colors: Record<string, { src: string }[]>; printRecipe: (k: string) => unknown }>)[template];
      expect(builtColors(def as never).sort()).toEqual([...KEYS].sort());
      for (const key of KEYS) expect(def.printRecipe(key), `${template}/${key}`).toEqual(seventhPrintRecipe(template, key));
    }
    expect(SEVENTH_RECIPE_OF.retro).toEqual({ w: "w", u: "u", b: "b", r: "r", g: "g", c: "a", m: null });
    expect(SEVENTH_RECIPE_OF.retroland).toEqual({ w: "wl", u: "ul", b: "bl", r: "rl", g: "gl", c: "l", m: "ml" });
    const retro = (CC_TEMPLATES as unknown as Record<string, { colors: Record<string, { src: string }[]> }>).retro;
    // `c` is the pack's ARTIFACT frame (its c.png is MH3's 2024 colourless).
    expect(retro.colors.c.map((l) => l.src)).toEqual(["img/frames/seventh/regular/a.png"]);
    // Gold: a file of THIS repo (MSE-derived, so it may live in git).
    expect(retro.colors.m.map((l) => l.src)).toEqual([RETRO_GOLD_MSE]);
    expect(RETRO_GOLD_MSE).toBe("repo:scripts/frame-inputs/retro-m-mse.png");
    expect(fs.existsSync("scripts/frame-inputs/retro-m-mse.png")).toBe(true);
    expect(sourceFilesFor(retro as never)).toContain(RETRO_GOLD_MSE);
    // The land's rings come from the pack's Pinline mask.
    expect(sourceFilesFor((CC_TEMPLATES as Record<string, unknown>).retroland as never)).toContain("img/frames/seventh/regular/pinline.svg");
    expect(() => seventhPrintRecipe("modern", "w")).toThrow(/no 1997 master/);
  });

  it("re-cuts PER KEY: outer frame and art window on the white prints' edges for every key, the text box on the key's own", () => {
    for (const [key, box] of Object.entries(boxes)) {
      const cut = seventhCut(key);
      const target = printEdgesFor(box);
      const byFrom = (anchors: number[][]) => new Map(anchors.map(([from, to]) => [from, to]));
      const y = byFrom(cut.y);
      const upper = byFrom(cut.xUpper);
      const lower = byFrom(cut.xLower);
      // Shared by every colour (the prints' outer frame and art window are).
      for (const [edge, map] of [
        ["outer-T", y],
        ["art-T", y],
        ["art-B", y],
        ["outer-B", y],
        ["outer-L", upper],
        ["art-L", upper],
        ["art-R", upper],
        ["outer-R", upper],
        ["outer-L", lower],
        ["outer-R", lower],
      ] as const) {
        expect(map.get(SEVENTH_EDGES[edge]), `${key} ${edge}`).toBeCloseTo(PRINT_EDGES_1997[edge], 2);
      }
      // The key's own text box.
      expect(lower.get(SEVENTH_EDGES["text-L"]), key).toBeCloseTo(target["text-L"], 2);
      expect(lower.get(SEVENTH_EDGES["text-R"]), key).toBeCloseTo(target["text-R"], 2);
      expect(y.get(SEVENTH_EDGES["text-T"]), key).toBeCloseTo(target["text-T"], 2);
      expect(y.get(SEVENTH_EDGES["text-B"]), key).toBeCloseTo(target["text-B"], 2);
      // The maps exist (anchors keep their order) and stretch the drawing
      // only locally: 0.88–1.16 anywhere (the strips beside green's narrow
      // plank and black's wide parchment are the extremes).
      const maps = cutMaps(cut, W, H);
      expect(maps.srcY).toHaveLength(H);
      for (const anchors of [cut.y, cut.xUpper, cut.xLower]) {
        const { min, max } = stretchRange(anchors);
        expect(min, key).toBeGreaterThan(0.88);
        expect(max, key).toBeLessThan(1.16);
      }
    }
    // The boxes differ by colour — why one scale per axis was not enough:
    // blue's top 6.6 px below white's, red's bottom 6.5 px above, green's
    // plank 24.2 px narrower.
    expect(boxes.u[2] - boxes.w[2]).toBeCloseTo(6.6, 6);
    expect(boxes.r[3] - boxes.w[3]).toBeCloseTo(-6.5, 6);
    expect(boxes.g[0] - boxes.g[1]).toBeCloseTo(24.2, 6);
    // The art window every key ends up with: 175–1326 × 208–1136 (the
    // profile's slot covers it, tests/unit/render/art-window-coverage).
    expect([PRINT_EDGES_1997["art-L"], PRINT_EDGES_1997["art-R"], PRINT_EDGES_1997["art-T"], PRINT_EDGES_1997["art-B"]].map(Math.round)).toEqual([175, 1326, 208, 1136]);
  });

  it("cuts the MSE gold onto the same outer frame and art window, and onto the gold prints' own box", () => {
    const cut = retroGoldCut();
    const gold = printEdgesFor(GOLD_TEXT_BOX);
    const to = (anchors: number[][], from: number) => anchors.find(([f]) => f === from)![1];
    for (const edge of ["outer-T", "art-T", "art-B", "outer-B"] as const) expect(to(cut.y, MSE_GOLD_EDGES[edge]), edge).toBeCloseTo(PRINT_EDGES_1997[edge], 2);
    for (const edge of ["outer-L", "art-L", "art-R", "outer-R"] as const) expect(to(cut.xUpper, MSE_GOLD_EDGES[edge]), edge).toBeCloseTo(PRINT_EDGES_1997[edge], 2);
    expect(to(cut.y, MSE_GOLD_EDGES["text-T"])).toBeCloseTo(gold["text-T"], 2);
    expect(to(cut.y, MSE_GOLD_EDGES["text-B"])).toBeCloseTo(gold["text-B"], 2);
    expect(to(cut.xLower, MSE_GOLD_EDGES["text-R"])).toBeCloseTo(gold["text-R"], 2);
    // Every edge of the MSE master moves by its own amount (2–7 px): the
    // per-axis fallback left its art bottom 4 px off.
    const moves = (["outer-L", "outer-R", "art-L", "art-R", "outer-T", "outer-B", "art-T", "art-B"] as const).map((e) => PRINT_EDGES_1997[e] - MSE_GOLD_EDGES[e]);
    expect(Math.max(...moves) - Math.min(...moves)).toBeGreaterThan(8);
    // Not toned (MSE's gold is the prints' colour); its cut corners are
    // flattened before the move, and the white window's fade on the art
    // ring's last px is cleared after it.
    expect(seventhPrintRecipe("retro", "m")).toEqual({ cut, squareCorners: true, windowHalo: 6 });
    expect(describePrintRecipe(seventhPrintRecipe("retro", "m"))).toHaveProperty("windowHalo");
    expect(describePrintRecipe(seventhPrintRecipe("retro", "m"))).not.toHaveProperty("tones");
  });

  it("tones every region of every key: mean and contrast in the body and the text box, a gain per bevel side; no trim where the box has no outline; rings on the lands", () => {
    expect(Object.keys(tones).sort()).toEqual(Object.keys(boxes).sort());
    const drawn = Object.keys(seventhDrawnRegions());
    expect(drawn.sort()).toEqual(["body", "text", ...BEVELS, ...TRIMS].sort());
    for (const [key, table] of Object.entries(tones)) {
      const land = key.endsWith("l");
      const byColour = (SEVENTH_BOX_BY_COLOUR as readonly string[]).includes(key);
      const want = ["body", "text", ...BEVELS, ...(byColour ? [] : TRIMS), ...(land ? ["pin"] : [])];
      expect(Object.keys(table).sort(), key).toEqual(want.sort());
      // Mean AND contrast where the texture lives.
      for (const name of ["body", "text"]) {
        expect(table[name].k, `${key} ${name}`).toBeGreaterThan(0.5);
        expect(table[name].k, `${key} ${name}`).toBeLessThan(1.1);
      }
      for (const name of BEVELS) expect(table[name].k, `${key} ${name}`).toBeUndefined();
      for (const [name, tone] of Object.entries(table)) {
        for (const v of [...tone.from, ...tone.to]) {
          expect(v, `${key} ${name}`).toBeGreaterThanOrEqual(0);
          expect(v, `${key} ${name}`).toBeLessThanOrEqual(255);
        }
      }
    }
    expect([...SEVENTH_BOX_BY_COLOUR]).toEqual(["g", "b"]);
    // The pack's colours are the 2021+ reprints': the white frame's body
    // comes DOWN from 220 to the originals' 168 luma, the black frame's goes
    // UP (× 1.2–1.8 as a gain — the reason the tone has an offset).
    const luma = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    expect(luma(tones.w.body.from)).toBeGreaterThan(215);
    expect(luma(tones.w.body.to)).toBeCloseTo(168.9, 0);
    expect(tones.b.body.to[1] / tones.b.body.from[1]).toBeGreaterThan(1.7);
    // A coloured land's rings and trim are flat colour: toned by an OFFSET
    // (k = 1), since a gain on a channel near 0 multiplies its noise (the
    // green ring's red channel is 5 in the pack and 130 on the prints).
    for (const key of ["wl", "ul", "bl", "rl", "gl"]) {
      expect(tones[key].pin.k, key).toBe(1);
      for (const name of TRIMS) expect(tones[key][name].k, `${key} ${name}`).toBe(1);
    }
    expect(tones.gl.pin.from[0]).toBe(5);
    // The stand-in land: the plain land's frame, the gold prints' box.
    expect(tones.ml.body).toEqual(tones.l.body);
    expect(tones.ml.pin).toEqual(tones.l.pin);
    expect(tones.ml.text).not.toEqual(tones.l.text);
  });

  it("records every recipe in lib/cards/frame-sources.json: the anchors, the local stretch and each region's tone", () => {
    const sources = JSON.parse(fs.readFileSync("lib/cards/frame-sources.json", "utf8")) as Record<string, { printRecipe: Record<string, unknown>; sourceFiles: string[]; pack: string; notes: string[] }>;
    for (const template of TEMPLATES) {
      const entry = sources[template];
      expect(Object.keys(entry.printRecipe).sort(), template).toEqual([...KEYS].sort());
      for (const key of KEYS) expect(entry.printRecipe[key], `${template}/${key}`).toEqual(JSON.parse(JSON.stringify(describePrintRecipe(seventhPrintRecipe(template, key)))));
      expect(entry.notes.join(" ")).toMatch(/ORIGINAL cards \(Mirage 1996 → Scourge 2003\)/);
    }
    expect(sources.retro.sourceFiles).toContain(RETRO_GOLD_MSE);
    expect(sources.retro.notes.join(" ")).toMatch(/blue is a flat-shaded redraw.*green's plank has no grain.*black's parchment keeps a burnt rim/);
  });

  it("lives in the frames bucket and nowhere in git: no public/frames copy, off the MSE builder", () => {
    for (const template of TEMPLATES) {
      expect(fs.existsSync(`public/frames/${template}`), template).toBe(false);
      for (const key of KEYS) {
        for (const ext of ["png", "webp"]) {
          const entry = frameManifestEntry(`/frames/${template}/${key}.${ext}`);
          expect(entry, `${template}/${key}.${ext}`).not.toBeNull();
          expect([entry!.width, entry!.height]).toEqual([W, H]);
        }
      }
    }
    const builder = fs.readFileSync("scripts/build-era-frames.mjs", "utf8");
    expect(builder).not.toMatch(/out: "public\/frames\/retro/);
  });
});

// The published masters themselves.
const MASTER_KEYS = TEMPLATES.flatMap((t) => KEYS.map((k) => `${t}/${k}.png`));
const have = haveBucketMasters(MASTER_KEYS);
describe.skipIf(!have)("the published 1997 masters (frames bucket)", () => {
  const load = async (key: string) => {
    const { data } = await sharp(bucketMaster(key)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return data;
  };
  const at = (data: Buffer, x: number, y: number) => [...data.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)];

  it("every key of both templates has ONE art window, the prints': 175–1326 × 208–1136 px (gold within a pixel)", async () => {
    for (const key of MASTER_KEYS) {
      const data = await load(key);
      const clearRow = Array.from({ length: W }, (_, x) => at(data, x, 600)[3] < 128);
      const clearCol = Array.from({ length: H }, (_, y) => at(data, 750, y)[3] < 128);
      const box = [clearRow.indexOf(true), clearRow.lastIndexOf(true) + 1, clearCol.indexOf(true), clearCol.lastIndexOf(true) + 1];
      const tolerance = key === "retro/m.png" ? 1 : 0;
      [175, 1326, 208, 1136].forEach((want, i) => expect(Math.abs(box[i] - want), `${key} window ${box}`).toBeLessThanOrEqual(tolerance));
      // The slot both renderers paint the art in covers it.
      const slot = getFrameProfile(key.split("/")[0] as "retro").artSlot;
      expect((slot.leftPct / 100) * W).toBeLessThan(box[0]);
      expect(((slot.leftPct + slot.widthPct) / 100) * W).toBeGreaterThan(box[1]);
      expect((slot.topPct / 100) * H).toBeLessThan(box[2]);
      expect(((slot.topPct + slot.heightPct) / 100) * H).toBeGreaterThan(box[3]);
    }
  }, 120_000);

  it("is toned onto the prints: each key's frame body and text box sit on the table's print means", async () => {
    // The table's means are the regions' inter-quartile cores; the median
    // over four strips of a marbled body sits within 14 levels a channel of
    // it, the flat text box's within 8. (Untoned, the white body is 47 / 52 /
    // 56 levels off.)
    const BODY_TOLERANCE = 14;
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
        const recipe = SEVENTH_RECIPE_OF[template][key];
        if (!recipe) continue;
        const data = await load(`${template}/${key}.png`);
        // The frame's two side strips, title band and type band (a marbled
        // frame is not one colour: the median of four strips), and the
        // text box's lower-left corner (clear of a basic land's symbol and
        // of every line).
        const body = median(data, [
          [100, 300, 138, 1900],
          [1364, 300, 1402, 1900],
          [300, 100, 1200, 180],
          [300, 1168, 1200, 1240],
        ]);
        const text = median(data, [[230, 1700, 430, 1820]]);
        body.forEach((v, c) => expect(Math.abs(v - tones[recipe].body.to[c]), `${template}/${key} body ${body.map(Math.round)}`).toBeLessThanOrEqual(BODY_TOLERANCE));
        // (The stand-in land's gold box is clouded: one corner is not its mean.)
        if (recipe !== "ml") text.forEach((v, c) => expect(Math.abs(v - tones[recipe].text.to[c]), `${template}/${key} text ${text.map(Math.round)}`).toBeLessThanOrEqual(8));
      }
    }
    // The white frame is the ORIGINALS' — luma ≈ 168 — not the pack's 220.
    const white = median(await load("retro/w.png"), [[100, 400, 138, 1000]]);
    expect(0.2126 * white[0] + 0.7152 * white[1] + 0.0722 * white[2]).toBeLessThan(180);
  }, 120_000);

  it("keeps the drawing sharp: the outer frame's edge is one or two pixels wide on the Seventh keys", async () => {
    for (const key of ["retro/w.png", "retro/r.png", "retroland/c.png"]) {
      const data = await load(key);
      // From the black border into the frame at row 700: the columns between
      // the last near-black pixel and the first pixel at the line's level.
      const lum = (x: number) => {
        const p = at(data, x, 700);
        return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
      };
      let first = 60;
      while (lum(first) < 12) first += 1;
      // The frame starts at 73 px (the prints' outer-L 72.97).
      expect(Math.abs(first - 73), key).toBeLessThanOrEqual(2);
    }
  }, 60_000);
});
