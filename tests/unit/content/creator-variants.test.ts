import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The creator's two breakpoints (TODO DK5.18; docs/research/
// deck-in-place-editing-2026-10.md §8 PR 2): `creator-lg:` / `creator-xl:`
// replaced the creator's `lg:` / `xl:` so a HOST (the deck's edit drawer)
// can read its own width. On /create and /card/…/edit — no
// `[data-creator-host]` above — they must compile to EXACTLY the window
// media queries `lg:` / `xl:` compile to, or the full page moves. This test
// compiles the variants from app/globals.css with Tailwind itself and holds
// the page arrangement to the old breakpoints; inside a host they are
// container queries on `creator`.
// ---------------------------------------------------------------------------

const GLOBALS = readFileSync(path.resolve(__dirname, "../../../app/globals.css"), "utf8");

/** The two @custom-variant blocks, as written in globals.css. */
function creatorVariants(): string {
  const blocks = ["creator-lg", "creator-xl"].map((name) => {
    const start = GLOBALS.indexOf(`@custom-variant ${name} {`);
    expect(start, `@custom-variant ${name} in globals.css`).toBeGreaterThanOrEqual(0);
    let depth = 0;
    for (let i = GLOBALS.indexOf("{", start); i < GLOBALS.length; i++) {
      if (GLOBALS[i] === "{") depth++;
      if (GLOBALS[i] === "}" && --depth === 0) return GLOBALS.slice(start, i + 1);
    }
    throw new Error(`unclosed @custom-variant ${name}`);
  });
  return blocks.join("\n");
}

async function build(candidates: string[]): Promise<string> {
  const tailwind = path.dirname(createRequire(import.meta.url).resolve("tailwindcss/package.json"));
  const compiler = await compile(`@import "tailwindcss/theme.css";\n@import "tailwindcss/utilities.css";\n${creatorVariants()}`, {
    base: tailwind,
    // The two stylesheets this input imports: Tailwind's own files.
    loadStylesheet: async (id: string) => {
      const file = path.join(tailwind, id.replace(/^tailwindcss\//, ""));
      return { path: file, base: tailwind, content: readFileSync(file, "utf8") };
    },
  });
  return compiler.build(candidates);
}

/** The at-rule wrapping a class's rule, e.g. "@media (width >= 64rem)". */
function wrappersOf(css: string, className: string): string[] {
  const escaped = className.replace(/:/g, "\\:");
  const at = css.indexOf(`.${escaped}`);
  expect(at, `.${className} in the compiled CSS`).toBeGreaterThanOrEqual(0);
  const rule = css.slice(at, css.indexOf("\n}\n", at) + 3);
  return [...rule.matchAll(/@(media|container)[^{]+/g)].map((m) => m[0].trim().replace(/\s+/g, " "));
}

describe("creator-lg / creator-xl (DK5.18): the full page's breakpoints, a host's container", () => {
  it("compile, outside a host, to the same window media query as lg: / xl:", async () => {
    const css = await build(["lg:flex", "creator-lg:flex", "xl:grid", "creator-xl:grid"]);
    const [lg] = wrappersOf(css, "lg:flex");
    const [xl] = wrappersOf(css, "xl:grid");
    expect(lg).toBe("@media (width >= 64rem)");
    expect(xl).toBe("@media (width >= 80rem)");
    expect(wrappersOf(css, "creator-lg:flex")).toEqual([lg, "@container creator (width >= 48rem)"]);
    expect(wrappersOf(css, "creator-xl:grid")).toEqual([xl, "@container creator (width >= 76rem)"]);
  });

  it("scope the media query to the page (not under [data-creator-host]) and the container to a host", async () => {
    const css = await build(["creator-lg:flex"]);
    const at = css.indexOf(".creator-lg\\:flex");
    const rule = css.slice(at, css.indexOf("\n}\n", at) + 3);
    expect(rule).toMatch(/&:where\(:not\(\[data-creator-host\] \*\)\)\s*\{\s*@media \(width >= 64rem\)/);
    expect(rule).toMatch(/&:where\(\[data-creator-host\] \*\)\s*\{\s*@container creator \(width >= 48rem\)/);
  });
});
