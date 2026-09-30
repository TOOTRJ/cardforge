import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";
import prints from "./fixtures/gold-walker-prints.json";

// ---------------------------------------------------------------------------
// TODO 4.33, owner round 15 (2026-09-29): GOLD = MATCH THE PRINTS. The gold
// (m) borderless walker's title and type faces must sit inside the range the
// mono-gold borderless walker prints set — the 13 exact printings, 26 bars,
// measured from their Scryfall scans into fixtures/gold-walker-prints.json
// (numbers only; no scan or frame is committed). The importer's recipe is
// PW_GOLD_FACE (scripts/lib/cc-frames.mjs); cc-importer.test.ts holds it.
//
// "Inside the range": the face's mean luminance and mean red − blue (how
// gold it reads) within the interquartile range of the prints' per-bar
// means, and its dark and light ends (luma p10 / p90) within the prints'.
// CC's own 'Multicolored Frame' — a flat tan — is outside (the check has
// teeth). The masters are frames-bucket objects, so a built master is
// checked when a local build is present — FRAMES_BUILD_DIR, else
// <repo>/.frames-build — and only when its bytes are the manifest's
// (sha256), as edge-contract.test.ts does.
// ---------------------------------------------------------------------------

type Stats = { mean: number[]; luma: number; lumaP10: number; lumaP90: number; redMinusBlue: number };
const TEMPLATES = ["m15borderlesspw", "m15borderlesspwtall"] as const;
const BARS = ["title", "type"] as const;
const manifest = manifestJson as { files: Record<string, { sha256: string }> };
const BUILD = process.env.FRAMES_BUILD_DIR ?? path.join(process.cwd(), ".frames-build");

/** numpy's default (linear) percentile. */
function percentile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * (q / 100);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** What keeps `s` out of the prints' range — [] when it is inside. */
function outsidePrints(s: Stats): string[] {
  const r = prints.range;
  const out: string[] = [];
  const within = (name: string, v: number, [lo, hi]: number[]) => {
    if (v < lo || v > hi) out.push(`${name} ${v.toFixed(1)} outside ${lo}–${hi}`);
  };
  within("luma", s.luma, r.lumaInterquartile);
  within("red − blue", s.redMinusBlue, r.redMinusBlueInterquartile);
  within("luma p10", s.lumaP10, r.lumaP10Range);
  within("luma p90", s.lumaP90, r.lumaP90Range);
  return out;
}

function builtMaster(template: string): string | null {
  const rel = `${template}/m.png`;
  const file = path.join(BUILD, rel);
  const entry = manifest.files[rel];
  if (!entry || !fs.existsSync(file)) return null;
  const sha = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  return sha === entry.sha256 ? file : null;
}

async function faceStats(file: string, rect: { x: number[]; y: number[] }): Promise<Stats> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const lumas: number[] = [];
  const sum = [0, 0, 0];
  let rb = 0;
  for (let y = rect.y[0]; y < rect.y[1]; y += 1) {
    for (let x = rect.x[0]; x < rect.x[1]; x += 1) {
      const o = (y * info.width + x) * 4;
      const [r, g, b] = [data[o], data[o + 1], data[o + 2]];
      sum[0] += r;
      sum[1] += g;
      sum[2] += b;
      rb += r - b;
      lumas.push(0.299 * r + 0.587 * g + 0.114 * b);
    }
  }
  const n = lumas.length;
  return {
    mean: sum.map((v) => v / n),
    luma: lumas.reduce((a, v) => a + v, 0) / n,
    lumaP10: percentile(lumas, 10),
    lumaP90: percentile(lumas, 90),
    redMinusBlue: rb / n,
  };
}

describe("the gold borderless walker's faces match the prints (TODO 4.33, owner round 15)", () => {
  it("measures every exact mono-gold borderless walker print: 13 printings, both bars each, on their own template", () => {
    const ids = new Set(prints.prints.map((p) => p.printing));
    expect([...ids].sort()).toEqual(
      [
        "blc-100", "frc-1", "iko-278", "med-GR4", "med-WS6", "med-WS8", "mh2-304", "mh2-305",
        "slc-2017", "sld-1184", "sld-1246", "sld-1421", "spg-14",
      ].sort(),
    );
    expect(prints.prints).toHaveLength(26);
    for (const p of prints.prints) {
      // Three or more colours: the gold dress (two-colour walkers print 4.6's split).
      expect(p.colors.length, p.printing).toBeGreaterThanOrEqual(3);
      expect(TEMPLATES as readonly string[]).toContain(p.template);
      // Enough of each bar's face was clear of the text to measure.
      expect(p.n, `${p.printing}/${p.bar}`).toBeGreaterThan(20000);
    }
  });

  it("derives the range from the recorded bars", () => {
    const luma = prints.prints.map((p) => p.luma);
    const rb = prints.prints.map((p) => p.redMinusBlue);
    const r = prints.range;
    expect(r.lumaInterquartile[0]).toBeCloseTo(percentile(luma, 25), 1);
    expect(r.lumaInterquartile[1]).toBeCloseTo(percentile(luma, 75), 1);
    expect(r.redMinusBlueInterquartile[0]).toBeCloseTo(percentile(rb, 25), 1);
    expect(r.redMinusBlueInterquartile[1]).toBeCloseTo(percentile(rb, 75), 1);
    expect(r.lumaP10Range).toEqual([Math.min(...prints.prints.map((p) => p.lumaP10)), Math.max(...prints.prints.map((p) => p.lumaP10))]);
    expect(r.lumaP90Range).toEqual([Math.min(...prints.prints.map((p) => p.lumaP90)), Math.max(...prints.prints.map((p) => p.lumaP90))]);
    // Gold, pale: the prints' faces are warm (red > green > blue) on average.
    for (const p of prints.prints) expect(p.mean[0] >= p.mean[1] && p.mean[1] >= p.mean[2], p.printing).toBe(true);
  });

  it("rejects Card Conjurer's own 'Multicolored Frame' faces — a flat tan, darker and more saturated than any print's range", () => {
    for (const [key, s] of Object.entries(prints.ccMulticolored)) {
      const why = outsidePrints(s);
      expect(why.length, key).toBeGreaterThan(0);
      expect(why.join(" "), key).toMatch(/^luma .* outside/);
    }
  });

  for (const template of TEMPLATES) {
    const file = builtMaster(template);
    it.runIf(file !== null)(`${template}/m: a built master's title and type faces sit inside the prints' range`, async () => {
      for (const bar of BARS) {
        const s = await faceStats(file!, prints.faceRects[template][bar]);
        expect(outsidePrints(s), `${template}/${bar}: ${JSON.stringify(s)}`).toEqual([]);
        // Still gold: warm, and paler than CC's tan.
        expect(s.mean[0] >= s.mean[1] && s.mean[1] >= s.mean[2]).toBe(true);
        expect(s.luma).toBeGreaterThan(prints.ccMulticolored[`${template}/${bar}` as keyof typeof prints.ccMulticolored].luma + 10);
      }
    });
  }
});
