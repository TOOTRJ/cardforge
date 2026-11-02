#!/usr/bin/env node
// Vercel's Ignored Build Step (vercel.json `ignoreCommand`): exit 0 skips
// the build, exit 1 builds. The rule — skip a notes-only change, build on
// ANY doubt — is scripts/lib/vercel-ignore-build.mjs. This entry ALWAYS
// exits explicitly, and 1 unless `run` answered 0: a module that fails to
// load is an uncaught error (node exits 1), never a silent exit 0.
// Dependency-free: Vercel runs it before `npm install`.

import { BUILD, run, runGit, SKIP } from "./lib/vercel-ignore-build.mjs";

let code = BUILD;
try {
  code = run({ env: process.env, git: runGit }) === SKIP ? SKIP : BUILD;
} catch {
  code = BUILD;
}
process.exit(code);
