#!/usr/bin/env node
// ---------------------------------------------------------------------------
// parity.mjs — CI's "Preview parity" job and its local twin (TODO 3.11,
// `npm run test:parity`): holds the BROWSER preview
// (components/cards/card-preview.tsx) to the server bake
// (lib/render/card-image.tsx) on the cards of tests/parity/cases.ts.
//
//   npm run test:parity                 check (exit 1 on a difference)
//   npm run test:parity -- --update     re-record this platform's baseline
//                                       (tests/parity/baseline/<platform>/):
//                                       ONLY the cases that are new, removed
//                                       or outside their recorded tolerance —
//                                       every other file stays byte for byte
//   npm run test:parity -- --update --all
//                                       re-record EVERY case of this platform,
//                                       also the ones inside their tolerance
//                                       (a diff of the whole directory: only
//                                       when that is what the PR is for)
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
//      manifest's PNG objects by key + sha256 from the PUBLIC bucket — on a
//      local run through the machine's shared frame store,
//      scripts/lib/frame-cache.mjs; CI shares the visual jobs' cache);
//   2. bake   — tests/parity/bake.parity.ts (vitest): every case through the
//      real Satori bake at 750 px and HD, into tmp/parity/;
//   3. browser — tests/parity/preview.parity.spec.ts (Playwright, headless
//      Chromium): starts its own `next dev` on port 3187 with
//      PARITY_HARNESS=1 (the only server /dev/parity exists on), mounts the
//      same data in the real CardPreview, screenshots it at the bake's size
//      and compares region by region (tests/parity/thresholds.ts).
//
// Output: tmp/parity/report.md (appended to $GITHUB_STEP_SUMMARY in CI),
// tmp/parity/results/*.json, tmp/parity/next/ (the case files --update
// would write, and update.json naming them — CI uploads it as the
// `parity-baseline` artifact, and a red CI run prints it as a script to
// paste: tests/parity/README.md "The linux half").
// ---------------------------------------------------------------------------
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { frameBucketOrigins, sharedFrameCacheDir } from "./lib/frame-cache.mjs";
import { parseFlags, readManifest } from "./lib/frame-objects.mjs";
import { syncFrameCache } from "./lib/visual-frames.mjs";
import { PASTE_LIMIT_BYTES, baselineArtifactCommand, baselinePasteScript, readNextBaseline } from "./lib/parity-next.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = path.join(ROOT, "tmp", "parity");
const FRAMES_DIR = path.join(ROOT, "tmp", "visual", "frames");
// CI reads production's public bucket (what production bakes with; the dev
// bucket covers a frame not promoted yet). A local run reads the dev bucket
// only — the one every local tool uses; name production with --origin if
// needed. Locally the frames come through the machine's shared store
// (scripts/lib/frame-cache.mjs: one download per machine, not per worktree;
// tmp/visual/frames stays this checkout's, hard-linked from it); CI has none.
const { defaults: DEFAULT_ORIGINS } = frameBucketOrigins({ root: ROOT });
const FRAMES_STORE = sharedFrameCacheDir();

const flags = parseFlags(process.argv.slice(2), ["--only", "--origin", "--shards"]);
const ONLY = flags.get("--only") ?? "";
const ORIGINS = (flags.get("--origin") ?? DEFAULT_ORIGINS.join(",")).split(",").map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean);
const UPDATE = flags.has("--update");
// Bake processes (Satori is single-threaded; the cases are independent).
const SHARDS = Math.max(1, Math.min(3, Number(flags.get("--shards") ?? Math.min(3, os.availableParallelism?.() ?? os.cpus().length))));
const UPDATE_ALL = flags.has("--all");
if (UPDATE && ONLY) throw new Error("--update needs the whole matrix (drop --only).");
if (UPDATE_ALL && !UPDATE) throw new Error("--all goes with --update (it re-records every case).");
const ALL_BANNER = [
  "",
  "  ****************************************************************************",
  `  --update --all: EVERY case of the ${process.platform} baseline is re-recorded, also the`,
  "  ones that are inside their recorded tolerance. The diff is the whole",
  "  directory and collides with every open PR that records a case. Use it only",
  "  when that is the point of the PR; a renderer change needs plain --update.",
  "  ****************************************************************************",
  "",
].join("\n");
if (UPDATE_ALL) console.warn(ALL_BANNER);

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
  const { cached, shared, fetched, bytes, failed } = await syncFrameCache({ entries, origins: ORIGINS, dir: FRAMES_DIR, store: FRAMES_STORE });
  console.log(
    `frames: ${entries.length} manifest PNGs — ${cached} cached${FRAMES_STORE ? ` (${shared} from the shared store ${FRAMES_STORE})` : ""}, ${fetched} fetched (${(bytes / 1e6).toFixed(1)} MB) in ${Math.round((Date.now() - t0) / 1000)} s`,
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
  ...(UPDATE_ALL ? { PARITY_UPDATE_ALL: "1" } : {}),
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
if (UPDATE_ALL) console.warn(ALL_BANNER);
if (browser !== 0 && !UPDATE) {
  console.error(
    "\nThe preview differs from the bake (or left its recorded offsets). Look at tmp/parity/out/<case>@<size>.{preview,bake,diff}.png.\n" +
      "A real difference: fix the renderer that is wrong. An intended change of both renderers that moved the recorded numbers:\n" +
      "  npm run test:parity -- --update        (this platform; it rewrites only the cases that moved — tests/parity/README.md)",
  );
  // On CI: this run's numbers (the linux half of a re-record) as something
  // to paste — nobody has to look a run id up or download an artifact.
  const next = process.env.GITHUB_RUN_ID ? readNextBaseline(path.join(TMP, "next")) : null;
  if (process.env.GITHUB_RUN_ID && !next) {
    console.error(
      "\nThis run has no baseline lines to hand over: every case is inside its recorded tolerance (the failure is a LIMIT, a stale known difference or a removed case's leftovers), or a case could not be measured at all.",
    );
  }
  if (next) {
    const cases = `${next.changed.length} case line(s) of ${next.changed.length + next.kept} — ${next.files.length} file(s) written${next.remove.length ? `, ${next.remove.length} removed` : ""}`;
    const script = baselinePasteScript(next);
    const paste = Buffer.byteLength(script) <= PASTE_LIMIT_BYTES;
    const artifact = baselineArtifactCommand({ ...next, runId: process.env.GITHUB_RUN_ID, repo: process.env.GITHUB_REPOSITORY });
    const caveat = "A value over a limit is in here too and still fails the next run; nothing is handed over when a case could not be measured at all.";
    console.error(
      `\nThis run's numbers for ${next.platform}, if the change is intended (${cases}; read the diff before committing it).\n${caveat}\n` +
        `From the artifact:\n  ${artifact}\n` +
        (paste ? `Or paste this at the repo's root — the same files, no artifact:\n\n${script}` : "(Too large to print as a script: use the artifact.)"),
    );
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `\n### If both renderers were changed on purpose\n\nThis run's numbers for ${next.platform} (${cases}) — read the diff before committing it. ${caveat}\n\n` +
          (paste ? `Paste at the repo's root (no artifact needed):\n\n\`\`\`bash\n${script}\`\`\`\n\nOr from the artifact:\n\n` : "") +
          `\`\`\`bash\n${artifact}\n\`\`\`\n`,
      );
    }
  }
}
process.exit(browser);
