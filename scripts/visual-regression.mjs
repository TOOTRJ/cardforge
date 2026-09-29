#!/usr/bin/env node
// ---------------------------------------------------------------------------
// visual-regression.mjs — CI's "Visual regression" job and its local twin
// (TODO 7.1, `npm run test:visual`). Bakes tests/visual/matrix.ts through the
// real renderer and gates the pixel hashes against tests/visual/baseline.json
// (rules: scripts/lib/visual-gate.mjs).
//
//   npm run test:visual                    check (exit 1 on a problem)
//   npm run test:visual -- --update        rewrite tests/visual/baseline.json
//
//   --shards N         bake processes in all (default: CPUs, at most 4)
//   --group g/G        bake only shards i with i % G == g (CI splits the
//                      shards over G parallel jobs); with --no-gate
//   --no-gate          bake and write tmp/visual/results/ only
//   --gate-only        gate the shard files already in tmp/visual/results/
//                      (CI's gate job, after downloading every group's)
//   --base <ref>       the base commit: its CARD_LAYOUT_VERSION and baseline
//                      decide "bumped", and each case's bump scope is judged
//                      at its version (CI: HEAD^1 of the merge commit, in the
//                      bake jobs and the gate alike; default: merge-base with
//                      origin/main when it exists)
//   --origin a,b       frames bucket origins to fetch from, in order
//                      (default: in CI production's public bucket, then
//                      dev's; locally the dev bucket)
//   --only p1,p2       bake only ids starting with these (no added/removed)
//   --save             also write every bake to tmp/visual/renders/ (local
//                      inspection; tmp/ is gitignored)
//   --no-fetch         use the frame cache as it is
//
// FRAMES: the bake reads the manifest's PNG objects from tmp/visual/frames/
// (gitignored), downloaded here by manifest key + sha256 from the public
// bucket — never committed (Card Conjurer-derived frames never enter git).
// CI caches the folder by the manifest's hash, so production storage is read
// only when the manifest changes; a frame not yet promoted to production
// comes from the dev bucket (same bytes: the sha is checked).
//
// Output: tmp/visual/report.md + report.json, tmp/visual/next/baseline.json
// (what --update would write — CI uploads it as the `visual-baseline`
// artifact), and the report appended to $GITHUB_STEP_SUMMARY in CI.
// ---------------------------------------------------------------------------
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFlags, publicBaseFor, readManifest } from "./lib/frame-objects.mjs";
import { syncFrameCache } from "./lib/visual-frames.mjs";
import { PRODUCTION_SUPABASE_REF } from "./lib/prod-guard.mjs";
import {
  BASELINE_PATH,
  LAYOUT_VERSION_PATH,
  compareToBaseline,
  formatReport,
  gateVerdict,
  mergeShardResults,
  parseLayoutVersion,
  parseShard,
  serializeBaseline,
} from "./lib/visual-gate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = path.join(ROOT, "tmp", "visual");
const FRAMES_DIR = path.join(TMP, "frames");
const RESULTS_DIR = path.join(TMP, "results");
// The shared dev branch's ref, from supabase/config.toml (as db-dev.mjs reads it).
const DEV_SUPABASE_REF = /\[remotes\.dev\][^[]*?project_id\s*=\s*"([a-z]{16,24})"/s.exec(
  fs.readFileSync(path.join(ROOT, "supabase/config.toml"), "utf8"),
)?.[1];
if (!DEV_SUPABASE_REF || DEV_SUPABASE_REF === PRODUCTION_SUPABASE_REF) throw new Error("supabase/config.toml has no usable [remotes.dev] project_id.");
const PRODUCTION_FRAMES = publicBaseFor(`https://${PRODUCTION_SUPABASE_REF}.supabase.co`);
const DEV_FRAMES = publicBaseFor(`https://${DEV_SUPABASE_REF}.supabase.co`);
// CI reads production's bucket (what production bakes with; the dev bucket
// covers a frame not promoted yet). A local run reads the dev bucket only —
// the one every local tool uses; name production with --origin if needed.
const DEFAULT_ORIGINS = process.env.CI ? [PRODUCTION_FRAMES, DEV_FRAMES] : [DEV_FRAMES];

const flags = parseFlags(process.argv.slice(2), ["--shards", "--group", "--base", "--origin", "--only"]);
const UPDATE = flags.has("--update");
const ONLY = (flags.get("--only") ?? "").split(",").filter(Boolean);
const SHARDS = Number(flags.get("--shards") ?? Math.min(4, Math.max(1, os.availableParallelism?.() ?? os.cpus().length)));
const ORIGINS = (flags.get("--origin") ?? DEFAULT_ORIGINS.join(",")).split(",").map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean);
if (!Number.isInteger(SHARDS) || SHARDS < 1) throw new Error("--shards needs a positive integer.");
const GROUP = parseShard(flags.get("--group") ?? "0/1");
const GATE = !flags.has("--no-gate");
const BAKE = !flags.has("--gate-only");
if (GROUP.count > 1 && GATE) throw new Error("--group bakes part of the matrix: pass --no-gate (the gate job reads every group's results).");

const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null);
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

// --- 1. frames --------------------------------------------------------------

async function fetchFrames() {
  const manifest = readManifest(path.join(ROOT, "lib/frames/frame-manifest.json"));
  // The bake reads PNG masters only (the .webp siblings are the browser's).
  const entries = Object.entries(manifest.files).filter(([key]) => key.endsWith(".png"));
  const t0 = Date.now();
  // A quick pass, then a confirm pass over its failures (transient storage
  // errors — scripts/lib/visual-frames.mjs).
  const { cached, fetched, bytes, failed } = await syncFrameCache({ entries, origins: ORIGINS, dir: FRAMES_DIR });
  console.log(
    `frames: ${entries.length} manifest PNGs — ${cached} cached, ${fetched} fetched (${(bytes / 1e6).toFixed(1)} MB) in ${Math.round((Date.now() - t0) / 1000)} s`,
  );
  if (failed.length) {
    for (const f of failed) console.error(`  ✗ ${f.key}: ${f.error}`);
    throw new Error(
      `${failed.length} frame object(s) could not be fetched from ${ORIGINS.join(" or ")} (the bytes must match the manifest's sha256; another bucket that has them: --origin <url>).`,
    );
  }
}

// --- 2. bake ----------------------------------------------------------------

function bakeShard(index, count, baseVersion) {
  const out = path.join(RESULTS_DIR, `shard-${index}.json`);
  const log = path.join(TMP, "logs", `shard-${index}.log`);
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.rmSync(out, { force: true });
  const env = {
    ...process.env,
    VISUAL_SHARD: `${index}/${count}`,
    VISUAL_OUT: out,
    VISUAL_FRAMES_DIR: FRAMES_DIR,
    VISUAL_BASE_VERSION: baseVersion === null || baseVersion === undefined ? "" : String(baseVersion),
    VISUAL_ONLY: ONLY.join(","),
    ...(flags.has("--save") ? { VISUAL_SAVE_DIR: path.join(TMP, "renders") } : {}),
  };
  const vitest = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [vitest, "run", "-c", "tests/visual/vitest.config.ts", "--reporter=dot"], {
      cwd: ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stream = fs.createWriteStream(log);
    child.stdout.pipe(stream);
    child.stderr.pipe(stream);
    child.on("close", (code) => {
      stream.end();
      const ok = code === 0 && fs.existsSync(out);
      console.log(`  shard ${index}/${count} ${ok ? "done" : `FAILED (exit ${code}) — see ${path.relative(ROOT, log)}`}`);
      resolve(ok ? readJson(out) : null);
    });
  });
}

// --- 3. base ----------------------------------------------------------------

function resolveBase() {
  const explicit = flags.get("--base") ?? process.env.VISUAL_BASE_REF ?? null;
  const candidates = explicit ? [explicit] : [];
  if (!explicit) {
    try {
      candidates.push(git("merge-base", "HEAD", "origin/main").trim());
    } catch {
      /* no origin/main here — judge "bumped" against the baseline alone */
    }
  }
  for (const ref of candidates) {
    try {
      const sha = git("rev-parse", "--verify", `${ref}^{commit}`).trim();
      const version = parseLayoutVersion(git("show", `${sha}:${LAYOUT_VERSION_PATH}`));
      let baseline = null;
      try {
        baseline = JSON.parse(git("show", `${sha}:${BASELINE_PATH}`));
      } catch {
        /* the base branch has no baseline yet */
      }
      return { ref, sha, version, baseline };
    } catch {
      if (explicit) throw new Error(`--base ${explicit} is not a commit here (CI checks out with fetch-depth 2).`);
    }
  }
  return null;
}

// --- main -------------------------------------------------------------------

const headVersion = parseLayoutVersion(fs.readFileSync(path.join(ROOT, LAYOUT_VERSION_PATH), "utf8"));
const headBaseline = readJson(path.join(ROOT, BASELINE_PATH));
// The base decides "bumped" (the gate) and the version each case's scope is
// judged at (the bake) — CI hands every job the same --base HEAD^1.
const base = resolveBase();
const scopeVersion = base?.version ?? headBaseline?.layoutVersion ?? null;

let shards;
if (BAKE) {
  if (!flags.has("--no-fetch")) await fetchFrames();
  const mine = Array.from({ length: SHARDS }, (_, i) => i).filter((i) => i % GROUP.count === GROUP.index);
  if (GROUP.count === 1) fs.rmSync(RESULTS_DIR, { recursive: true, force: true });
  console.log(`bake: shard(s) ${mine.join(", ")} of ${SHARDS}${ONLY.length ? `, only ${ONLY.join(", ")}` : ""}`);
  const t0 = Date.now();
  shards = await Promise.all(mine.map((i) => bakeShard(i, SHARDS, scopeVersion)));
  if (shards.some((s) => s === null)) {
    console.error("A bake shard failed (harness error, not a pixel change) — its log is named above.");
    process.exit(1);
  }
  console.log(`bake: ${shards.reduce((n, s) => n + Object.keys(s.cases).length, 0)} cases in ${Math.round((Date.now() - t0) / 1000)} s`);
  if (!GATE) process.exit(0);
} else {
  shards = Array.from({ length: SHARDS }, (_, i) => readJson(path.join(RESULTS_DIR, `shard-${i}.json`)));
  const missing = shards.map((s, i) => (s ? null : i)).filter((i) => i !== null);
  if (missing.length) {
    console.error(`Missing bake results for shard(s) ${missing.join(", ")} of ${SHARDS} in ${path.relative(ROOT, RESULTS_DIR)} — a bake job failed or was cancelled.`);
    process.exit(1);
  }
}
const run = mergeShardResults(shards);

const partial = ONLY.length > 0;
fs.mkdirSync(path.join(TMP, "next"), { recursive: true });
let nextBaseline = null;
try {
  nextBaseline = partial ? null : serializeBaseline(run, headVersion);
  if (nextBaseline) fs.writeFileSync(path.join(TMP, "next", "baseline.json"), nextBaseline);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
}

if (UPDATE) {
  if (partial) throw new Error("--update needs the whole matrix (drop --only).");
  if (!nextBaseline) process.exit(1);
  const comparison = compareToBaseline(run, headBaseline);
  fs.writeFileSync(path.join(ROOT, BASELINE_PATH), nextBaseline);
  console.log(
    `Wrote ${BASELINE_PATH}: ${comparison.changed.length} changed, ${comparison.added.length} new, ${comparison.removed.length} removed, ${comparison.redefined.length} redefined, ${comparison.unchanged} unchanged (layout v${headVersion}, ${run.environment.platform}).`,
  );
  // Print-only (square) cases never need the bump.
  const stored = comparison.changed.filter((c) => !run.cases[c.id]?.printOnly);
  if (stored.length && base?.version != null && !(headVersion > base.version)) {
    console.warn(
      `⚠ ${stored.length} case(s) changed but CARD_LAYOUT_VERSION was not bumped against ${base.ref} (v${base.version}) — CI will refuse this baseline without the bump.`,
    );
  }
  process.exit(0);
}

const comparison = compareToBaseline(run, headBaseline, { partial });
const verdict = gateVerdict({
  comparison,
  run,
  headBaseline,
  headVersion,
  baseVersion: base?.version ?? null,
  baseBaseline: partial ? null : (base?.baseline ?? null),
  partial,
});
const report = formatReport({ verdict, comparison, run, headBaseline, headVersion });
fs.writeFileSync(path.join(TMP, "report.md"), report);
fs.writeFileSync(
  path.join(TMP, "report.json"),
  `${JSON.stringify({ verdict, comparison, base: base && { ref: base.ref, sha: base.sha, version: base.version }, environment: run.environment }, null, 2)}\n`,
);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
console.log(`\n${report}`);
if (!base) console.log("(No base commit found — \"bumped\" was judged against the baseline's layout version.)");
process.exit(verdict.ok ? 0 : 1);
