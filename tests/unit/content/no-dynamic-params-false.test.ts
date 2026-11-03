import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// No `dynamicParams = false` in app/.
//
// With it, a built page that the cache can't hand back has no fallback: Next
// answers 404 (`NoFallbackError`) instead of rendering it again. Under
// `next start` that is every built page of the route as soon as one of its
// cache tags expires: the file-system cache returns nothing for an entry
// with an expired tag, and every page carries `_N_T_/layout`, which a
// sign-in, sign-out or onboarding expires (`revalidatePath("/", "layout")`);
// a publish's `updateTag(ARTICLES_TAG)` does it to /learn. The pages stayed
// 404 until a restart (2026-11-02: /help/*, /learn/*, /gallery/type/*,
// /decks/format/* after an independent check's sign-in). Vercel's minimal
// mode skips that branch, so production never showed it — but a local or
// self-hosted `next start` did.
//
// So a route with built params leaves dynamicParams on (the default) and
// answers an unknown key with notFound() — the SEO contract's real 404.
// ---------------------------------------------------------------------------

const APP = path.resolve(__dirname, "../../../app");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(tsx?|jsx?)$/.test(entry.name) ? [full] : [];
  });
}

const files = sourceFiles(APP).map((file) => ({
  file: path.relative(APP, file),
  source: readFileSync(file, "utf8"),
}));

const DYNAMIC_PARAMS_FALSE = /export\s+const\s+dynamicParams\s*(?::[^=]+)?=\s*false\b/;
const builtParamPages = files.filter(
  ({ file, source }) => /(^|\/)page\.tsx$/.test(file) && /\bgenerateStaticParams\b/.test(source),
);

describe("dynamicParams", () => {
  it("the scan sees the routes with built params", () => {
    expect(builtParamPages.map(({ file }) => file)).toEqual(
      expect.arrayContaining([
        "(marketing)/help/[section]/page.tsx",
        "(marketing)/learn/[category]/page.tsx",
        "(marketing)/gallery/type/[type]/page.tsx",
        "(marketing)/decks/format/[format]/page.tsx",
      ]),
    );
  });

  it("no route turns its fallback off", () => {
    const offenders = files.filter(({ source }) => DYNAMIC_PARAMS_FALSE.test(source)).map(({ file }) => file);
    expect(
      offenders,
      "dynamicParams = false 404s every built page once a cache tag expires under `next start` — use notFound() for unknown keys",
    ).toEqual([]);
  });

  it("the pattern catches the line it forbids", () => {
    expect(DYNAMIC_PARAMS_FALSE.test("export const dynamicParams = false;")).toBe(true);
    expect(DYNAMIC_PARAMS_FALSE.test("export const dynamicParams: boolean = false;")).toBe(true);
    expect(DYNAMIC_PARAMS_FALSE.test("export const dynamicParams = true;")).toBe(false);
  });

  it.each(builtParamPages.map(({ file }) => file))(
    "%s answers an unknown key with notFound() in the metadata and the page",
    (file) => {
      const source = files.find((entry) => entry.file === file)!.source;
      expect(source).toMatch(/import\s*\{[^}]*\bnotFound\b[^}]*\}\s*from\s*["']next\/navigation["']/);
      expect(source.match(/\bnotFound\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    },
  );
});
