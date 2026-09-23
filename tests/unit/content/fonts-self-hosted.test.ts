import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Fonts are self-hosted. `next/font/google` downloads from fonts.googleapis.com
// at BUILD time, and the 2026-09-22 production deploy of a green merge failed
// inside that loader. This keeps the dependency out for good.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../../..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("self-hosted fonts", () => {
  it("nothing imports next/font/google", () => {
    const offenders = ["app", "components", "lib"]
      .flatMap((dir) => sourceFiles(path.join(ROOT, dir)))
      // An actual import, not a comment that explains why there is none.
      .filter((file) => /from\s+["']next\/font\/google["']/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it("the root layout loads Geist from the geist package and Cinzel from the committed variable font", () => {
    const layout = readFileSync(path.join(ROOT, "app/layout.tsx"), "utf8");
    expect(layout).toContain('from "geist/font/sans"');
    expect(layout).toContain('from "geist/font/mono"');
    expect(layout).toContain('src: "./fonts/cinzel/Cinzel-Variable.woff2"');
    expect(existsSync(path.join(ROOT, "app/fonts/cinzel/Cinzel-Variable.woff2"))).toBe(true);
    // The OFL licence travels with the file.
    expect(readFileSync(path.join(ROOT, "app/fonts/cinzel/OFL.txt"), "utf8")).toMatch(/SIL Open Font License/);
  });
});
