#!/usr/bin/env node
// ---------------------------------------------------------------------------
// parity.mjs — CI's "Preview parity" job and its local twin (TODO 3.11,
// `npm run test:parity`): holds the BROWSER preview
// (components/cards/card-preview.tsx) to the server bake
// (lib/render/card-image.tsx) on the cards of tests/parity/cases.ts.
//
//   npm run test:parity                 check (exit 1 on a difference)
//   npm run test:parity -- --update     re-record this platform's section of
//                                       tests/parity/baseline.json
//
//   --only p1,p2     only the cases whose id starts with these
//   --save           keep every preview screenshot, bake and difference map
//                    in tmp/parity/out/ (a failing case keeps its own anyway)
//   --measure        record and report without judging
//   --no-fetch       use the frame cache as it is
//   --shards N       bake processes (default: CPUs, at most 3)
//   --origin a,b     frames bucket origins to fetch from (as test:visual)
//
// Three steps, no database, no account, no secret:
//   1. frames — the visual suite's cache (tmp/visual/frames, gitignored; the
//      manifest's PNG objects by key + sha256 from the PUBLIC bucket; CI
//      shares the visual jobs' cache);
//   2. bake   — tests/parity/bake.parity.ts (vitest): every case through the
//      real Satori bake at 750 px and HD, into tmp/parity/;
//   3. browser — tests/parity/preview.parity.spec.ts (Playwright, headless
//      Chromium): starts its own `next dev` on port 3187 with
//      PARITY_HARNESS=1 (the only server /dev/parity exists on), mounts the
//      same data in the real CardPreview, screenshots it at the bake's size
//      and compares region by region (tests/parity/thresholds.ts).
//
// Output: tmp/parity/report.md (appended to $GITHUB_STEP_SUMMARY in CI),
// tmp/parity/results/*.json, tmp/parity/next/baseline.json (what --update
// would write — CI uploads it as the `parity-baseline` artifact).
// ---------------------------------------------------------------------------
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFlags, publicBaseFor, readManifest } from "./lib/frame-objects.mjs";
import { syncFrameCache } from "./lib/visual-frames.mjs";
import { PRODUCTION_SUPABASE_REF } from "./lib/prod-guard.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = path.join(ROOT, "tmp", "parity");
const FRAMES_DIR = path.join(ROOT, "tmp", "visual", "frames");
const DEV_SUPABASE_REF = /\[remotes\.dev\][^[]*?project_id\s*=\s*"([a-z]{16,24})"/s.exec(
  fs.readFileSync(path.join(ROOT, "supabase/config.toml"), "utf8"),
)?.[1];
if (!DEV_SUPABASE_REF || DEV_SUPABASE_REF === PRODUCTION_SUPABASE_REF) throw new Error("supabase/config.toml has no usable [remotes.dev] project_id.");
const PRODUCTION_FRAMES = publicBaseFor(`https://${PRODUCTION_SUPABASE_REF}.supabase.co`);
const DEV_FRAMES = publicBaseFor(`https://${DEV_SUPABASE_REF}.supabase.co`);
// As scripts/visual-regression.mjs: CI reads production's public bucket (the
// dev bucket covers a frame not promoted yet), a local run the dev bucket.
const DEFAULT_ORIGINS = process.env.CI ? [PRODUCTION_FRAMES, DEV_FRAMES] : [DEV_FRAMES];

const flags = parseFlags(process.argv.slice(2), ["--only", "--origin", "--shards"]);
const ONLY = flags.get("--only") ?? "";
const ORIGINS = (flags.get("--origin") ?? DEFAULT_ORIGINS.join(",")).split(",").map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean);
const UPDATE = flags.has("--update");
// Bake processes (Satori is single-threaded; the cases are independent).
const SHARDS = Math.max(1, Math.min(3, Number(flags.get("--shards") ?? Math.min(3, os.availableParallelism?.() ?? os.cpus().length))));
if (UPDATE && ONLY) throw new Error("--update needs the whole matrix (drop --only).");

function run(label, args, env) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: "inherit" });
    child.on("close", (code) => {
      console.log(`${label}: ${code === 0 ? "done" : `exit ${code}`} in ${Math.round((Date.now() - t0) / 1000)} s`);
      resolve(code ?? 1);
    });
  });
}

// --- 1. frames --------------------------------------------------------------
if (!flags.has("--no-fetch")) {
  const manifest = readManifest(path.join(ROOT, "lib/frames/frame-manifest.json"));
  const entries = Object.entries(manifest.files).filter(([key]) => key.endsWith(".png"));
  const t0 = Date.now();
  const { cached, fetched, bytes, failed } = await syncFrameCache({ entries, origins: ORIGINS, dir: FRAMES_DIR });
  console.log(
    `frames: ${entries.length} manifest PNGs — ${cached} cached, ${fetched} fetched (${(bytes / 1e6).toFixed(1)} MB) in ${Math.round((Date.now() - t0) / 1000)} s`,
  );
  if (failed.length) {
    for (const f of failed) console.error(`  ✗ ${f.key}: ${f.error}`);
    throw new Error(`${failed.length} frame object(s) could not be fetched from ${ORIGINS.join(" or ")}.`);
  }
}

// --- 2. bake ----------------------------------------------------------------
// A fresh run: nothing of an earlier one is judged or reported.
for (const dir of ["bake", "results", "out", "next", "playwright"]) fs.rmSync(path.join(TMP, dir), { recursive: true, force: true });
fs.rmSync(path.join(TMP, "report.md"), { force: true });
if (fs.existsSync(TMP)) for (const f of fs.readdirSync(TMP)) if (/^cases(-\d+)?\.json$/.test(f)) fs.rmSync(path.join(TMP, f));

const shared = { PARITY_ONLY: ONLY, PARITY_FRAMES_DIR: FRAMES_DIR };
const vitest = [path.join(ROOT, "node_modules/vitest/vitest.mjs"), "run", "-c", "tests/parity/vitest.config.ts", "--reporter=dot"];
const baked = await Promise.all(
  Array.from({ length: SHARDS }, (_, i) => run(`bake ${i + 1}/${SHARDS}`, vitest, { ...shared, PARITY_SHARD: `${i}/${SHARDS}` })),
);
if (baked.some((code) => code !== 0)) {
  console.error("The bake stage failed (a harness error, not a preview difference).");
  process.exit(1);
}

// --- 3. browser -------------------------------------------------------------
const browser = await run("browser", [path.join(ROOT, "node_modules/@playwright/test/cli.js"), "test", "-c", "tests/parity/playwright.config.ts"], {
  ...shared,
  ...(UPDATE ? { PARITY_UPDATE: "1" } : {}),
  ...(flags.has("--measure") ? { PARITY_MEASURE: "1" } : {}),
  ...(flags.has("--save") ? { PARITY_SAVE: "1" } : {}),
});

const reportFile = path.join(TMP, "report.md");
if (fs.existsSync(reportFile)) {
  const report = fs.readFileSync(reportFile, "utf8");
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  // The verdict and what failed; the full table is in the file.
  console.log(`\n${report.split("\n### ")[0].trim()}\n\n(full table: ${path.relative(ROOT, reportFile)})`);
}
if (browser !== 0 && !UPDATE) {
  console.error(
    "\nThe preview differs from the bake (or left its recorded offsets). Look at tmp/parity/out/<case>@<size>.{preview,bake,diff}.png.\n" +
      "A real difference: fix the renderer that is wrong. An intended change of both renderers that moved the recorded numbers:\n" +
      "  npm run test:parity -- --update        (or commit CI's `parity-baseline` artifact as tests/parity/baseline.json)",
  );
  // On CI: the one command that brings this run's numbers (the linux section)
  // into the branch — nobody has to look the run id up.
  if (process.env.GITHUB_RUN_ID) {
    const fetchBaseline = `gh run download ${process.env.GITHUB_RUN_ID} -n parity-baseline -D tests/parity`;
    console.error(`\nThis run's numbers, if the change is intended (read the diff before committing it):\n  ${fetchBaseline}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `\n### If both renderers were changed on purpose\n\nThis run's numbers (linux) as \`tests/parity/baseline.json\` — read the diff before committing it:\n\n\`\`\`bash\n${fetchBaseline}\n\`\`\`\n\nThe artifact is not written when a case could not be measured at all, and a value over a limit still fails the next run (tests/README.md "Preview parity").\n`,
      );
    }
  }
}
process.exit(browser);
