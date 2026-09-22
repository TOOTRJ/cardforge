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

`.github/workflows/ci.yml` runs on every PR and on `main`: typecheck, lint,
unit tests with coverage floors, `next build`, and the **full** Playwright
suite against a Supabase stack booted inside the runner (its keys are
generated per run; no secrets involved; the paid layer is switched on so the
pricing specs run). A red e2e job is a real signal — in 2026-09 the suite had
drifted to 12 failures locally and two of them were production bugs. The
job summary lists every skipped test and every test that only passed on a
retry (`scripts/e2e-summary.mjs`) — a flake that keeps appearing there is a
bug to fix, not noise.

## Full e2e coverage (local Supabase stack)

E2E tests create and wipe data, so they **only** run against the local Docker
stack — never the shared `dev` branch (other previews and your own local
session are using it) and never production. `scripts/seed-e2e.mjs` refuses any
non-local URL.

The stack comes up already seeded (`supabase/seed.sql` +
`supabase/seeds/10_dev_data.sql`): five `dev_*` accounts, 22 cards, decks,
challenges. Specs may read that content, but must not depend on its exact
counts — assert on what the spec itself created. The e2e user is separate
(`e2e_forger`) and is wiped on every `seed-e2e` run.

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
