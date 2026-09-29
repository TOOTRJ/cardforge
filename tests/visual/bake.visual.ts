import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { shardCases, visualCases, type VisualCase } from "./matrix";

// ---------------------------------------------------------------------------
// The visual-regression BAKE (TODO 7.1): renders one shard of
// tests/visual/matrix.ts through the real renderer — renderCardImage with the
// stored bake's contract (brand mark, no footer text, round corners unless a
// case says square) — and writes each case's pixel hash to VISUAL_OUT for
// scripts/visual-regression.mjs to gate. Run through that script
// (`npm run test:visual`); it fetches the frames and starts the shards.
//
// HERMETIC: the only input from outside the repo is the frames bucket, and
// that is read from VISUAL_FRAMES_DIR — the script's local cache of the
// manifest's objects, which lib/render/card-frames.ts checks against the
// manifest's sha256 as it loads them (a wrong byte fails the case). Any
// other fetch is refused and fails the run. Fonts are the committed / locked
// files the renderer reads; their hashes go into the result.
//
// The hash is sha256 over the DECODED pixels (size + RGBA), not the PNG
// bytes, so an encoder change alone never counts as a pixel change.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const [SHARD_INDEX, SHARD_COUNT] = (process.env.VISUAL_SHARD ?? "0/1").split("/").map(Number);
const OUT = process.env.VISUAL_OUT ?? path.join(ROOT, "tmp/visual/results/shard-0.json");
const FRAMES_DIR = process.env.VISUAL_FRAMES_DIR ?? path.join(ROOT, "tmp/visual/frames");
/** The layout version the baseline was made at: each case records whether
 *  a bake stamped with it is stale now (isRenderStale — the bump's scope). */
const BASE_VERSION = process.env.VISUAL_BASE_VERSION ? Number(process.env.VISUAL_BASE_VERSION) : null;
/** Comma-separated id prefixes (debugging). */
const ONLY = (process.env.VISUAL_ONLY ?? "").split(",").filter(Boolean);
/** Write each bake's PNG here (local inspection only — tmp/ is gitignored;
 *  CC-derived pixels never go into git). */
const SAVE_DIR = process.env.VISUAL_SAVE_DIR ?? null;

/** The bucket origin the renderer is pointed at; served from FRAMES_DIR. */
const FRAME_ORIGIN = "https://frames.visual.invalid";
const OBJECT_KEY = /^[a-z0-9-]+(\/[a-z0-9-]+)*\.[0-9a-f]{12}\.png$/;

/** Satori's note for a style it ignores — the bake relies on paint order
 *  (TODO 3.10); not a problem with the case. */
const IGNORED_WARNINGS = ["`z-index` is currently not supported."];

const blocked: string[] = [];
let restoreStorage: () => void = () => {};

/** A deterministic, smooth-but-busy picture — never a real artwork. */
async function generatedArt(width: number, height: number, seed: number): Promise<string> {
  const px = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = (x / width + y / height) / 2;
      const i = (y * width + x) * 3;
      px[i] = Math.round(200 - 150 * t + 20 * Math.sin(x / (60 + seed)));
      px[i + 1] = Math.round(190 - 140 * t + 20 * Math.cos(y / 50));
      px[i + 2] = Math.round(170 - 110 * t + 30 * Math.sin((x + y) / 120));
    }
  }
  const png = await sharp(px, { raw: { width, height, channels: 3 } }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

function sha(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** What the result records about the tools and inputs that draw the pixels
 *  (the gate names the ones that changed when every case moves at once). */
async function environment(): Promise<Record<string, unknown>> {
  const fonts: Record<string, string> = {};
  for (const rel of [
    "node_modules/mana-font/fonts/mana.ttf",
    "node_modules/mana-font/fonts/mplantin.ttf",
    "node_modules/keyrune/fonts/keyrune.ttf",
    "public/fonts/Beleren-Bold.ttf",
    "public/fonts/mplantin-italic.ttf",
  ]) {
    fonts[rel] = sha(fs.readFileSync(path.join(ROOT, rel))).slice(0, 16);
  }
  const pkg = (name: string) =>
    (JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", name, "package.json"), "utf8")) as { version: string }).version;
  const v = sharp.versions as Record<string, string>;
  return {
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    satori: pkg("satori"),
    sharp: v.sharp,
    libvips: v.vips,
    rsvg: v.rsvg,
    cairo: v.cairo,
    pixman: v.pixman,
    fonts,
    manifest: sha(fs.readFileSync(path.join(ROOT, "lib/frames/frame-manifest.json"))).slice(0, 16),
  };
}

beforeAll(async () => {
  const { setFrameStorageForTests } = await import("@/lib/frames/frame-url");
  restoreStorage = setFrameStorageForTests({ origin: FRAME_ORIGIN });
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("data:")) return realFetch(input, init);
    if (url.startsWith(`${FRAME_ORIGIN}/`)) {
      const key = url.slice(FRAME_ORIGIN.length + 1);
      const file = path.join(FRAMES_DIR, key);
      if (!OBJECT_KEY.test(key) || key.includes("..") || !fs.existsSync(file)) {
        blocked.push(`frame not in the local cache: ${key}`);
        return new Response(null, { status: 404 });
      }
      return new Response(new Uint8Array(fs.readFileSync(file)), { status: 200, headers: { "content-type": "image/png" } });
    }
    blocked.push(url.slice(0, 160));
    throw new TypeError(`visual bake is hermetic: refused ${url.slice(0, 80)}`);
  });
});

afterAll(() => {
  restoreStorage();
  vi.unstubAllGlobals();
});

type CaseResult = { hash: string | null; input: string; ms: number; stale?: boolean; printOnly?: true; warnings?: string[]; error?: string };

it("bakes its shard of the visual-regression matrix", async () => {
  const { rowToPreviewData } = await import("@/lib/cards/bake-core");
  const { renderCardImage } = await import("@/lib/render/card-image");
  const { CARD_LAYOUT_VERSION, isRenderStale } = await import("@/lib/cards/layout-version");

  const art = await generatedArt(1000, 760, 30);
  const art2 = await generatedArt(760, 1000, 12);
  let cases: VisualCase[] = shardCases(visualCases(), SHARD_INDEX, SHARD_COUNT);
  if (ONLY.length) cases = cases.filter((c) => ONLY.some((p) => c.id.startsWith(p)));
  if (SAVE_DIR) fs.mkdirSync(SAVE_DIR, { recursive: true });

  // Every warning the renderer logs lands on the case being baked.
  let current: string[] = [];
  const capture = (...args: unknown[]) => {
    const text = args.map(String).join(" ");
    if (!IGNORED_WARNINGS.some((w) => text.includes(w))) current.push(text.slice(0, 300));
  };
  const warn = vi.spyOn(console, "warn").mockImplementation(capture);
  const error = vi.spyOn(console, "error").mockImplementation(capture);

  const results: Record<string, CaseResult> = {};
  const started = Date.now();
  try {
    for (const c of cases) {
      current = [];
      const t0 = Date.now();
      const result: CaseResult = { hash: null, input: c.input, ms: 0 };
      if (c.printOnly) result.printOnly = true;
      if (BASE_VERSION !== null) {
        result.stale = isRenderStale(BASE_VERSION, c.template, undefined, CARD_LAYOUT_VERSION, c.row);
      }
      try {
        // The stored-bake path (lib/cards/bake-render.ts): the row mapped as
        // the bake maps it, then the resolved art swapped in as a data URL.
        const card = rowToPreviewData(c.row);
        if (c.row.art_url === "ART") card.artUrl = art;
        const back = c.row.back_face as { art_url?: string } | null;
        if (card.backFace && back?.art_url === "ART2") card.backFace = { ...card.backFace, art_url: art2 };
        const res = await renderCardImage(card, c.preset, { brandMark: true, watermarkText: null, corners: c.corners });
        const png = Buffer.from(await res.arrayBuffer());
        const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        result.hash = sha(Buffer.concat([Buffer.from(`${info.width}x${info.height}x${info.channels}\n`), data])).slice(0, 16);
        if (SAVE_DIR) fs.writeFileSync(path.join(SAVE_DIR, `${c.id.replace(/[/@]/g, "__")}.png`), png);
      } catch (err) {
        result.error = err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 500) : String(err);
      }
      result.ms = Date.now() - t0;
      if (current.length) result.warnings = [...new Set(current)];
      results[c.id] = result;
    }
  } finally {
    warn.mockRestore();
    error.mockRestore();
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        shard: `${SHARD_INDEX}/${SHARD_COUNT}`,
        layoutVersion: CARD_LAYOUT_VERSION,
        baseVersion: BASE_VERSION,
        environment: await environment(),
        seconds: (Date.now() - started) / 1000,
        blocked: [...new Set(blocked)],
        cases: results,
      },
      null,
      1,
    )}\n`,
  );
  // The gate reads the file; the test only fails on a broken harness.
  expect(Object.keys(results)).toHaveLength(cases.length);
});
