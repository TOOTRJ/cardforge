import fs from "node:fs";
import path from "node:path";
import { PARITY_DIR, type ParityCaseFile } from "./shared";
import { loadBaseline } from "./baseline";
import type { Measured } from "./thresholds";

// ---------------------------------------------------------------------------
// What the browser stage's spec files share (TODO 3.11): where things are,
// the run's switches, the cases the bake stage left and this platform's
// recorded baseline.
//
// PARITY_MEASURE=1 records without judging (calibrating thresholds);
// PARITY_UPDATE=1 does the same and then records this platform's baseline
// files (tests/parity/baseline.ts: only the cases that are new or moved;
// PARITY_UPDATE_ALL=1 with it: every case); PARITY_SAVE=1 keeps every preview screenshot
// and difference map in tmp/parity/out/ (a failing case keeps its own either
// way); PARITY_ONLY=a,b runs the cases whose id starts with one of these.
// ---------------------------------------------------------------------------

export const ROOT = path.resolve(__dirname, "../..");
export const DIR = path.join(ROOT, PARITY_DIR);
export const FRAMES_DIR = process.env.PARITY_FRAMES_DIR ?? path.join(ROOT, "tmp/visual/frames");
export const PLATFORM = process.platform;
export const UPDATE = process.env.PARITY_UPDATE === "1";
export const UPDATE_ALL = UPDATE && process.env.PARITY_UPDATE_ALL === "1";
export const MEASURE = UPDATE || process.env.PARITY_MEASURE === "1";
export const SAVE = process.env.PARITY_SAVE === "1";
export const ONLY = (process.env.PARITY_ONLY ?? "").split(",").filter(Boolean);

/** The cases of this run, in the matrix's order. */
export function loadCases(): ParityCaseFile[] {
  const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => /^cases-\d+\.json$/.test(f)) : [];
  if (!files.length) {
    throw new Error(`${PARITY_DIR}/cases-*.json is missing — run the suite through \`npm run test:parity\` (it bakes first).`);
  }
  const cases = files
    .flatMap((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) as ParityCaseFile[])
    .sort((a, b) => a.index - b.index);
  return ONLY.length ? cases.filter((c) => ONLY.some((p) => c.id.startsWith(p))) : cases;
}

/** The committed baseline (it throws — and fails every spec — on a file
 *  that is not a case file as an update writes it). */
export const baseline = loadBaseline(ROOT);

/** This platform's recorded offsets; null where none were recorded (Chromium
 *  rasterises text differently per OS — the limits still hold there). */
export const recorded = baseline.platforms[PLATFORM]?.cases ?? null;

export type Result = Measured & { why: string; failures: string[] };

/** Every comparison this run has written. */
export function readRun(): Result[] {
  const dir = path.join(DIR, "results");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Result);
}
