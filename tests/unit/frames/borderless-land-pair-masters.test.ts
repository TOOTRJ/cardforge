import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";
import {
  BORDERLESS_TINT_POINT,
  BORDERLESS_TITLE_TO_TYPE_DY,
  CC_TEMPLATES,
  TINTED_BOX_STRUCTURE,
  borderlessLandLayers,
  builtColors,
  describeLayer,
  sourceFilesFor,
} from "@/scripts/lib/cc-frames.mjs";
import { PAIR_RAMPS, TWO_COLOR_PAIRS, rampShare, shareCrossings } from "@/scripts/lib/pair-ramp.mjs";
import { frameAnatomyOf, twoColorFits } from "@/lib/cards/anatomy";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { edgeContractFor } from "@/lib/frames/edge-contract";

// ---------------------------------------------------------------------------
// TODO 4.56 — the ten two-colour pair masters of the borderless nonbasic
// land (`m15borderlessland/<pair>.png`): the SAME function as the seven mono
// masters (scripts/lib/cc-frames.mjs borderlessLandLayers) with Card
// Conjurer's grey 'Land Frame' for the bars and a letter PAIR for the box
// and the pinline, each pair lerped across ONE untilted ramp, 39→61 %W
// (PAIR_RAMPS.borderlessLand — measured on the 119 two-colour borderless
// lands that print the tinted look). The recipe, what the profile declares,
// the manifest and provenance, and — with a local copy of the published
// masters at the manifest's sha256 (FRAMES_BUILD_DIR, else .frames-build; CI
// fetches them) — the pixels:
//   • every pixel of a pair master is the grey land master's (`c`: the
//     bars, the bottom bar, the fins) or the two mono masters' premultiplied
//     lerp across the ramp (the ring, the box) — nothing else is drawn;
//   • the #449 lesson: inside the ring no row and no column keeps the grey
//     frame's own brown-grey pinline (that hairline was 1,276 gold px in a
//     row on the borderless spells' first pair masters);
//   • the bars are the colourless land's grey, never the gold `m` bars a
//     stored pair still draws with its switch off;
//   • the split reads 41.2 / 50.0 / 58.8 %W at 10 / 50 / 90 % on every ring
//     and on the box, untilted, the first canonical colour on the left.
// ---------------------------------------------------------------------------

type Entry = { hash: string; sha256: string; bytes: number; width: number; height: number };
const files = (manifestJson as { files: Record<string, Entry> }).files;
const provenance = JSON.parse(fs.readFileSync("lib/cards/frame-sources.json", "utf8")) as Record<
  string,
  { colors: Record<string, string[]>; notes: string[]; transforms?: string; sourceFiles: string[] }
>;
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");

const TEMPLATE = "m15borderlessland";
const W = 1500;
const H = 2100;
const RAMP = [...PAIR_RAMPS.borderlessLand] as [number, number];
const frame = (k: string) => `img/frames/m15/borderless/m15GenericShowcaseFrame${k.toUpperCase()}.png`;
const PINLINE_MASK = "img/frames/m15/genericShowcase/m15GenericShowcaseMaskPinline.png";
const TYPE_MASK = "img/frames/m15/regular/m15MaskType.png";
const RULES_MASK = "img/frames/m15/regular/m15MaskRules.png";

describe("the recipe (borderlessLandLayers with a letter pair)", () => {
  it("is the mono recipe's four layers with the grey L frame for the bars and the pair for the box and the pinline — both across ONE ramp, 39→61 %W", () => {
    expect(PAIR_RAMPS.borderlessLand).toEqual([39, 61]);
    expect(borderlessLandLayers({ frame: "l", box: ["w", "u"], pinline: ["w", "u"] })).toEqual([
      { src: frame("l") },
      { src: frame("l"), mask: TYPE_MASK, replace: true, dy: 1081 },
      {
        src: TINTED_BOX_STRUCTURE.src,
        mask: RULES_MASK,
        replace: true,
        retint: {
          from: [154, 154, 154],
          tintOf: { src: frame("w"), x: 750, y: 160 },
          tintOfRight: { src: frame("u"), x: 750, y: 160 },
          ramp: [39, 61],
        },
      },
      { src: frame("w"), right: frame("u"), ramp: [39, 61], mask: PINLINE_MASK },
    ]);
    expect(BORDERLESS_TITLE_TO_TYPE_DY).toBe(1081);
    expect(BORDERLESS_TINT_POINT).toEqual({ x: 750, y: 160 });
    // A mono land is untouched by the pair's branch: one letter three times,
    // no ramp anywhere.
    const mono = borderlessLandLayers({ frame: "g", box: "g", pinline: "g" });
    expect(mono).toEqual([
      { src: frame("g") },
      { src: frame("g"), mask: TYPE_MASK, replace: true, dy: 1081 },
      { src: TINTED_BOX_STRUCTURE.src, mask: RULES_MASK, replace: true, retint: { from: [154, 154, 154], tintOf: { src: frame("g"), x: 750, y: 160 } } },
      { src: frame("g"), mask: PINLINE_MASK },
    ]);
    expect(JSON.stringify(mono)).not.toMatch(/ramp|right|tintOfRight/);
  });

  it("the first canonical colour on the left, on all ten; the ramp is a copy per layer (never the frozen constant itself)", () => {
    for (const pair of TWO_COLOR_PAIRS) {
      const layers = (CC_TEMPLATES.m15borderlessland.colors as Record<string, unknown>)[pair];
      expect(layers, pair).toEqual(borderlessLandLayers({ frame: "l", box: pair.split(""), pinline: pair.split("") }));
      const [base, typeBar, box, pinline] = layers as Array<{ src: string; right?: string; ramp?: number[]; retint?: { tintOf: { src: string }; tintOfRight?: { src: string }; ramp?: number[] } }>;
      expect(base.src).toBe(frame("l"));
      expect(typeBar.src).toBe(frame("l"));
      expect(box.retint?.tintOf.src).toBe(frame(pair[0]));
      expect(box.retint?.tintOfRight?.src).toBe(frame(pair[1]));
      expect(pinline.src).toBe(frame(pair[0]));
      expect(pinline.right).toBe(frame(pair[1]));
      expect(pinline.ramp).toEqual(RAMP);
      expect(box.retint?.ramp).toEqual(RAMP);
      expect(pinline.ramp).not.toBe(PAIR_RAMPS.borderlessLand);
    }
  });

  it("CC_TEMPLATES builds the ten pairs beside the seven monos and nothing else — no hybrid dress, no crowned twin; provenance records them", () => {
    const def = CC_TEMPLATES.m15borderlessland;
    expect(builtColors(def)).toEqual(["w", "u", "b", "r", "g", "c", "m", ...TWO_COLOR_PAIRS]);
    expect("plates" in def).toBe(false);
    for (const pair of TWO_COLOR_PAIRS) {
      const layers = borderlessLandLayers({ frame: "l", box: pair.split(""), pinline: pair.split("") });
      expect(provenance[TEMPLATE].colors[pair], pair).toEqual(layers.map(describeLayer));
    }
    expect(provenance[TEMPLATE].notes).toEqual(def.notes);
    expect(provenance[TEMPLATE].notes.join(" ")).toMatch(/TODO 4\.56/);
    expect(provenance[TEMPLATE].notes.join(" ")).toMatch(/39→61 %W/);
    expect(provenance[TEMPLATE].transforms).toMatch(/procedural:ramp\(39→61 %W\)/);
  });

  it("provenance names both tints and the ramp; a pair needs no file the monos don't already fetch", () => {
    const [, , box, pinline] = borderlessLandLayers({ frame: "l", box: ["b", "r"], pinline: ["b", "r"] });
    expect(describeLayer(box)).toBe(
      `${TINTED_BOX_STRUCTURE.src} re-tinted from 154,154,154 to the tints of (${frame("b")} at (750, 160) | ${frame("r")} at (750, 160) across procedural:ramp(39→61 %W)) replacing through ${RULES_MASK}`,
    );
    expect(describeLayer(pinline)).toBe(`(${frame("b")} | ${frame("r")} across procedural:ramp(39→61 %W)) through ${PINLINE_MASK}`);
    // The seven pack frames, the box structure and the three masks: the
    // mono masters' own eleven files (the ramp is procedural, no file).
    const sources = sourceFilesFor(CC_TEMPLATES.m15borderlessland);
    expect(sources).toEqual(
      [...["B", "G", "L", "M", "R", "U", "W"].map(frame), TINTED_BOX_STRUCTURE.src, PINLINE_MASK, RULES_MASK, TYPE_MASK].sort(),
    );
    expect(provenance[TEMPLATE].sourceFiles).toEqual(sources);
    // A pair whose box named a tint the list lacks would be fetched too.
    const odd = { colors: { wu: borderlessLandLayers({ frame: "l", box: ["w", "u"], pinline: ["w", "u"] }) } };
    expect(sourceFilesFor(odd as never)).toEqual([frame("L"), frame("U"), frame("W"), TINTED_BOX_STRUCTURE.src, PINLINE_MASK, RULES_MASK, TYPE_MASK].sort());
  });
});

describe("declared and published", () => {
  it("the borderless land declares the split dress, a land's — and no crown, overlay, collector slot or stamp notch", () => {
    const profile = getFrameProfile(TEMPLATE);
    expect(profile.twoColorMasters).toEqual(["split"]);
    expect(profile.twoColorForLands).toBe(true);
    expect(twoColorFits(profile, "land")).toBe(true);
    expect(profile.crownMasters).toBeUndefined();
    expect(profile.overlays).toBeUndefined();
    expect(frameAnatomyOf(TEMPLATE)).toEqual({ crown: false, twoColor: ["split"], collector: false, stamp: false, dfcIcon: false, rulesAlign: true });
    // The spells' frame it spreads keeps its own dresses, and its pairs stay
    // a nonland's.
    expect(getFrameProfile("m15borderless").twoColorMasters).toEqual(["split", "hybrid"]);
    expect(getFrameProfile("m15borderless").twoColorForLands).toBeUndefined();
    // A pair key is held to the template's own edges (no twin contract).
    expect(edgeContractFor(TEMPLATE, "wu")).toBe(edgeContractFor(TEMPLATE, "c"));
  });

  it("every pair master is in the frames bucket, PNG + WebP, 1500 × 2100; the seven monos are the objects 4.34 published", () => {
    for (const pair of TWO_COLOR_PAIRS) {
      for (const ext of ["png", "webp"]) {
        const entry = files[`${TEMPLATE}/${pair}.${ext}`];
        expect(entry, `${TEMPLATE}/${pair}.${ext}`).toBeDefined();
        expect([entry.width, entry.height]).toEqual([W, H]);
      }
    }
    // No other key: no hybrid pair, no crowned twin.
    const keys = Object.keys(files).filter((k) => k.startsWith(`${TEMPLATE}/`) && k.endsWith(".png")).map((k) => k.slice(TEMPLATE.length + 1, -4)).sort();
    expect(keys).toEqual(["w", "u", "b", "r", "g", "c", "m", ...TWO_COLOR_PAIRS].sort());
    // The same importer run rebuilt the monos byte-identical: their hashes
    // are the ones #436 published.
    expect(Object.fromEntries(["w", "u", "b", "r", "g", "c", "m"].map((k) => [k, files[`${TEMPLATE}/${k}.png`].hash]))).toEqual({
      w: "7300c1ebda5f",
      u: "0557e5bd94f3",
      b: "b5e11ca0c6e1",
      r: "8f6925840a60",
      g: "ecd4ee669685",
      c: "2b1d593aff06",
      m: "0049cdc46fb5",
    });
  });
});

// --- the pixels (local build at the manifest's sha) ------------------------

function local(rel: string): Buffer | null {
  const file = path.join(BUILD, rel);
  if (!files[rel] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === files[rel].sha256 ? bytes : null;
}

async function raw(key: string): Promise<Buffer> {
  const { data, info } = await sharp(local(`${TEMPLATE}/${key}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== W || info.height !== H) throw new Error(`${key}: ${info.width}×${info.height}`);
  return data;
}

const NEEDED = ["w", "u", "b", "r", "g", "c", "m", ...TWO_COLOR_PAIRS].map((k) => `${TEMPLATE}/${k}.png`);
const available = NEEDED.every((rel) => local(rel) !== null);

/** The premultiplied lerp of two masters at one pixel across the ramp. */
function lerpAt(A: Buffer, B: Buffer, o: number, x: number): [number, number, number, number] {
  const t = rampShare(((x + 0.5) / W) * 100, RAMP);
  const aa = (A[o + 3] / 255) * (1 - t);
  const ab = (B[o + 3] / 255) * t;
  const alpha = aa + ab;
  const ch = (c: number) => (alpha === 0 ? 0 : (A[o + c] * aa + B[o + c] * ab) / alpha);
  return [ch(0), ch(1), ch(2), alpha * 255];
}

describe.skipIf(!available)("the published borderless land pair masters' pixels (set FRAMES_BUILD_DIR if skipped)", () => {
  it.each([...TWO_COLOR_PAIRS])(
    "%s: every pixel is the grey land master's or its two mono masters' lerp across 39→61 %%W; the ring keeps no row or column of the grey frame's own pinline",
    async (pair) => {
      const [P, C, A, B] = await Promise.all([raw(pair), raw("c"), raw(pair[0]), raw(pair[1])]);
      let unexplained = 0;
      let ring = 0;
      let ringWorst = 0;
      let boxSum = 0;
      let boxWorst = 0;
      let box = 0;
      const rowOff = new Uint32Array(H);
      const colOff = new Uint32Array(W);
      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
          const o = (y * W + x) * 4;
          if (P[o + 3] === 0 && C[o + 3] === 0 && A[o + 3] === 0 && B[o + 3] === 0) continue;
          const L = lerpAt(A, B, o, x);
          const dL = Math.max(Math.abs(P[o] - L[0]), Math.abs(P[o + 1] - L[1]), Math.abs(P[o + 2] - L[2]), Math.abs(P[o + 3] - L[3]));
          const dC = Math.max(Math.abs(P[o] - C[o]), Math.abs(P[o + 1] - C[o + 1]), Math.abs(P[o + 2] - C[o + 2]), Math.abs(P[o + 3] - C[o + 3]));
          if (Math.min(dL, dC) > 3) unexplained += 1;
          // The ring: opaque in all three, where a mono master's pixel is
          // not the grey land's (its pinline, and the outline beside it).
          const opaque = A[o + 3] === 255 && B[o + 3] === 255 && C[o + 3] === 255;
          const differs = (M: Buffer) => Math.max(Math.abs(M[o] - C[o]), Math.abs(M[o + 1] - C[o + 1]), Math.abs(M[o + 2] - C[o + 2])) > 12;
          if (opaque && (differs(A) || differs(B))) {
            ring += 1;
            ringWorst = Math.max(ringWorst, dL);
            if (dL > 8) {
              rowOff[y] += 1;
              colOff[x] += 1;
            }
          }
          // The box's interior (inside its bevels and the ring).
          if (y > 1325 && y < 1925 && x > 125 && x < 1375) {
            box += 1;
            boxSum += dL;
            boxWorst = Math.max(boxWorst, dL);
          }
        }
      }
      // Nothing else is drawn: a handful of anti-aliased pixels at the bar
      // caps of a pair with black (the black frame's outline is a dark grey
      // where every other frame's is pure black) — never a line.
      expect(unexplained, `${pair}: pixels that are neither the grey land's nor the lerp`).toBeLessThanOrEqual(120);
      expect(ring, `${pair}: ring pixels`).toBeGreaterThan(80_000);
      // A hairline of the L frame's ring would be 100+ levels off on 1,000+
      // pixels of ONE row (the #449 gold line: 1,276 px): here no pixel is
      // more than 24 levels off, and no row or column holds more than 24
      // pixels off by more than 8.
      expect(ringWorst, `${pair}: worst ring pixel against the lerp`).toBeLessThanOrEqual(24);
      expect(Math.max(...rowOff), `${pair}: most off-lerp pixels in one row`).toBeLessThanOrEqual(24);
      expect(Math.max(...colOff), `${pair}: most off-lerp pixels in one column`).toBeLessThanOrEqual(24);
      // The box IS the two mono boxes' lerp (the same structure, the same
      // alpha, each colour's title tint).
      expect(box).toBeGreaterThan(700_000);
      expect(boxSum / box, `${pair}: mean |box − lerp|`).toBeLessThanOrEqual(0.5);
      expect(boxWorst, `${pair}: worst box pixel`).toBeLessThanOrEqual(2);
    },
    120_000,
  );

  it("the bars are the colourless land's grey (never the gold `m` bars), the box the two colours' own boxes at each end", async () => {
    const [P, C, M, A, B] = await Promise.all([raw("gw"), raw("c"), raw("m"), raw("g"), raw("w")]);
    const at = (img: Buffer, x: number, y: number) => [...img.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)];
    // The title bar's and the type bar's flat interior, across the split.
    for (const y of [160, 1240]) {
      for (const x of [200, 600, 750, 900, 1300]) {
        expect(at(P, x, y), `bar (${x}, ${y})`).toEqual(at(C, x, y));
        expect(at(P, x, y), `bar (${x}, ${y})`).not.toEqual(at(M, x, y));
      }
    }
    expect(at(C, 750, 160)).toEqual([156, 151, 144, 179]);
    // The box: the green land's box left of the ramp, the white land's
    // right of it (the monos' own pixels), their mean at the centre column.
    expect(at(P, 300, 1600)).toEqual(at(A, 300, 1600));
    expect(at(P, 1200, 1600)).toEqual(at(B, 1200, 1600));
    const mid = at(P, 749, 1600).map((v, c) => Math.abs(v - (at(A, 749, 1600)[c] + at(B, 749, 1600)[c]) / 2));
    expect(Math.max(...mid)).toBeLessThanOrEqual(2);
    // The bottom bar and the fins are the pack's black on every master.
    expect(at(P, 750, 2050)).toEqual([0, 0, 0, 255]);
  }, 60_000);

  it.each([...TWO_COLOR_PAIRS])("%s: the split reads 41.2 / 50.0 / 58.8 %%W on the title ring, the type ring and the box — one untilted ramp, the first canonical colour on the left", async (pair) => {
    const [P, A, B] = await Promise.all([raw(pair), raw(pair[0]), raw(pair[1])]);
    const crossingsAt = (y: number) => {
      const px = (img: Buffer, x: number) => [img[(y * W + x) * 4], img[(y * W + x) * 4 + 1], img[(y * W + x) * 4 + 2]];
      const left = px(P, 300);
      const right = px(P, 1200);
      // The ends are the mono masters' own pixels: the first colour LEFT.
      expect(left, `${pair} row ${y}: left end`).toEqual(px(A, 300));
      expect(right, `${pair} row ${y}: right end`).toEqual(px(B, 1200));
      const d = right.map((v, c) => v - left[c]);
      const n2 = d.reduce((t, v) => t + v * v, 0);
      expect(n2, `${pair} row ${y}: the two colours differ`).toBeGreaterThan(100);
      const shares = Array.from({ length: W }, (_, x) => px(P, x).reduce((t, v, c) => t + (v - left[c]) * d[c], 0) / n2);
      // Only the straight run between the bar's caps is the ramp's.
      return shareCrossings(shares.map((s, x) => (x < 300 ? 0 : x > 1200 ? 1 : s))) as number[];
    };
    // The title bar's top ring, the type bar's top ring, the box's interior.
    const rows = [94, 1175, 1600].map(crossingsAt);
    for (const got of rows) {
      [41.2, 50.0, 58.8].forEach((want, i) => expect(Math.abs(got[i] - want), `${pair}: ${got.map((v) => v.toFixed(2)).join(" / ")}`).toBeLessThanOrEqual(0.25));
    }
    // Untilted: the 50 % point of the title ring and of the box agree.
    expect(Math.abs(rows[0][1] - rows[2][1])).toBeLessThanOrEqual(0.15);
  }, 60_000);
});
