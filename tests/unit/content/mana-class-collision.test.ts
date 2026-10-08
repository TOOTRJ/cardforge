import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// A mana pip's class is also a Tailwind utility (TODO 4.8.0, skeptic pass).
//
// mana-font draws generic mana with the class "ms-" + the number, and
// Tailwind v4 reads the same token as `margin-inline-start: <number> ×
// spacing`. Tailwind emits a utility for every candidate it FINDS IN THE
// REPO'S TEXT — its source scan takes every file git does not ignore: tests,
// scripts and docs as well as components. The app never writes such a class
// out (the previews build it from the symbol: `ms-${suffix}`), so the build
// has no such utility and a pip has no margin. One literal anywhere in the
// tree changes that for the whole site: a test that spelled the generic-3
// pip's class in an expectation made the build emit the utility, and every
// {3} in a card preview, a deck list, a cost picker and an article moved
// 12 px to the right — in the browser only, so the preview no longer matched
// the stored PNG, and no bake-side check (the Visual gate, a production
// replay) could see it.
//
// So: no file may hold such a token. The one exception is the 2 — mana-font
// itself ships `margin-left: inherit !important` for that class (its own
// guard against a margin utility), which beats Tailwind's, and
// components/cards/card-preview.tsx documents it.
//
// Write a pip's class as the code does (from the symbol), or use a symbol
// that is not a number ({X}, {G}) in a test's expectation.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../../..");

/** Folders git ignores or Tailwind never reads. */
const SKIP_DIRS = new Set(["node_modules", "tmp", "coverage", "test-results", "playwright-report", "out", "build", "dist"]);
/** What Tailwind's scan leaves out by itself: styles, lockfiles, binaries. */
const SKIP_FILES = /\.(css|scss|lock|png|jpe?g|gif|webp|avif|ico|icns|svg|ttf|otf|woff2?|eot|pdf|zip|gz|mp4|webm|mov|psd|sqlite|wasm)$|(^|\/)package-lock\.json$/i;

function textFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") || SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) textFiles(full, out);
    else if (!SKIP_FILES.test(full) && stat.size < 8 * 1024 * 1024) out.push(full);
  }
  return out;
}

// "ms-" + a number (an optional leading minus, an optional decimal), standing
// alone: not part of a longer word or class (the Fourth Edition tap's suffix
// ends in letters, a template id runs on).
const NUMERIC_MANA_CLASS = /(?<![A-Za-z0-9_-])-?ms-(\d+(?:\.\d+)?)(?![A-Za-z0-9_-])/g;

/** mana-font neutralises a margin utility on this one itself. */
const NEUTRALISED_BY_MANA_FONT = new Set(["2"]);

describe("a numeric mana class is never written out in the repo", () => {
  it("mana-font still neutralises the one exception with its own !important margin", () => {
    const css = readFileSync(path.join(ROOT, "node_modules/mana-font/css/mana.css"), "utf8");
    for (const n of NEUTRALISED_BY_MANA_FONT) {
      expect(css, n).toMatch(new RegExp(`\\.ms-${n}\\s*\\{\\s*margin-left:\\s*inherit\\s*!important;?\\s*\\}`));
    }
    // …and only that one: any other number would take Tailwind's margin.
    const guarded = [...css.matchAll(/\.ms-(\d+)\s*\{\s*margin-left:\s*inherit\s*!important/g)].map((m) => m[1]);
    expect(guarded).toEqual([...NEUTRALISED_BY_MANA_FONT]);
  });

  it("no text file holds one (Tailwind would emit its margin utility, and every such pip in the browser would move)", () => {
    const offenders: string[] = [];
    for (const file of textFiles(ROOT)) {
      const text = readFileSync(file, "utf8");
      if (!text.includes("ms-")) continue;
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        for (const match of line.matchAll(NUMERIC_MANA_CLASS)) {
          if (!NEUTRALISED_BY_MANA_FONT.has(match[1])) offenders.push(`${path.relative(ROOT, file)}:${i + 1} ${match[0]}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("the previews build the class from the symbol, never from a literal", () => {
    // Every pip the previews draw is built in mana-cost-glyphs.tsx (a card's
    // through its CardPip); card-preview.tsx writes no mana class itself.
    expect(readFileSync(path.join(ROOT, "components/cards/mana-cost-glyphs.tsx"), "utf8")).toMatch(/`ms-\$\{/);
    expect(readFileSync(path.join(ROOT, "components/cards/card-preview.tsx"), "utf8")).not.toMatch(/\bms ms-cost\b/);
  });
});
