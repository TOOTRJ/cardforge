#!/usr/bin/env node
// ---------------------------------------------------------------------------
// CI's first job (.github/workflows/ci.yml, `changes`): which TIER is this
// run — full, notes, draft or light? Writes `tier` and what the tier runs
// (`static`, `unit`, `heavy`, `docs`: "true" / "false") to $GITHUB_OUTPUT and
// the tier with its reason to the run summary. The rule is
// scripts/lib/ci-docs-only.mjs.
//
// Fail-closed: every error ends in the FULL tier. The changed files are read
// from the checkout itself — for a pull request GitHub checks out the test
// MERGE commit, whose first parent is the base branch's tip, and a merge to
// main is one too: `HEAD^1..HEAD` is exactly what merging changes. No API
// call, no token, no third-party action.
// ---------------------------------------------------------------------------
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { classifyChange, TIERS } from "./lib/ci-docs-only.mjs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });

/** HEAD's two parents, or null when HEAD is not a merge of exactly two. */
function mergeParents() {
  try {
    const parents = git("rev-list", "--parents", "-n", "1", "HEAD").trim().split(/\s+/).slice(1);
    return parents.length === 2 ? parents : null;
  } catch {
    return null;
  }
}

/** Every path the merge commit changes against its first parent, or null. */
function changedFiles() {
  try {
    // Anything but a merge of two parents (a shallow clone without them,
    // another ref, a direct push) is not judged.
    if (!mergeParents()) return null;
    // --no-renames: a rename lists BOTH names, so code renamed to notes.md
    // still counts as code. -z: names arrive unquoted, NUL-separated.
    const out = git("diff", "--name-only", "--no-renames", "-z", "HEAD^1", "HEAD");
    return out.split("\0").filter((name) => name.length > 0);
  } catch {
    return null;
  }
}

/**
 * A merge to main: is the merged tree the pull request head's own tree, with
 * all of the previous main already inside the branch? Then the pull
 * request's run — which tested the merge of that head with a main it
 * already contained — ran on these exact files. Any doubt is `false`.
 */
function treeIsPrHead() {
  try {
    if (!mergeParents()) return false;
    if (git("rev-parse", "HEAD^{tree}").trim() !== git("rev-parse", "HEAD^2^{tree}").trim()) return false;
    // The checkout is two commits deep; the ancestry needs the branch's
    // history. Commits and trees only (no file contents). A failed fetch
    // leaves the clone shallow, where ancestry can only be UNDER-reported.
    try {
      if (git("rev-parse", "--is-shallow-repository").trim() === "true") git("fetch", "--quiet", "--no-tags", "--filter=blob:none", "--unshallow", "origin");
    } catch {
      /* stay shallow: the test below then says no */
    }
    execFileSync("git", ["merge-base", "--is-ancestor", "HEAD^1", "HEAD^2"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

let verdict;
try {
  const event = process.env.GITHUB_EVENT_NAME;
  verdict = classifyChange({
    event,
    files: event === "pull_request" || event === "push" ? changedFiles() : null,
    // The workflow passes `github.event.pull_request.draft`: "true" for a draft.
    draft: event === "pull_request" && process.env.PR_DRAFT === "true",
    treeIsPrHead: event === "push" && treeIsPrHead(),
  });
  if (!Object.hasOwn(TIERS, verdict.tier)) throw new Error(`unknown tier "${verdict.tier}"`);
} catch (error) {
  verdict = { tier: "full", reason: `the classifier failed (${error instanceof Error ? error.message : String(error)}): everything runs` };
}

const runs = TIERS[verdict.tier];
const lines = [`**CI tier: ${verdict.tier}** — ${verdict.reason}`];
if (verdict.code?.length && verdict.tier === "full") {
  lines.push("", ...verdict.code.slice(0, 20).map((file) => `- \`${file}\``));
  if (verdict.code.length > 20) lines.push(`- … and ${verdict.code.length - 20} more`);
}
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
if (process.env.GITHUB_OUTPUT) {
  const output = [`tier=${verdict.tier}`, ...Object.entries(runs).map(([group, on]) => `${group}=${on ? "true" : "false"}`)];
  appendFileSync(process.env.GITHUB_OUTPUT, `${output.join("\n")}\n`);
}

// probe: a code change on a draft (throwaway)
