import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PARITY_PATH, PARITY_PORT } from "@/tests/parity/shared";

// ---------------------------------------------------------------------------
// /dev/parity — the page the preview ⇄ bake parity suite screenshots (TODO
// 3.11) — is a route of ONE server: the suite's own `next dev`, started with
// PARITY_HARNESS=1. It must not exist anywhere else:
//
//   * its file is app/dev/parity/page.parity.tsx, and ".parity.tsx" is a page
//     extension only when next.config.ts's parityHarnessEnabled() says so —
//     never in a production build (NODE_ENV=production), whatever the env;
//   * the page answers 404 by itself outside the harness (the second lock);
//   * nothing else in app/ imports the harness component.
//
// `npm run build` proves the first point on the real compiler (the route is
// absent from the build's route list); this test keeps the rule from being
// edited away.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function filesUnder(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    return statSync(join(ROOT, rel)).isDirectory() ? filesUnder(rel) : [rel];
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function configWith(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value as string);
  return (await import("@/next.config")).default;
}

describe("the parity harness route", () => {
  it("is a page only for a development server started with PARITY_HARNESS=1", async () => {
    const { parityHarnessEnabled } = await import("@/next.config");
    expect(parityHarnessEnabled({ PARITY_HARNESS: "1", NODE_ENV: "development" })).toBe(true);
    expect(parityHarnessEnabled({ PARITY_HARNESS: "1", NODE_ENV: "production" })).toBe(false);
    expect(parityHarnessEnabled({ PARITY_HARNESS: "1", NODE_ENV: "test" })).toBe(false);
    expect(parityHarnessEnabled({ PARITY_HARNESS: "1" })).toBe(false);
    expect(parityHarnessEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(parityHarnessEnabled({ PARITY_HARNESS: "true", NODE_ENV: "development" })).toBe(false);
  });

  it("a production build knows no .parity.tsx pages, even with the flag set", async () => {
    for (const env of [
      { NODE_ENV: "production", PARITY_HARNESS: "1" },
      { NODE_ENV: "production", PARITY_HARNESS: undefined },
      { NODE_ENV: "development", PARITY_HARNESS: undefined },
    ]) {
      const config = await configWith(env);
      // Unset = Next's defaults (tsx, ts, jsx, js): "page.parity.tsx" is then
      // a module named "page.parity", which is no route file.
      expect(config.pageExtensions, JSON.stringify(env)).toBeUndefined();
    }
    const harness = await configWith({ NODE_ENV: "development", PARITY_HARNESS: "1" });
    expect(harness.pageExtensions).toEqual(["tsx", "ts", "jsx", "js", "parity.tsx"]);
  });

  it("is the only .parity. file in app/, and only that page imports the harness component", () => {
    const app = filesUnder("app");
    expect(app.filter((f) => /\.parity\./.test(f))).toEqual(["app/dev/parity/page.parity.tsx"]);
    expect(PARITY_PATH).toBe("/dev/parity");
    // No ordinary route file sits beside it: the folder is a route for the
    // harness server alone.
    expect(readdirSync(join(ROOT, "app/dev/parity")).sort()).toEqual(["page.parity.tsx", "parity-harness.tsx"]);
    const importers = [...app, ...filesUnder("components"), ...filesUnder("lib")]
      .filter((f) => /\.(ts|tsx)$/.test(f) && f !== "app/dev/parity/parity-harness.tsx")
      .filter((f) => /parity-harness/.test(read(f)));
    expect(importers).toEqual(["app/dev/parity/page.parity.tsx"]);
  });

  it("the page answers 404 by itself outside the harness (second lock)", () => {
    const page = read("app/dev/parity/page.parity.tsx");
    expect(page).toMatch(/process\.env\.PARITY_HARNESS !== "1" \|\| process\.env\.NODE_ENV !== "development"/);
    expect(page.indexOf("notFound()")).toBeGreaterThan(0);
    expect(page.indexOf("notFound()")).toBeLessThan(page.indexOf("<ParityHarness"));
  });
});

describe("the parity suite's wiring", () => {
  it("npm run test:parity runs the script; the suite keeps off the developer's ports", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["test:parity"]).toBe("node scripts/parity.mjs");
    expect([3000, 3100]).not.toContain(PARITY_PORT);
    const config = read("tests/parity/playwright.config.ts");
    expect(config).toMatch(/PARITY_HARNESS: "1"/);
    expect(config).toMatch(/reuseExistingServer: false/);
    expect(config).toMatch(/retries: 0/);
  });

  it("CI has a 'Preview parity' job that runs it and needs no database", () => {
    const ci = read(".github/workflows/ci.yml");
    const job = /\n  parity:\n([\s\S]*?)(?=\n  [a-z-]+:\n|$)/.exec(ci)?.[1] ?? "";
    expect(job).toMatch(/name: Preview parity\n/);
    expect(job).toMatch(/node scripts\/parity\.mjs/);
    expect(job).not.toMatch(/supabase/i);
    expect(job).not.toMatch(/secrets\./);
  });

  it("the e2e suite and the unit run do not pick the parity specs up", () => {
    expect(read("playwright.config.ts")).toMatch(/testDir: "tests\/e2e"/);
    expect(read("vitest.config.ts")).toMatch(/include: \["tests\/unit\/\*\*\/\*\.test\.\{ts,tsx\}"\]/);
    // The recorded baseline: a directory of case files (TODO 7.13), never
    // #514's single file again.
    expect(existsSync(join(ROOT, "tests/parity/baseline/linux"))).toBe(true);
    expect(existsSync(join(ROOT, "tests/parity/baseline.json"))).toBe(false);
  });
});
