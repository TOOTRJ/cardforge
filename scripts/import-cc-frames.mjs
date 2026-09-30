#!/usr/bin/env node
// ---------------------------------------------------------------------------
// import-cc-frames.mjs — build the M15-era frame masters from Card Conjurer's
// frame packs into .frames-build/ (frames plan 4.3; owner decision
// 2026-09-25: Card Conjurer art for the M15 era, MSE for showcase families
// and the old borders). Later runs of the same importer: 4.32's borderless
// frame (m15borderless, m15borderlessartifact) and 4.39's full-art basics
// (m15fullartland, fullartland), 4.49 (b)'s text-box tokens
// (m15tokentext, m15tokenartifacttext), re-cut onto the prints, 4.49's
// textless-token re-cut (m15token, m15tokenartifact moved onto the prints),
// and 4.33's borderless planeswalkers (m15borderlesspw, m15borderlesspwtall).
//
//   node scripts/import-cc-frames.mjs                 # every template
//   node scripts/import-cc-frames.mjs --only m15,m15land
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
// <out>/<template>/<colour>.png + .webp, plus P/T plates at native size
// under pt/, a basic land's mana-symbol discs at native size under symbol/,
// (re-cut templates) a band moved down before the downscale (recut),
// and a planeswalker's loyalty shield cut out of each master under loyalty/. Provenance (which source files made which
// frame, and every substitution) goes to lib/cards/frame-sources.json.
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
  CC_RAW,
  CC_REPO,
  CC_TEMPLATES,
  COLORS,
  CORNER_RADIUS,
  OUT_H,
  OUT_W,
  WEBP,
  builtColors,
  compositeLayers,
  cutThroughMask,
  describeLayer,
  recutBand,
  roundCornersRgba8,
  sourceFilesFor,
  toRgba8,
} from "./lib/cc-frames.mjs";
// The edge contract (TODO 7.7) and its corner check (TODO 3.26) — the same
// checks CI runs on every master (tests/unit/frames/edge-contract.test.ts),
// here after the downscale and the corner cut.
import {
  EDGE_CONTRACTS,
  cornerViolations,
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
  const unknown = only.filter((t) => !CC_TEMPLATES[t]);
  if (unknown.length) {
    console.error(`✗ Unknown template(s): ${unknown.join(", ")}. Known: ${Object.keys(CC_TEMPLATES).join(", ")}`);
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
for (const template of Object.keys(provenance)) if (!CC_TEMPLATES[template]) delete provenance[template];
for (const [template, def] of Object.entries(CC_TEMPLATES)) {
  if (only && !only.includes(template)) continue;
  const recipe = {};
  for (const key of builtColors(def)) {
    recipe[key] = def.colors[key].map(describeLayer);
    const out = path.join(outDir, template, `${key}.png`);
    if (dryRun) {
      console.log(`${path.relative(process.cwd(), out)} ← ${recipe[key].join(" + ")}`);
      continue;
    }
    // Work at the base layer's native size; downscale once at the end.
    const baseFile = await fetchCached(def.colors[key][0].src);
    const { width: W, height: H } = await sharp(baseFile).metadata();
    const images = [];
    for (const l of def.colors[key]) {
      images.push({
        data: await rgba(await fetchCached(l.src), W, H),
        mask: l.mask ? await rgba(await fetchCached(l.mask), W, H) : undefined,
        invert: l.invert,
        opacity: l.opacity,
        gain: l.gain,
        recolour: l.recolour,
        lumaRamp: l.lumaRamp,
      });
    }
    const composite = toRgba8(compositeLayers(images, W, H));
    // A re-cut template's band, moved onto the prints (TODO 4.49, 4.49 (b)).
    const native = def.recut ? recutBand(composite, W, H, def.recut) : composite;
    const master = await sharp(native, { raw: { width: W, height: H, channels: 4 } })
      .resize(OUT_W, OUT_H, { fit: "fill", kernel: "lanczos3" })
      .raw()
      .toBuffer();
    roundCornersRgba8(master, OUT_W, OUT_H, CORNER_RADIUS);
    const contract = EDGE_CONTRACTS[template];
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
  provenance[template] = {
    source: "cardconjurer",
    repo: CC_REPO,
    commit: CC_COMMIT,
    ...(def.pack ? { pack: def.pack } : {}),
    converter: "scripts/import-cc-frames.mjs",
    output: `${OUT_W}x${OUT_H}, corners rounded to ${CORNER_RADIUS}px, webp q${WEBP.quality}`,
    ...(def.transforms ? { transforms: def.transforms } : {}),
    colors: recipe,
    ...(def.excluded ? { excluded: def.excluded } : {}),
    ...(plates ? { plates } : {}),
    ...(symbols ? { symbols: { ...symbols, output: "symbol/<colour>.png, native size" } } : {}),
    ...(def.shield ? { shield: { mask: def.shield.mask, box: def.shield.box, output: "loyalty/<colour>.png" } } : {}),
    ...(def.recut ? { recut: def.recut } : {}),
    sourceFiles: sourceFilesFor(def),
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
