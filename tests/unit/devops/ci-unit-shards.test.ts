import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The shape of CI's "Typecheck, lint, unit" check (.github/workflows/ci.yml).
//
// It was ONE job — typecheck, lint, the unit suite with coverage, the build,
// in a row: 14 to 24 minutes, cancelled at its limit twice on 2026-10-12 with
// no test failing. It is now a gate over three jobs that run side by side
// (`static`, the `unit` shards, `coverage`). What the one job guarded must
// still be guarded — these tests hold the pieces that would fail SILENTLY if
// someone dropped them:
//
//   - the required check keeps its exact name (main's ruleset names it) and
//     is red unless every job its TIER runs is green — the tiers (full,
//     light, draft, notes) and what each may skip are pinned in
//     tests/unit/devops/ci-docs-only.test.ts;
//   - every shard runs, on the bucket masters, and none is the only one;
//   - the coverage floors are checked once, on ALL shards' coverage — a shard
//     alone never checks them, and nothing but a shard may switch them off.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const ci = read(".github/workflows/ci.yml");

/** The text of one job of the workflow (its body, two-space indented). */
function jobOf(id: string): string {
  const body = new RegExp(`\\n  ${id}:\\n([\\s\\S]*?)(?=\\n  [a-z0-9-]+:\\n|$)`).exec(ci)?.[1];
  if (!body) throw new Error(`ci.yml has no job "${id}"`);
  // Comment lines say what a job does NOT do; only the YAML counts.
  return body
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

const numbers = (list: string) => list.split(",").map((n) => Number(n.trim()));

describe("the required check", () => {
  const gate = jobOf("checks");

  it("keeps the exact name main's ruleset requires, on exactly one job — in every tier but a draft's", () => {
    // A draft's gate reports as "Draft checks": a green check under the
    // required name would still be on the commit when the draft is marked
    // ready, before the full run has judged anything.
    expect(gate).toContain("    name: ${{ needs.changes.outputs.tier == 'draft' && 'Draft checks (typecheck, lint, build)' || 'Typecheck, lint, unit' }}\n");
    expect(ci.match(/Typecheck, lint, unit' \}\}$/gm)).toHaveLength(1);
    expect(ci).not.toMatch(/^ +name: Typecheck, lint, unit$/m);
  });

  it("covers the classifier, typecheck + lint + build, every unit shard, the coverage floors and the notes job — and waits for the other required jobs", () => {
    expect(gate).toMatch(/^ {4}needs: \[changes, static, unit, coverage, docs, frames, e2e, visual, superseded\]$/m);
  });

  it("runs when a job it covers failed (a skipped required check counts as passing) and passes only when all succeeded", () => {
    // `always()`: the gate runs whatever became of its needs — failed,
    // skipped, stopped at a timeout ("cancelled") or cancelled with the run —
    // and then fails on anything but its tier's shape (a cancelled DRAFT run
    // alone passes as "superseded"; ci-docs-only.test.ts runs the gate's
    // script). `!cancelled()` leans on how a timed-out need is counted, which
    // nothing documents — and a job whose condition is false in a cancelled
    // run ends "cancelled", not "skipped".
    expect(gate).toMatch(/^ {4}if: \$\{\{ always\(\) \}\}$/m);
    expect(gate).toContain("NEEDS: ${{ toJSON(needs) }}");
    expect(gate).toContain("TIER: ${{ needs.changes.outputs.tier }}");
    // The full tier (and any tier nobody knows): the classifier succeeded
    // and static, every shard and coverage succeeded. "skipped" passes ONLY
    // in the shape of the tier the classifier named. The whole truth table
    // is run through jq in ci-docs-only.test.ts.
    expect(gate).toContain(`else                       ["success", "success", "skipped", "ran"] end ) as $want`);
    expect(gate).toContain("| length == 8\n");
    expect(gate).toContain(`and .changes.result == "success"\n`);
    expect(gate).toContain("and .static.result == $want[0]\n");
    expect(gate).toContain("and ([.unit, .coverage] | all(.result == $want[1]))\n");
    // Nothing in it may swallow the verdict.
    expect(gate).not.toMatch(/continue-on-error|\|\| true/);
  });

  it("no job the check covers may pass on a failure", () => {
    for (const id of ["changes", "static", "unit", "coverage", "docs"]) {
      expect(jobOf(id), id).not.toMatch(/continue-on-error|\|\| true/);
    }
  });
});

describe("the jobs behind the check", () => {
  it("each has its own time limit — a hung one ends in minutes, not in GitHub's six hours", () => {
    for (const id of ["changes", "static", "unit", "coverage", "docs", "checks"]) {
      expect(jobOf(id), id).toMatch(/^ {4}timeout-minutes: \d+$/m);
    }
  });

  it("the shards all run in the full and light tiers: one job condition, no matrix exclude or include", () => {
    const unit = jobOf("unit");
    // The classifier's word (a notes-only change, a draft) is the ONLY thing
    // that skips them — and a failed classifier (empty output) runs them.
    expect(unit).toMatch(/^ {4}needs: changes$/m);
    expect(unit.match(/^ {4}if: .*$/gm)).toEqual(["    if: ${{ !cancelled() && needs.changes.outputs.unit != 'false' }}"]);
    expect(unit).not.toMatch(/^ {8}(exclude|include):/m);
    // A push that supersedes a pull request's run cancels it; a merge to
    // main has its own group and is never cancelled by the next one.
    expect(ci).toContain(
      "\nconcurrency:\n  group: ci-${{ github.event_name == 'pull_request' && github.ref || github.sha }}\n  cancel-in-progress: ${{ github.event_name == 'pull_request' }}\n",
    );
  });
});

describe("typecheck, lint and the build", () => {
  it("all three run in the static job", () => {
    const job = jobOf("static");
    for (const script of ["typecheck", "lint", "build"]) {
      expect(job, script).toMatch(new RegExp(`^ {6}- run: npm run ${script}$`, "m"));
    }
    // The build proves the pages fall back with nothing configured.
    expect(job).not.toMatch(/secrets\.|SUPABASE|STRIPE/);
  });
});

describe("the unit shards", () => {
  const job = jobOf("unit");
  const total = Number(/^ {8}total: \[(\d+)\]$/m.exec(job)?.[1]);
  const shards = numbers(/^ {8}shard: \[([\d, ]+)\]$/m.exec(job)?.[1] ?? "");

  it("the matrix lists every shard 1..total exactly once, and one failing never cancels the others", () => {
    expect(total).toBeGreaterThan(1);
    expect(shards).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    expect(job).toMatch(/^ {6}fail-fast: false$/m);
  });

  it("each runs its own share of the suite with coverage recorded, through vitest's own --shard", () => {
    expect(job).toContain("- run: npm run test:coverage:shard -- --shard=${{ matrix.shard }}/${{ matrix.total }}");
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    const script = pkg.scripts["test:coverage:shard"];
    expect(script).toMatch(/^vitest run --coverage /);
    expect(script).toContain("--reporter=blob");
    // The whole suite: no path, no filter, no --shard of its own.
    expect(script).not.toMatch(/tests\/|--shard|-t |--exclude|--changed|passWithNoTests/);
    // No hand-kept file lists anywhere in the job.
    expect(job).not.toMatch(/tests\/unit/);
  });

  it("each has the bucket masters before the tests (a suite gated on them skips silently without)", () => {
    const fetch = job.indexOf("node scripts/frames-fetch.mjs --out .frames-cache");
    const run = job.indexOf("- run: npm run test:coverage:shard");
    expect(fetch).toBeGreaterThan(0);
    expect(run).toBeGreaterThan(fetch);
    // No `if:` on the fetch, the tests or `npm ci`: only the cache SAVE is
    // one shard's.
    const conditions = [...job.matchAll(/^ {8}if: (.*)$/gm)].map((m) => m[1]);
    expect(conditions).toEqual(["steps.frames-cache.outputs.cache-hit != 'true' && matrix.shard == 1", "${{ !cancelled() }}"]);
    expect(job.slice(run, run + 250)).toMatch(/FRAMES_BUILD_DIR: \.frames-cache/);
  });

  it("each uploads its report — from a red shard too — under its own name", () => {
    expect(job).toContain("name: unit-blob-${{ matrix.shard }}");
    expect(job).toMatch(/path: \.vitest-reports\/\n\s+include-hidden-files: true\n\s+if-no-files-found: error/);
  });
});

describe("the coverage floors", () => {
  const job = jobOf("coverage");
  const unit = jobOf("unit");
  const config = read("vitest.config.ts");

  it("are still in vitest.config.ts, for every area that had one", () => {
    for (const area of ["lib/billing/**", "lib/stripe/**", "lib/auth/**", "lib/seo/**", "lib/ai/**"]) {
      expect(config, area).toContain(`"${area}": {`);
    }
  });

  it("only VITEST_COVERAGE_SHARD=1 switches them off, and only the shard step sets it", () => {
    expect(config).toContain('const COVERAGE_SHARD = process.env.VITEST_COVERAGE_SHARD === "1";');
    expect(config).toMatch(/thresholds: COVERAGE_SHARD\n\s+\? undefined\n\s+: \{/);
    const yaml = ci.replace(/^\s*#.*$/gm, "");
    expect(yaml.match(/VITEST_COVERAGE_SHARD/g)).toHaveLength(1);
    const run = unit.indexOf("- run: npm run test:coverage:shard");
    expect(unit.slice(run, run + 250)).toMatch(/VITEST_COVERAGE_SHARD: "1"/);
    expect(job).not.toMatch(/VITEST_COVERAGE_SHARD/);
    for (const file of ["package.json", ".env.example"]) {
      let text = "";
      try {
        text = read(file);
      } catch {
        continue;
      }
      expect(text, file).not.toMatch(/VITEST_COVERAGE_SHARD/);
    }
  });

  it("are checked on the merge of EVERY shard's coverage, shard failures or not", () => {
    expect(job).toMatch(/^ {4}needs: \[changes, unit\]$/m);
    // …but never where no shard ran (a notes-only change, a draft): the
    // floors are the whole suite's.
    expect(job.match(/^ {4}if: .*$/gm)).toEqual(["    if: ${{ !cancelled() && needs.changes.outputs.unit != 'false' }}"]);
    expect(job).toMatch(/pattern: unit-blob-\*\n\s+merge-multiple: true\n\s+path: \.vitest-reports/);
    expect(job).toMatch(/^ {6}- run: npm run test:coverage:merge$/m);
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["test:coverage:merge"]).toBe("vitest run --merge-reports --coverage");
    // One machine's run is unchanged.
    expect(pkg.scripts["test:coverage"]).toBe("vitest run --coverage");

    // The merge refuses a missing shard: the list it checks is the matrix's.
    const total = Number(/^ {8}total: \[(\d+)\]$/m.exec(unit)?.[1]);
    const checked = /for i in ([\d ]+); do test -s "\.vitest-reports\/blob-\$i-(\d+)\.json"; done/.exec(job);
    expect(checked?.[1].split(" ").map(Number)).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    expect(Number(checked?.[2])).toBe(total);
    expect(job).toContain(`test "$(ls .vitest-reports | wc -l)" -eq ${total}`);
    expect(job.indexOf("for i in")).toBeLessThan(job.indexOf("npm run test:coverage:merge"));
  });

  it("the report is still uploaded as the `coverage` artifact", () => {
    expect(job).toMatch(/name: coverage\n\s+path: coverage\/\n/);
  });
});
