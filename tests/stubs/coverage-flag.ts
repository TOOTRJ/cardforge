import type { TestProject } from "vitest/node";

// ---------------------------------------------------------------------------
// Whether this run collects coverage (vitest.config.ts `globalSetup`).
//
// A test that times the code it guards (the strong-language detector's
// linear-time tests) reads it with `inject("coverageOn")`: v8 coverage
// instruments every line and makes such code 5–8× slower, so an absolute
// millisecond bound tuned on an uninstrumented run is noise under it. The
// unit shards of a PR run without coverage; `main`'s full runs and the
// nightly schedule collect it (CLAUDE.md, CI tiers). A test may relax ONLY
// a wall-clock bound on it — never what it asserts about the result.
// ---------------------------------------------------------------------------

declare module "vitest" {
  export interface ProvidedContext {
    /** True when this run collects coverage (`vitest run --coverage`). */
    coverageOn: boolean;
  }
}

export default function setup(project: TestProject) {
  project.provide("coverageOn", project.globalConfig.coverage.enabled === true);
}
