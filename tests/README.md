# Tests

Two-tier test layer:

- **Unit tests** (`tests/unit/`) — Vitest, run in Node. Cover pure
  `lib/` helpers: validation schemas, Scryfall import mapper, mana-cost
  tokenizer, pip overrides.
- **End-to-end tests** (`tests/e2e/`) — Playwright, run against a live
  dev server. Marketing + a11y smoke run anywhere; the auth / create /
  Scryfall / pricing specs run against the **local Supabase stack**
  (see below) and `test.skip()` cleanly when it isn't set up.

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

## Full e2e coverage (local Supabase stack)

The auth / create / Scryfall / pricing specs need a database they can
freely write to. That's the local stack — never production:

```bash
# one-time
supabase start                  # boots the stack + applies supabase/migrations/*
                                # (needs a container runtime, e.g. `brew install
                                # colima docker && colima start --memory 4`)
cp .env.e2e.example .env.e2e    # then paste the publishable + secret keys
                                # printed by `supabase status` into it
node scripts/seed-e2e.mjs       # creates the e2e user (idempotent)

# every run
npx playwright test             # 12/12 — full suite
```

When `.env.e2e` exists, `playwright.config.ts` boots its **own** dev
server on **port 3100** with those values (explicit env beats
`.env.local` inside the spawned server), so your normal `:3000` dev
server and the real project are untouched. One caveat: Next 16 allows a
single `next dev` per project directory — stop your `:3000` server
before running the suite.

Without `.env.e2e`, behavior is unchanged: port 3000, marketing + a11y
smoke only, cred-gated specs skip with a documented reason.

## Conventions

- One file per logical area (`validation.test.ts`, `import-mapper.test.ts`).
- Use `describe` blocks for the function under test; individual `it`
  cases assert one behavior each.
- Don't mock the database — unit tests cover pure functions only. E2E
  tests run against the real (local) stack.
- E2E specs that depend on env vars should `test.skip` (with a
  documented reason) when the vars are absent, so a contributor without
  the setup sees a clear skip rather than a confusing failure.
- Prefer step-rail navigation over walking "Next" in editor specs: the
  sticky bar swaps Next → Save in place on the last transition, and a
  click racing that swap can submit early.
