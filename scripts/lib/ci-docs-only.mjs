// ---------------------------------------------------------------------------
// CI's tiers (.github/workflows/ci.yml, the `changes` job; owner 2026-10-13:
// Actions minutes are billed once the repo is private, a full run is ~65 of
// them). Pure and dependency-free: the classifier job runs it on the
// runner's own Node with no `npm ci`.
//
//   full     everything. A READY pull request, a merge to main that no
//            green full pull request run tested, and every case nothing
//            below claims — an unknown event, a diff that could not be read,
//            no changed file, a classifier that threw. The default is the
//            expensive one, on purpose. Off a pull request the unit shards
//            also record COVERAGE and the floors are held (`coverageFor`;
//            owner 2026-10-16: never on a pull request).
//   notes    a pull request (or a merge to main) whose EVERY changed file
//            is on the allow-list below: only `npm run test:docs`.
//   draft    a DRAFT pull request that changes code: typecheck + lint +
//            build and `npm run test:docs`. The heavy jobs run when it is
//            marked ready (`ready_for_review` starts a full run on the same
//            head).
//   verified a merge to main whose tree IS the pull request head's tree (the
//            branch already held all of main, so the pull request's run
//            tested these exact files) AND whose head has a GREEN FULL pull
//            request run of ci.yml (scripts/lib/ci-runs.mjs, read through
//            the GitHub API): only the cache warm-up (the frame caches every
//            pull request restores from main) and "Frames published"
//            (owner 2026-10-16).
//   nightly  the schedule: the unit shards with coverage and the floors, on
//            main as it is (a verified merge runs no unit test on main).
//   idle     the schedule, when a run of ci.yml on this very commit already
//            passed the coverage floors: nothing runs.
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
 * What each tier runs. `static` = typecheck + lint + build; `unit` = the
 * shards (and, off a pull request, the coverage merge: `coverageFor`);
 * `heavy` = e2e, the visual bakes and gate, parity; `frames` = "Frames
 * published"; `warm` = the cache warm-up (the frame caches main saves for
 * every pull request — a pull request can read only its base branch's
 * caches); `docs` = `npm run test:docs`.
 */
export const TIERS = {
  full: { static: true, unit: true, heavy: true, frames: true, warm: false, docs: false },
  verified: { static: false, unit: false, heavy: false, frames: true, warm: true, docs: false },
  nightly: { static: false, unit: true, heavy: false, frames: false, warm: false, docs: false },
  idle: { static: false, unit: false, heavy: false, frames: false, warm: false, docs: false },
  draft: { static: true, unit: false, heavy: false, frames: false, warm: false, docs: true },
  notes: { static: false, unit: false, heavy: false, frames: false, warm: false, docs: true },
};

/**
 * Do this run's unit shards record coverage, and does the `coverage` job
 * hold the floors? Wherever the shards run EXCEPT on a pull request (owner
 * 2026-10-16: the floors are held on main and nightly; a pull request's
 * shards run plain vitest, about twice as fast). Any other event — a push to
 * main, the schedule, one nobody expected — covers.
 * @param {string} tier
 * @param {string | undefined} event
 */
export function coverageFor(tier, event) {
  return Object.hasOwn(TIERS, tier) && TIERS[tier].unit === true && event !== "pull_request";
}

/**
 * Every output the classifier writes: `tier`, each group of TIERS as
 * "true" / "false", and `coverage`.
 * @param {string} tier
 * @param {string | undefined} event
 * @returns {Record<string, string>}
 */
export function tierOutputs(tier, event) {
  if (!Object.hasOwn(TIERS, tier)) throw new Error(`unknown tier "${tier}"`);
  const groups = Object.entries(TIERS[tier]).map(([group, on]) => [group, on ? "true" : "false"]);
  return { tier, ...Object.fromEntries(groups), coverage: coverageFor(tier, event) ? "true" : "false" };
}

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
 *   prRunGreen       push only: `true` when a pull request run of ci.yml on
 *                    the second parent (the pull request's head) finished
 *                    GREEN in the full tier (scripts/lib/ci-runs.mjs).
 *   alreadyCovered   schedule only: `true` when a run of ci.yml on this
 *                    commit already passed the coverage floors.
 * The four flags count only as the boolean `true`; anything else is "no".
 *
 * @param {{ event?: string, files?: string[] | null, draft?: unknown, treeIsPrHead?: unknown, prRunGreen?: unknown, alreadyCovered?: unknown }} input
 * @returns {{ tier: "full" | "verified" | "nightly" | "idle" | "notes" | "draft", reason: string, code?: string[] }}
 */
export function classifyChange({ event, files, draft, treeIsPrHead, prRunGreen, alreadyCovered }) {
  /** @returns {{ tier: "full", reason: string, code?: string[] }} */
  const full = (/** @type {string} */ reason, extra = {}) => ({ tier: "full", reason: `${reason}: everything runs`, ...extra });
  if (event === "schedule") {
    if (alreadyCovered === true) return { tier: "idle", reason: "a run of ci.yml on this commit already passed the coverage floors: nothing runs" };
    return { tier: "nightly", reason: "the nightly coverage run: the unit shards with coverage, and the floors, on main as it is" };
  }
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
  if (prRunGreen !== true) {
    return full(`${notNotes}; the merged tree is the pull request head's, but no GREEN FULL pull request run of that head was found (or the lookup failed)`, { code });
  }
  return {
    tier: "verified",
    reason: `${notNotes}; the merged tree is the pull request head's own and that head's full pull request run was green: only the cache warm-up and "Frames published" run`,
    code,
  };
}
