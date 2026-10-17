#!/usr/bin/env node
// ---------------------------------------------------------------------------
// CI's first job (.github/workflows/ci.yml, `changes`): which TIER is this
// run — full, verified, nightly, idle, notes or draft? Writes `tier`, what
// the tier runs (`static`, `unit`, `heavy`, `frames`, `warm`, `docs`) and
// `coverage` ("true" / "false") to $GITHUB_OUTPUT, and the tier with its
// reason to the run summary. The rule is scripts/lib/ci-docs-only.mjs.
//
// Fail-closed: every error ends in the FULL tier (on the schedule: the
// nightly coverage run). The changed files are read from the checkout
// itself — for a pull request GitHub checks out the test MERGE commit, whose
// first parent is the base branch's tip, and a merge to main is one too:
// `HEAD^1..HEAD` is exactly what merging changes.
//
// The GitHub API is asked two things only (scripts/lib/ci-runs.mjs, with the
// run's own GITHUB_TOKEN — `actions: read` — passed as GH_TOKEN): on a merge
// to main whose tree is its pull request head's, whether that head has a
// GREEN FULL pull request run (→ `verified`); on the schedule, whether this
// commit already passed the coverage floors (→ `idle`). No token, an
// unexpected answer or a network error is "no".
// ---------------------------------------------------------------------------
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { classifyChange, tierOutputs } from "./lib/ci-docs-only.mjs";
import { commitPassedCoverage, findGreenFullPrRun, githubApi, workflowPathOf } from "./lib/ci-runs.mjs";

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
 * all of the previous main already inside the branch? Then every pull
 * request run of that head tested exactly these files: its test merge was
 * the head with an EARLIER main — and main's ruleset refuses non-fast-forward
 * pushes, so every earlier tip of main is an ancestor of HEAD^1, hence of the
 * head, and such a merge's tree is the head's own. Any doubt is `false`.
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

/** What the run summary says about the lookups. */
const notes = [];
const log = (line) => {
  notes.push(line);
};

/** The API client and this run's coordinates, or null ("no"). */
function apiContext() {
  const repo = process.env.GITHUB_REPOSITORY;
  const workflowPath = workflowPathOf(process.env.GITHUB_WORKFLOW_REF);
  if (!process.env.GH_TOKEN || !repo || !workflowPath) {
    log("no API token, repository or workflow ref: not looked up");
    return null;
  }
  return { api: githubApi({ token: process.env.GH_TOKEN, base: process.env.GITHUB_API_URL || undefined }), repo, workflowPath };
}

const failed = (error) => {
  log(`the lookup failed (${error instanceof Error ? error.message : String(error)})`);
  return false;
};

/** A merge to main: does its pull request head (HEAD^2) have a green full run? */
async function prRunGreen() {
  try {
    const ctx = apiContext();
    if (!ctx) return false;
    const headSha = git("rev-parse", "HEAD^2").trim();
    const run = await findGreenFullPrRun({ ...ctx, headSha, log });
    log(run ? `the pull request head ${headSha.slice(0, 12)} has a green full run: ${run.html_url ?? run.id}` : `no green full pull request run of ${headSha.slice(0, 12)} was found`);
    return run !== null;
  } catch (error) {
    return failed(error);
  }
}

/** The schedule: did a run of ci.yml on HEAD already pass the floors? */
async function alreadyCovered() {
  try {
    const ctx = apiContext();
    if (!ctx) return false;
    return await commitPassedCoverage({ ...ctx, sha: git("rev-parse", "HEAD").trim(), currentRunId: process.env.GITHUB_RUN_ID, log });
  } catch (error) {
    return failed(error);
  }
}

const event = process.env.GITHUB_EVENT_NAME;
let verdict;
let outputs;
try {
  const sameTree = event === "push" && treeIsPrHead();
  verdict = classifyChange({
    event,
    files: event === "pull_request" || event === "push" ? changedFiles() : null,
    // The workflow passes `github.event.pull_request.draft`: "true" for a draft.
    draft: event === "pull_request" && process.env.PR_DRAFT === "true",
    treeIsPrHead: sameTree,
    // Asked only where the answer can matter.
    prRunGreen: sameTree && (await prRunGreen()),
    alreadyCovered: event === "schedule" && (await alreadyCovered()),
  });
  outputs = tierOutputs(verdict.tier, event);
} catch (error) {
  const fallback = event === "schedule" ? "nightly" : "full";
  verdict = { tier: fallback, reason: `the classifier failed (${error instanceof Error ? error.message : String(error)}): the ${fallback} tier runs` };
  outputs = tierOutputs(fallback, event);
}

const lines = [`**CI tier: ${verdict.tier}** — ${verdict.reason}`];
if (outputs.coverage === "true") lines.push("", "The unit shards record coverage, and `Unit coverage` holds the floors.");
if (notes.length) lines.push("", ...notes.map((line) => `- ${line}`));
if (verdict.code?.length && verdict.tier === "full") {
  lines.push("", ...verdict.code.slice(0, 20).map((file) => `- \`${file}\``));
  if (verdict.code.length > 20) lines.push(`- … and ${verdict.code.length - 20} more`);
}
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `${Object.entries(outputs).map(([key, value]) => `${key}=${value}`).join("\n")}\n`);
}
