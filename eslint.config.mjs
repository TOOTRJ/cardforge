import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Claude Code worktrees hold full stale snapshots of the repo (gitignored);
    // linting them double-counts every file and floods the report with
    // thousands of phantom problems. Coverage output is generated, not source.
    ".claude/**",
    "coverage/**",
  ]),
]);

export default eslintConfig;
