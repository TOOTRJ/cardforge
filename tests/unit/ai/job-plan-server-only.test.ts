import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OWNER_JOB_COLUMNS,
  PENDING_BACK_STEP_LABEL,
  PENDING_STEP_LABEL,
  earnedStepLabel,
  isPlaceholderStepLabel,
} from "@/lib/ai/job-privacy";

// ---------------------------------------------------------------------------
// An AI job's designed text is paid for at its STEP (fix(ai), migration
// 0163, lib/ai/job-privacy.ts): its owner's session can read every column of
// `ai_generation_jobs` but `plan`, and every owner-session read names the
// columns it reads (a `select *` is refused once the column grant is live).
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const MIGRATION = readFileSync(join(ROOT, "supabase/migrations/0163_ai_job_plan_server_only.sql"), "utf8");

const columns = (list: string) =>
  list
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean)
    .sort();

describe("the columns an owner reads", () => {
  it("are the migration's grant, every column but plan", () => {
    const grant = MIGRATION.match(/grant select \(([^)]*)\)\s+on table public\.ai_generation_jobs to authenticated;/);
    expect(grant, "0163 grants authenticated a column list").not.toBeNull();
    expect(columns(grant![1]!)).toEqual(columns(OWNER_JOB_COLUMNS));
    expect(columns(OWNER_JOB_COLUMNS)).not.toContain("plan");
    // …and the table-wide SELECT is taken away first (without it the
    // column grant adds nothing: a table grant covers every column).
    expect(MIGRATION).toMatch(/revoke select on table public\.ai_generation_jobs from anon, authenticated;/);
  });

  it("are every column of the table's Row type but plan (a new column is a decision)", () => {
    const types = readFileSync(join(ROOT, "types/supabase.ts"), "utf8");
    const block = types.match(/ai_generation_jobs: \{\s*Row: \{([^}]*)\}/);
    expect(block).not.toBeNull();
    const row = [...block![1]!.matchAll(/^\s*(\w+):/gm)].map((match) => match[1]!);
    expect(columns(OWNER_JOB_COLUMNS)).toEqual(row.filter((column) => column !== "plan").sort());
  });
});

/** Every source file of the app (not tests, not scripts: the owner-run
 *  scripts read with the service role). */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("every read of ai_generation_jobs in the app", () => {
  const chains = ["app", "lib", "components"].flatMap((dir) =>
    sourceFiles(join(ROOT, dir)).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      // The query chain: from the table to the end of its statement.
      return [...text.matchAll(/\.from\("ai_generation_jobs"\)[\s\S]*?;/g)].map((match) => ({
        where: relative(ROOT, file),
        chain: match[0],
      }));
    }),
  );

  it("is found (the scan reads the queries)", () => {
    expect(chains.length).toBeGreaterThan(10);
  });

  it("names its columns — never `*`, never a bare select, never plan", () => {
    const offending = chains.filter(({ chain }) => {
      const selects = [...chain.matchAll(/\.select\(([^)]*)\)/g)].map((match) => match[1]!.trim());
      return selects.some((arg) => arg === "" || arg.includes("*") || /\bplan\b/.test(arg));
    });
    expect(offending.map(({ where, chain }) => `${where}: ${chain.slice(0, 120)}`)).toEqual([]);
  });
});

describe("a step's label until it is done", () => {
  it("is a placeholder the recent-titles list skips", () => {
    expect(isPlaceholderStepLabel(PENDING_STEP_LABEL)).toBe(true);
    expect(isPlaceholderStepLabel(PENDING_BACK_STEP_LABEL)).toBe(true);
    expect(isPlaceholderStepLabel(" your card ")).toBe(true);
    expect(isPlaceholderStepLabel("Emberwake Tyrant")).toBe(false);
  });

  it("is replaced by the plan's own once done, else left alone", () => {
    const plan = { step_labels: { "fill:0": "Hollow Village Smith // Moonlit Ravager", "fill:1": "Moonlit Ravager" } };
    expect(earnedStepLabel(plan, "fill:0")).toBe("Hollow Village Smith // Moonlit Ravager");
    expect(earnedStepLabel(plan, "fill:1")).toBe("Moonlit Ravager");
    // A plan made before step_labels (its steps hold their titles), a step
    // the plan names no label for, an empty one: the label stays.
    expect(earnedStepLabel({ fields: {} }, "fill:0")).toBeNull();
    expect(earnedStepLabel(plan, "card:0")).toBeNull();
    expect(earnedStepLabel({ step_labels: { "card:0": "  " } }, "card:0")).toBeNull();
    expect(earnedStepLabel(null, "card:0")).toBeNull();
  });
});
