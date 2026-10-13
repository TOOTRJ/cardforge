// ---------------------------------------------------------------------------
// CI's tiers (.github/workflows/ci.yml, the `changes` job; owner 2026-10-13:
// Actions minutes are billed once the repo is private, a full run is ~65 of
// them). Pure and dependency-free: the classifier job runs it on the
// runner's own Node with no `npm ci`.
//
//   full   everything. A READY pull request, and every case nothing below
//          claims — an unknown event, a diff that could not be read, no
//          changed file, a classifier that threw. The default is the
//          expensive one, on purpose.
//   notes  a pull request (or a merge to main) whose EVERY changed file is
//          on the allow-list below: only `npm run test:docs`.
//   draft  a DRAFT pull request that changes code: typecheck + lint + build
//          and `npm run test:docs`. The heavy jobs run when it is marked
//          ready (`ready_for_review` starts a full run on the same head).
//   light  a merge to main whose tree IS the pull request head's tree (the
//          branch already held all of main, so the pull request's own run
//          tested these exact files) and which leaves the frame manifest
//          alone: typecheck + lint + build + the unit shards + coverage;
//          not e2e, visual, parity or "Frames published" again.
//
// NOTES — the allow-list. Never turn it into a deny-list: a new kind of
// file must land on the heavy side until someone says otherwise.
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
// What a notes-only change still runs: `npm run test:docs` — the unit tests
// that READ a file on the list (DOCS_READING_TESTS). The list is held to the
// test files by tests/unit/devops/ci-docs-only.test.ts, which fails when a
// test names a Markdown file and is not on it.
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
  // fetched for this job, and notes cannot move a master.)
  "tests/unit/render/art-window-coverage.test.ts",
];

/**
 * A merge to main that changes this file always runs in full: main's run is
 * what SAVES the frame caches a pull request restores (a pull request can
 * read only its base branch's caches), and "Frames published" must be seen
 * on main once the manifest moved.
 */
export const FRAME_MANIFEST = "lib/frames/frame-manifest.json";

/**
 * What each tier runs. `static` = typecheck + lint + build; `unit` = the
 * shards and the coverage merge; `heavy` = e2e, the visual bakes and gate,
 * parity, "Frames published"; `docs` = `npm run test:docs`.
 */
export const TIERS = {
  full: { static: true, unit: true, heavy: true, docs: false },
  light: { static: true, unit: true, heavy: false, docs: false },
  draft: { static: true, unit: false, heavy: false, docs: true },
  notes: { static: false, unit: false, heavy: false, docs: true },
};

/**
 * Is this repo-relative path (forward slashes) a notes file?
 * @param {unknown} file
 */
export function isNotesFile(file) {
  if (typeof file !== "string" || file.length === 0) return false;
  // No "..", no absolute path, no backslash, no control character: a name
  // that is not a plain relative path is never notes.
  if (file.startsWith("/") || file.includes("\\") || /[\u0000-\u001f]/.test(file)) return false;
  if (file.split("/").some((part) => part === "" || part === "." || part === "..")) return false;
  return NOTES_ALLOW_LIST.some((pattern) => pattern.test(file));
}

/**
 * The tier of one CI run.
 *   event            GITHUB_EVENT_NAME.
 *   files            every path the merge commit adds, changes or deletes
 *                    against its first parent (renames as both names), or
 *                    null when the diff could not be read.
 *   draft            pull request only: `true` (the boolean) for a draft.
 *   treeIsPrHead     push only: `true` when HEAD is a merge commit whose
 *                    tree equals its second parent's AND whose first parent
 *                    is an ancestor of the second — the merged files are
 *                    byte for byte what the pull request's run tested.
 *
 * @param {{ event?: string, files?: string[] | null, draft?: unknown, treeIsPrHead?: unknown }} input
 * @returns {{ tier: "full" | "notes" | "draft" | "light", reason: string, code?: string[] }}
 */
export function classifyChange({ event, files, draft, treeIsPrHead }) {
  /** @returns {{ tier: "full", reason: string, code?: string[] }} */
  const full = (/** @type {string} */ reason, extra = {}) => ({ tier: "full", reason: `${reason}: everything runs`, ...extra });
  if (event !== "pull_request" && event !== "push") return full(`event "${event ?? ""}" is neither a pull request nor a push`);
  if (!Array.isArray(files)) return full("the changed files could not be read");
  if (files.length === 0) return full("no changed file");

  const code = files.filter((file) => !isNotesFile(file));
  if (code.length === 0) {
    return { tier: "notes", reason: `all ${files.length} changed file(s) are notes: only the tests that read notes run` };
  }
  const notNotes = `${code.length} of ${files.length} changed file(s) are not notes`;

  if (event === "pull_request") {
    if (draft === true) {
      return {
        tier: "draft",
        reason: `${notNotes} and the pull request is a DRAFT: typecheck, lint, build and the notes tests run — mark it ready for the full checks`,
        code,
      };
    }
    return full(`${notNotes} and the pull request is ready`, { code });
  }

  if (treeIsPrHead !== true) return full(`${notNotes} and main had moved under the pull request (or this is no merge commit) — this tree was never tested`, { code });
  if (files.includes(FRAME_MANIFEST)) return full(`${notNotes} and the frame manifest changed (main saves the frame caches)`, { code });
  return {
    tier: "light",
    reason: `${notNotes}, and the merged tree is the pull request head's own: typecheck, lint, build and the unit suite run; e2e, visual, parity and "Frames published" ran on these files in the pull request`,
    code,
  };
}
