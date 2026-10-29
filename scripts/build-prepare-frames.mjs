#!/usr/bin/env node
// ---------------------------------------------------------------------------
// build-prepare-frames.mjs — the Prepare frame's masters (TODO 4.27):
// PipGlyph's OWN derivation from masters already published in the frames
// bucket. Neither Card Conjurer nor MSE has the frame; no scan is read by the
// build — every number is DATA in scripts/lib/prepare-2026.mjs
// (PREPARE_RECIPE), measured on the printings.
//
//   prepare/<w u b r g m>   from the published m15/<key>, its page bars from
//                           the published adventure/<key>
//   prepare/c               from the published m15artifact/c, its bars from
//                           adventure/c (Card Conjurer's artifact `a`)
//   prepare/<pair>, <pair>-h  (TODO 4.26) the two-colour Prepare: the
//                           published m15/<pair> (gold-split) or
//                           m15/<pair>-h (hybrid) master, its left box and
//                           bottom pinline re-lerped from the two one-colour
//                           m15 masters onto print's columns, the page's rim
//                           and box lerped about the page's centre, gold or
//                           grey bars (adventure/m, adventure/b toned)
//   prepare/page/<key>      (TODO 4.26) every master's page cut out — the
//                           overlay a card draws when its SPELL's page key
//                           is not the creature's (lib/cards/part-color.ts)
//   extendedartprepare/<key>  (TODO 4.27b, `--only extended`) the extended-
//                           art dress: the published extendedart/<key>
//                           above the type bar and beside the box, the
//                           published prepare/<key> below it — a merge, no
//                           pixel drawn (PREPARE_EXTENDED)
//
// What the run does to the base master (in this order; every painted pixel
// is a published master's, moved, toned or darkened — the only geometry it
// draws is the bars' outline and the page's outline, flat black at the
// prints' coverage, said so in provenance):
//   1. the left box's right edge: the base box's own right edge, moved left;
//   2. the page's rim: the base's pinline colour, column by column;
//   3. the strip under the page: the base's own frame field, a quarter turn;
//   4. the page's box: the base box's paper under a per-key gain, its edges
//      the base box's own edges, moved;
//   5. the name and type bars: the adventure master's two page bars, toned
//      onto print and lit by the prints' bevel, cut to the prints' shape
//      (square left end, half-ellipse right end) with a 3 px outline;
//   6. the page's black outline (left, top, bottom).
//
//   node scripts/build-prepare-frames.mjs                 # → .frames-build
//   node scripts/build-prepare-frames.mjs --out <dir> [--masters <dir>] [--only prepare|extended] [--dry-run]
//   npm run frames:publish -- --source .frames-build --only prepare,extendedartprepare --write
//
// The sources are local copies of the PUBLISHED masters, each sha256-checked
// against lib/frames/frame-manifest.json (--masters, FRAMES_BUILD_DIR,
// .frames-cache — scripts/frames-fetch.mjs — or .frames-build). The output is
// gitignored: a master derived from a bucket master never enters git.
// Provenance → lib/cards/frame-sources.json.
//
// The WebP sibling's ALPHA must equal the PNG's exactly (the browser preview
// reads the WebP, the bake the PNG): the run decodes every WebP it wrote and
// refuses a difference.
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { WEBP } from "./lib/cc-frames.mjs";
import { PREPARE_EXTENDED, PREPARE_RECIPE as R } from "./lib/prepare-2026.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const dryRun = args.includes("--dry-run");
// What to build: the Prepare masters and pages (`prepare`), the extended-art
// dress (`extended`, TODO 4.27b) — both by default.
const parts = new Set(flag("--only")?.split(",").filter(Boolean) ?? ["prepare", "extended"]);
for (const part of parts) if (part !== "prepare" && part !== "extended") throw new Error(`--only ${part}: known prepare, extended`);
const outDir = path.resolve(flag("--out") ?? ".frames-build");
const PROVENANCE = "lib/cards/frame-sources.json";
const MANIFEST = JSON.parse(fs.readFileSync("lib/frames/frame-manifest.json", "utf8")).files;
const W = 1500;
const H = 2100;
const TEMPLATE = "prepare";
const PREPARE_WEBP = { ...WEBP, alphaQuality: 100 };

const sourceDirs = [
  ...(flag("--masters") ? [path.resolve(flag("--masters"))] : []),
  ...(process.env.FRAMES_BUILD_DIR ? [path.resolve(process.env.FRAMES_BUILD_DIR)] : []),
  path.resolve(".frames-cache"),
  path.resolve(".frames-build"),
];

/** A published master's local copy, at the manifest's sha256. */
function published(rel) {
  const want = MANIFEST[`${rel}.png`]?.sha256;
  if (!want) throw new Error(`${rel}.png is not in lib/frames/frame-manifest.json`);
  for (const dir of sourceDirs) {
    const file = path.join(dir, `${rel}.png`);
    if (!fs.existsSync(file)) continue;
    if (createHash("sha256").update(fs.readFileSync(file)).digest("hex") === want) return { file, sha: want };
  }
  throw new Error(`no copy of ${rel}.png at the manifest's sha256 (${want.slice(0, 12)}) under ${sourceDirs.join(", ")} — node scripts/frames-fetch.mjs`);
}

async function raw(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== W || info.height !== H) throw new Error(`${file}: ${info.width}×${info.height}, expected ${W}×${H}`);
  return data;
}

const clamp8 = (v) => Math.max(0, Math.min(255, Math.round(v)));
const at = (x, y) => (y * W + x) * 4;

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** The per-channel median of a region. */
function regionMedian(px, x0, x1, y0, y1) {
  const ch = [[], [], []];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let c = 0; c < 3; c++) ch[c].push(px[at(x, y) + c]);
  return ch.map(median);
}

const PRINT_KEYS = Object.keys(R.print);
const meanOf = (field) =>
  R.print[PRINT_KEYS[0]][field].map((_, i) => PRINT_KEYS.reduce((s, k) => s + R.print[k][field][i], 0) / PRINT_KEYS.length);

/** The key's bevel ratios: its own, or (m, c — no plain printing) the mean of the five. */
function bevelOf(key) {
  const own = R.print[key];
  return {
    nameTop: own?.nameTop ?? meanOf("nameTop"),
    nameBottom: own?.nameBottom ?? meanOf("nameBottom"),
    typeTop: own?.typeTop ?? meanOf("typeTop"),
    typeBottom: own?.typeBottom ?? meanOf("typeBottom"),
  };
}

/** The page box's gain: print page box ÷ print left box, per channel (m, c:
 *  the mean of the five keys' gains). */
function pageGainOf(key) {
  const gain = (k) => R.print[k].pageBox.map((v, i) => v / R.print[k].leftBox[i]);
  if (R.print[key]) return gain(key);
  const all = PRINT_KEYS.map(gain);
  return [0, 1, 2].map((i) => all.reduce((s, g) => s + g[i], 0) / all.length);
}

/** Bar fill toning: print fill ÷ the source bar's fill per channel; a channel
 *  under 20 in the source moves by the difference. Identity without a print. */
function toneOf(printFill, sourceFill) {
  if (!printFill) return [0, 1, 2].map(() => (v) => v);
  return [0, 1, 2].map((c) =>
    sourceFill[c] < 20 ? (v) => v + (printFill[c] - sourceFill[c]) : (v) => (v * printFill[c]) / sourceFill[c],
  );
}

/** Light a pixel by a luminance ratio: above 1 the luminance step is added,
 *  below 1 a multiply. */
function lit(rgb, ratio, level) {
  if (ratio >= 1) return rgb.map((v) => v + (ratio - 1) * level);
  return rgb.map((v) => v * ratio);
}

// ---- the bars' shape ----------------------------------------------------------
const SS = 4; // supersamples per axis

/** Coverage of a bar's outer and inner shapes at pixel (x, y). */
function barCoverage(x, y, bar) {
  const [y0, y1] = bar.rows;
  const top = y0;
  const bottom = y1 + 1;
  const yc = (top + bottom) / 2;
  const b = (bottom - top) / 2;
  const { cx, a } = R.bars.end;
  const t = R.bars.outline;
  let outer = 0;
  let inner = 0;
  for (let sy = 0; sy < SS; sy++) {
    const py = y + (sy + 0.5) / SS;
    for (let sx = 0; sx < SS; sx++) {
      const px = x + (sx + 0.5) / SS;
      const inside = (left, tp, bt, ea, eb) => {
        if (px < left || py < tp || py > bt) return false;
        if (px <= cx) return true;
        const dy = (py - yc) / eb;
        if (Math.abs(dy) >= 1) return false;
        return px <= cx + ea * Math.sqrt(1 - dy * dy);
      };
      if (inside(R.bars.x0, top, bottom, a, b)) outer++;
      if (inside(R.bars.x0 + t, top + t, bottom - t, a - t, b - t)) inner++;
    }
  }
  return { outer: outer / (SS * SS), inner: inner / (SS * SS) };
}

// ---- the build ----------------------------------------------------------------
/**
 * One master: `spec.base` is the frame the card's creature wears (its
 * field, bars and left box), `spec.pageBase` the frame its page's rim and
 * box are read from (the same buffer for a one-colour key; for a pair, the
 * two colours ramped about the page), `spec.bars` the adventure master
 * whose page bars are toned onto print (`spec.tones`: print's fills, or
 * null — untoned), `spec.bevel` print's bevel ratios, `spec.gainAt(x)` the
 * page box's gain at column x, `spec.strip` print's strip median (or null
 * — the strip keeps its own level).
 */
async function buildMaster(spec) {
  let stripShift = [0, 0, 0];
  const base = spec.base;
  const pageBase = spec.pageBase;
  const adv = spec.bars;
  const out = Buffer.from(base);
  const set = (x, y, rgb) => {
    const o = at(x, y);
    out[o] = clamp8(rgb[0]);
    out[o + 1] = clamp8(rgb[1]);
    out[o + 2] = clamp8(rgb[2]);
    out[o + 3] = 255;
  };
  const get = (px, x, y) => {
    const o = at(x, y);
    return [px[o], px[o + 1], px[o + 2]];
  };

  // 1. the left box's right edge
  const E = R.leftBoxEdge;
  for (let y = E.rows[0]; y <= E.rows[1]; y++) for (let i = 0; i < E.width; i++) set(E.toCol + i, y, get(base, E.fromCol + i, y));

  // 2. the rim
  for (let x = R.rim.cols[0]; x <= R.rim.cols[1]; x++) {
    const pin = get(pageBase, x, R.rim.sourceRow);
    for (let y = R.rim.rows[0]; y <= R.rim.rows[1]; y++) set(x, y, pin);
  }

  // 3. the strip under the page: the base's frame field beside the art
  //    window, a quarter turn, toned onto print's strip
  {
    const S = R.strip;
    // Each block's rows, then the blocks joined, the last `crossFade` rows of
    // one blended into the first of the next (weights 1/7 … 6/7).
    const want = S.rows[1] - S.rows[0] + 1;
    const blockRows = S.blocks.map((block) => {
      const [from, to] = block.fieldCols;
      const step = to >= from ? 1 : -1;
      const out = [];
      for (let col = from; col !== to + step; col += step) {
        out.push(Array.from({ length: S.cols[1] - S.cols[0] + 1 }, (_, j) => get(base, col, block.sourceRow0 + j)));
      }
      return out;
    });
    const fade = S.crossFade ?? 0;
    let rows = blockRows[0];
    for (const next of blockRows.slice(1)) {
      const head = rows.slice(0, rows.length - fade);
      const blended = Array.from({ length: fade }, (_, t) => {
        const w = (t + 1) / (fade + 1);
        return rows[rows.length - fade + t].map((p, j) => p.map((v, c) => v * (1 - w) + next[t][j][c] * w));
      });
      rows = [...head, ...blended, ...next.slice(fade)];
    }
    if (rows.length < want) throw new Error(`the strip's blocks fill ${rows.length} of ${want} rows`);
    rows = rows.slice(0, want);
    const own = [0, 1, 2].map((c) => median(rows.flatMap((r) => r.map((p) => p[c]))));
    const shift = spec.strip ? spec.strip.map((v, c) => v - own[c]) : [0, 0, 0];
    rows.forEach((pixels, i) => {
      const shade = S.shadow[i] ?? 1;
      pixels.forEach((p, j) => set(S.cols[0] + j, S.rows[0] + i, p.map((v, c) => (v + shift[c]) * shade)));
    });
    stripShift = shift;
  }

  // 4. the page's box
  const P = R.pageBox;
  const ungained = (x, y) =>
    (y >= P.ungained.rows[0] && y <= P.ungained.rows[1]) || (x >= P.ungained.cols[0] && x <= P.ungained.cols[1]);
  const page = new Map();
  for (let y = P.rows[0]; y <= P.rows[1]; y++) for (let x = P.cols[0]; x <= P.cols[1]; x++) page.set(y * W + x, get(pageBase, x, y));
  for (let i = 0; i < P.left.cols; i++) for (let y = P.rows[0]; y <= P.rows[1]; y++) page.set(y * W + P.left.toCol + i, get(pageBase, P.left.fromCol + i, y + P.left.rowOffset));
  for (let i = 0; i < P.top.rows; i++) for (let x = P.cols[0]; x <= P.cols[1]; x++) {
    // The top edge's own left end: the base box's corner, moved with it.
    const from = x < P.left.toCol + P.left.cols ? P.left.fromCol + (x - P.left.toCol) : x;
    page.set((P.top.toRow + i) * W + x, get(pageBase, from, P.top.fromRow + i));
  }
  for (let i = 0; i < P.bottom.rows; i++) for (let x = P.cols[0]; x <= P.cols[1]; x++) {
    page.set((P.bottom.toRow + i) * W + x, get(pageBase, x, P.bottom.fromRow + i));
  }
  for (const [i, rgb] of page) {
    const x = i % W;
    const y = Math.floor(i / W);
    const gain = spec.gainAt(x);
    set(x, y, ungained(x, y) ? rgb : rgb.map((v, c) => v * gain[c]));
  }

  // The page as it stands under the bars: the overlay's rounded bar ends
  // are cut against it (pageOverlay).
  const underBars = Buffer.from(out);

  // 5. the bars
  const bevel = spec.bevel;
  const bars = {};
  for (const name of ["name", "type"]) {
    const bar = R.bars[name];
    const t = R.bars.outline;
    const innerTop = bar.rows[0] + t;
    const innerBottom = bar.rows[1] - t;
    const [s0, s1] = bar.sourceRows;
    const sourceRowOf = (y) => Math.round(s0 + ((y - innerTop) * (s1 - s0)) / Math.max(1, innerBottom - innerTop));
    const srcCol = (x) => Math.max(R.bars.sourceCols.min, Math.min(R.bars.sourceCols.max, x + R.bars.sourceCols.offset));
    // The source bar's fill, where the print's was read (the print's
    // name fill 1338..1344 × 800..1240, its type fill 1450..1496 × 1100..1385).
    const sourceFill =
      name === "name"
        ? regionMedian(adv, srcCol(800), srcCol(1240), sourceRowOf(1338), sourceRowOf(1344))
        : regionMedian(adv, srcCol(1100), srcCol(1385), sourceRowOf(1450), sourceRowOf(1496));
    const tone = toneOf(spec.tones?.[`${name}Fill`], sourceFill);
    const toned = sourceFill.map((v, c) => tone[c](v));
    const level = (toned[0] + toned[1] + toned[2]) / 3;
    const top = bevel[`${name}Top`];
    const bottom = bevel[`${name}Bottom`];
    bars[name] = { sourceFill, toned };
    const xEnd = Math.ceil(R.bars.end.cx + R.bars.end.a) + 1;
    for (let y = bar.rows[0]; y <= bar.rows[1]; y++) {
      const ratio = y >= bar.topRow && y < bar.topRow + top.length
        ? top[y - bar.topRow]
        : y >= bar.bottomRow && y < bar.bottomRow + bottom.length
          ? bottom[y - bar.bottomRow]
          : 1;
      const sy = Math.max(s0, Math.min(s1, sourceRowOf(y)));
      for (let x = R.bars.x0; x <= xEnd; x++) {
        const cov = barCoverage(x, y, bar);
        if (cov.outer === 0) continue;
        const fill = lit(get(adv, srcCol(x), sy).map((v, c) => tone[c](v)), ratio, level);
        const under = get(out, x, y);
        set(
          x,
          y,
          under.map((v, c) => v * (1 - cov.outer) + fill[c] * cov.inner),
        );
      }
    }
  }

  // 6. the page's outline
  const O = R.outline;
  const darken = (x, y, alpha) => set(x, y, get(out, x, y).map((v) => v * (1 - alpha)));
  for (const [col, alpha] of Object.entries(O.left.cols)) for (let y = O.left.rows[0]; y <= O.left.rows[1]; y++) darken(Number(col), y, alpha);
  for (const edge of [O.top, O.bottom]) {
    for (const [row, alpha] of Object.entries(edge.rows)) {
      // The left line already darkened its own columns: the corner takes the
      // darker of the two, never both.
      for (let x = edge.cols[0]; x <= edge.cols[1]; x++) {
        const leftAlpha = O.left.cols[x] ?? 0;
        if (alpha <= leftAlpha) continue;
        darken(x, Number(row), 1 - (1 - alpha) / (1 - leftAlpha));
      }
    }
  }
  return { out, underBars, bars, stripShift };
}

/** A one-colour key's master (TODO 4.27's seven keys; 4.26 changes none of
 *  their bytes). */
async function buildKey(key) {
  const baseSrc = published(R.base[key]);
  const barSrc = published(R.barSources[key]);
  const base = await raw(baseSrc.file);
  const gain = pageGainOf(key);
  const built = await buildMaster({
    base,
    pageBase: base,
    bars: await raw(barSrc.file),
    tones: R.print[key] ?? null,
    bevel: bevelOf(key),
    gainAt: () => gain,
    strip: R.print[key]?.strip ?? null,
  });
  return { ...built, key, gain, baseSha: baseSrc.sha, barSha: barSrc.sha };
}

// ---- the pairs (TODO 4.26) ------------------------------------------------------
const PR = R.pairs;
/** The second colour's share at column x of a ramp [from, to]. */
const share = ([from, to], x) => (x <= from ? 0 : x >= to ? 1 : (x - from) / (to - from));

/** Two masters lerped per column by `shareAt` into `out` over `rows` ×
 *  `cols` — premultiplied, as scripts/lib/pair-ramp.mjs lerps. */
function lerpInto(out, left, right, shareAt, rows, cols) {
  for (let y = rows[0]; y <= rows[1]; y++) {
    for (let x = cols[0]; x <= cols[1]; x++) {
      const t = shareAt(x);
      const o = at(x, y);
      const la = left[o + 3] / 255;
      const ra = right[o + 3] / 255;
      const a = la * (1 - t) + ra * t;
      for (let c = 0; c < 3; c++) out[o + c] = a === 0 ? 0 : clamp8((left[o + c] * la * (1 - t) + right[o + c] * ra * t) / a);
      out[o + 3] = clamp8(a * 255);
    }
  }
}

/** A pair key's master (`wu`, `wu-h`): the M15 pair master of its dress,
 *  the creature's left box and the pinline under the boxes ramped onto
 *  print's columns, the page's rim and box ramped about the page's centre,
 *  the bars in the dress's tone (gold, or the hybrid's grey). */
async function buildPair(pair, dressName) {
  const dress = PR.dresses[dressName];
  const [k1, k2] = [pair[0], pair[1]];
  const pairRel = dress.base.replace("{pair}", pair);
  const pairSrc = published(pairRel);
  const leftSrc = published(R.base[k1]);
  const rightSrc = published(R.base[k2]);
  const barSrc = published(dress.barSource);
  const left = await raw(leftSrc.file);
  const right = await raw(rightSrc.file);
  // The creature's frame: the pair master, its left box and bottom pinline
  // re-ramped onto print's columns (the field and bars stay the master's).
  const base = await raw(pairSrc.file);
  lerpInto(base, left, right, (x) => share(PR.creatureRamp, x), PR.creatureZone.rows, PR.creatureZone.cols);
  lerpInto(base, left, right, (x) => share(PR.pinlineRamp, x), PR.pinlineZone.rows, PR.pinlineZone.cols);
  // The page's rim and box: the two colours about the page's centre.
  const pageBase = Buffer.alloc(W * H * 4);
  lerpInto(pageBase, left, right, (x) => share(PR.pageRamp, x), [0, H - 1], [0, W - 1]);
  const g1 = pageGainOf(k1);
  const g2 = pageGainOf(k2);
  const built = await buildMaster({
    base,
    pageBase,
    bars: await raw(barSrc.file),
    tones: dress,
    bevel: dress,
    gainAt: (x) => {
      const t = share(PR.pageRamp, x);
      return [0, 1, 2].map((c) => g1[c] * (1 - t) + g2[c] * t);
    },
    strip: dress.strip ?? R.print[k2]?.strip ?? null,
  });
  return {
    ...built,
    key: dressName === "hybrid" ? `${pair}-h` : pair,
    sources: [pairRel, R.base[k1], R.base[k2], dress.barSource],
    shas: [pairSrc.sha, leftSrc.sha, rightSrc.sha, barSrc.sha],
  };
}

/** The page overlay of a built master (R.page): the page cut out at even
 *  HD px, see-through where the creature's own pixels belong (the
 *  outline's soft left column and bottom rows), and right of the rim only
 *  the bars' rounded ends — their colour un-blended from the page under
 *  them, their alpha the bar's coverage — so over another master they
 *  composite as the bars were drawn over this one. */
function pageOverlay(built) {
  const G = R.page;
  const w = G.cols[1] - G.cols[0] + 1;
  const h = G.rows[1] - G.rows[0] + 1;
  const buf = Buffer.alloc(w * h * 4);
  for (let y = G.rows[0]; y <= G.rows[1]; y++) {
    for (let x = G.cols[0]; x <= G.cols[1]; x++) {
      const o = at(x, y);
      const d = ((y - G.rows[0]) * w + (x - G.cols[0])) * 4;
      const clear = (x >= G.clearCols[0] && x <= G.clearCols[1]) || (y >= G.clearRows[0] && y <= G.clearRows[1]);
      if (clear) continue;
      if (x <= G.rimRight) {
        for (let c = 0; c < 3; c++) buf[d + c] = built.out[o + c];
        buf[d + 3] = 255;
        continue;
      }
      let cov = 0;
      for (const bar of [R.bars.name, R.bars.type]) if (y >= bar.rows[0] && y <= bar.rows[1]) cov = barCoverage(x, y, bar).outer;
      if (cov === 0) continue;
      for (let c = 0; c < 3; c++) buf[d + c] = clamp8((built.out[o + c] - built.underBars[o + c] * (1 - cov)) / cov);
      buf[d + 3] = clamp8(cov * 255);
    }
  }
  return { buf, w, h };
}

async function write(rel, out, w = W, h = H, folder = TEMPLATE) {
  const png = path.join(outDir, folder, `${rel}.png`);
  fs.mkdirSync(path.dirname(png), { recursive: true });
  const image = sharp(out, { raw: { width: w, height: h, channels: 4 } });
  await image.clone().png({ compressionLevel: 9 }).toFile(png);
  const webp = png.replace(/\.png$/, ".webp");
  await image.clone().webp(PREPARE_WEBP).toFile(webp);
  const { data: back, info } = await sharp(webp).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== w || info.height !== h) throw new Error(`${webp}: ${info.width}×${info.height}, expected ${w}×${h}`);
  for (let i = 0; i < w * h; i++) {
    if (back[i * 4 + 3] !== out[i * 4 + 3]) throw new Error(`${webp}: alpha differs from the PNG's at ${i % w},${Math.floor(i / w)} (${back[i * 4 + 3]} ≠ ${out[i * 4 + 3]})`);
  }
  return png;
}

/** Write a master and its page overlay (`page/<key>`). */
async function emit(key, built) {
  if (dryRun) {
    console.log(`${key}: built (dry run)`);
    return;
  }
  const png = await write(key, built.out);
  const overlay = pageOverlay(built);
  const pagePng = await write(`page/${key}`, overlay.buf, overlay.w, overlay.h);
  console.log(`wrote ${path.relative(process.cwd(), png)} + ${path.relative(process.cwd(), pagePng)} (+ .webp, alpha equal)`);
}

const fmt = (rgb) => rgb.map((v) => Math.round(v)).join("/");
if (parts.has("prepare")) {
const colors = {};
const sourceFiles = new Set();
for (const key of R.keys) {
  const built = await buildKey(key);
  const { baseSha, barSha, gain, bars, stripShift } = built;
  sourceFiles.add(`${R.base[key]}.png`).add(`${R.barSources[key]}.png`);
  colors[key] = [
    `${R.base[key]}.png (published, sha256 ${baseSha.slice(0, 12)})`,
    `its page bars from ${R.barSources[key]}.png (published, sha256 ${barSha.slice(0, 12)})`,
    `page box gain ${gain.map((g) => g.toFixed(3)).join(" / ")}; strip shift ${stripShift.map((v) => Math.round(v)).join(" / ")}; name bar ${bars.name.sourceFill.join("/")} → ${bars.name.toned.map((v) => Math.round(v)).join("/")}, type bar ${bars.type.sourceFill.join("/")} → ${bars.type.toned.map((v) => Math.round(v)).join("/")}${R.print[key] ? "" : " (no plain printing: the bars untoned, the gain the five keys' mean)"}`,
  ];
  await emit(key, built);
}
// TODO 4.26: the twenty pair masters (both dresses of the ten pairs).
for (const dressName of ["split", "hybrid"]) {
  for (const pair of PR.list) {
    const built = await buildPair(pair, dressName);
    for (const rel of built.sources) sourceFiles.add(`${rel}.png`);
    colors[built.key] = [
      ...built.sources.map((rel, i) => `${rel}.png (published, sha256 ${built.shas[i].slice(0, 12)})`),
      `the ${dressName === "hybrid" ? "hybrid (grey bars)" : "gold-split"} dress: the left box ramped ${PR.creatureRamp.join("→")}, the bottom pinline ${PR.pinlineRamp.join("→")}, the page's rim and box ${PR.pageRamp.join("→")}; strip shift ${fmt(built.stripShift)}; name bar ${built.bars.name.sourceFill.join("/")} → ${fmt(built.bars.name.toned)}, type bar ${built.bars.type.sourceFill.join("/")} → ${fmt(built.bars.type.toned)}`,
    ];
    await emit(built.key, built);
  }
}

if (!dryRun) {
  const provenance = fs.existsSync(PROVENANCE) ? JSON.parse(fs.readFileSync(PROVENANCE, "utf8")) : {};
  provenance[TEMPLATE] = {
    source: "pipglyph",
    converter: "scripts/build-prepare-frames.mjs",
    derivedFrom:
      'the published m15/<key> masters (m15artifact/c for c), the published m15/<pair> and m15/<pair>-h pair masters, and the published adventure/<key> masters\' page bars (Card Conjurer imports: see "m15", "m15artifact" and "adventure")',
    output: `${W}x${H}, the base's corners, webp q${WEBP.quality} with the PNG's alpha exactly; page/<key> ${R.page.cols[1] - R.page.cols[0] + 1}x${R.page.rows[1] - R.page.rows[0] + 1} at x ${R.page.cols[0]}, y ${R.page.rows[0]}`,
    recipe: {
      leftBoxEdge: `the base box's right edge (cols ${R.leftBoxEdge.fromCol}..${R.leftBoxEdge.fromCol + R.leftBoxEdge.width - 1}) moved to ${R.leftBoxEdge.toCol}..`,
      rim: `cols ${R.rim.cols.join("..")} x rows ${R.rim.rows.join("..")}: the base's pinline (row ${R.rim.sourceRow}) per column`,
      strip: `rows ${R.strip.rows.join("..")}: the base's frame field (cols ${R.strip.blocks.map((b) => `${b.fieldCols.join("..")} from row ${b.sourceRow0}`).join(", then ")}, cross-faded over ${R.strip.crossFade} rows) turned a quarter, each channel moved onto print's strip median, the page's shadow on it`,
      pageBox: `cols ${R.pageBox.cols.join("..")} x rows ${R.pageBox.rows.join("..")}: the base box's paper x a per-key gain, its top / left / bottom edges the base box's own, moved`,
      bars: `name rows ${R.bars.name.rows.join("..")}, type ${R.bars.type.rows.join("..")}, from x ${R.bars.x0}: the adventure master's page bars (rows ${R.bars.name.sourceRows.join("..")} / ${R.bars.type.sourceRows.join("..")}) toned onto print and lit by the prints' bevel; the shape (square left end, half-ellipse right end centred x ${R.bars.end.cx}, ${R.bars.end.a} px across) and its ${R.bars.outline} px outline DRAWN, flat black`,
      outline: "the page's left, top and bottom outline DRAWN, flat black at the prints' coverage",
      pairs: `TODO 4.26: the M15 pair master of the dress, its left box (rows ${PR.creatureZone.rows.join("..")}, cols ${PR.creatureZone.cols.join("..")}) and the pinline under the boxes (rows ${PR.pinlineZone.rows.join("..")}) re-lerped from the two one-colour m15 masters (shares ${PR.creatureRamp.join("→")} / ${PR.pinlineRamp.join("→")}); the page read from the two one-colour masters lerped ${PR.pageRamp.join("→")}, its box's gain the two keys' lerped the same way; the bars from ${PR.dresses.split.barSource} (gold) or ${PR.dresses.hybrid.barSource} (the hybrid's grey) toned onto print`,
      page: `page/<key>: the master's page, cols ${R.page.cols.join("..")} x rows ${R.page.rows.join("..")} (col ${R.page.clearCols[0]} and rows ${R.page.clearRows.join("..")} see-through; right of x ${R.page.rimRight} only the bars' ends at their coverage, un-blended from the page under them)`,
    },
    colors,
    sourceFiles: [...sourceFiles].sort(),
    notes: [
      "PipGlyph's own derivation (TODO 4.27): neither Card Conjurer (its fork ends June 2024) nor MSE has the Prepare frame (Secrets of Strixhaven, 2026). Every painted pixel is a published master's — moved, toned, lerped or darkened — except the bars' outline and the page's outline, which are flat black geometry at the prints' coverage.",
      `The numbers are scripts/lib/prepare-2026.mjs (${R.scope}, measured ${R.measuredOn}; the pairs and pages 2026-10-21 on the two-colour and part-colour printings named there); no scan is read by the build.`,
      "m and c have no plain printing as a creature's frame: they exist so that no colour resolves to a missing master and stay unticked until a print shows them; `page/m` is a gold spell of three colours or more.",
      "TODO 4.26: the page is the SPELL's (print colours it by the spell — a hybrid spell's grey page, Abigale SOS #170): `page/<key>` is drawn over the creature's master where the spell's page key differs (lib/cards/part-color.ts), opt-in per card (frame_style.partColor).",
    ],
  };
  writeProvenance(provenance);
}
}

function writeProvenance(provenance) {
  const sorted = Object.fromEntries(Object.keys(provenance).sort().map((k) => [k, provenance[k]]));
  fs.writeFileSync(PROVENANCE, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`provenance → ${PROVENANCE}`);
}

// ---- TODO 4.27b: the extended-art Prepare dress -----------------------------------
// `extendedartprepare/<key>`: the PUBLISHED extended-art master above the
// type bar and beside the box, the PUBLISHED Prepare master below it (its
// box, page, strip and outline — wherever its build changed the M15 base, and
// everywhere inside the side fields, where the extended-art pack is M15's
// pixels), the extended-art master's own shadow carried onto the shadow rows
// (scripts/lib/prepare-2026.mjs PREPARE_EXTENDED). No pixel is drawn. It
// reads the published Prepare masters (sha-checked), not this run's: run it
// after `prepare` is published.

/** The dress of one key: [buffer, the three sources with their shas]. */
async function buildExtended(key) {
  const X = PREPARE_EXTENDED;
  const extRel = `extendedart/${X.extendedKey[key] ?? key}`;
  const prepRel = `prepare/${key}`;
  // (A pair's Prepare master was built on the M15 pair master of its dress:
  // m15/<pair> or m15/<pair>-h.)
  const baseRel = R.base[key] ?? `m15/${key}`;
  const srcs = [published(extRel), published(prepRel), published(baseRel)];
  const [ext, prep, base] = await Promise.all(srcs.map((s) => raw(s.file)));
  const out = Buffer.from(ext);
  let fromPrepare = 0;
  for (let y = X.cutRow; y < H; y++) {
    const shadow = y >= X.shadowRows[0] && y <= X.shadowRows[1];
    for (let x = 0; x < W; x++) {
      const o = at(x, y);
      const inside = x >= X.cols[0] && x <= X.cols[1];
      const touched = !inside && (prep[o] !== base[o] || prep[o + 1] !== base[o + 1] || prep[o + 2] !== base[o + 2] || prep[o + 3] !== base[o + 3]);
      if (!inside && !touched) continue;
      fromPrepare++;
      for (let c = 0; c < 4; c++) {
        const delta = shadow ? ext[o + c] - base[o + c] : 0;
        out[o + c] = clamp8(prep[o + c] + delta);
      }
    }
  }
  return { out, srcs: [extRel, prepRel, baseRel].map((rel, i) => ({ rel, sha: srcs[i].sha })), fromPrepare };
}

if (parts.has("extended")) {
  const X = PREPARE_EXTENDED;
  const keys = [...R.keys, ...PR.list, ...PR.list.map((p) => `${p}-h`)];
  const colors = {};
  const sourceFiles = new Set();
  for (const key of keys) {
    const built = await buildExtended(key);
    for (const s of built.srcs) sourceFiles.add(`${s.rel}.png`);
    colors[key] = [
      ...built.srcs.map((s, i) => `${s.rel}.png (published, sha256 ${s.sha.slice(0, 12)})${["", " — below the type bar", " — the M15 base it was built on"][i]}`),
      `${built.fromPrepare} px from the Prepare master; the extended-art shadow carried onto rows ${X.shadowRows.join("–")}`,
    ];
    if (dryRun) {
      console.log(`${X.template}/${key}: built (dry run)`);
      continue;
    }
    const png = await write(key, built.out, W, H, X.template);
    console.log(`wrote ${path.relative(process.cwd(), png)} (+ .webp, alpha equal)`);
  }
  if (!dryRun) {
    const provenance = fs.existsSync(PROVENANCE) ? JSON.parse(fs.readFileSync(PROVENANCE, "utf8")) : {};
    provenance[X.template] = {
      source: "pipglyph",
      converter: "scripts/build-prepare-frames.mjs --only extended",
      derivedFrom:
        'the published extendedart/<key> masters (extendedart/a for c; Card Conjurer imports: see "extendedart"), the published prepare/<key> masters (PipGlyph\'s: see "prepare") and the published m15 masters they were built on',
      output: `${W}x${H}, the extended-art master's corners and art window, webp q${WEBP.quality} with the PNG's alpha exactly`,
      recipe: {
        merge: `rows 0..${X.cutRow - 1}: the extended-art master; from row ${X.cutRow}: the Prepare master inside cols ${X.cols.join("..")} and wherever its build changed the M15 base, the extended-art master's own side fields elsewhere`,
        shadow: `rows ${X.shadowRows.join("..")}: the extended-art master's difference from M15 (its black type bar's shadow) added to the Prepare master's pixels`,
      },
      colors,
      sourceFiles: [...sourceFiles].sort(),
      notes: [
        "PipGlyph's own derivation (TODO 4.27b): the extended-art Prepare printings (SOS #309–342, SOC #63–98, FRA #425–430) print the extended-art frame over the Prepare frame's lower half. Card Conjurer's extended-art pack is M15's pixels below its type bar (inside x 100–1400 byte for byte from row 1320 but blue's paper, within 10 levels), so the dress merges two published masters; no pixel is drawn.",
        `The numbers are scripts/lib/prepare-2026.mjs PREPARE_EXTENDED (measured ${X.measuredOn} on the masters); no scan is read by the build.`,
        "Below the type bar the dress holds the Prepare master's pixels wherever the holofoil stamp's notch, the page overlays (prepare/page/<key>) and the P/T plate read, so those serve it unchanged.",
        "c is the pack's silver artifact frame over prepare/c (m15artifact/c's): no colourless Prepare is printed, and the see-through Eldrazi frame has no box under it.",
      ],
    };
    writeProvenance(provenance);
  }
}
