import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// `next build` skips its type check on VERCEL only (owner 2026-11-02,
// docs/research/vercel-build-cost-2026-11.md §3.6): 49–51 s of every Vercel
// build. CI's "Typecheck, lint, build" job (`npm run typecheck`, then
// `npm run build` with no VERCEL) still type-checks every commit, and a
// local build still does. What must hold:
//
//   - the switch is on for VERCEL=1 alone — never for a build CI or a
//     developer runs;
//   - CI's build job never sets VERCEL, so its `next build` keeps the check.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function configWith(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value as string);
  return (await import("@/next.config")).default;
}

describe("the type check inside next build", () => {
  it("is skipped only when VERCEL is exactly \"1\"", async () => {
    const { skipBuildTypeCheck } = await import("@/next.config");
    expect(skipBuildTypeCheck({ VERCEL: "1" })).toBe(true);
    expect(skipBuildTypeCheck({})).toBe(false);
    expect(skipBuildTypeCheck({ VERCEL: "" })).toBe(false);
    expect(skipBuildTypeCheck({ VERCEL: "0" })).toBe(false);
    expect(skipBuildTypeCheck({ VERCEL: "true" })).toBe(false);
    expect(skipBuildTypeCheck({ CI: "true" })).toBe(false);
    expect(skipBuildTypeCheck({ CI: "true", GITHUB_ACTIONS: "true" })).toBe(false);
  });

  it("the config reads it: on a Vercel build, and only there", async () => {
    expect((await configWith({ VERCEL: "1" })).typescript?.ignoreBuildErrors).toBe(true);
    expect((await configWith({ VERCEL: undefined })).typescript?.ignoreBuildErrors).toBe(false);
    expect((await configWith({ VERCEL: undefined, CI: "true" })).typescript?.ignoreBuildErrors).toBe(false);
  });

  it("CI's build job type-checks and builds without VERCEL", () => {
    const ci = read(".github/workflows/ci.yml");
    const start = ci.indexOf("\n  static:\n");
    expect(start).toBeGreaterThan(0);
    // The job runs to the next job id (two spaces, a name, a colon).
    const rest = ci.slice(start + 1);
    const next = rest.slice(1).search(/\n {2}[a-z_-]+:\n/);
    const steps = next > 0 ? rest.slice(0, next + 1) : rest;
    expect(steps).not.toContain("VERCEL");
    expect(steps).toContain("name: Typecheck, lint, build");
    expect(steps).toContain("- run: npm run typecheck");
    expect(steps).toContain("- run: npm run build");
    // No workflow or package script turns the switch on.
    expect(ci).not.toMatch(/^\s*VERCEL\s*:/m);
    expect(read("package.json")).not.toMatch(/\bVERCEL=/);
  });
});
