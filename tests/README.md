# Tests

Two-tier test layer:

- **Unit tests** (`tests/unit/`) — Vitest, run in Node. Cover `lib/`
  helpers, route handlers and a few components, grouped by area under
  `tests/unit/<area>/` (admin, ai, api, auth, billing, cards, content,
  creator, db, decks, devops, email, format, messages, moderation, mse,
  notifications, og, pips, render, routing, scryfall, seo, updates,
  validation). `npm run test:coverage` prints the coverage table and
  enforces the floors in `vitest.config.ts` for the money/auth areas.
- **End-to-end tests** (`tests/e2e/`) — Playwright, run against a live
  dev server. Marketing + a11y smoke run anywhere; the auth / create /
  custom-pips / Scryfall / decks / challenges / frame-editor / pricing
  specs run against the **local Supabase stack** (see below) and
  `test.skip()` cleanly when it isn't set up.

## Running locally

```bash
# unit
npm run test:unit              # one-shot
npm run test:unit:watch        # watch mode

# e2e — one-time setup
npx playwright install chromium

# e2e — run
npm run test:e2e

# both
npm test
```

## CI

### Tiers: what a run costs, and how to work with them

Actions minutes are billed (private repo; every job is rounded up to a whole
minute). The first job of every run, **Classify the change**
(`scripts/ci-classify-change.mjs`, rule in `scripts/lib/ci-docs-only.mjs`),
puts the run in one tier and says which, and why, on the run summary:

| Tier | When | Runs | Billed (measured 2026-10-13) |
| --- | --- | --- | --- |
| **full** | a READY pull request; a merge to `main` that its PR did not already test; anything unclear | everything | ~67 min |
| **draft** | a DRAFT pull request that changes code | typecheck + lint + build, and the notes tests | ~7 min |
| **notes** | every changed file is notes (PR or merge to `main`) | the notes tests (`npm run test:docs`) | ~3 min |
| **light** | a merge to `main` whose tree IS its PR head's tree (the branch held all of `main`) and that leaves `lib/frames/frame-manifest.json` alone | typecheck + lint + build, the six unit shards, coverage | ~37 min |

**Working with it: open the pull request as a draft while you iterate, mark
it ready when you want the full checks.**

```bash
gh pr create --draft …     # every push: the draft tier
gh pr ready 123            # starts the FULL run on the same commit, no push needed
gh pr ready 123 --undo     # back to draft: the NEXT push runs the draft tier
```

- A draft cannot be merged (GitHub refuses it), and its gate reports as
  **Draft checks (typecheck, lint, build)** — the required name
  **Typecheck, lint, unit** stays "Expected — waiting for status" until a
  full run has finished. That is deliberate: the draft run leaves "skipped"
  on E2E, Frames published and Visual regression, and a skipped required
  check counts as satisfied. A green gate under the required name would
  still be on the commit in the minutes after "ready for review", before
  the full run had judged anything. The gate also waits for every other
  required job, so it is the last check to turn green.
- A pull request opened ready, and every push to a ready one, is a full run.
  A newer push (or "ready for review") cancels the run in flight for that
  pull request. Merges to `main` never cancel each other.
- A cancelled DRAFT run leaves its gate **skipped**, not red: "Draft checks"
  is not required and the run that cancelled it judges the commit. A
  cancelled run of any other tier still FAILS "Typecheck, lint, unit" — a
  skipped required check would count as passing — so a superseded ready
  push shows red on its old commit (not on the pull request's head), and a
  draft run that fails for real is red as before.
- `--undo` starts no run (`converted_to_draft` is not a trigger): the commit
  keeps the results it has, and a full run already in flight finishes —
  cancel it by hand if you want the minutes back.
- A full run that is not needed is the expensive mistake: marking ready and
  then pushing three fixes costs three full runs. Push the fixes as a draft.

**Notes** are an allow-list — a pull request is notes-only when EVERY changed
file is on it:

| On the list (`.md` only) | Never on it |
| --- | --- |
| root `*.md` (`TODO.md`, `CLAUDE.md`, `README.md`, `BILLING_SETUP.md`, …) | `*.mdx` anywhere — `content/articles/*.mdx` are pages |
| `docs/**/*.md` | `supabase/**` (even its README: it starts a Supabase preview branch) |
| `.claude/**/*.md` | `.github/**` |
| `tests/README.md`, `tests/parity/README.md` | `app/`, `lib/`, `components/`, `content/`, `public/`, `scripts/`, `types/`, everything else under `tests/`, every `.txt`, `docs/*.json`, a bare `LICENSE` |

`npm run test:docs` is the unit tests that READ a notes file —
`frames-doc.test.ts` (docs/FRAMES.md, CLAUDE.md's section titles) and
`art-window-coverage.test.ts` (TODO.md's item numbers; its bucket-master
checks report "unavailable" there, no masters are fetched) — because a
notes-only PR can break exactly those. **A unit test that starts to read a
Markdown file joins `DOCS_READING_TESTS` and the `test:docs` script**;
`tests/unit/devops/ci-docs-only.test.ts` fails until it does (it scans every
unit-test source for a string naming a `.md`, `docs/`, `.claude`, README or
LICENSE), and fails too if app code starts to read a `.md`. The coverage
floors do not apply where no shard runs (notes, draft).

The **light** tier rests on one fact: when the branch already contained all
of `main`, the merge commit's files are byte for byte the files the pull
request's own run tested, and E2E, Frames published and Visual regression
are required checks there. The script proves it from git alone (the merge's
tree equals its second parent's, and its first parent is an ancestor of the
second). `main` moved under the PR → full. The manifest changed → full,
because `main`'s run is what SAVES the frame caches every pull request
restores (a PR can read only its base branch's caches).

Rules for whoever edits the workflow:

- Never a workflow-level `paths-ignore` (or `paths`): a workflow that does
  not start leaves the required checks "Waiting for status to be reported"
  and the PR cannot merge. A job skipped by its own `if` reports "skipped",
  which a required check accepts.
- A new job takes its group's condition, `needs: changes` and
  `if: ${{ !cancelled() && needs.changes.outputs.<static|unit|heavy> != 'false' }}`
  — so a FAILED classifier runs it — and is added to the test's `GROUP_JOBS`.
- The gate accepts exactly one shape per tier (the table in the workflow);
  "skipped" passes only where the classifier put it, and a failed or
  cancelled classifier is red.
- Artifacts: 3 days for a run's diagnostics (`coverage`, `playwright-report`,
  `visual-results-*`, `parity-report`, `parity-differences`), 7 for the two a
  contributor fetches to commit (`visual-baseline`, `parity-baseline`), 1 for
  the shards' blobs (read by the same run only). Nothing reads an artifact
  of another run.

`.github/workflows/ci.yml` runs on every PR and on `main`: typecheck, lint,
unit tests with coverage floors, `next build`, and the **full** Playwright
suite against a Supabase stack booted inside the runner (its keys are
generated per run; no secrets involved; the paid layer is switched on so the
pricing specs run). A red e2e job is a real signal — in 2026-09 the suite had
drifted to 12 failures locally and two of them were production bugs. The
job summary lists every skipped test and every test that only passed on a
retry (`scripts/e2e-summary.mjs`) — a flake that keeps appearing there is a
bug to fix, not noise.

The required **Typecheck, lint, unit** check is a gate over three jobs that
run side by side (in the full and light tiers; the other tiers above swap in
**Notes checks**): `static` (typecheck, lint, `next build`), `unit` (the unit
suite in six shards — vitest's `--shard`, a hash of each file's path, so
there is no file list to keep) and `coverage`, which merges the shards'
blob reports (`npm run test:coverage:merge`) and holds the coverage floors
of `vitest.config.ts` to the WHOLE suite. A shard only records coverage
(`VITEST_COVERAGE_SHARD=1`: its share of the tests could never meet a
floor); nothing else may set that variable. One machine's
`npm run test:coverage` is unchanged and checks the same floors.
`tests/unit/devops/ci-unit-shards.test.ts` pins the shape.

A shard is never faster than its slowest FILE (vitest runs a file on one
worker), so a file that takes minutes is split by a rule, not by a list: the
per-master art-window check runs in `art-window-coverage-<1..4>.test.ts`
(`tests/unit/render/art-window-masters.ts` — under coverage its pixel loops
run ~9× slower, and V8's coverage cannot be switched off for one file) and
the title-room bakes in `title-room-scaled-pips-bake-<1..4>.test.ts`
(`title-room-scaled-pips.ts`). Each part file is three lines; the first file
of each holds the proof that the parts are, together, exactly what the one
file checked — a part can be added or removed, never silently lost.

The **Visual regression** jobs gate the renderer's
pixels (next section) and **Preview parity** holds the browser preview to
the bake (the section after).

## Visual regression (renderer pixels, TODO 7.1)

The **Visual regression** job bakes a fixed card matrix through the real
Satori bake and compares each card's pixel hash with the committed
`tests/visual/baseline.json`:

- `tests/visual/matrix.ts` — every frame template (published or not) × 8
  colours (the seven frame keys, gold as three colours, plus a two-colour
  card) × a short and a long card of the template's first kind; every other
  kind the template hosts once; foil and etched on a spread of frames; the
  HD preset (the stored bake's size) for every template's long card; square
  print corners on a few; an "edge" card (100/100, a four-mode Command,
  reversed-hybrid and unknown symbols) on one frame per family. A new
  template, kind or colour joins by itself; a new rendering feature (a crown,
  a new finish) gets a case here in the PR that adds it.
- `tests/visual/bake.visual.ts` — the bake, with the stored bake's contract
  (brand mark, no footer text, round corners). Hermetic: generated art, the
  committed/locked fonts, and the frames bucket objects read from a local
  cache (`tmp/visual/frames/`, gitignored) that the script fills by manifest
  key and checks against the manifest's sha256. Card Conjurer-derived frames
  never enter git: the baseline holds 16-hex hashes of the decoded pixels,
  nothing else.
- `scripts/visual-regression.mjs` + `scripts/lib/visual-gate.mjs` — fetch,
  shard, gate, report. The fetch (`scripts/lib/visual-frames.mjs`) takes a
  quick pass and then retries, one at a time, whatever storage refused (a
  429, a 5xx, a hang, a 400 for an object that is there).

```bash
npm run test:visual                # bake + gate (dev bucket locally)
npm run test:visual -- --update    # rewrite tests/visual/baseline.json
npm run test:visual -- --only m15/r/ --save   # a few cases, PNGs in tmp/visual/renders/
```

What CI does with a changed hash:

| The PR… | Result |
| --- | --- |
| changes pixels, no `CARD_LAYOUT_VERSION` bump | ❌ `unbumped-change` — bump it (+ `VERSION_ROLLOUT`, + a scope when only some cards change) |
| bumps, baseline not regenerated | ❌ `regenerate` — the diff list and the regenerate command; commit the new baseline |
| bumps, a changed case outside the bump's scope (judged at the base branch's version, before and after regenerating) | ❌ `outside-bump-scope` — the sweep would stamp that card without re-baking it |
| regenerates the baseline without a bump | ❌ `unbumped-regeneration` |
| adds, removes or redefines matrix cases (a case's row, preset or corners changed in `matrix.ts` — its input fingerprint moved) | ❌ `cases-changed` — regenerate; no bump needed |
| changes only print-only cases (square corners: the PDF and the Square download are rendered live, never stored) | ❌ `print-changed` — regenerate; no bump needed, never "outside the scope" |
| bumps with the regenerated baseline | ✅ |

Each baseline entry is `<pixel hash>:<input fingerprint>`: the same input
drawing different pixels is a renderer change; a new input is a matrix edit.
A change to the harness itself (the generated art or the render contract in
`bake.visual.ts`) raises `VISUAL_HARNESS` in `matrix.ts`, which redefines
every case — never raise it to get a renderer change past the gate.

"Bumped" is judged against the base branch (`--base HEAD^1` on CI's merge
commit), never against the baseline file. The bake runs in three parallel
jobs of four shards each; the gate job merges their hashes and uploads the
baseline it would write as the `visual-baseline` artifact —
`gh run download <run> -n visual-baseline -D tests/visual` takes it when
regenerating locally isn't convenient. The pipeline is deterministic across
platforms for the pinned sharp/libvips (2026-09-29: the baseline made on
darwin-arm64 / Node 25 matched all 849 cases on CI's linux-x64 / Node 24
runner, and a 3-shard local run matched the 4-shard baseline); if every case
changes at once with no code change, the report names the tool or input
that moved. `tests/unit/render/visual-matrix.test.ts` also fails the fast
unit run when the baseline no longer matches the matrix or the layout
version. DB frame-profile overrides are outside the suite (their saves null
the stamps and the platform re-bakes).

## Preview parity (the browser preview ⇄ the bake, TODO 3.11)

The card a person edits is drawn by `components/cards/card-preview.tsx` in
their browser; the card that is stored, shared and downloaded is drawn by
`lib/render/card-image.tsx` through Satori. The **Preview parity** job draws
the same cards in both and compares them — what a reviewer used to do by hand
with a throwaway page.

```bash
npx playwright install chromium        # once
npm run test:parity                    # frames → bake → Chromium → compare (≈ 1½ min)
npm run test:parity -- --only m15pw,saga --save   # a few cases; pictures in tmp/parity/out/
npm run test:parity -- --update        # re-record THIS platform's offsets — only the cases that moved
```

No database, no account, no `.env`: the suite starts its **own** `next dev`
on port 3187 with `PARITY_HARNESS=1` and never reuses a running server, and
the page's storage and frame requests are answered from local files. Next
allows one dev server per checkout: stop a `npm run dev` running in the SAME
checkout first (one in another worktree is fine).

- `tests/parity/cases.ts` — the matrix: rows of `tests/visual/matrix.ts`
  taken **by id** (the two harnesses cannot drift), one per template family
  and per feature that has drifted before (every symbol kind in cost and
  rules, a walker, a saga, split / aftermath / adventure / flip / battle,
  both faces of a transform and a modal card, tokens, an emblem, the 1993 /
  1997 / 2003 frames, borderless, crown + stamp + pair, the Vehicle frame's
  brown plate and its pair + crown, the Universes Beyond frame's triangle
  stamp and plate, the collector line,
  centred rules, art off its default position incl. focal 0 with zoom, foil
  and etched, an EXIF orientation-6 photo as stored and as uploaded, 3.24's
  Plains and textless cases). A new rendering feature of BOTH renderers gets
  a case here in the PR that adds it (≈ 3 s of CI each).
- `tests/parity/bake.parity.ts` (vitest) bakes each case at 750 px and HD
  with the stored bake's contract; `tests/parity/preview.parity.spec.ts`
  (Playwright, Chromium) mounts the **same data** in the real `CardPreview`
  on `/dev/parity` and screenshots it at the same pixel size (750 CSS px at
  1× and at 2×). The preview is given the PNG masters the bake read (it asks
  for the `.webp` siblings), so the comparison is of the renderers, not of
  the WebP encode.
- `/dev/parity` (`app/dev/parity/page.parity.tsx`) exists **only** on that
  server: `.parity.tsx` is a page extension only when `next.config.ts`'s
  `parityHarnessEnabled()` says so (development + the flag). A production
  build never compiles it (`tests/unit/devops/parity-harness-route.test.ts`).
- `tests/parity/compare.ts` — per **region** (the profile's own slots: title,
  cost, art, type, set symbol, rules, stat plate, footer, strip, an unturned
  second face…): `shift` (has the ink moved, by how many px), `mad` (mean
  absolute difference) and `hot` (share of the region that is another
  picture); and per 25 px **tile** of the whole card, so one inline pip out
  of place, a crown or a stamp is seen too.

Two rasterisers never agree to the pixel, so "the same" is three layers
(`tests/parity/thresholds.ts`):

1. `LIMITS` — what any region may measure (an offset of one CSS pixel or so,
   and the difference anti-aliasing leaves).
2. `KNOWN_DIFFERENCES` — the measurements over a limit **today**: each a
   real, described difference between the renderers with its numbers and
   bounds. They are findings. Fixing one means striking it (an entry nothing
   needs fails the run). `WITHIN_LIMIT_DIFFERENCES` beside them describes
   the systematic offsets that are inside the limits (zoomed art, TODO
   3.37): the unit run fails once a named case no longer records one.
3. `tests/parity/baseline/<platform>/<case>.json` — every region's offset
   as recorded per platform, one file per case (`tests/parity/README.md`
   has the format, why it is files, and the re-record sequence) (Chromium draws text differently on linux and macOS; `linux` is
   CI's and the one that gates a PR). Today's offset must be within ±1 px of
   it, either way — a preview nudged 2 px *towards* the bake fails like one
   nudged away — and no region or tile may differ much more than recorded.

When the job is red:

| What it says | What to do |
| --- | --- |
| a region "sits at x,y — it was x,y", or tiles "differ more than recorded" | One renderer moved without the other. Look at `tmp/parity/out/<case>@<size>.{preview,bake,diff}.png` (CI: the `parity-differences` artifact) and fix the renderer that is wrong. |
| the same, and BOTH renderers were changed on purpose (the numbers moved a little with them) | Re-record — `tests/parity/README.md` "Re-recording": `npm run test:parity -- --update` for your platform, push, then paste the script the red **Preview parity** run prints for linux, push again. Only the cases that moved change. Say in the PR what moved. |
| "over the limit and no known difference names it" | A new real difference. Fix it — or, if it stays, describe it in `KNOWN_DIFFERENCES` with its measured numbers and bounds. Never raise a `LIMIT` to make a case pass. |
| "known difference … is no longer measured anywhere" | It was fixed: strike the entry. |
| a new case is "not in tests/parity/baseline/ for this platform" | Record it (the same sequence: one new file per platform). Until `linux/` has it, **Preview parity** and the unit test `parity-matrix.test.ts` are both red. |
| "The parity baseline cannot be read" | A case file is not the text an update writes: a hand edit, a line doubled by a merge, a file under another case's name, a conflict's leftovers, or #514's `baseline.json` come back from an older branch. Take either side's file whole (or delete it) and re-record. |

An update refuses to record a value over a limit that no known difference
names, so the baseline cannot quietly absorb a regression; it never touches
a limit, and it leaves every case that is still inside its recorded
tolerance byte for byte (`--update --all` re-records them all, and says so). No retries: a
case that passes only sometimes is a finding.

## Full e2e coverage (local Supabase stack)

E2E tests create and wipe data, so they **only** run against the local Docker
stack — never the shared `dev` branch (other previews and your own local
session are using it) and never production. `scripts/seed-e2e.mjs` refuses any
non-local URL.

The stack comes up already seeded (`supabase/seed.sql` +
`supabase/seeds/10_dev_data.sql`): five `dev_*` accounts, 26 cards, decks,
challenges. Specs may read that content, but must not depend on its exact
counts — assert on what the spec itself created. The e2e user is separate
(`e2e_forger`, an admin) and is wiped on every `seed-e2e` run; a second,
plain FREE account (`e2e_free`, the main email with a `+free` tag, same
password — override with `SUPABASE_E2E_FREE_USER_EMAIL`) exists for the
billing specs, because an admin is fully unlocked and never sees what a
customer sees on `/pricing`. `signIn(page, { as: "free" })` picks it.

The auth / create / custom-pips / Scryfall / decks / challenges /
frame-editor / pricing specs need a database they can freely write to. That's the local stack — never production:

```bash
# one-time
supabase start                  # boots the stack + applies supabase/migrations/*
                                # (needs a container runtime, e.g. `brew install
                                # colima docker && colima start --memory 4`)
cp .env.e2e.example .env.e2e    # then paste the publishable + secret keys
                                # printed by `supabase status` into it
node scripts/seed-e2e.mjs       # creates the e2e user (idempotent); also re-opens the
                                # "Arcane Frontiers" challenge the challenge specs use

# every run
npx playwright test             # the full suite (every spec)
```

When `.env.e2e` exists, `playwright.config.ts` boots its **own** dev
server on **port 3100** with those values (explicit env beats
`.env.local` inside the spawned server), so your normal `:3000` dev
server and the real project are untouched. One caveat: Next 16 allows a
single `next dev` per project directory — stop your `:3000` server
before running the suite.

Without `.env.e2e`, behavior is unchanged: port 3000, marketing + a11y
smoke only, cred-gated specs skip with a documented reason.

The password-reset flow reads the emailed link from the local stack's
**Mailpit** inbox (`E2E_MAILPIT_URL`, default `http://127.0.0.1:54324`) and
skips when it isn't reachable. After a `supabase db reset`, run
`node scripts/seed-e2e.mjs` again — the reset wipes the e2e user.

## Conventions

- One file per logical area under `tests/unit/<area>/` (e.g.
  `cards/validation.test.ts`, `scryfall/import-mapper.test.ts`).
- Use `describe` blocks for the function under test; individual `it`
  cases assert one behavior each.
- Don't spin up a database in unit tests. Pure `lib/` helpers are tested
  directly; DB-touching billing logic (webhook handlers, refill, reconcile)
  is tested against a minimal recording stub of the admin client (see
  `tests/unit/billing/`). E2E tests run against the real (local) stack.
- Sign in through `tests/e2e/helpers/sign-in.ts` — never paste the login
  form's selectors into a spec.
- E2E specs that depend on env vars should `test.skip` (with a
  documented reason) when the vars are absent, so a contributor without
  the setup sees a clear skip rather than a confusing failure.
- Prefer step-rail navigation over walking "Next" in editor specs: the
  sticky bar swaps Next → Save in place on the last transition, and a
  click racing that swap can submit early.
