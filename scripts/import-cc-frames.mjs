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
// / m15land profiles draw over their masters), and 4.21a's portrait layouts
// (flip with its two P/T plates cut per half, adventure, aftermath).
//
//   node scripts/import-cc-frames.mjs                 # every template
//   node scripts/import-cc-frames.mjs --only m15,m15land
//   node scripts/import-cc-frames.mjs --only m15crown   # the crown band only
//   node scripts/import-cc-frames.mjs --dry-run       # print the recipe only
//   CC_CACHE=/path  (source cache; default ~/.cache/pipglyph-cc/<commit>)
//   --out <dir>     (default .frames-build — gitignored)
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
// (re-cut templates) a band moved down before the downscale (recut),
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
import {
  CC_COMMIT,
  CC_OVERLAY_BANDS,
  CC_RAW,
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
  cutThroughMask,
  describeCrownBand,
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
  rectPx,
  retintStructure,
  roundCornersRgba8,
  shiftRows,
  sourceFilesFor,
  toRgba8,
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
  const unknown = only.filter((t) => !CC_TEMPLATES[t] && !CC_OVERLAY_BANDS[t]);
  if (unknown.length) {
    console.error(
      `✗ Unknown template(s): ${unknown.join(", ")}. Known: ${[...Object.keys(CC_TEMPLATES), ...Object.keys(CC_OVERLAY_BANDS)].join(", ")}`,
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
  if (!CC_TEMPLATES[template] && !CC_OVERLAY_BANDS[template]) delete provenance[template];
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
    // A re-cut template's band, moved onto the prints (TODO 4.49, 4.49 (b)).
    const recut = def.recut ? recutBand(composite, W, H, def.recut) : composite;
    // A ray's top closed over by the frame (the emblem's spark, 4.52).
    const bridged = def.bridge ? bridgeRayTip(recut, W, H, def.bridge) : recut;
    // Toned regions, onto the prints' tone (the emblem's silver, name pill,
    // type pill and text box, 4.52), in order.
    const native = (def.tones ?? []).reduce((img, tone) => applyTone(img, W, H, tone), bridged);
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
    ...(def.recut ? { recut: def.recut } : {}),
    ...(def.bridge ? { bridge: def.bridge } : {}),
    ...(def.tones ? { tones: def.tones } : {}),
    sourceFiles: sourceFilesFor(def),
    notes: def.notes,
  };
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
    const r = crownBandRecipe(key);
    recipe[key] = describeCrownBand(r);
    const out = path.join(outDir, folder, `${key}.png`);
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
    output: `${OUT_W}x${band.rows} overlay band: rows 0–${band.rows - 1} of a ${OUT_W}x${OUT_H} card composited at ${W}x${H}, corners rounded to ${CORNER_RADIUS}px, webp q${WEBP.quality}`,
    colors: recipe,
    sourceFiles: crownBandSourceFiles(def.keys),
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
