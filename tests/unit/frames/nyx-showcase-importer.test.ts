import fs from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  ADVENTURE_PAPER_REGION,
  ADVENTURE_PAPER_TONES,
  CC_TEMPLATES,
  belowOutlinePlane,
  sourceFilesFor,
  sourceTonesOf,
} from "@/scripts/lib/cc-frames.mjs";
import { NYX_CC_TEXT_BOX_ROWS, NYX_CC_TYPE_BAR_ROWS } from "@/scripts/lib/nyx-tone.mjs";
import { NYX_RIM_TONES } from "@/scripts/lib/nyx-frame.mjs";
import { PREPARE_RECIPE } from "@/scripts/lib/prepare-2026.mjs";
import provenanceJson from "@/lib/cards/frame-sources.json";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { bucketMaster, haveBucketMasters } from "../../stubs/bucket-masters";

// ---------------------------------------------------------------------------
// Layout v74's two corrections (owner 2026-10-28):
//   • TODO 4.26a — the adventure's LEFT page's PAPER toned onto print as the
//     pack file loads (ADVENTURE_PAPER_TONES through sourceTonesOf), inside
//     `bookLeft`, below the type bar's outline and between the page's two
//     outlines — the bars, the curled edge, the spine and `a` untouched, so
//     Prepare's page bars (read from these masters) do not move;
//   • TODO 4.17f — `nyx` re-sourced from Card Conjurer's 'Nyx Showcase' into
//     the frames bucket (out of public/frames/nyx), v37's darkness and v55's
//     rim kept as the recipe's master pass, the type band 4 px up with its
//     bar.
// On the published objects (FRAMES_BUILD_DIR at the manifest's sha256) the
// paper reads print's medians and the masters carry both passes.
// ---------------------------------------------------------------------------

type Entry = { sha256: string; width: number; height: number };
const MANIFEST = (manifestJson as { files: Record<string, Entry> }).files;
const PROVENANCE = provenanceJson as unknown as Record<string, { source?: string; pack?: string; sourceFiles: string[]; masterPass?: string[]; sourceTones?: Record<string, Record<string, string>> }>;
const ADV = "img/frames/adventure/regular";
const NYX = "img/frames/m15/nyxShowcase";

describe("4.26a — the adventure's left-page paper", () => {
  it("tones every coloured master's paper, ≥ 9 levels off print on a channel, and never the artifact frame", () => {
    expect(Object.keys(ADVENTURE_PAPER_TONES).sort()).toEqual(["b", "g", "m", "r", "u", "w"]);
    for (const [key, tone] of Object.entries(ADVENTURE_PAPER_TONES)) {
      expect(Math.max(...tone.to.map((v, c) => Math.abs(v - tone.from[c]))), key).toBeGreaterThanOrEqual(9);
      const file = sourceTonesOf(`${ADV}/${key}.png`);
      expect(file?.masks.paper, key).toBe(`${ADV}/bookLeft.png`);
      expect(file?.clip.paper.belowOutline, key).toBe(ADVENTURE_PAPER_REGION);
      expect(file?.tones.paper, key).toBe(tone);
    }
    expect(sourceTonesOf(`${ADV}/a.png`)).toBeNull();
    // Recorded with the recipe (sourceTones), the mask an importer input.
    expect(sourceFilesFor(CC_TEMPLATES.adventure)).toContain(`${ADV}/bookLeft.png`);
    const recorded = PROVENANCE.adventure!.sourceTones!;
    for (const key of Object.keys(ADVENTURE_PAPER_TONES)) {
      expect(recorded[`${ADV}/${key}.png`]!.table).toBe(`ADVENTURE_PAPER_TONES.${key}`);
      expect(recorded[`${ADV}/${key}.png`]!.paper).toMatch(/through img\/frames\/adventure\/regular\/bookLeft\.png, in columns 97–748 below the outline/);
    }
  });

  it("searches for the type bar's outline below the name bar, across Prepare's bar columns", () => {
    const { cols, rows } = ADVENTURE_PAPER_REGION;
    expect(rows[0]).toBeGreaterThan(PREPARE_RECIPE.bars.name.sourceRows[1]);
    expect(cols[0]).toBeLessThanOrEqual(PREPARE_RECIPE.bars.sourceCols.min);
    expect(cols[1]).toBeGreaterThanOrEqual(PREPARE_RECIPE.bars.sourceCols.max);
  });

  // The bars are untouched, so the published masters find the same outline:
  // the region starts below Prepare's page-bar rows (1323–1493) in every one
  // of its columns (100–729).
  it.runIf(haveBucketMasters(Object.keys(ADVENTURE_PAPER_TONES).map((k) => `adventure/${k}.png`)))(
    "keeps the region off Prepare's page bars on every published master",
    async () => {
      for (const key of Object.keys(ADVENTURE_PAPER_TONES)) {
        const { data } = await sharp(bucketMaster(`adventure/${key}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const plane = belowOutlinePlane(data, 1500, 2100, ADVENTURE_PAPER_REGION);
        const { min, max } = PREPARE_RECIPE.bars.sourceCols;
        for (let x = min; x <= max; x += 1) {
          for (let y = 0; y <= PREPARE_RECIPE.bars.type.sourceRows[1]; y += 1) if (plane[y * 1500 + x]) throw new Error(`${key}: the paper region reaches ${x},${y}`);
        }
      }
    },
    60_000,
  );

  describe("belowOutlinePlane", () => {
    const W = 20;
    const H = 30;
    /** Paper (luma 200) with a dark outline (luma 40) whose bottom row is
     *  10 + (x % 3), and a darker paper speck at 20,5 (never an outline: it
     *  is outside the window). */
    const image = () => {
      const d = new Uint8Array(W * H * 4).fill(200);
      for (let x = 0; x < W; x += 1) {
        for (let y = 7; y <= 10 + (x % 3); y += 1) d.set([40, 40, 40, 255], (y * W + x) * 4);
      }
      return d;
    };
    it("is 255 below each column's outline, inside the columns only", () => {
      const plane = belowOutlinePlane(image(), W, H, { cols: [2, 17], rows: [5, 15], dark: 90 });
      for (let x = 0; x < W; x += 1) {
        for (let y = 0; y < H; y += 1) {
          const want = x >= 2 && x <= 17 && y > 10 + (x % 3) ? 255 : 0;
          expect(plane[y * W + x], `${x},${y}`).toBe(want);
        }
      }
    });
    it("refuses a column with no outline in the window", () => {
      expect(() => belowOutlinePlane(image(), W, H, { cols: [2, 17], rows: [20, 25], dark: 90 })).toThrow(/no outline darker than 90/);
    });
  });

  const keys = Object.keys(ADVENTURE_PAPER_TONES);
  it.runIf(haveBucketMasters(keys.map((k) => `adventure/${k}.png`)))("the published masters' paper reads print's medians", async () => {
    for (const key of keys) {
      const { data } = await sharp(bucketMaster(`adventure/${key}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const ch: number[][] = [[], [], []];
      for (let y = 1540; y < 1900; y += 2) for (let x = 120; x < 700; x += 2) for (let c = 0; c < 3; c += 1) ch[c]!.push(data[(y * 1500 + x) * 4 + c]!);
      const median = ch.map((v) => v.sort((a, b) => a - b)[v.length >> 1]!);
      const to = ADVENTURE_PAPER_TONES[key as keyof typeof ADVENTURE_PAPER_TONES].to;
      for (let c = 0; c < 3; c += 1) expect(Math.abs(median[c]! - to[c]!), `${key} channel ${c}`).toBeLessThanOrEqual(2);
    }
  }, 60_000);
});

describe("4.17f — the Nyx Constellation's masters from Card Conjurer's 'Nyx Showcase'", () => {
  it("draws each colour from the pack (colourless from its artifact frame) with the master pass, and nothing else", () => {
    const def = CC_TEMPLATES.nyx as { colors: Record<string, { src: string }[]>; masterPass?: unknown; transforms?: string; pack?: string };
    expect(Object.keys(def.colors).sort()).toEqual(["b", "c", "g", "m", "r", "u", "w"]);
    for (const key of ["w", "u", "b", "r", "g", "m"]) expect(def.colors[key]!.map((l) => l.src)).toEqual([`${NYX}/${key}.png`]);
    expect(def.colors.c!.map((l) => l.src)).toEqual([`${NYX}/a.png`]);
    expect(typeof def.masterPass).toBe("function");
    expect(def.pack).toMatch(/Nyx Showcase/);
    expect(PROVENANCE.nyx!.source).toBe("cardconjurer");
    expect(PROVENANCE.nyx!.masterPass!.join(" ")).toMatch(/α 150 in the type bar \(rows 1175–1304\) and α 171 in the text box \(rows 1305–2099\)/);
    expect(NYX_CC_TYPE_BAR_ROWS).toEqual([1175, 1305]);
    expect(NYX_CC_TEXT_BOX_ROWS).toEqual([1305, 2100]);
    // The rims: v55's tones, and colourless onto MSE's bronze (the `a` crown's).
    expect(NYX_RIM_TONES.c!.to).toEqual([172, 148, 132]);
  });

  it("lives in the frames bucket only: every key's PNG and WebP in the manifest, none in git", () => {
    for (const key of ["w", "u", "b", "r", "g", "m", "c"]) {
      for (const ext of ["png", "webp"]) {
        const entry = MANIFEST[`nyx/${key}.${ext}`];
        expect(entry, `${key}.${ext}`).toBeDefined();
        expect([entry!.width, entry!.height]).toEqual([1500, 2100]);
      }
    }
    expect(fs.existsSync("public/frames/nyx")).toBe(false);
  });

  it("sets the type band 4 px above v66's, with its bar; the rules box and the plate are M15's", () => {
    const nyx = getFrameProfile("nyx");
    const m15 = getFrameProfile("m15");
    expect(((nyx.type.rect.topPct - m15.type.rect.topPct) / 100) * 2100).toBeCloseTo(6, 6);
    expect(nyx.rules.rect).toEqual(m15.rules.rect);
    expect(nyx.pt?.plateRect).toEqual(m15.pt?.plateRect);
    expect(nyx.pt?.rect).toEqual(m15.pt?.rect);
  });

  it.runIf(haveBucketMasters(["w", "u", "b", "r", "g", "m", "c"].map((k) => `nyx/${k}.png`)))(
    "the published masters' type bar and box sit on the M15 pack's rows",
    async () => {
      for (const key of ["w", "r", "c"]) {
        const { data } = await sharp(bucketMaster(`nyx/${key}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const a = (y: number) => data[(y * 1500 + 600) * 4 + 3]!;
        // The bar's black (α 150) from 1193, the rim opaque at 1303–1313, the
        // box's black (α 171) down to 1929, the bottom rim from 1937.
        expect(a(1200), key).toBe(150);
        expect(a(1290), key).toBeLessThan(255);
        expect(a(1308), key).toBe(255);
        expect(a(1925), key).toBe(171);
        expect(a(1940), key).toBe(255);
      }
    },
    60_000,
  );
});
