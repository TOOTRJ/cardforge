#!/usr/bin/env node
// ---------------------------------------------------------------------------
// CI's first job (.github/workflows/ci.yml, `changes`): is this run a
// notes-only pull request? Writes `docs_only=true|false` to $GITHUB_OUTPUT
// and the reason to the run summary. The rule is scripts/lib/ci-docs-only.mjs.
//
// Fail-closed: every error ends in `docs_only=false` (the whole suite runs).
// The changed files are read from the checkout itself — for a pull request
// GitHub checks out the test MERGE commit, whose first parent is the base
// branch's tip, so `HEAD^1..HEAD` is exactly what merging would change. No
// API call, no token, no third-party action.
// ---------------------------------------------------------------------------
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { classifyChange } from "./lib/ci-docs-only.mjs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** Every path the merge commit changes against the base, or null. */
function changedFiles() {
  try {
    // A pull request's HEAD is a merge of exactly two parents; anything else
    // (a shallow clone without the parents, another ref) is not judged.
    const parents = git("rev-list", "--parents", "-n", "1", "HEAD").trim().split(/\s+/).slice(1);
    if (parents.length !== 2) return null;
    // --no-renames: a rename lists BOTH names, so code renamed to notes.md
    // still counts as code. -z: names arrive unquoted, NUL-separated.
    const out = git("diff", "--name-only", "--no-renames", "-z", "HEAD^1", "HEAD");
    return out.split("\0").filter((name) => name.length > 0);
  } catch {
    return null;
  }
}

let verdict;
try {
  const event = process.env.GITHUB_EVENT_NAME;
  verdict = classifyChange({ event, files: event === "pull_request" ? changedFiles() : null });
} catch (error) {
  verdict = { docsOnly: false, reason: `the classifier failed (${error instanceof Error ? error.message : String(error)}): everything runs` };
}

const lines = [`docs_only=${verdict.docsOnly ? "true" : "false"} — ${verdict.reason}`];
if (verdict.code?.length) {
  lines.push("", ...verdict.code.slice(0, 20).map((file) => `- \`${file}\``));
  if (verdict.code.length > 20) lines.push(`- … and ${verdict.code.length - 20} more`);
}
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `docs_only=${verdict.docsOnly ? "true" : "false"}\n`);
