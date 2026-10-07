#!/usr/bin/env node
// ---------------------------------------------------------------------------
// import-cc-frames.mjs — build the M15-era frame masters from Card Conjurer's
// frame packs into .frames-build/ (frames plan 4.3; owner decision
// 2026-09-25: Card Conjurer art for the M15 era, MSE for showcase families
// and the old borders). Later runs of the same importer: 4.32's borderless
// frame (m15borderless, m15borderlessartifact), 4.34's borderless land
// (m15borderlessland, a composite of the same pack's pixels) and 4.39's
// full-art basics (m15fullartland, fullartland), 4.49 (b)'s text-box tokens
// (m15tokentext, m15tokenartifacttext), re-cut onto the prints, 4.49's
// textless-token re-cut (m15token, m15tokenartifact moved onto the prints),
// 4.48 / 4.50's full-art tokens (m20token, m20tokentext, m20tokentall and
// their artifact templates; the textless pair re-cut 5 px onto the prints),
// 4.33's borderless planeswalkers (m15borderlesspw, m15borderlesspwtall),
// 4.6a's legendary crown band (m15crown, an overlay the m15 / m15artifact
// / m15land profiles draw over their masters), 4.21a's portrait layouts
// (flip with its two P/T plates cut per half, adventure, aftermath) and
// 4.21c's saga (the ribbon in the masters; its chapter badge and row divider
// published beside them).
//
//   node scripts/import-cc-frames.mjs                 # every template
//   node scripts/import-cc-frames.mjs --only m15,m15land
//   node scripts/import-cc-frames.mjs --only m15crown   # the crown band only
//   node scripts/import-cc-frames.mjs --only m15dfccrown,m15dfccrownright,m15mdfccrown
//                                                     # the double-faced bodies'
//                                                     # crowns (5.1d): our m15crown
//                                                     # band cut round the well —
//                                                     # needs the published band
//                                                     # under <out> or .frames-cache
//   node scripts/import-cc-frames.mjs --only m15mdfcfront,m15mdfcback,m15mdfclandfront,m15mdfclandback
//                                                     # the modal bodies AND their
//                                                     # flipside strip riders (5.1c:
//                                                     # strip/<key>.png, cut from the
//                                                     # published masters after the
//                                                     # templates — this run's output
//                                                     # first, else a local copy at the
//                                                     # manifest's sha256)
//   node scripts/import-cc-frames.mjs --only m15holostamp,m15pwholostamp
//                                                     # the stamp notches (4.9c:
//                                                     # the colour keys and the
//                                                     # ten pair keys)
//   node scripts/import-cc-frames.mjs --dry-run       # print the recipe only
//   CC_CACHE=/path  (source cache; default ~/.cache/pipglyph-cc/<commit>)
//   --out <dir>     (default .frames-build — gitignored)
//   FRAMES_BUILD_DIR=<dir>  (the sha-checked masters a notch's rim is tinted
//                            from when <out> has none; default .frames-cache)
//
// For each template × colour it downloads the pack files from the PINNED
// commit (cached outside the repo), composites the layers through their
// masks at the pack's NATIVE size in CC's draw order (2010×2814 for the
// accurate M15 pack), downscales once with Lanczos to 1500×2100, cuts the
// one card corner (lib/cards/card-corner.ts, 64.5 px), checks the edge
// contract (7.7), the corner (3.26) and the art window (7.6), and writes
// <out>/<template>/<colour>.png + .webp (and a template's two-colour pair
// masters, <pair>.png / <pair>-h.png, TODO 4.6b), plus P/T plates at native size
// under pt/, a basic land's mana-symbol discs at native size under symbol/,
// (re-cut templates) a band moved down before the downscale (recut), or
// a block moved up in two pieces (recutUp: the flip masters' lower half),
// (the emblem) its spark's ray bridged over and its regions toned onto the
// prints,
// and a planeswalker's loyalty shield cut out of each master under loyalty/.
// An overlay band (CC_OVERLAY_BANDS: the crown) is composited the same way
// on the full card, then cropped to the rows it covers: <out>/<folder>/<key>.png
// + .webp. Provenance (which source files made which frame, and every
// substitution) goes to lib/cards/frame-sources.json.
//
// Nothing here touches public/frames or any bucket. Next:
//   npm run frames:publish -- --source .frames-build [--only …] --write
// (docs/FRAMES.md). The converted frames are never committed — see
// scripts/lib/cc-frames.mjs for why.
// ---------------------------------------------------------------------------
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createHash } from "node:crypto";
import {
  CC_COMMIT,
  CC_OVERLAY_BANDS,
  DFC_CROWN_TWIN_SIZE,
  HOLO_STAMP_NOTCHES,
  cutCrownBand,
  cutCrownFindings,
  cutCrownRecipe,
  cutCrownSourceFiles,
  describeCutCrown,
  placeTwin,
  NOTCH_FOOT,
  buildNotch,
  columnTintGap,
  describeColumnTint,
  describeNotch,
  footRunsSolid,
  notchFindings,
  notchSourceFiles,
  sampleBar,
  sampleBarColumns,
  CC_RAW,
  CC_RIDERS,
  CC_REPO,
  CC_TEMPLATES,
  COLORS,
  CORNER_RADIUS,
  OUT_H,
  OUT_W,
  TINTED_BOX_STRUCTURE,
  WEBP,
  builtColors,
  compositeFinish,
  compositeLayers,
  cropRows,
  crownBandFindings,
  crownBandRecipe,
  crownBandSourceFiles,
  cutStripRider,
  cutThroughMask,
  describeCrownBand,
  describeStripRider,
  describeFinish,
  describeLayer,
  applyTone,
  boundsPx,
  bridgeRayTip,
  describePtCut,
  finishFor,
  flatPixelAt,
  placeOnCanvas,
  recutBand,
  recutBlockUp,
  rectPx,
  retintStructure,
  roundCornersRgba8,
  shiftRows,
  sourceFilesFor,
  toRgba8,
  tonesFor,
  stripRiderInterior,
  stripRiderFindings,
  stripRiderKeys,
  stripRiderSourceOf,
} from "./lib/cc-frames.mjs";
import { blendPair } from "./lib/pair-ramp.mjs";
// The edge contract (TODO 7.7) and its corner check (TODO 3.26) — the same
// checks CI runs on every master (tests/unit/frames/edge-contract.test.ts),
// here after the downscale and the corner cut.
import {
  cornerViolations,
  edgeContractFor,
  edgeContractViolations,
  isKnownEdgeFailure,
} from "../lib/frames/edge-contract.ts";
// The art-window coverage (TODO 7.6) — the check CI runs on every master
// (tests/unit/render/art-window-coverage.test.ts), here on the flattened
// master after the downscale has anti-aliased the window edge. The art
// slots are the frame profiles' own (lib/cards/template-layout.ts), read
// through the "@/" alias hook — a dynamic import, so the hook is in place.
import { artWindowFindings, artWindowSlotsOf, artWindowVerdict } from "../lib/frames/art-window.ts";
import "./lib/ts-alias-hooks.mjs";

const { getFrameProfile, underFrameArtRect, underFrameArtSlot } = await import("../lib/cards/template-layout.ts");

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? "") : null;
};
const dryRun = args.includes("--dry-run");
const only = flag("--only")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
const outDir = path.resolve(flag("--out") ?? ".frames-build");
const cacheDir = process.env.CC_CACHE ?? path.join(os.homedir(), ".cache", "pipglyph-cc", CC_COMMIT);
const PROVENANCE = "lib/cards/frame-sources.json";

if (only) {
  const unknown = only.filter((t) => !CC_TEMPLATES[t] && !CC_OVERLAY_BANDS[t] && !CC_RIDERS[t] && !HOLO_STAMP_NOTCHES[t]);
  if (unknown.length) {
    console.error(
      `✗ Unknown template(s): ${unknown.join(", ")}. Known: ${[...Object.keys(CC_TEMPLATES), ...Object.keys(CC_OVERLAY_BANDS), ...Object.keys(CC_RIDERS), ...Object.keys(HOLO_STAMP_NOTCHES)].join(", ")}`,
    );
    process.exit(1);
  }
}

async function fetchCached(rel) {
  const file = path.join(cacheDir, rel);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const res = await fetch(`${CC_RAW}/${rel}`, { headers: { "User-Agent": "PipGlyph-cc-import/1.0" } });
  if (!res.ok) throw new Error(`${res.status} fetching ${rel} from ${CC_REPO}@${CC_COMMIT.slice(0, 7)}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/** Raw RGBA of an image at the working size (SVG masks rasterise sharp). */
async function rgba(file, width, height) {
  const { data } = await sharp(file, { density: 300 })
    .resize(width, height, { fit: "fill", kernel: "lanczos3" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

async function writeMaster(bytes, pngFile) {
  fs.mkdirSync(path.dirname(pngFile), { recursive: true });
  const image = sharp(bytes, { raw: { width: OUT_W, height: OUT_H, channels: 4 } });
  await image.clone().png({ compressionLevel: 9 }).toFile(pngFile);
  await image.clone().webp(WEBP).toFile(pngFile.replace(/\.png$/, ".webp"));
}

async function writeCutout(bytes, box, pngFile) {
  fs.mkdirSync(path.dirname(pngFile), { recursive: true });
  const image = sharp(bytes, { raw: { width: box.width, height: box.height, channels: 4 } });
  await image.clone().png({ compressionLevel: 9 }).toFile(pngFile);
  await image.clone().webp(WEBP).toFile(pngFile.replace(/\.png$/, ".webp"));
}

async function writePlate(src, pngFile) {
  fs.mkdirSync(path.dirname(pngFile), { recursive: true });
  // Plates keep their native size; the renderer scales them into the slot.
  const image = sharp(await fetchCached(src));
  await image.clone().png({ compressionLevel: 9 }).toFile(pngFile);
  await image.clone().webp(WEBP).toFile(pngFile.replace(/\.png$/, ".webp"));
}

const provenance = fs.existsSync(PROVENANCE) ? JSON.parse(fs.readFileSync(PROVENANCE, "utf8")) : {};
const edgeFailures = [];
const artWindowFailures = [];
// Drop templates the recipe no longer builds (e.g. deferred ones).
for (const template of Object.keys(provenance)) {
  if (!CC_TEMPLATES[template] && !CC_OVERLAY_BANDS[template] && !CC_RIDERS[template] && !HOLO_STAMP_NOTCHES[template]) delete provenance[template];
}
for (const [template, def] of Object.entries(CC_TEMPLATES)) {
  if (only && !only.includes(template)) continue;
  const recipe = {};
  for (const key of builtColors(def)) {
    recipe[key] = def.colors[key].map(describeLayer);
    const out = path.join(outDir, template, `${key}.png`);
    // This colour's PipGlyph composites (a composite may name its colours:
    // round 14's colourless type pill is the plain templates' `c` only).
    const finish = finishFor(def, key);
    if (dryRun) {
      console.log(`${path.relative(process.cwd(), out)} ← ${recipe[key].join(" + ")}${finish.length ? `, then ${finish.map(describeFinish).join("; ")}` : ""}`);
      continue;
    }
    // Work at the base layer's native size; downscale once at the end.
    const baseFile = await fetchCached(def.colors[key][0].src);
    const { width: W, height: H } = await sharp(baseFile).metadata();
    const images = [];
    for (const l of def.colors[key]) {
      // A layer at CC's bounds (TODO 4.6f: the floating crown, its outline
      // and the erased strip) is resized to its box and placed on a clear
      // canvas, as CC draws an image at its bounds; a whole-canvas layer is
      // resized to the canvas. A pair layer (TODO 4.6b, pairLayer): its two
      // files blended across the region's untilted ramp
      // (scripts/lib/pair-ramp.mjs) first — a placed pair on the canvas, so
      // the ramp's % of the card's width is the card's.
      const box = l.at ? rectPx(l.at, W, H) : null;
      const load = async (src) =>
        box ? placeOnCanvas(await rgba(await fetchCached(src), box.width, box.height), box, W, H) : await rgba(await fetchCached(src), W, H);
      let data = l.right ? blendPair(await load(l.src), await load(l.right), W, H, l.ramp) : await load(l.src);
      if (l.retint) {
        // 4.34's tinted box: a neutral structure re-tinted to the flat tint
        // read from another frame (both asserted flat where they are read).
        const { from, tintOf } = l.retint;
        const flat = flatPixelAt(data, W, H, TINTED_BOX_STRUCTURE.flatAt);
        if (from.some((v, c) => v !== flat[c])) {
          throw new Error(`${l.src}: its flat box is ${flat.slice(0, 3)}, the recipe says ${from} (the source moved?)`);
        }
        const tint = flatPixelAt(await rgba(await fetchCached(tintOf.src), W, H), W, H, tintOf);
        data = retintStructure(data, from, tint.slice(0, 3));
      }
      // 4.34's type bar: the title bar moved down onto it.
      if (l.dy) data = shiftRows(data, W, H, l.dy);
      images.push({
        data,
        mask: l.mask ? await rgba(await fetchCached(l.mask), W, H) : undefined,
        invert: l.invert,
        opacity: l.opacity,
        replace: l.replace,
        erase: l.erase,
        gain: l.gain,
        recolour: l.recolour,
        lumaRamp: l.lumaRamp,
      });
    }
    const flat = toRgba8(compositeLayers(images, W, H));
    // PipGlyph composites over CC's flattened pixels (the full-art tokens'
    // type pill darkened and solid, the artifact name pill slate and solid;
    // owner decisions 2026-09-29), before any re-cut: the masks are the
    // pack's geometry.
    const composite = finish.length
      ? compositeFinish(
          flat,
          W,
          H,
          finish,
          Object.fromEntries(
            await Promise.all(finish.map(async (f) => [f.mask, await rgba(await fetchCached(f.mask), W, H)])),
          ),
        )
      : flat;
    // A re-cut template's band, moved onto the prints (TODO 4.49, 4.49 (b));
    // the flip masters' lower half, moved up in two pieces (4.21a, v39).
    const recut = def.recut
      ? recutBand(composite, W, H, def.recut)
      : def.recutUp
        ? recutBlockUp(composite, W, H, def.recutUp)
        : composite;
    // A ray's top closed over by the frame (the emblem's spark, 4.52).
    const bridged = def.bridge ? bridgeRayTip(recut, W, H, def.bridge) : recut;
    // Toned regions, onto the prints' tone (the emblem's silver, name pill,
    // type pill and text box, 4.52; the transform backs' bars and box through
    // the pack's masks, per key — 5.1a), in order.
    const tones = tonesFor(def, key);
    const toneMasks = Object.fromEntries(
      await Promise.all([...new Set(tones.flatMap((t) => (t.mask ? [t.mask] : [])))].map(async (m) => [m, await rgba(await fetchCached(m), W, H)])),
    );
    const native = tones.reduce((img, tone) => applyTone(img, W, H, tone, toneMasks), bridged);
    const master = await sharp(native, { raw: { width: W, height: H, channels: 4 } })
      .resize(OUT_W, OUT_H, { fit: "fill", kernel: "lanczos3" })
      .raw()
      .toBuffer();
    roundCornersRgba8(master, OUT_W, OUT_H, CORNER_RADIUS);
    // A crowned twin (4.6f) is held to its own edges where they differ.
    const contract = edgeContractFor(template, key);
    if (!contract) {
      edgeFailures.push(`${template}/${key}: no edge contract declared (lib/frames/edge-contract.ts)`);
    } else if (!isKnownEdgeFailure(template, key)) {
      for (const v of [
        ...edgeContractViolations(contract, master, OUT_W, OUT_H),
        ...cornerViolations(contract, master, OUT_W, OUT_H),
      ]) {
        edgeFailures.push(`${template}/${key} ${v}`);
      }
    }
    {
      // A known failure fails only when it got worse than its entry's bound.
      const profile = getFrameProfile(template);
      const findings = artWindowFindings(master, OUT_W, OUT_H, artWindowSlotsOf(profile, underFrameArtRect(profile, key), underFrameArtSlot(profile, key)));
      const verdict = artWindowVerdict(template, key, findings);
      for (const v of verdict.fails) artWindowFailures.push(`${template}/${key} ${v}`);
      if (verdict.fixed) console.log(`${template}/${key}: its art window passes now — strike it from ART_WINDOW_KNOWN_FAILURES (lib/frames/art-window.ts)`);
    }
    await writeMaster(master, out);
    console.log(`wrote ${path.relative(process.cwd(), out)} (+ .webp) from ${W}×${H}`);
    if (def.shield) {
      const mask = await rgba(await fetchCached(def.shield.mask), OUT_W, OUT_H);
      const { box } = def.shield;
      const shield = cutThroughMask(master, mask, OUT_W, box);
      await writeCutout(shield, box, path.join(outDir, template, "loyalty", `${key}.png`));
    }
  }
  for (const [key, why] of Object.entries(def.excluded ?? {})) {
    recipe[key] = [`NOT IMPORTED — ${why}`];
    if (dryRun) console.log(`${template}/${key}: skipped — ${why}`);
  }
  const plates = def.plates ? { ...def.plates } : undefined;
  if (plates && !dryRun) {
    for (const key of COLORS) await writePlate(plates[key], path.join(outDir, template, "pt", `${key}.png`));
    console.log(`wrote ${template} plates`);
  }
  const symbols = def.symbols ? { ...def.symbols } : undefined;
  if (symbols && !dryRun) {
    for (const [key, src] of Object.entries(symbols)) {
      await writePlate(src, path.join(outDir, template, "symbol", `${key}.png`));
    }
    console.log(`wrote ${template} symbol discs (${Object.keys(symbols).join(", ")})`);
  }
  // A pack's two-plate P/T image (4.21a's flip): drawn at its bounds on the
  // card, as CC draws it, and cut through each half mask into that plate's
  // box — pt/<colour>-top.png, pt/<colour>-bottom.png, native size.
  if (def.ptCut && !dryRun) {
    const { image, bounds, masks, boxes } = def.ptCut;
    const at = boundsPx(bounds, OUT_W, OUT_H);
    const maskData = Object.fromEntries(
      await Promise.all(Object.entries(masks).map(async ([name, src]) => [name, await rgba(await fetchCached(src), OUT_W, OUT_H)])),
    );
    for (const key of COLORS) {
      const file = await fetchCached(image[key]);
      const { width: iw, height: ih } = await sharp(file).metadata();
      const canvas = placeOnCanvas(await rgba(file, iw, ih), { ...at, width: iw, height: ih }, OUT_W, OUT_H);
      for (const [name, box] of Object.entries(boxes)) {
        const plate = cutThroughMask(canvas, maskData[name], OUT_W, box);
        await writeCutout(plate, box, path.join(outDir, template, "pt", `${key}-${name}.png`));
      }
    }
    console.log(`wrote ${template} plates (${Object.keys(boxes).map((n) => `pt/<colour>-${n}.png`).join(", ")})`);
  }
  // A pack's own bitmaps published beside the masters (4.21c's saga: the
  // chapter badge and the row divider), native size: <template>/<name>.png.
  const pieces = def.pieces ? { ...def.pieces } : undefined;
  if (pieces && !dryRun) {
    for (const [name, src] of Object.entries(pieces)) await writePlate(src, path.join(outDir, template, `${name}.png`));
    console.log(`wrote ${template} pieces (${Object.keys(pieces).map((n) => `${n}.png`).join(", ")})`);
  }
  // Masks a LATER recipe reads (the two-colour saga's pair masters, TODO
  // 4.6f): fetched into the cache so the pinned commit's bytes are at hand,
  // listed in provenance, never written to the build folder.
  if (def.maskInputs && !dryRun) {
    for (const src of Object.values(def.maskInputs)) await fetchCached(src);
  }
  provenance[template] = {
    source: "cardconjurer",
    repo: CC_REPO,
    commit: CC_COMMIT,
    ...(def.pack ? { pack: def.pack } : {}),
    converter: "scripts/import-cc-frames.mjs",
    output: `${OUT_W}x${OUT_H}, corners rounded to ${CORNER_RADIUS}px, webp q${WEBP.quality}`,
    ...(def.transforms ? { transforms: def.transforms } : {}),
    colors: recipe,
    ...(def.finish ? { finish: def.finish.map(describeFinish) } : {}),
    ...(def.excluded ? { excluded: def.excluded } : {}),
    ...(plates ? { plates } : {}),
    ...(symbols ? { symbols: { ...symbols, output: "symbol/<colour>.png, native size" } } : {}),
    ...(def.shield ? { shield: { mask: def.shield.mask, box: def.shield.box, output: "loyalty/<colour>.png" } } : {}),
    ...(def.ptCut ? { ptCut: describePtCut(def.ptCut, OUT_W, OUT_H) } : {}),
    ...(pieces ? { pieces: { ...pieces, output: "<name>.png, native size" } } : {}),
    ...(def.maskInputs ? { maskInputs: { ...def.maskInputs, output: "not published — importer inputs for a later recipe" } } : {}),
    ...(def.recut ? { recut: def.recut } : {}),
    ...(def.recutUp ? { recutUp: def.recutUp } : {}),
    ...(def.bridge ? { bridge: def.bridge } : {}),
    // Per-key tones (a function) are recorded key by key.
    ...(def.tones
      ? { tones: typeof def.tones === "function" ? Object.fromEntries(builtColors(def).map((key) => [key, def.tones(key)])) : def.tones }
      : {}),
    sourceFiles: sourceFilesFor(def),
    notes: def.notes,
  };
}
// The published m15crown band a cut band reads (TODO 5.1d): this run's own
// output when the band was built in it, else a local copy — FRAMES_BUILD_DIR,
// .frames-cache (frames-fetch.mjs) or .frames-build — whose bytes are the
// manifest's (sha256), so a cut is always over the band the bucket serves.
const MANIFEST_FILE = path.resolve("lib/frames/frame-manifest.json");
const manifestFiles = fs.existsSync(MANIFEST_FILE) ? JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8")).files ?? {} : {};
function manifestShaOf(rel) {
  return manifestFiles[rel]?.sha256 ?? null;
}
function publishedBand(rel) {
  const want = manifestShaOf(`${rel}.png`);
  if (!want) throw new Error(`cut band: ${rel}.png is not in lib/frames/frame-manifest.json — publish the band first`);
  const dirs = [outDir, ...(process.env.FRAMES_BUILD_DIR ? [path.resolve(process.env.FRAMES_BUILD_DIR)] : []), path.resolve(".frames-cache"), path.resolve(".frames-build")];
  for (const dir of dirs) {
    const file = path.join(dir, `${rel}.png`);
    if (!fs.existsSync(file)) continue;
    const sha = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (sha === want) return { file, sha };
    console.log(`cut band: ${path.relative(process.cwd(), file)} is not the published band (${sha.slice(0, 12)} ≠ ${want.slice(0, 12)}) — skipped`);
  }
  throw new Error(`cut band: no copy of ${rel}.png at the manifest's sha256 under ${dirs.map((d) => path.relative(process.cwd(), d) || ".").join(", ")} — build it (--only m15crown) or fetch the bucket's (scripts/frames-fetch.mjs)`);
}

// A published MASTER a cut reads (TODO 5.1c: the strip riders): this run's
// own output when the template was built in it (the master that is about to
// be published), else a local copy at the manifest's sha256 (FRAMES_BUILD_DIR,
// .frames-cache, .frames-build) — a piece is always cut from the bytes the
// bucket serves.
function localMaster(rel) {
  const own = path.join(outDir, `${rel}.png`);
  if (fs.existsSync(own)) return { file: own, sha: createHash("sha256").update(fs.readFileSync(own)).digest("hex"), fresh: true };
  const want = manifestShaOf(`${rel}.png`);
  if (!want) throw new Error(`strip rider: ${rel}.png is neither in this run's output nor in lib/frames/frame-manifest.json — build or publish the master first`);
  for (const dir of [...(process.env.FRAMES_BUILD_DIR ? [path.resolve(process.env.FRAMES_BUILD_DIR)] : []), path.resolve(".frames-cache"), path.resolve(".frames-build")]) {
    const file = path.join(dir, `${rel}.png`);
    if (!fs.existsSync(file)) continue;
    const sha = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (sha === want) return { file, sha, fresh: false };
    console.log(`strip rider: ${path.relative(process.cwd(), file)} is not the published master (${sha.slice(0, 12)} ≠ ${want.slice(0, 12)}) — skipped`);
  }
  throw new Error(`strip rider: no copy of ${rel}.png at the manifest's sha256 — build it (--only <template>) or fetch the bucket's (scripts/frames-fetch.mjs)`);
}

// The flipside strip riders (TODO 5.1c): each modal template's masters' tabs
// cut through the pack's Flipside mask (the full-alpha interior eroded by
// one pixel and snapped to the HD grid's 2 × 2 px blocks — a piece over its
// own master is then byte-identical at HD and at the 750 bake) into
// <out>/<template>/strip/<key>.png + .webp, from the
// PUBLISHED masters (localMaster) — after the template loop, so a template
// built in this run cuts from its own fresh output; the extra `l` key from
// the land pair's grey `c` master.
for (const [template, def] of Object.entries(CC_TEMPLATES)) {
  if (!def.strip || (only && !only.includes(template))) continue;
  const spec = def.strip;
  const recipe = {};
  const sources = {};
  const stripFailures = [];
  let inside = null;
  for (const key of stripRiderKeys(spec)) {
    const out = path.join(outDir, template, "strip", `${key}.png`);
    const src = stripRiderSourceOf(template, key, spec);
    sources[key] = `${src}.png`;
    if (dryRun) {
      recipe[key] = describeStripRider(template, key, spec, manifestShaOf(`${src}.png`) ?? "(unpublished)");
      console.log(`${path.relative(process.cwd(), out)} ← ${recipe[key].join(" + ")}`);
      continue;
    }
    const { file, sha, fresh } = localMaster(src);
    recipe[key] = describeStripRider(template, key, spec, sha);
    const { data: master, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== OUT_W || info.height !== OUT_H) throw new Error(`${file} is ${info.width}×${info.height}, not ${OUT_W}×${OUT_H}`);
    inside ??= stripRiderInterior(await rgba(await fetchCached(spec.mask), OUT_W, OUT_H), OUT_W, OUT_H, spec);
    const piece = cutStripRider(master, inside, OUT_W, spec.box);
    const findings = stripRiderFindings(piece, master, inside, OUT_W, OUT_H, spec.box);
    for (const f of findings.failures) stripFailures.push(`${template}/strip/${key}: ${f}`);
    await writeCutout(piece, spec.box, out);
    console.log(`wrote ${path.relative(process.cwd(), out)} (+ .webp) ${spec.box.width}×${spec.box.height} from ${path.relative(process.cwd(), file)}${fresh ? " (this run)" : ` (published ${sha.slice(0, 12)})`}: ${findings.opaque} opaque px, 0 partial`);
  }
  for (const f of stripFailures) edgeFailures.push(f);
  if (!dryRun && provenance[template]) {
    provenance[template].strip = {
      mask: spec.mask,
      box: spec.box,
      erodePx: spec.erode,
      snapPx: spec.snap,
      keys: stripRiderKeys(spec),
      sources,
      output: "strip/<key>.png (+ .webp), the piece's box at 1:1",
      colors: recipe,
    };
  }
}
// Overlay bands (TODO 4.6a: the legendary crown). Composited on the full card
// at the pack's native size in CC's order — the black cover, then the crown
// (a pair's two crowns lerped through the untilted crown ramp) — downscaled
// once, the card corner cut, checked, then cropped to the band's rows.
for (const [folder, def] of Object.entries(CC_OVERLAY_BANDS)) {
  if (only && !only.includes(folder)) continue;
  const { band } = def;
  const recipe = {};
  const { width: W, height: H } = band.compositeSize;
  const coverBox = rectPx(band.cover, W, H);
  const crownBox = rectPx(band.crown, W, H);
  let cover = null;
  const bandFailures = [];
  const m15Art = getFrameProfile("m15").artSlot;
  for (const key of def.keys) {
    const out = path.join(outDir, folder, `${key}.png`);
    if (def.layers) {
      // A generic band (TODO 4.6f, wave 2b: the extended-art crown): placed
      // layers at CC's bounds in CC's draw order over a clear canvas, then
      // the band's own findings.
      const layers = def.layers(key);
      recipe[key] = layers.map(describeLayer);
      if (dryRun) {
        console.log(`${path.relative(process.cwd(), out)} ← ${recipe[key].join(" + ")}`);
        continue;
      }
      const images = [{ data: Buffer.alloc(W * H * 4) }];
      for (const l of layers) {
        const box = rectPx(l.at, W, H);
        const load = async (src) => placeOnCanvas(await rgba(await fetchCached(src), box.width, box.height), box, W, H);
        const data = l.right ? blendPair(await load(l.src), await load(l.right), W, H, l.ramp) : await load(l.src);
        images.push({ data, erase: l.erase });
      }
      const composite = toRgba8(compositeLayers(images, W, H));
      const full =
        W === OUT_W && H === OUT_H
          ? composite
          : await sharp(composite, { raw: { width: W, height: H, channels: 4 } }).resize(OUT_W, OUT_H, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer();
      roundCornersRgba8(full, OUT_W, OUT_H, CORNER_RADIUS);
      const findings = def.findings(full, OUT_W, OUT_H, band.rows);
      for (const f of findings.failures) bandFailures.push(`${folder}/${key}: ${f}`);
      const cropped = cropRows(full, OUT_W, band.rows);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const image = sharp(cropped, { raw: { width: OUT_W, height: band.rows, channels: 4 } });
      await image.clone().png({ compressionLevel: 9 }).toFile(out);
      await image.clone().webp(WEBP).toFile(out.replace(/\.png$/, ".webp"));
      console.log(
        `wrote ${path.relative(process.cwd(), out)} (+ .webp) ${OUT_W}×${band.rows} at ${W}×${H}: last alpha row ${findings.lastAlphaRow}, outline peak row ${findings.peakRow}, cover ${findings.cover.join(",")}`,
      );
      continue;
    }
    if (def.cut) {
      // A cut band (TODO 5.1d: the double-faced bodies' crowns): our
      // published m15crown band — read from this run's output or a local
      // copy at the manifest's sha256 — cut through the CC twin's alpha
      // round the well (scripts/lib/cc-frames.mjs cutCrownBand).
      const r = cutCrownRecipe(folder, key);
      if (dryRun) {
        recipe[key] = describeCutCrown(folder, key, manifestShaOf(`${r.band}.png`) ?? "(unpublished)");
        console.log(`${path.relative(process.cwd(), out)} ← ${recipe[key].join(" + ")}`);
        continue;
      }
      const { file: bandFile, sha: bandSha } = publishedBand(r.band);
      recipe[key] = describeCutCrown(folder, key, bandSha);
      const bandPixels = await sharp(bandFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (bandPixels.info.width !== OUT_W || bandPixels.info.height !== band.rows) throw new Error(`${bandFile} is ${bandPixels.info.width}×${bandPixels.info.height}, the band is ${OUT_W}×${band.rows}`);
      const twinFile = await fetchCached(r.twin);
      const twinMeta = await sharp(twinFile).metadata();
      if (twinMeta.width !== DFC_CROWN_TWIN_SIZE.width || twinMeta.height !== DFC_CROWN_TWIN_SIZE.height) throw new Error(`${r.twin} is ${twinMeta.width}×${twinMeta.height}, the twins are 1418×350 (the source moved?)`);
      const twin = placeTwin(await sharp(twinFile).ensureAlpha().raw().toBuffer(), band.rows);
      const { piece, circle, refLuma } = cutCrownBand(bandPixels.data, twin, r.well, OUT_W, band.rows);
      const findings = cutCrownFindings(piece, bandPixels.data, twin, r.well, circle, OUT_W, band.rows);
      for (const f of findings.failures) bandFailures.push(`${folder}/${key}: ${f}`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const image = sharp(piece, { raw: { width: OUT_W, height: band.rows, channels: 4 } });
      await image.clone().png({ compressionLevel: 9 }).toFile(out);
      await image.clone().webp(WEBP).toFile(out.replace(/\.png$/, ".webp"));
      const well = circle ? `the well's circle (${circle.cx.toFixed(1)}, ${circle.cy.toFixed(1)}) r ${circle.r.toFixed(1)} (fit ${circle.maxErr.toFixed(2)} px)` : "the housing's teardrop";
      console.log(
        `wrote ${path.relative(process.cwd(), out)} (+ .webp) ${OUT_W}×${band.rows}: ${well}, its hole ending at row ${findings.holeBottom}, twin leg luma ${refLuma.toFixed(1)}, fill ${findings.fillMean?.join(",")} vs the band's leg ${findings.legMean?.join(",")}`,
      );
      continue;
    }
    const r = crownBandRecipe(key);
    recipe[key] = describeCrownBand(r);
    if (dryRun) {
      console.log(`${path.relative(process.cwd(), out)} ← ${recipe[key].join(" + ")}`);
      continue;
    }
    cover ??= placeOnCanvas(await rgba(await fetchCached(r.cover), coverBox.width, coverBox.height), coverBox, W, H);
    const place = async (src) => placeOnCanvas(await rgba(await fetchCached(src), crownBox.width, crownBox.height), crownBox, W, H);
    // A pair: the two crowns blended across the crown ramp by the same
    // helper the pair masters use (scripts/lib/pair-ramp.mjs blendPair).
    const left = await place(r.left);
    const crown = r.right ? blendPair(left, await place(r.right), W, H, r.ramp) : left;
    const composite = toRgba8(compositeLayers([{ data: cover }, { data: crown }], W, H));
    const full = await sharp(composite, { raw: { width: W, height: H, channels: 4 } })
      .resize(OUT_W, OUT_H, { fit: "fill", kernel: "lanczos3" })
      .raw()
      .toBuffer();
    roundCornersRgba8(full, OUT_W, OUT_H, CORNER_RADIUS);
    const findings = crownBandFindings(full, OUT_W, OUT_H, band.rows, m15Art);
    if (findings.lastAlphaRow >= band.rows) bandFailures.push(`${folder}/${key}: alpha down to row ${findings.lastAlphaRow}, past the band's ${band.rows} rows`);
    if (Math.abs(findings.peakRow - 42) > 2) bandFailures.push(`${folder}/${key}: crown peak at row ${findings.peakRow}, the prints' is 42 ± 2`);
    if (findings.artMaxAlpha > 127) bandFailures.push(`${folder}/${key}: α ${findings.artMaxAlpha} over the M15 art slot (a shadow only: ≤ 127)`);
    const cropped = cropRows(full, OUT_W, band.rows);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const image = sharp(cropped, { raw: { width: OUT_W, height: band.rows, channels: 4 } });
    await image.clone().png({ compressionLevel: 9 }).toFile(out);
    await image.clone().webp(WEBP).toFile(out.replace(/\.png$/, ".webp"));
    console.log(
      `wrote ${path.relative(process.cwd(), out)} (+ .webp) ${OUT_W}×${band.rows} from ${W}×${H}: last alpha row ${findings.lastAlphaRow}, peak row ${findings.peakRow}, art slot α ≤ ${findings.artMaxAlpha} (${findings.artPartialPct.toFixed(2)} % above 0.05)`,
    );
  }
  for (const f of bandFailures) edgeFailures.push(f);
  provenance[folder] = {
    source: "cardconjurer",
    repo: CC_REPO,
    commit: CC_COMMIT,
    pack: def.pack,
    converter: "scripts/import-cc-frames.mjs",
    kind: "overlay",
    output: def.cut
      ? `${OUT_W}x${band.rows} cut band: the published m15crown band (rows 0–${band.rows - 1}) cut through the twin's alpha round the well, webp q${WEBP.quality}`
      : `${OUT_W}x${band.rows} overlay band: rows 0–${band.rows - 1} of a ${OUT_W}x${OUT_H} card composited at ${W}x${H}, corners rounded to ${CORNER_RADIUS}px, webp q${WEBP.quality}`,
    colors: recipe,
    sourceFiles: def.cut
      ? cutCrownSourceFiles(folder)
      : def.layers
        ? sourceFilesFor({ colors: Object.fromEntries(def.keys.map((key) => [key, def.layers(key)])) })
        : crownBandSourceFiles(def.keys),
    ...(def.cut ? { bands: Object.fromEntries(def.keys.map((key) => [key, `m15crown/${key}.png`])) } : {}),
    notes: def.notes,
  };
}
// Rider sets (TODO 5.1a: the transform icon glyphs). Each file rasterised
// to the set's square size — sharp at density 300 for an SVG, Lanczos for a
// PNG — and written as <out>/<folder>/<key>.png + .webp. No card canvas, no
// corner, no edge contract: a rider is drawn inside a master's own well.
for (const [folder, def] of Object.entries(CC_RIDERS)) {
  if (only && !only.includes(folder)) continue;
  const recipe = {};
  for (const [key, src] of Object.entries(def.files)) {
    const out = path.join(outDir, folder, `${key}.png`);
    recipe[key] = [`${src} rasterised at ${def.size}×${def.size}`];
    if (dryRun) {
      console.log(`${path.relative(process.cwd(), out)} ← ${recipe[key].join(" + ")}`);
      continue;
    }
    const data = await rgba(await fetchCached(src), def.size, def.size);
    // The disc's corners must be clear and its glyph white: a rider that
    // fills its square would overdraw the well's ring.
    const corner = data[3];
    if (corner !== 0) throw new Error(`${folder}/${key}: the rider's corner is not clear (α ${corner})`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const image = sharp(data, { raw: { width: def.size, height: def.size, channels: 4 } });
    await image.clone().png({ compressionLevel: 9 }).toFile(out);
    await image.clone().webp(WEBP).toFile(out.replace(/\.png$/, ".webp"));
    console.log(`wrote ${path.relative(process.cwd(), out)} (+ .webp) ${def.size}×${def.size}`);
  }
  provenance[folder] = {
    source: "cardconjurer",
    repo: CC_REPO,
    commit: CC_COMMIT,
    pack: def.pack,
    converter: "scripts/import-cc-frames.mjs",
    kind: "rider",
    output: `${def.size}x${def.size} rider glyphs (a black disc, the glyph in white), webp q${WEBP.quality}`,
    colors: recipe,
    sourceFiles: [...Object.values(def.files)].sort(),
    notes: def.notes,
  };
}
// The holofoil stamp's notch pieces (TODO 4.9c): CC's arch geometry, the rim
// tinted to our master's bar, the oval region cut clear — see
// scripts/lib/cc-frames.mjs HOLO_STAMP_NOTCHES. Written 1:1 at the piece's
// native size (the slot stretches it over CC's bounds).
const masterDirs = [outDir, path.resolve(process.env.FRAMES_BUILD_DIR ?? ".frames-cache")];
function notchMasterPath(rel, what) {
  for (const dir of masterDirs) {
    const file = path.join(dir, `${rel}.png`);
    if (fs.existsSync(file)) return file;
  }
  throw new Error(`notch ${what}: no master ${rel}.png under ${masterDirs.join(" or ")} — build it, or fetch the bucket's with scripts/frames-fetch.mjs`);
}
async function notchMasterPixels(rel, what) {
  const file = notchMasterPath(rel, what);
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== OUT_W || info.height !== OUT_H) throw new Error(`${file} is ${info.width}×${info.height}, not ${OUT_W}×${OUT_H}`);
  return { file, data, width: info.width };
}
for (const [folder, def] of Object.entries(HOLO_STAMP_NOTCHES)) {
  if (only && !only.includes(folder)) continue;
  const recipe = {};
  const { width: PW, height: PH } = def.shape.size;
  let piece = null;
  const notchFailures = [];
  for (const key of def.keys) {
    const out = path.join(outDir, folder, `${key}.png`);
    const perColumn = def.rampKeys?.includes(key) === true;
    if (dryRun) {
      const unknown = perColumn ? Array.from({ length: PW }, () => ["?", "?", "?"]) : ["?", "?", "?"];
      console.log(`${path.relative(process.cwd(), out)} ← ${describeNotch(def, key, unknown).join(" + ")}`);
      continue;
    }
    if (!piece) {
      const file = await fetchCached(def.shape.src);
      const meta = await sharp(file).metadata();
      if (meta.width !== PW || meta.height !== PH) throw new Error(`${def.shape.src} is ${meta.width}×${meta.height}, the recipe says ${PW}×${PH} (the source moved?)`);
      piece = await sharp(file).ensureAlpha().raw().toBuffer();
      // The foot columns every key is checked at must be solid rim in CC's
      // piece: the published-object test reads them without the piece.
      const off = footRunsSolid(def.shape, piece, NOTCH_FOOT[folder]);
      if (off.length) throw new Error(`${folder}: NOTCH_FOOT row ${NOTCH_FOOT[folder].y} is not solid rim in ${def.shape.src} at x ${off.join(", ")}`);
    }
    const { file: masterFile, data: master, width } = await notchMasterPixels(def.barOf[key], key);
    // A flat key samples one column; a pair key reads the bar at every
    // column of the piece's bounds (its bar is the pinline ramp), and the
    // other masters the pair key is drawn over must hold the same bar.
    const tint = perColumn ? sampleBarColumns(master, width, def.barSample, def.shape) : sampleBar(master, width, def.barSample);
    if (perColumn) {
      for (const rel of def.barSharedBy?.[key] ?? []) {
        const shared = await notchMasterPixels(rel, `${key} (shared by ${rel})`);
        const gap = columnTintGap(tint, sampleBarColumns(shared.data, shared.width, def.barSample, def.shape));
        if (gap.max > def.barSample.tolerance) {
          notchFailures.push(`${folder}/${key}: ${rel}.png's bar under the notch differs from ${def.barOf[key]}.png's by ${gap.max} levels at piece column ${gap.at} — it needs its own key`);
        }
      }
    }
    const built = buildNotch(def.shape, piece, tint, def.oval, def.cutMarginPx);
    const findings = notchFindings(built, def.shape, piece, tint, def.oval, def.cutMarginPx, NOTCH_FOOT[folder]);
    for (const f of findings.failures) notchFailures.push(`${folder}/${key}: ${f}`);
    recipe[key] = describeNotch(def, key, tint);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const image = sharp(built, { raw: { width: PW, height: PH, channels: 4 } });
    await image.clone().png({ compressionLevel: 9 }).toFile(out);
    await image.clone().webp(WEBP).toFile(out.replace(/\.png$/, ".webp"));
    const rim = perColumn ? `per column (${describeColumnTint(def, tint)})` : tint.join(",");
    console.log(
      `wrote ${path.relative(process.cwd(), out)} (+ .webp) ${PW}×${PH}: rim ${rim} from ${path.relative(process.cwd(), masterFile)}, cut clear ${findings.cutClear}, ring black ${findings.ringBlack}, foot ${findings.footPx.slice(0, 3).join(",")}`,
    );
  }
  for (const f of notchFailures) edgeFailures.push(f);
  provenance[folder] = {
    source: "cardconjurer",
    repo: CC_REPO,
    commit: CC_COMMIT,
    pack: def.pack,
    converter: "scripts/import-cc-frames.mjs",
    kind: "overlay",
    output: `${PW}x${PH} notch piece (1:1 at ${OUT_W}x${OUT_H}, stretched over ${def.shape.bounds.leftPct}/${def.shape.bounds.topPct}/${def.shape.bounds.widthPct}×${def.shape.bounds.heightPct} %), the oval region cut to transparent, webp q${WEBP.quality}`,
    colors: recipe,
    cut: { oval: def.oval, marginPx: def.cutMarginPx, what: "the hologram capture inside CC's oval (WotC's planeswalker symbol tiled) — never published" },
    sourceFiles: notchSourceFiles(def),
    notes: def.notes,
  };
}
if (!dryRun) {
  const sorted = Object.fromEntries(Object.keys(provenance).sort().map((k) => [k, provenance[k]]));
  fs.writeFileSync(PROVENANCE, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`provenance → ${PROVENANCE}`);
}
if (edgeFailures.length) {
  console.error(`✗ ${edgeFailures.length} master(s) break their edge contract or corner check (TODO 7.7 / 3.26) — fix before publishing:`);
  for (const f of edgeFailures) console.error(`  ${f}`);
  process.exitCode = 1;
} else if (!dryRun) {
  console.log("edge contracts + corner check: every master honours its template's (TODO 7.7 / 3.26)");
}
if (artWindowFailures.length) {
  console.error(`✗ ${artWindowFailures.length} art window(s) escape their art slot (TODO 7.6) — fix the master or the slot before publishing:`);
  for (const f of artWindowFailures) console.error(`  ${f}`);
  process.exitCode = 1;
} else if (!dryRun) {
  console.log("art windows: every slot covers its master's window, 0.05 % to spare (TODO 7.6; known failures within their bounds)");
}
