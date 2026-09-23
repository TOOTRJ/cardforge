// ---------------------------------------------------------------------------
// Regenerate app/fonts/geist/*.woff2 from Vercel's `geist` package, subset to
// Google Fonts' latin + latin-ext ranges (the only ones the UI needs). The
// package ships every glyph (~70 KB per file); the subsets are ~40 KB with
// the wght axis intact. Run after bumping `geist`:
//
//   npx -y -p geist@1 node scripts/subset-geist.mjs   # or `npm i -D geist@1` first
//
// Needs Python 3 with fontTools + brotli (`python3 -m pip install fonttools brotli`).
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const pkg = path.dirname(require.resolve("geist/package.json"));
const out = path.resolve("app/fonts/geist");
mkdirSync(out, { recursive: true });

// Google Fonts' unicode-range subsets (what next/font/google served before).
const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

const FILES = [
  ["dist/fonts/geist-sans/Geist-Variable.woff2", "Geist-Variable.woff2"],
  ["dist/fonts/geist-mono/GeistMono-Variable.woff2", "GeistMono-Variable.woff2"],
];

for (const [src, name] of FILES) {
  const from = path.join(pkg, src);
  if (!existsSync(from)) throw new Error(`Missing ${from} — is the geist package installed?`);
  const to = path.join(out, name);
  execFileSync("python3", [
    "-m", "fontTools.subset", from,
    `--unicodes=${LATIN},${LATIN_EXT}`,
    "--flavor=woff2",
    "--layout-features=*",
    "--name-IDs=*",
    `--output-file=${to}`,
  ], { stdio: "inherit" });
  console.log(`✓ ${name}: ${statSync(from).size} → ${statSync(to).size} bytes`);
}
copyFileSync(path.join(pkg, "LICENSE.txt"), path.join(out, "OFL.txt"));
console.log("✓ OFL.txt copied");
