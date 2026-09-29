// ---------------------------------------------------------------------------
// upload-metadata.mjs — the testable half of scripts/strip-upload-metadata.mjs
// (TODO 3.14a): what to scan, what a stripped object must still be, and how
// to say what an object carries without printing any of it.
//
// The strip itself is lib/media/strip-metadata.ts — the SAME code every
// upload runs through — imported here through node's type stripping.
// ---------------------------------------------------------------------------
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { padImageToAtLeast, stripImageMetadata } from "../../lib/media/strip-metadata.ts";

/** Buckets that hold users' own files. Never card-renders (our bakes — a
 *  stored card image must not change) or frames (content-addressed). */
export const USER_UPLOAD_BUCKETS = ["card-art", "profile-media", "set-covers", "custom-pips"];

// Mirrors lib/render/art-source.ts (toSatoriDataUrl) — the ESM script can't
// import that server-only module; tests/unit/devops/upload-metadata-script
// .test.ts holds these to the real constants and the real function.
export const BAKE_INLINE_MAX_BYTES = 3 * 1024 * 1024;
export const BAKE_INLINE_MAX_EDGE = 1600;
export const BAKE_INLINE_JPEG_QUALITY = 88;

/** AI outputs (lib/ai/random-art.ts names them `ai-<id>.<ext>`) hold no
 *  camera data and may carry the model's provenance (C2PA / IPTC digital
 *  source type) — left alone unless asked. */
export function isAiOutput(objectPath) {
  return path.posix.basename(objectPath).startsWith("ai-");
}

/** "max-age=3600" (what storage reports) → "3600" (what upload takes). */
export function cacheControlSeconds(value) {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(?:max-age=)?(\d+)$/);
  return m ? m[1] : null;
}

/** One report line: bucket/path, format, size, what it carries — labels
 *  only (lib/media/strip-metadata.ts never reports a value). */
export function describe(objectKey, bytes, report) {
  const kb = `${(bytes / 1024).toFixed(0)} KB`;
  const flags = [report.gps ? "GPS" : null, report.orientation ? `keeps orientation ${report.orientation}` : null]
    .filter(Boolean)
    .join(", ");
  return `${objectKey}  ${report.format}  ${kb}  ${report.found.join(" ")}${flags ? `  [${flags}]` : ""}`;
}

const browserTurns = (meta) =>
  (meta.format === "jpeg" || meta.format === "png") &&
  Number.isInteger(meta.orientation) &&
  meta.orientation >= 2 &&
  meta.orientation <= 8;

/**
 * What the bake would inline for these bytes (toSatoriDataUrl, mirrored):
 * `{ path: "inline" }` for a small untagged JPEG/PNG passed through as-is,
 * else the re-encoded bytes it would draw.
 */
export async function bakeInputOf(bytes) {
  const meta = await sharp(bytes, { animated: false }).metadata();
  const native = meta.format === "jpeg" || meta.format === "png";
  const turn = browserTurns(meta);
  if (native && !turn && bytes.byteLength <= BAKE_INLINE_MAX_BYTES) return { path: "inline" };
  const decoded = sharp(bytes, { animated: false });
  const fitted = (turn ? decoded.autoOrient() : decoded).resize({
    width: BAKE_INLINE_MAX_EDGE,
    height: BAKE_INLINE_MAX_EDGE,
    fit: "inside",
    withoutEnlargement: true,
  });
  if (meta.hasAlpha) return { path: "png", bytes: await fitted.png().toBuffer() };
  return { path: "jpeg", bytes: await fitted.jpeg({ quality: BAKE_INLINE_JPEG_QUALITY, mozjpeg: true }).toBuffer() };
}

const rawPixels = (bytes, opts = {}) => {
  let img = sharp(bytes, { animated: true, limitInputPixels: false, ignoreIcc: opts.ignoreIcc ?? false });
  if (opts.autoOrient) img = img.autoOrient();
  return img.raw().toBuffer({ resolveWithObject: true });
};

/**
 * Every way the stripped file could differ from the original for a viewer
 * or the bake; [] when there is none. Checks the decoded pixels (colour-
 * managed, raw, and turned), the size, frames, orientation and ICC profile,
 * and that the bake would get the same input (the same path, and for a
 * re-encode the same bytes).
 */
export async function verifyStripped(before, after) {
  const problems = [];
  const [a, b] = [await sharp(before).metadata(), await sharp(after).metadata()];
  for (const key of ["format", "width", "height", "pages", "channels", "hasAlpha", "space"]) {
    if (a[key] !== b[key]) problems.push(`${key} ${a[key]} → ${b[key]}`);
  }
  if ((a.orientation ?? 1) !== (b.orientation ?? 1)) problems.push(`orientation ${a.orientation} → ${b.orientation}`);
  if (Boolean(a.icc) !== Boolean(b.icc) || (a.icc && !a.icc.equals(b.icc))) problems.push("ICC profile changed");
  for (const opts of [{}, { ignoreIcc: true }, { autoOrient: true }]) {
    const [x, y] = [await rawPixels(before, opts), await rawPixels(after, opts)];
    if (x.info.width !== y.info.width || x.info.height !== y.info.height || !x.data.equals(y.data)) {
      problems.push(`pixels differ (${JSON.stringify(opts)})`);
      break;
    }
  }
  const [bakeA, bakeB] = [await bakeInputOf(before), await bakeInputOf(after)];
  if (bakeA.path !== bakeB.path) problems.push(`bake path ${bakeA.path} → ${bakeB.path}`);
  else if (bakeA.bytes && !bakeA.bytes.equals(bakeB.bytes)) problems.push("bake input differs");
  return problems;
}

/**
 * The bytes to write for `original`, or why not:
 *   { status: "clean" }                         nothing to remove
 *   { status: "unparseable" }                   container the stripper refuses
 *   { status: "strip", bytes, report, padded }  stripped (and padded when the
 *                                                strip would move a JPEG/PNG
 *                                                under the bake's inline cap)
 */
export function planStrip(original) {
  const result = stripImageMetadata(original);
  if (!result) return { status: "unparseable" };
  if (result.report.found.length === 0) return { status: "clean", report: result.report };
  let bytes = Buffer.from(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
  let padded = false;
  if (
    (result.report.format === "jpeg" || result.report.format === "png") &&
    original.byteLength > BAKE_INLINE_MAX_BYTES &&
    bytes.byteLength <= BAKE_INLINE_MAX_BYTES
  ) {
    const grown = padImageToAtLeast(bytes, BAKE_INLINE_MAX_BYTES + 1);
    if (!grown) return { status: "unparseable" };
    bytes = Buffer.from(grown.buffer, grown.byteOffset, grown.byteLength);
    padded = true;
  }
  return { status: "strip", bytes, report: result.report, padded };
}

// --- resumable state -------------------------------------------------------------

/** { objects: { "bucket/path": { etag, status, at } } } — an object whose
 *  eTag still matches a "clean" or "stripped" entry is not downloaded again. */
export function loadState(file) {
  if (!existsSync(file)) return { version: 1, objects: {} };
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  return parsed && typeof parsed.objects === "object" ? parsed : { version: 1, objects: {} };
}

export function saveState(file, state) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 1));
  renameSync(tmp, file);
}

export function alreadyDone(state, objectKey, etag) {
  const entry = state.objects[objectKey];
  return Boolean(entry && etag && entry.etag === etag && (entry.status === "clean" || entry.status === "stripped"));
}
