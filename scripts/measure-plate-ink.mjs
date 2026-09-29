#!/usr/bin/env node
// ---------------------------------------------------------------------------
// measure-plate-ink.mjs — where each stat PLATE master puts ink (layout v33,
// TODO 3.29): the table in lib/cards/plate-ink.ts that the rules layout keeps
// its lines out of (lib/cards/rules-layout.ts statKeepOuts — the P/T plate,
// the planeswalker's loyalty shield).
//
// Every plate a profile draws (`plateAssetPathTemplate`: <template>/pt/ and
// <template>/loyalty/, one PNG per colour key) is read at full size; its ink
// is the bounding box of the pixels at least half covered (alpha ≥ 128 — the
// plate's own body, not the faint drop shadow around it), united over every
// colour. It is printed as fractions of the plate image, which both renderers
// stretch over the plate's box (plateRect, else the stat's rect) — so the
// numbers hold wherever a profile or an override puts that box.
//
// Bucket plates (lib/frames/frame-manifest.json) are read from a local build
// — FRAMES_BUILD_DIR, else .frames-build — and only when the file's sha256 is
// the manifest's; git plates from public/frames. A plate this machine can't
// read is reported and skipped.
//
// It also prints the manifest hash of every bucket plate it measured: paste
// that block into tests/unit/cards/plate-ink.test.ts (MEASURED_ON), which
// fails in CI the moment the manifest points a plate at another file — a
// replaced bucket plate can't keep a stale keep-out (CI has no bucket
// frames to re-measure).
//
//   FRAMES_BUILD_DIR=… node scripts/measure-plate-ink.mjs          # table
//   FRAMES_BUILD_DIR=… node scripts/measure-plate-ink.mjs --json   # JSON
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, "public", "frames");
const BUILD = process.env.FRAMES_BUILD_DIR ?? path.join(ROOT, ".frames-build");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, "lib", "frames", "frame-manifest.json"), "utf8"));
const COLOR_KEYS = ["w", "u", "b", "r", "g", "c", "m"];
/** A pixel at least this opaque is the plate's ink. */
const ALPHA_INK = 128;

/** Every plate directory: `<template>/<kind>` for kind pt | loyalty. */
function plateDirs() {
  const dirs = new Set();
  for (const key of Object.keys(MANIFEST.files)) {
    const m = /^([^/]+)\/(pt|loyalty)\/[a-z]\.png$/.exec(key);
    if (m) dirs.add(`${m[1]}/${m[2]}`);
  }
  for (const template of fs.readdirSync(PUBLIC)) {
    for (const kind of ["pt", "loyalty"]) {
      if (fs.existsSync(path.join(PUBLIC, template, kind))) dirs.add(`${template}/${kind}`);
    }
  }
  return [...dirs].sort();
}

/** The readable file for one plate colour, or a reason it isn't. */
function plateFile(rel) {
  const entry = MANIFEST.files[rel];
  if (entry) {
    const file = path.join(BUILD, rel);
    if (!fs.existsSync(file)) return { missing: `bucket plate not in ${BUILD}` };
    const sha = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (sha !== entry.sha256) return { missing: `${file} is not the manifest's (sha256)` };
    return { file, source: "bucket" };
  }
  const file = path.join(PUBLIC, rel);
  return fs.existsSync(file) ? { file, source: "git" } : { missing: "no such plate" };
}

async function inkBox(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let [x0, y0, x1, y1] = [info.width, info.height, -1, -1];
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] < ALPHA_INK) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { width: info.width, height: info.height, x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

const down = (v) => Math.floor(v * 1e4) / 1e4;
const up = (v) => Math.ceil(v * 1e4) / 1e4;

const rows = [];
const skipped = [];
for (const dir of plateDirs()) {
  let ink = null;
  const sources = new Set();
  const hashes = {};
  for (const key of COLOR_KEYS) {
    const rel = `${dir}/${key}.png`;
    if (!MANIFEST.files[rel] && !fs.existsSync(path.join(PUBLIC, rel))) continue;
    const got = plateFile(rel);
    if (got.missing) {
      skipped.push(`${rel}: ${got.missing}`);
      ink = null;
      break;
    }
    sources.add(got.source);
    if (got.source === "bucket") hashes[key] = MANIFEST.files[rel].hash;
    const b = await inkBox(got.file);
    const f = { left: b.x0 / b.width, top: b.y0 / b.height, right: b.x1 / b.width, bottom: b.y1 / b.height };
    ink = ink
      ? {
          left: Math.min(ink.left, f.left),
          top: Math.min(ink.top, f.top),
          right: Math.max(ink.right, f.right),
          bottom: Math.max(ink.bottom, f.bottom),
        }
      : f;
  }
  if (!ink) continue;
  rows.push({
    asset: `/frames/${dir}/{color}.png`,
    source: [...sources].join("+"),
    // Rounded outward: the table never draws the ink smaller than it is.
    ink: { left: down(ink.left), top: down(ink.top), right: up(ink.right), bottom: up(ink.bottom) },
    hashes,
  });
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ rows, skipped }, null, 2));
} else {
  console.log("// lib/cards/plate-ink.ts PLATE_INK — fractions of the plate image (alpha ≥ 128, every colour)");
  for (const r of rows) {
    const { left, top, right, bottom } = r.ink;
    console.log(`  "${r.asset}": { left: ${left}, top: ${top}, right: ${right}, bottom: ${bottom} }, // ${r.source}`);
  }
  console.log("// tests/unit/cards/plate-ink.test.ts MEASURED_ON — the bucket plates' manifest hashes");
  for (const r of rows) {
    if (Object.keys(r.hashes).length === 0) continue;
    const colours = Object.entries(r.hashes).map(([k, h]) => `${k}: "${h}"`);
    console.log(`  "${r.asset}": { ${colours.join(", ")} },`);
  }
  for (const s of skipped) console.error(`skipped ${s}`);
}
