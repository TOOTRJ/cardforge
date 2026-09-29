// ---------------------------------------------------------------------------
// ts-alias-hooks.mjs — lets a Node script import the app's TypeScript that
// uses the "@/…" alias (tsconfig `paths`) under Node's own type stripping:
// "@/lib/cards/typography" resolves to <repo>/lib/cards/typography.ts (then
// .tsx, then /index.ts). Import it for its side effect, then load the app
// module with a DYNAMIC import (static imports link before the hook exists):
//
//   import "./lib/ts-alias-hooks.mjs";
//   const { getFrameProfile } = await import("../lib/cards/template-layout.ts");
//
// scripts/import-cc-frames.mjs reads the frame profiles' art slots this way
// for the art-window check (TODO 7.6); tests/unit/render/art-window-coverage
// .test.ts holds it to vitest's view of the same module. Resolution only —
// the loaded files are still plain type-stripped TypeScript.
// ---------------------------------------------------------------------------
import { existsSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** "@/x/y" → the file it names under `root`, or null. */
export function resolveAlias(specifier, root = REPO_ROOT) {
  if (!specifier.startsWith("@/")) return null;
  const base = path.join(root, specifier.slice(2));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const file = resolveAlias(specifier);
    return nextResolve(file ? pathToFileURL(file).href : specifier, context);
  },
});
