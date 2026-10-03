import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  CC_COMMIT,
  CC_OVERLAY_BANDS,
  CORNER_RADIUS,
  CROWN_BAND,
  CROWN_BAND_KEYS,
  OUT_H,
  OUT_W,
  compositeLayers,
  crownBandFindings,
  crownBandRecipe,
  crownBandSourceFiles,
  describeCrownBand,
  placeOnCanvas,
  rectPx,
  toRgba8,
} from "@/scripts/lib/cc-frames.mjs";
import { PAIR_RAMPS, TWO_COLOR_PAIRS, lerpLayers, rampMask } from "@/scripts/lib/pair-ramp.mjs";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { M15_CROWN, getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.6a — the legendary crown band (scripts/lib/cc-frames.mjs
// CC_OVERLAY_BANDS.m15crown, built by scripts/import-cc-frames.mjs
// `--only m15crown`; design 2026-09-29 §1.1): CC's M15 'Legend Crowns (New)'
// over the black 'Legend Crown Border Cover', composited at 2010 × 2814,
// downscaled once, the card corner cut, cropped to rows 0–409 — the overlay
// the m15 / m15artifact / m15land profiles stretch over the top 410 / 2100
// of the card (M15_CROWN). A pair's crown is the first colour's crown lerped
// into the second's through the UNTILTED crown ramp (45→55 %W), in printed
// order. The published bands' own pixels are checked when a local copy at
// the manifest's sha256 is on disk (FRAMES_BUILD_DIR, else .frames-build;
// CI fetches them).
// ---------------------------------------------------------------------------

type Entry = { sha256: string; width: number; height: number };
const files = (manifestJson as { files: Record<string, Entry> }).files;
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");

const solidCanvas = (w: number, h: number, rgba: [number, number, number, number]) => {
  const buf = Buffer.alloc(w * h * 4);
  for (let p = 0; p < w * h; p += 1) buf.set(rgba, p * 4);
  return buf;
};

describe("the crown band's recipe", () => {
  it("builds CC's nine crown letters and the ten pairs in printed order — the profile slot's keys", () => {
    expect(CROWN_BAND_KEYS).toEqual(["w", "u", "b", "r", "g", "m", "a", "l", "c", ...TWO_COLOR_PAIRS]);
    expect(CC_OVERLAY_BANDS.m15crown.keys).toEqual(CROWN_BAND_KEYS);
    // The one slot the profiles draw lists exactly what the importer builds.
    expect([...M15_CROWN.keys]).toEqual(CROWN_BAND_KEYS);
  });

  it("places the crown 1:1 at CC's bounds on the 2010 × 2814 card, over a 137-row black cover", () => {
    const { width, height } = CROWN_BAND.compositeSize;
    expect(rectPx(CROWN_BAND.crown, width, height)).toEqual({ x: 44, y: 53, width: 1922, height: 493 });
    expect(rectPx(CROWN_BAND.cover, width, height)).toEqual({ x: 0, y: 0, width: 2010, height: 137 });
  });

  it("a mono key is its crown letter; a pair is the first colour left, lerped into the second through 45→55 %W", () => {
    expect(crownBandRecipe("w")).toEqual({
      cover: "img/black.png",
      left: "img/frames/m15/crowns/new/w.png",
      right: null,
      ramp: null,
    });
    expect(crownBandRecipe("l").left).toBe("img/frames/m15/crowns/new/l.png");
    expect(crownBandRecipe("ur")).toEqual({
      cover: "img/black.png",
      left: "img/frames/m15/crowns/new/u.png",
      right: "img/frames/m15/crowns/new/r.png",
      ramp: [45, 55],
    });
    expect(PAIR_RAMPS.crown).toEqual([45, 55]);
    expect(() => crownBandRecipe("uw")).toThrow();
    expect(() => crownBandRecipe("x")).toThrow();
    expect(describeCrownBand(crownBandRecipe("gu"))).toEqual([
      "img/black.png over 0/0/100×4.87 %",
      "img/frames/m15/crowns/new/g.png ⟷ img/frames/m15/crowns/new/u.png lerped through procedural:ramp(45→55 %W) at 2.19/1.88/95.62×17.52 %",
    ]);
    expect(crownBandSourceFiles()).toEqual([
      "img/black.png",
      ...["a", "b", "c", "g", "l", "m", "r", "u", "w"].map((k) => `img/frames/m15/crowns/new/${k}.png`),
    ]);
  });

  it("composites a pair split at the ramp, untilted, with the shared crown shadow kept single", () => {
    const W = 100;
    const H = 4;
    const box = { x: 0, y: 0, width: W, height: H };
    const left = placeOnCanvas(solidCanvas(W, H, [255, 0, 0, 255]), box, W, H);
    const right = placeOnCanvas(solidCanvas(W, H, [0, 0, 255, 255]), box, W, H);
    const crown = lerpLayers(left, right, rampMask(W, H, PAIR_RAMPS.crown as [number, number]));
    const cover = solidCanvas(W, H, [0, 0, 0, 0]);
    const out = toRgba8(compositeLayers([{ data: cover }, { data: crown }], W, H));
    const at = (x: number, y: number) => [...out.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)];
    for (const y of [0, H - 1]) {
      expect(at(40, y)).toEqual([255, 0, 0, 255]); // left of 45 %W: the first colour
      expect(at(60, y)).toEqual([0, 0, 255, 255]); // right of 55 %W: the second
      expect(at(49, y)[0]).toBeGreaterThan(100); // the middle blends
      expect(at(49, y)[2]).toBeGreaterThan(100);
    }
    // A translucent shadow (both crowns α 99) stays α 99 through the split —
    // CC's stacking would raise it (α 160 on the prints' measure).
    const shade = (rgb: [number, number, number]) => placeOnCanvas(solidCanvas(W, H, [...rgb, 99]), box, W, H);
    const shadow = lerpLayers(shade([0, 0, 0]), shade([0, 0, 0]), rampMask(W, H, PAIR_RAMPS.crown as [number, number]));
    for (let x = 0; x < W; x += 1) expect(shadow[x * 4 + 3], `x ${x}`).toBe(99);
  });

  it("finds the band's extent, its peak and what it lays over the art", () => {
    const W = 20;
    const H = 30;
    const buf = Buffer.alloc(W * H * 4);
    const paint = (x: number, y: number, rgba: [number, number, number, number]) => buf.set(rgba, (y * W + x) * 4);
    for (let y = 0; y < 3; y += 1) for (let x = 0; x < W; x += 1) paint(x, y, [0, 0, 0, 255]); // cover
    paint(10, 3, [200, 190, 150, 255]); // the crown's peak at the centre column
    paint(5, 12, [0, 0, 0, 40]); // a shadow inside the art slot
    const f = crownBandFindings(buf, W, H, 20, { topPct: 33.4, leftPct: 0, widthPct: 100, heightPct: 50 });
    expect(f).toMatchObject({ lastAlphaRow: 12, peakRow: 3, artMaxAlpha: 40 });
    expect(f.artPartialPct).toBeCloseTo((1 / (20 * 15)) * 100, 5);
  });
});

describe("the crown slot the profiles draw (M15_CROWN)", () => {
  it("stretches the 1500 × 410 band over exactly rows 0–409 of the card", () => {
    expect(M15_CROWN.rect).toEqual({ topPct: 0, leftPct: 0, widthPct: 100, heightPct: (CROWN_BAND.rows / OUT_H) * 100 });
    expect((M15_CROWN.rect.heightPct / 100) * 2100).toBeCloseTo(410, 9);
    expect(CROWN_BAND.rows).toBe(410);
    expect(M15_CROWN.assetPathTemplate).toBe("/frames/m15crown/{key}.png");
  });

  it("is on the m15, m15artifact and m15land entries — and the snow pair since 4.6f wave 2c — remapping a colourless card's key", () => {
    expect(getFrameProfile("m15").overlays).toEqual([M15_CROWN]);
    expect(getFrameProfile("m15artifact").overlays).toEqual([{ ...M15_CROWN, keyMap: { c: "a" } }]);
    expect(getFrameProfile("m15land").overlays).toEqual([{ ...M15_CROWN, keyMap: { c: "l" } }]);
    // The snow frames share the band (the snow pack's title bar sits where
    // the M15 pack's does): a colourless snow card's master is CC's snow
    // ARTIFACT frame, so its crown is the artifact silver; a colourless snow
    // land's the land grey, as on m15land.
    expect(getFrameProfile("m15snow").overlays).toEqual([{ ...M15_CROWN, keyMap: { c: "a" } }]);
    expect(getFrameProfile("m15snowland").overlays).toEqual([{ ...M15_CROWN, keyMap: { c: "l" } }]);
    // Nothing else reads the band (the borderless frames and extended art
    // draw the floating crown; devoid draws none).
    expect(FRAME_TEMPLATE_VALUES.filter((t) => (getFrameProfile(t).overlays ?? []).some((o) => o.assetPathTemplate === M15_CROWN.assetPathTemplate))).toEqual(
      ["m15", "m15land", "m15artifact", "m15snow", "m15snowland"],
    );
  });
});

describe("published to the frames bucket", () => {
  it("lists every band key, PNG and WebP, at 1500 × 410", () => {
    for (const key of CROWN_BAND_KEYS) {
      for (const ext of ["png", "webp"]) {
        const entry = files[`m15crown/${key}.${ext}`];
        expect(entry, `m15crown/${key}.${ext}`).toBeDefined();
        expect([entry.width, entry.height], `m15crown/${key}.${ext}`).toEqual([OUT_W, CROWN_BAND.rows]);
      }
    }
    // Nothing else under the folder.
    expect(Object.keys(files).filter((k) => k.startsWith("m15crown/")).length).toBe(CROWN_BAND_KEYS.length * 2);
  });

  it("records its provenance: the pinned commit, the pack, every key's recipe and source files", () => {
    const provenance = JSON.parse(fs.readFileSync("lib/cards/frame-sources.json", "utf8")).m15crown;
    expect(provenance).toMatchObject({
      source: "cardconjurer",
      commit: CC_COMMIT,
      kind: "overlay",
      pack: CC_OVERLAY_BANDS.m15crown.pack,
      output: `1500x410 overlay band: rows 0–409 of a 1500x2100 card composited at 2010x2814, corners rounded to ${CORNER_RADIUS}px, webp q90`,
      sourceFiles: crownBandSourceFiles(),
      notes: CC_OVERLAY_BANDS.m15crown.notes,
    });
    expect(Object.keys(provenance.colors)).toEqual(CROWN_BAND_KEYS);
    for (const key of CROWN_BAND_KEYS) expect(provenance.colors[key], key).toEqual(describeCrownBand(crownBandRecipe(key)));
  });

  // The published bands' own pixels, when a copy at the manifest's sha256 is
  // on disk (CI: FRAMES_BUILD_DIR from scripts/frames-fetch.mjs).
  const local = CROWN_BAND_KEYS.flatMap((key) => {
    const rel = `m15crown/${key}.png`;
    const file = path.join(BUILD, rel);
    if (!files[rel] || !fs.existsSync(file)) return [];
    const sha = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    return sha === files[rel].sha256 ? [{ key, file }] : [];
  });
  const m15Art = getFrameProfile("m15").artSlot;
  if (local.length === 0) {
    it.skip("the published bands' pixels (no local copy; set FRAMES_BUILD_DIR)", () => {});
  }
  // A pair band's split, measured the way the prints were (the 4.6 review,
  // 2026-09-29): each pixel of rows 4.42–4.66 %H de-shaded against the SAME
  // pixel of its two single-colour bands — the share s that best explains
  // it as (1 − s)·left + s·right, so the crown's own shading cancels — and
  // the first x where the share reaches 10 / 50 / 90 %. The prints, measured
  // the same way against their own single-colour crowns: 45.5 / 49.3 / 53.6
  // %W (FDN #122 #123 #115 #651 #126 #119 #245, MKM #238, gold) and 46.4 /
  // 49.4 / 53.6 (TLA ×9, hybrid). The first bands (43→55: 44.2 / 49.0 /
  // 53.8) missed the hybrid prints' 10 % point by 2.2.
  const byKey = new Map(local.map((entry) => [entry.key, entry.file]));
  const pairsHere = TWO_COLOR_PAIRS.filter((pair) => byKey.has(pair) && byKey.has(pair[0]!) && byKey.has(pair[1]!));
  if (pairsHere.length === 0) {
    it.skip("the published pair bands' split (no local copy; set FRAMES_BUILD_DIR)", () => {});
  }
  for (const pair of pairsHere) {
    it(`m15crown/${pair}: splits where the crowned prints do (de-shaded, ±1.0 %W of the gold and hybrid medians)`, async () => {
      const raw = async (key: string) =>
        (await sharp(byKey.get(key)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data;
      const [both, left, right] = await Promise.all([raw(pair), raw(pair[0]!), raw(pair[1]!)]);
      const y0 = Math.floor((4.42 / 100) * OUT_H);
      const y1 = Math.floor((4.66 / 100) * OUT_H);
      const num = new Float64Array(OUT_W);
      const den = new Float64Array(OUT_W);
      for (let y = y0; y <= y1; y += 1) {
        for (let x = 0; x < OUT_W; x += 1) {
          const o = (y * OUT_W + x) * 4;
          if (both[o + 3] < 251 || left[o + 3] < 251 || right[o + 3] < 251) continue;
          let dot = 0;
          let n2 = 0;
          for (let c = 0; c < 3; c += 1) {
            const d = right[o + c] - left[o + c];
            dot += (both[o + c] - left[o + c]) * d;
            n2 += d * d;
          }
          if (n2 < 144) continue; // the two crowns alike here: no reading
          num[x] += dot;
          den[x] += n2;
        }
      }
      const at = [0.1, 0.5, 0.9].map((level) => {
        for (let x = Math.round(0.3 * OUT_W); x < Math.round(0.7 * OUT_W); x += 1) {
          if (den[x] > 0 && num[x] / den[x] >= level) return ((x + 0.5) / OUT_W) * 100;
        }
        return NaN;
      });
      for (const prints of [
        [45.5, 49.3, 53.6],
        [46.4, 49.4, 53.6],
      ]) {
        at.forEach((x, i) =>
          expect(Math.abs(x - prints[i]!), `${pair} ${[10, 50, 90][i]} %: ${x.toFixed(2)} vs ${prints[i]}`).toBeLessThanOrEqual(1.0),
        );
      }
    });
  }

  for (const { key, file } of local) {
    it(`m15crown/${key}: black cover, the crown's peak at row 42 ± 2, only a shadow over the art, corners cut`, async () => {
      const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect([info.width, info.height]).toEqual([OUT_W, CROWN_BAND.rows]);
      // Findings on the band placed on a full card (the rows below are empty).
      const full = Buffer.alloc(OUT_W * OUT_H * 4);
      data.copy(full, 0);
      const f = crownBandFindings(full, OUT_W, OUT_H, CROWN_BAND.rows, m15Art);
      expect(Math.abs(f.peakRow - 42), `peak row ${f.peakRow}`).toBeLessThanOrEqual(2);
      expect(f.artMaxAlpha, "never opaque over the art").toBeLessThan(128);
      // The cover: opaque black across the top edge (away from the corners).
      for (const x of [100, 750, 1400]) {
        const o = (2 * OUT_W + x) * 4;
        expect([data[o], data[o + 1], data[o + 2], data[o + 3]], `x ${x}`).toEqual([0, 0, 0, 255]);
      }
      // The one card corner is cut: the very corner pixels are clear.
      expect(data[3]).toBe(0);
      expect(data[(OUT_W - 1) * 4 + 3]).toBe(0);
    });
  }
});
