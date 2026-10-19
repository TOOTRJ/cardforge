import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { TOKEN_NYX_RECIPE, dressTokenNyx, isArtifactNyx, tokenNyxRegion } from "@/scripts/lib/token-nyx.mjs";
import { M20_TOKEN_CROWN, getFrameProfile } from "@/lib/cards/template-layout";
import { M20_TOKEN_TEMPLATES } from "@/lib/cards/token-height";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.51: the full-art token's Nyx dress — PipGlyph's composite of a
// starfield in the NAME PILL of the published full-art token masters
// (scripts/build-token-nyx.mjs, recipe in scripts/lib/token-nyx.mjs), into
// the DEV bucket (never git). The recipe is checked here as data; the
// published pixels when a local copy at the manifest's sha256 is on disk
// (FRAMES_BUILD_DIR, else .frames-build; CI fetches the PNGs — the WebP
// half needs a local build).
// ---------------------------------------------------------------------------

type Entry = { sha256: string; width: number; height: number };
const files = (manifestJson as { files: Record<string, Entry> }).files;
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
const provenance = JSON.parse(fs.readFileSync("lib/cards/frame-sources.json", "utf8")) as Record<
  string,
  { source: string; converter: string; colors: Record<string, string[]>; sourceFiles: string[] }
>;
const DRESSES = Object.entries(TOKEN_NYX_RECIPE.templates) as [string, string][];

function real(rel: string): Buffer | null {
  const dirs = [BUILD, path.join(process.cwd(), ".frames-build"), path.join(process.cwd(), ".frames-cache")];
  for (const dir of dirs) {
    const file = path.join(dir, rel);
    if (!files[rel] || !fs.existsSync(file)) continue;
    const bytes = fs.readFileSync(file);
    if (createHash("sha256").update(bytes).digest("hex") === files[rel].sha256) return bytes;
  }
  return null;
}
const raw = async (buf: Buffer | string) => sharp(buf).ensureAlpha().raw().toBuffer();

describe("the Nyx dress's recipe (data)", () => {
  it("dresses every full-art token template, at its height, plain and artifact", () => {
    for (const height of ["textless", "regular", "tall"] as const) {
      const set = M20_TOKEN_TEMPLATES[height];
      expect(TOKEN_NYX_RECIPE.templates[set.nyx as keyof typeof TOKEN_NYX_RECIPE.templates]).toBe(set.plain);
      expect(TOKEN_NYX_RECIPE.templates[set.artifactNyx as keyof typeof TOKEN_NYX_RECIPE.templates]).toBe(set.artifact);
    }
    expect(DRESSES).toHaveLength(6);
    for (const [dress] of DRESSES) expect(FRAME_TEMPLATE_VALUES as readonly string[]).toContain(dress);
  });

  it("builds the profiles' keys: the seven colours, no pairs (no two-colour Nyx token is printed)", () => {
    expect([...TOKEN_NYX_RECIPE.keys]).toEqual(["w", "u", "b", "r", "g", "c", "m"]);
    for (const [dress] of DRESSES) {
      const p = getFrameProfile(dress as never);
      expect(p.twoColorMasters, dress).toBeUndefined();
      expect(p.overlays, dress).toEqual([isArtifactNyx(dress) ? { ...M20_TOKEN_CROWN, keyMap: { c: "a" } } : M20_TOKEN_CROWN]);
    }
  });

  it("reads print's pill medians for the colours printed, the artifact slate for every artifact key", () => {
    const { plain, artifact } = TOKEN_NYX_RECIPE.targets;
    expect(plain.w).toEqual([170.5, 167, 159]); // TDSK #4, TSOC #3
    expect(plain.u).toEqual([20, 85, 127]); // TMDD #8
    expect(plain.b).toEqual([42, 38, 46]); // TDSK #10
    expect(plain.c).toEqual([124, 125, 124]); // SLD #1835
    expect([plain.r, plain.g, plain.m]).toEqual([null, null, null]);
    expect(artifact).toEqual([74, 80, 96]); // TEOC #13
  });

  it("publishes a PNG and a WebP per dress and key — exactly these, and provenance for each", () => {
    const published = Object.keys(files).filter((k) => DRESSES.some(([d]) => k.startsWith(`${d}/`))).sort();
    const want = DRESSES.flatMap(([d]) => TOKEN_NYX_RECIPE.keys.flatMap((k) => [`${d}/${k}.png`, `${d}/${k}.webp`])).sort();
    expect(published).toEqual(want);
    for (const [dress, from] of DRESSES) {
      expect(provenance[dress].source, dress).toBe("pipglyph");
      expect(provenance[dress].converter, dress).toBe("scripts/build-token-nyx.mjs");
      expect(Object.keys(provenance[dress].colors), dress).toEqual([...TOKEN_NYX_RECIPE.keys]);
      for (const key of TOKEN_NYX_RECIPE.keys) {
        const parent = files[`${from}/${key}.png`];
        expect(provenance[dress].colors[key][0], `${dress}/${key}`).toContain(parent.sha256.slice(0, 12));
      }
    }
  });
});

describe("dressTokenNyx (pure)", () => {
  const W = TOKEN_NYX_RECIPE.width;
  const H = TOKEN_NYX_RECIPE.height;
  it("never touches alpha or a pixel outside the region; no print → no offset", () => {
    const master = Buffer.alloc(W * H * 4);
    for (let p = 0; p < W * H; p++) master.set([200, 100, 50, 230], p * 4);
    const weight = new Float32Array(W * H);
    const layer = new Float32Array(W * H);
    // A strip of the pill's face: the measuring window's rows.
    for (let y = 118; y <= 202; y++) for (let x = 130; x <= 1370; x++) {
      weight[y * W + x] = 1;
      layer[y * W + x] = x % 50 === 0 ? 40 : 0;
    }
    const plain = dressTokenNyx(master, weight, layer, null);
    expect(plain.offsets).toEqual([0, 0, 0]);
    const toned = dressTokenNyx(master, weight, layer, [120, 120, 120]);
    for (const { out } of [plain, toned]) {
      let bad = 0;
      for (let p = 0; p < W * H; p++) {
        if (out[p * 4 + 3] !== 230) bad++;
        if (weight[p] === 0 && (out[p * 4] !== 200 || out[p * 4 + 1] !== 100 || out[p * 4 + 2] !== 50)) bad++;
      }
      expect(bad).toBe(0);
    }
    // The stars brighten their pixels by k × the layer.
    expect(plain.out[(150 * W + 150) * 4 + 1]).toBe(Math.round(100 + TOKEN_NYX_RECIPE.k * 40));
  }, 60_000);
});

const pngs = DRESSES.flatMap(([dress, from]) => TOKEN_NYX_RECIPE.keys.map((key) => ({ dress, from, key })));
const available = pngs.every(({ dress, from, key }) => real(`${dress}/${key}.png`) && real(`${from}/${key}.png`));
const bandAvailable = Boolean(real(`${TOKEN_NYX_RECIPE.hole.band}.png`) && real(`${TOKEN_NYX_RECIPE.alpha.master}.png`));

describe("the published Nyx masters", () => {
  it.skipIf(!available || !bandAvailable)("are their parents byte for byte outside the name pill's face, alpha everywhere; inside it, the starfield", async () => {
    const band = real(`${TOKEN_NYX_RECIPE.hole.band}.png`)!;
    const bandMeta = await sharp(band).metadata();
    const { weight } = tokenNyxRegion(await raw(band), bandMeta.height!, await raw(real(`${TOKEN_NYX_RECIPE.alpha.master}.png`)!));
    for (const { dress, from, key } of pngs) {
      const out = await raw(real(`${dress}/${key}.png`)!);
      const parent = await raw(real(`${from}/${key}.png`)!);
      let inside = 0;
      let moved = 0;
      for (let p = 0; p < weight.length; p++) {
        const o = p * 4;
        if (out[o + 3] !== parent[o + 3]) throw new Error(`${dress}/${key}: alpha at ${p}`);
        const same = out[o] === parent[o] && out[o + 1] === parent[o + 1] && out[o + 2] === parent[o + 2];
        if (weight[p] <= 0) {
          if (!same) throw new Error(`${dress}/${key}: a pixel outside the pill at ${p % 1500},${Math.floor(p / 1500)}`);
        } else {
          inside++;
          if (!same) moved++;
        }
      }
      // The starfield covers the face: nearly every pixel of it moves.
      expect(moved / inside, `${dress}/${key}`).toBeGreaterThan(0.9);
      // …and the face is the pill, between the outline rows.
      expect(inside, `${dress}/${key}`).toBeGreaterThan(120_000);
    }
  }, 300_000);

  const webps = pngs.filter(({ dress, key }) => real(`${dress}/${key}.webp`));
  it.skipIf(webps.length === 0)("their WebPs' alpha is the PNGs' exactly", async () => {
    for (const { dress, key } of webps) {
      const png = await raw(real(`${dress}/${key}.png`)!);
      const webp = await raw(real(`${dress}/${key}.webp`)!);
      for (let i = 3; i < png.length; i += 4) if (png[i] !== webp[i]) throw new Error(`${dress}/${key}.webp: alpha at ${(i - 3) / 4}`);
    }
  }, 300_000);
});
