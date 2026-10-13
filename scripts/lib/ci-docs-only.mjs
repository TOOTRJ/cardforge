// ---------------------------------------------------------------------------
// CI's "notes-only" rule (.github/workflows/ci.yml, the `changes` job; owner
// 2026-10-13: a pull request that changes nothing but notes skips the heavy
// checks). Pure and dependency-free: the classifier job runs it on the
// runner's own Node with no `npm ci`.
//
// A pull request is notes-only when EVERY file it changes is on the
// ALLOW-LIST below. Anything else — one other file, no file at all, a diff
// that could not be read, any event that is not a pull request (a push to
// main) — runs the whole suite. Never turn this into a deny-list: a new
// kind of file must land on the heavy side until someone says otherwise.
//
// On the list (Markdown only, `.md` in lower case):
//   - the repository root's notes: TODO.md, CLAUDE.md, README.md,
//     BILLING_SETUP.md, AGENTS.md, LICENSE.md … (`<name>.md`, no directory);
//   - docs/**/*.md (the runbooks and the archive);
//   - .claude/**/*.md (skills and their references — read by Claude, never
//     by the app);
//   - tests/README.md and tests/parity/README.md, by name.
//
// NOT on it, on purpose:
//   - *.mdx anywhere — content/articles/*.mdx are PAGES of the site;
//   - supabase/** — even a README there makes Supabase's GitHub integration
//     create a preview branch, and the migrations README is the errata of
//     the migration history;
//   - .github/** — the workflows themselves;
//   - app/**, lib/**, components/**, content/**, public/**, scripts/**,
//     types/** — a Markdown file there ships or is read by code;
//   - every other file under tests/ (fixtures included), every .txt (the
//     font licences are read by tests and shipped), docs/*.json, and
//     anything with no extension (a bare LICENSE).
//
// What a notes-only pull request still runs: `npm run test:docs` — the unit
// tests that READ a file on the list (DOCS_READING_TESTS). The list is held
// to the test files by tests/unit/devops/ci-docs-only.test.ts, which fails
// when a test names a Markdown file and is not on it.
// ---------------------------------------------------------------------------

/** Every pattern is anchored at both ends; a path matches one or it is code. */
export const NOTES_ALLOW_LIST = [
  /^[^/]+\.md$/,
  /^docs\/(?:[^/]+\/)*[^/]+\.md$/,
  /^\.claude\/(?:[^/]+\/)*[^/]+\.md$/,
  /^tests\/README\.md$/,
  /^tests\/parity\/README\.md$/,
];

/**
 * The unit tests that read a file on the allow-list — what `npm run
 * test:docs` runs, in this order. A test that starts to read Markdown joins
 * the list (and package.json's script); the devops test names the file.
 */
export const DOCS_READING_TESTS = [
  // docs/FRAMES.md (its contents list, links, paths, counts) and the section
  // titles CLAUDE.md sends readers to.
  "tests/unit/content/frames-doc.test.ts",
  // TODO.md: every art-window known failure names a TODO item that exists.
  // (Its bucket-master checks report "unavailable" here: no masters are
  // fetched for a notes-only run, and notes cannot move a master.)
  "tests/unit/render/art-window-coverage.test.ts",
];

/** Is this repo-relative path (forward slashes) a notes file? */
export function isNotesFile(file) {
  if (typeof file !== "string" || file.length === 0) return false;
  // No "..", no absolute path, no backslash, no control character: a name
  // that is not a plain relative path is never notes.
  if (file.startsWith("/") || file.includes("\\") || /[\u0000-\u001f]/.test(file)) return false;
  if (file.split("/").some((part) => part === "" || part === "." || part === "..")) return false;
  return NOTES_ALLOW_LIST.some((pattern) => pattern.test(file));
}

/**
 * The verdict for one CI run. `files` is every path the pull request adds,
 * changes or deletes (renames listed as both names), or null when the diff
 * could not be read.
 */
export function classifyChange({ event, files }) {
  if (event !== "pull_request") return { docsOnly: false, reason: `event "${event ?? ""}" is not a pull request: everything runs` };
  if (!Array.isArray(files)) return { docsOnly: false, reason: "the changed files could not be read: everything runs" };
  if (files.length === 0) return { docsOnly: false, reason: "no changed file: everything runs" };
  const code = files.filter((file) => !isNotesFile(file));
  if (code.length > 0) {
    return { docsOnly: false, reason: `${code.length} of ${files.length} changed file(s) are not notes: everything runs`, code };
  }
  return { docsOnly: true, reason: `all ${files.length} changed file(s) are notes: only the tests that read notes run` };
}
