import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { parityCases, parityFileName } from "./cases";
import { parityRegions } from "./regions";
import {
  PARITY_ART2_URL,
  PARITY_ART_URL,
  PARITY_DIR,
  PARITY_SIZES,
  PARITY_TAGGED_JPEG_URL,
  PARITY_UPLOADED_JPEG_URL,
  type ParityCaseFile,
} from "./shared";

// ---------------------------------------------------------------------------
// The BAKE half of the preview ⇄ bake parity suite (TODO 3.11): every case of
// tests/parity/cases.ts through the real Satori bake — renderCardImage with
// the stored bake's contract (brand mark, no footer text, round corners), as
// tests/visual/bake.visual.ts bakes the hash matrix — at 750 px and at HD.
// Leaves, in tmp/parity/ (gitignored): the PNGs, the art pictures, and
// cases-<shard>.json — each case's CardPreviewData and regions for the browser
// stage (tests/parity/preview.parity.spec.ts), which mounts the SAME data in
// CardPreview. Run through scripts/parity.mjs (`npm run test:parity`).
//
// Hermetic like the visual bake: frames come from the visual suite's cache
// (PARITY_FRAMES_DIR, sha-checked as they load), every other fetch is
// refused and fails the run.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const OUT = path.join(ROOT, PARITY_DIR);
const FRAMES_DIR = process.env.PARITY_FRAMES_DIR ?? path.join(ROOT, "tmp/visual/frames");
const ONLY = (process.env.PARITY_ONLY ?? "").split(",").filter(Boolean);
/** "i/n": this process bakes every n-th case from the i-th (scripts/parity.mjs
 *  starts n of them). */
const [SHARD_INDEX, SHARD_COUNT] = (process.env.PARITY_SHARD ?? "0/1").split("/").map(Number);
const FRAME_ORIGIN = "https://frames.visual.invalid";
const OBJECT_KEY = /^[a-z0-9-]+(\/[a-z0-9-]+)*\.[0-9a-f]{12}\.png$/;
const PRELOAD_GAP = /\[card-frames\] .* was not preloaded/;

const blocked: string[] = [];
let restoreStorage: () => void = () => {};

/**
 * A CODED picture — never a real artwork: a 12 × 9 board of flat cells, each
 * its own colour, with dark rules between them and a light dot in every
 * cell. Where the art sits in its window (focal point, zoom) is readable
 * from the cell edges to the pixel, which a smooth gradient would hide.
 */
async function codedArt(width: number, height: number, seed: number): Promise<Buffer> {
  const cols = width >= height ? 12 : 9;
  const rows = width >= height ? 9 : 12;
  const cw = width / cols;
  const ch = height / rows;
  const px = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const row = Math.min(rows - 1, Math.floor(y / ch));
    const fy = y - row * ch;
    for (let x = 0; x < width; x += 1) {
      const col = Math.min(cols - 1, Math.floor(x / cw));
      const fx = x - col * cw;
      const i = (y * width + x) * 3;
      const line = fx < 3 || fy < 3;
      const dot = Math.hypot(fx - cw / 2, fy - ch / 2) < Math.min(cw, ch) * 0.12;
      if (line) {
        px[i] = 24;
        px[i + 1] = 24;
        px[i + 2] = 32;
      } else if (dot) {
        px[i] = 240;
        px[i + 1] = 236;
        px[i + 2] = 220;
      } else {
        px[i] = 60 + ((col * 37 + row * 11 + seed * 5) % 150);
        px[i + 1] = 60 + ((col * 13 + row * 41 + seed * 3) % 150);
        px[i + 2] = 70 + ((col * 29 + row * 23 + seed * 7) % 140);
      }
    }
  }
  return sharp(px, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

const dataUrl = (bytes: Buffer, type = "image/png") => `data:${type};base64,${bytes.toString("base64")}`;

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
    throw new TypeError(`parity bake is hermetic: refused ${url.slice(0, 80)}`);
  });
});

afterAll(() => {
  restoreStorage();
  vi.unstubAllGlobals();
});

it("bakes the parity matrix", async () => {
  const { rowToPreviewData } = await import("@/lib/cards/bake-core");
  const { backBodyOf, backPreviewData } = await import("@/lib/cards/faces");
  const { renderCardImage } = await import("@/lib/render/card-image");
  const { resetFrameAssetCacheForTests } = await import("@/lib/render/card-frames");
  const { resolveFrameProfile } = await import("@/lib/cards/profile-override");
  const { normalizeFrameTemplate } = await import("@/lib/cards/card-display");

  fs.mkdirSync(path.join(OUT, "bake"), { recursive: true });
  // Each shard writes its own copy of the (identical) art, then renames it
  // into place: the browser stage never reads a half-written file.
  const artDir = path.join(OUT, "art");
  fs.mkdirSync(artDir, { recursive: true });
  const writeArt = (name: string, bytes: Buffer) => {
    const partial = path.join(artDir, `${name}.${process.pid}.part`);
    fs.writeFileSync(partial, bytes);
    fs.renameSync(partial, path.join(artDir, name));
  };
  const art = await codedArt(1200, 900, 3);
  const art2 = await codedArt(900, 1200, 8);
  writeArt("parity-art.png", art);
  writeArt("parity-art2.png", art2);

  // The EXIF cases' photo (TODO 3.14): the portrait picture laid out as a
  // phone stores it — sideways, tagged Orientation 6 — and what
  // prepareUploadBytes makes of that file (upright pixels, no tag).
  const { prepareUploadBytes } = await import("@/lib/media/upload-bytes");
  const tagged = await sharp(art2).rotate(270).jpeg({ quality: 95 }).withMetadata({ orientation: 6 }).toBuffer();
  const taggedMeta = await sharp(tagged).metadata();
  expect([taggedMeta.orientation, taggedMeta.width, taggedMeta.height], "the fixture is stored sideways, tagged 6").toEqual([6, 1200, 900]);
  const uploaded = await prepareUploadBytes(tagged, taggedMeta);
  const uploadedMeta = await sharp(uploaded).metadata();
  expect([uploadedMeta.orientation ?? 1, uploadedMeta.width, uploadedMeta.height], "an upload is stored upright, untagged").toEqual([1, 900, 1200]);
  writeArt("parity-exif6-stored.jpg", tagged);
  writeArt("parity-exif6-upload.jpg", uploaded);
  const photo = {
    "tagged-jpeg": { url: PARITY_TAGGED_JPEG_URL, data: dataUrl(tagged, "image/jpeg") },
    "uploaded-jpeg": { url: PARITY_UPLOADED_JPEG_URL, data: dataUrl(uploaded, "image/jpeg") },
  } as const;

  let cases = parityCases().map((c, index) => ({ ...c, index }));
  if (ONLY.length) cases = cases.filter((c) => ONLY.some((p) => c.id.startsWith(p)));
  cases = cases.filter((_, i) => i % SHARD_COUNT === SHARD_INDEX);

  const warnings: string[] = [];
  const capture = (...args: unknown[]) => warnings.push(args.map(String).join(" ").slice(0, 300));
  const warn = vi.spyOn(console, "warn").mockImplementation(capture);
  const error = vi.spyOn(console, "error").mockImplementation(capture);

  const files: ParityCaseFile[] = [];
  try {
    for (const c of cases) {
      // The row as the bake maps it; then the art, once per renderer: the
      // preview loads the harness's storage URL, the bake the same bytes.
      const mapped = rowToPreviewData(c.row);
      const back = c.row.back_face as { art_url?: string } | null;
      const withArt = (front: string, second: string) => {
        const card = { ...mapped };
        if (c.row.art_url === "ART") card.artUrl = front;
        if (card.backFace && back?.art_url === "ART2") card.backFace = { ...card.backFace, art_url: second };
        return card;
      };
      const forPreview = withArt(c.art ? photo[c.art].url : PARITY_ART_URL, PARITY_ART2_URL);
      const forBake = withArt(c.art ? photo[c.art].data : dataUrl(art), dataUrl(art2));

      // The face both renderers draw: the bake takes the back's own data
      // (lib/cards/faces.ts, as the stored back bake does), the preview the
      // whole card flipped to its back.
      let baked = forBake;
      if (c.face === "back") {
        const backData = backPreviewData(forBake);
        if (!backData || !backBodyOf(forBake)) throw new Error(`${c.id}: the case bakes a back face the row has not got`);
        baked = backData;
      }
      const profile = resolveFrameProfile(normalizeFrameTemplate(baked.frameStyle?.template, baked), null);
      const file = parityFileName(c.id);
      for (const size of PARITY_SIZES) {
        // Cold, as the visual bake: a plate one case preloaded must not
        // cover for another case's preload gap.
        resetFrameAssetCacheForTests();
        const res = await renderCardImage(baked, size.preset, { brandMark: true, watermarkText: null, corners: "round" });
        fs.writeFileSync(path.join(OUT, "bake", `${file}@${size.name}.png`), Buffer.from(await res.arrayBuffer()));
      }
      files.push({
        index: c.index,
        id: c.id,
        file,
        why: c.why,
        face: c.face,
        orientation: profile.orientation === "landscape" ? "landscape" : "portrait",
        card: forPreview as unknown as Record<string, unknown>,
        regions: parityRegions(profile),
      });
    }
  } finally {
    warn.mockRestore();
    error.mockRestore();
  }

  fs.writeFileSync(path.join(OUT, `cases-${SHARD_INDEX}.json`), `${JSON.stringify(files, null, 1)}\n`);
  // A broken harness fails here; the pixels are judged by the browser stage.
  expect(blocked, "the bake asked for something outside the frame cache").toEqual([]);
  expect(warnings.filter((w) => PRELOAD_GAP.test(w)), "a frame asset was read without its preload").toEqual([]);
  expect(files).toHaveLength(cases.length);
});
