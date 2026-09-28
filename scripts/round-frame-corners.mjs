#!/usr/bin/env node
// ---------------------------------------------------------------------------
// round-frame-corners.mjs — the Phase B corner normalise pass (TODO 3.26,
// owner decision 2026-09-27) over the git MSE masters in public/frames.
//
// For every master on the allow-list (scripts/lib/frame-corners.mjs
// CORNER_NORMALISE_TEMPLATES — never a showcase family) it paints the light
// card-stock paper outside the frame's painted corner, and its grey
// anti-aliased fringe and its dark tail, with the border as it runs beside
// the corner (the edge band's depth profile),
// then cuts the one card corner (lib/cards/card-corner.ts, 64.5 px). Each
// master must pass the gate before it is written:
//   - the diff stays inside the four 96×96 corner boxes;
//   - the light it repaints is at most the light the cut showed before (the
//     challenge's measured light count) and none is left;
//   - the WHOLE repaint (light paper, grey fringe and the fringe's dark tail)
//     stays within REPAINT_DEPTH_MAX (10 px) of the outline and only darkens;
//   - the corner check and the edge contract (lib/frames/edge-contract.ts)
//     pass on the result.
// (scripts/lib/frame-corners.mjs normalisedMasterFailures — the builders'
// hook runs the same gate.)
// A master that fails is reported and left alone, and the run exits 1.
//
//   node scripts/round-frame-corners.mjs                  # normalise + rewrite
//   node scripts/round-frame-corners.mjs --dry            # report only
//   node scripts/round-frame-corners.mjs --only retro,saga
//   node scripts/round-frame-corners.mjs --report gate.json
//   node scripts/round-frame-corners.mjs --dir <frames dir>   (default public/frames)
//
// Idempotent: a normalised master comes out byte-identical and is not
// rewritten. Then regenerate the WebP siblings: `npm run assets:frame-webp`.
// The MSE builders (convert-mse-frame.mjs, build-era-frames.mjs, …) run the
// same pass (normaliseMasterCorners) before they write, so rebuilding a
// master can't bring the white back (it came back once: dc65aa5's clear was
// a one-off over the files, and later builds overwrote it).
// ---------------------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  CORNER_NORMALISE_TEMPLATES,
  cornerDiff,
  lightInsideCorners,
  normaliseCardCorners,
  normalisedMasterFailures,
  shouldNormalise,
} from "./lib/frame-corners.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? "") : null;
};
const DRY = args.includes("--dry");
const only = flag("--only")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
const reportFile = flag("--report");
const dir = path.resolve(flag("--dir") ?? path.join("public", "frames"));
const KEYS = ["w", "u", "b", "r", "g", "c", "m", "a"];

if (only) {
  const unknown = only.filter((t) => !CORNER_NORMALISE_TEMPLATES[t]);
  if (unknown.length) {
    console.error(`✗ Not on the Phase B allow-list: ${unknown.join(", ")}`);
    process.exit(1);
  }
}

const results = [];
let written = 0;
let failed = 0;
for (const template of Object.keys(CORNER_NORMALISE_TEMPLATES)) {
  if (only && !only.includes(template)) continue;
  for (const key of KEYS) {
    const file = path.join(dir, template, `${key}.png`);
    if (!fs.existsSync(file) || !shouldNormalise(template, key)) continue;
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    const before = Buffer.from(data);
    const lightBefore = lightInsideCorners(before, width, height);
    const report = normaliseCardCorners(data, width, height);
    const diff = cornerDiff(before, data, width, height);
    // The ONE gate (the builders' hook runs it too): Phase B's own checks,
    // then the edge contract and the corner check unless a known failure.
    const failures = normalisedMasterFailures(template, key, before, data, width, height, report);
    const sum = (field) => report.reduce((s, c) => s + c[field], 0);
    const row = {
      master: `${template}/${key}.png`,
      lightBefore,
      repainted: sum("repainted"),
      repaintedLight: sum("repaintedLight"),
      repaintedFringe: sum("repaintedFringe"),
      repaintedDark: sum("repaintedDark"),
      tail: sum("tail"),
      deepestPx: Number(Math.max(...report.map((c) => c.deepestPx)).toFixed(2)),
      lightened: sum("lightened"),
      ghost: sum("ghost"),
      ghostLumaOver: Math.max(...report.map((c) => c.ghostLumaOver)),
      changedPx: diff.changed,
      changedOutsideBoxes: diff.outside,
      corners: report.map((c) => ({
        corner: c.corner,
        border: c.border,
        profile: c.profile,
        flooded: c.flooded,
        repainted: c.repainted,
        repaintedLight: c.repaintedLight,
        repaintedFringe: c.repaintedFringe,
        repaintedDark: c.repaintedDark,
        tail: c.tail,
        deepestPx: Number(c.deepestPx.toFixed(2)),
        ghost: c.ghost,
        ghostLumaOver: c.ghostLumaOver,
        lightLeft: c.lightLeft,
        blocked: c.blocked,
        ...(c.skipped ? { skipped: c.skipped } : {}),
      })),
      failures,
      written: false,
    };
    results.push(row);
    const rel = path.relative(process.cwd(), file);
    if (failures.length) {
      failed += 1;
      console.error(`✗ ${rel}: ${failures.join("; ")}`);
      continue;
    }
    if (diff.changed === 0) {
      console.log(`= ${rel} (already normalised)`);
      continue;
    }
    if (!DRY) {
      await sharp(data, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(file);
      row.written = true;
      written += 1;
    }
    console.log(
      `${DRY ? "would write" : "wrote"} ${rel}: repainted ${row.repainted} px (light ${row.repaintedLight} of ${lightBefore}, fringe ${row.repaintedFringe}, dark tail ${row.repaintedDark}), deepest ${row.deepestPx} px, ghost ${row.ghost} (≤ +${row.ghostLumaOver} luma), ${diff.changed} px changed, all inside the corner boxes`,
    );
  }
}
if (reportFile) fs.writeFileSync(reportFile, `${JSON.stringify({ generated: new Date().toISOString(), dry: DRY, results }, null, 2)}\n`);
console.log(`\n${results.length} masters checked · ${DRY ? "dry run" : `${written} written`} · ${failed} failed the gate`);
if (!DRY && written) console.log("Next: npm run assets:frame-webp (the WebP siblings).");
if (failed) process.exitCode = 1;
